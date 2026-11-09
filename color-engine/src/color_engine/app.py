"""FastAPI application implementing the MatchTone color-engine sidecar contract."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import anyio.to_thread
import color_matcher
from fastapi import FastAPI, File, Form, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from color_engine import __version__
from color_engine.errors import EngineError, FailureCode
from color_engine.matcher import (
    SUPPORTED_BATCH_EXTS,
    BatchSourceCandidate,
    get_max_upload_bytes,
    process_batch_sync,
    process_single_sync,
    validate_intensity,
    validate_method,
    validate_output_format,
)
from color_engine.schemas import (
    SUPPORTED_METHODS,
    BatchMatchResponse,
    ClientLogRequest,
    ClientLogResponse,
    HealthResponse,
    SingleMatchResponse,
)
from color_engine.telemetry import EngineTelemetry, configure_logging

CORS_ORIGIN_REGEX = r"^(https?://(127\.0\.0\.1|localhost)(:\d+)?|null)$"


async def _read_upload_bounded(upload: UploadFile | None, max_bytes: int) -> bytes | None:
    if upload is None:
        return None
    data = await upload.read(max_bytes + 1)
    if len(data) > max_bytes:
        max_mb = round(max_bytes / (1024 * 1024), 2)
        raise EngineError(
            413,
            "PAYLOAD_TOO_LARGE",
            f"Uploaded file '{upload.filename or 'upload'}' exceeds maximum size ({max_mb} MB).",
        )
    if not data:
        return None
    return data


def _error_json(status_code: int, failure_code: FailureCode, detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail, "failure_code": failure_code},
    )


def create_app() -> FastAPI:
    logger = configure_logging()
    telemetry = EngineTelemetry()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
        warmup_ms = await anyio.to_thread.run_sync(telemetry.run_warmup)
        logger.info(
            "color-engine ready",
            extra={
                "structured": {
                    "version": __version__,
                    "engine_version": color_matcher.__version__,
                    "warmup_ms": warmup_ms,
                }
            },
        )
        yield

    app = FastAPI(
        title="MatchTone Color Engine",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=CORS_ORIGIN_REGEX,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.exception_handler(EngineError)
    async def handle_engine_error(_request: Request, exc: EngineError) -> JSONResponse:
        logger.warning(
            exc.detail,
            extra={
                "structured": {
                    "status_code": exc.status_code,
                    "failure_code": exc.failure_code,
                }
            },
        )
        return _error_json(exc.status_code, exc.failure_code, exc.detail)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        _request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        if exc.status_code in (404, 405):
            detail = "Route not found" if exc.status_code == 404 else str(exc.detail)
            return _error_json(exc.status_code, "NOT_FOUND", detail)
        return _error_json(exc.status_code, "INTERNAL_ERROR", str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        errors = exc.errors()
        first_loc = ".".join(str(part) for part in errors[0].get("loc", ())) if errors else ""
        first_msg = (
            str(errors[0].get("msg", "Invalid request payload")) if errors else "Invalid request"
        )
        if "intensity" in first_loc:
            return _error_json(400, "INVALID_INTENSITY", f"Invalid intensity: {first_msg}")
        if "method" in first_loc:
            return _error_json(400, "INVALID_METHOD", f"Invalid method: {first_msg}")
        return _error_json(422, "INVALID_IMAGE", f"Validation error ({first_loc}): {first_msg}")

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled server exception")
        return _error_json(500, "INTERNAL_ERROR", f"Internal engine error: {exc}")

    @app.get("/favicon.ico", status_code=204)
    async def favicon() -> Response:
        return Response(status_code=204)

    @app.get("/health")
    async def health() -> HealthResponse:
        if not telemetry.ready:
            await anyio.to_thread.run_sync(telemetry.run_warmup)
        return HealthResponse(
            status="ok",
            ready=telemetry.ready,
            version=__version__,
            engine="color-matcher",
            engine_version=color_matcher.__version__,
            methods=list(SUPPORTED_METHODS),
            warmup_ms=telemetry.warmup_ms,
            uptime_seconds=telemetry.uptime_seconds,
            memory=telemetry.memory_stats(),
            latency=telemetry.latency_stats(),
        )

    @app.post("/v1/match/single")
    async def match_single(
        src_file: Annotated[UploadFile | None, File()] = None,
        ref_file: Annotated[UploadFile | None, File()] = None,
        src_path: Annotated[str | None, Form()] = None,
        ref_path: Annotated[str | None, Form()] = None,
        method: Annotated[str, Form()] = "hm-mvgd-hm",
        intensity: Annotated[str, Form()] = "100",
        output_format: Annotated[str, Form()] = "png",
        output_dir: Annotated[str | None, Form()] = None,
        save_to_disk: Annotated[bool, Form()] = False,
        source_name: Annotated[str | None, Form()] = None,
        filename_suffix: Annotated[str, Form()] = "_matchtone",
    ) -> SingleMatchResponse:
        validated_method = validate_method(method)
        validated_intensity = validate_intensity(intensity)
        validated_format = validate_output_format(output_format)

        max_bytes = get_max_upload_bytes()
        src_bytes = await _read_upload_bounded(src_file, max_bytes)
        ref_bytes = await _read_upload_bounded(ref_file, max_bytes)

        effective_name = (
            source_name.strip()
            if source_name and source_name.strip()
            else (
                Path(src_path.strip()).name
                if src_path and src_path.strip()
                else (src_file.filename if src_file and src_file.filename else "Source photo")
            )
        )
        effective_ref_name = (
            Path(ref_path.strip()).name
            if ref_path and ref_path.strip()
            else (ref_file.filename if ref_file and ref_file.filename else "Reference photo")
        )

        result = await anyio.to_thread.run_sync(
            lambda: process_single_sync(
                src_bytes=src_bytes,
                src_path=src_path,
                ref_bytes=ref_bytes,
                ref_path=ref_path,
                method=validated_method,
                intensity=validated_intensity,
                output_format=validated_format,
                output_dir=output_dir,
                save_to_disk=save_to_disk,
                source_name=effective_name,
                reference_name=effective_ref_name,
                filename_suffix=filename_suffix,
            )
        )

        latency = telemetry.record_latency(result.breakdown_ms.total_ms)
        memory = telemetry.memory_stats()
        logger.info(
            "single match completed",
            extra={
                "structured": {
                    "method": result.method,
                    "intensity": result.intensity,
                    "format": result.output_format,
                    "width": result.width,
                    "height": result.height,
                    "total_ms": result.breakdown_ms.total_ms,
                    "rss_mb": memory.rss_mb,
                }
            },
        )
        return SingleMatchResponse(
            preview_data_url=result.preview_data_url,
            download_data_url=result.download_data_url,
            mime_type=result.mime_type,
            output_path=result.output_path,
            suggested_filename=result.suggested_filename,
            width=result.width,
            height=result.height,
            format=result.output_format,
            method=result.method,
            intensity=result.intensity,
            breakdown_ms=result.breakdown_ms,
            memory=memory,
            latency=latency,
        )

    @app.post("/v1/match/batch")
    async def match_batch(
        ref_file: Annotated[UploadFile | None, File()] = None,
        ref_path: Annotated[str | None, Form()] = None,
        src_dir: Annotated[str | None, Form()] = None,
        src_files: Annotated[list[UploadFile] | None, File()] = None,
        method: Annotated[str, Form()] = "hm-mvgd-hm",
        intensity: Annotated[str, Form()] = "100",
        output_format: Annotated[str, Form()] = "png",
        output_dir: Annotated[str | None, Form()] = None,
        filename_suffix: Annotated[str, Form()] = "_matchtone",
    ) -> BatchMatchResponse:
        validated_method = validate_method(method)
        validated_intensity = validate_intensity(intensity)
        validated_format = validate_output_format(output_format)

        max_bytes = get_max_upload_bytes()
        ref_bytes = await _read_upload_bounded(ref_file, max_bytes)

        candidates: list[BatchSourceCandidate] = []
        resolved_output_dir: Path | None = None

        cleaned_src_dir = src_dir.strip() if src_dir else ""
        cleaned_out_dir = output_dir.strip() if output_dir else ""

        if cleaned_src_dir:
            src_dir_path = Path(cleaned_src_dir).expanduser().resolve()
            if not src_dir_path.exists() or not src_dir_path.is_dir():
                raise EngineError(
                    400,
                    "PATH_NOT_FOUND",
                    f"Source directory not found: {cleaned_src_dir}",
                )
            for entry in sorted(src_dir_path.iterdir(), key=lambda p: p.name.lower()):
                if entry.is_file() and entry.suffix.lower() in SUPPORTED_BATCH_EXTS:
                    candidates.append(
                        BatchSourceCandidate(display_name=entry.name, file_path=entry)
                    )
            resolved_output_dir = (
                Path(cleaned_out_dir).expanduser().resolve()
                if cleaned_out_dir
                else src_dir_path / f"matchtone_{validated_method}"
            )
        else:
            if src_files:
                for upload in src_files:
                    fname = (upload.filename or "").strip()
                    if not fname:
                        continue
                    if Path(fname).suffix.lower() not in SUPPORTED_BATCH_EXTS:
                        continue
                    raw = await _read_upload_bounded(upload, max_bytes)
                    candidates.append(
                        BatchSourceCandidate(
                            display_name=Path(fname).name,
                            raw_bytes=raw if raw is not None else b"",
                        )
                    )
            if cleaned_out_dir:
                resolved_output_dir = Path(cleaned_out_dir).expanduser().resolve()

        if not candidates:
            raise EngineError(
                400,
                "EMPTY_BATCH",
                "No supported image files provided for batch processing.",
            )

        effective_ref_name = (
            Path(ref_path.strip()).name
            if ref_path and ref_path.strip()
            else (ref_file.filename if ref_file and ref_file.filename else "Reference photo")
        )

        batch_res = await anyio.to_thread.run_sync(
            lambda: process_batch_sync(
                ref_bytes=ref_bytes,
                ref_path=ref_path,
                candidates=candidates,
                method=validated_method,
                intensity=validated_intensity,
                output_format=validated_format,
                resolved_output_dir=resolved_output_dir,
                reference_name=effective_ref_name,
                filename_suffix=filename_suffix,
            )
        )

        for item_ms in batch_res.item_durations_ms:
            telemetry.record_latency(item_ms)
        latency = telemetry.latency_stats()
        memory = telemetry.memory_stats()

        logger.info(
            "batch match completed",
            extra={
                "structured": {
                    "method": batch_res.method,
                    "total_count": batch_res.total_count,
                    "succeeded_count": batch_res.succeeded_count,
                    "failed_count": batch_res.failed_count,
                    "total_ms": batch_res.total_ms,
                    "rss_mb": memory.rss_mb,
                }
            },
        )
        return BatchMatchResponse(
            output_dir=batch_res.output_dir,
            zip_data_url=batch_res.zip_data_url,
            zip_filename=batch_res.zip_filename,
            method=batch_res.method,
            intensity=batch_res.intensity,
            format=batch_res.output_format,
            total_count=batch_res.total_count,
            succeeded_count=batch_res.succeeded_count,
            failed_count=batch_res.failed_count,
            total_ms=batch_res.total_ms,
            items=batch_res.items,
            memory=memory,
            latency=latency,
        )

    @app.post("/v1/client-log")
    async def client_log(payload: ClientLogRequest) -> ClientLogResponse:
        log_extra = {"structured": {"source": "renderer", "context": payload.context}}
        if payload.level == "error":
            logger.error(payload.message, extra=log_extra)
        elif payload.level in ("warn", "warning"):
            logger.warning(payload.message, extra=log_extra)
        elif payload.level == "debug":
            logger.debug(payload.message, extra=log_extra)
        else:
            logger.info(payload.message, extra=log_extra)
        return ClientLogResponse(ok=True)

    return app


app = create_app()
