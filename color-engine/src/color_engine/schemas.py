"""Pydantic v2 request and response contracts for MatchTone color-engine."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from color_engine.errors import FailureCode

TransferMethod = Literal["hm-mvgd-hm", "hm-mkl-hm", "mkl", "mvgd", "reinhard", "hm"]
OutputFormat = Literal["png", "jpg", "webp", "tiff"]

SUPPORTED_METHODS: tuple[TransferMethod, ...] = (
    "hm-mvgd-hm",
    "hm-mkl-hm",
    "mkl",
    "mvgd",
    "reinhard",
    "hm",
)
SUPPORTED_FORMATS: tuple[OutputFormat, ...] = ("png", "jpg", "webp", "tiff")


class MemoryStats(BaseModel):
    rss_mb: float
    peak_rss_mb: float


class LatencyStats(BaseModel):
    count: int
    p50_ms: float
    p95_ms: float
    last_ms: float


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    ready: bool
    version: str
    engine: Literal["color-matcher"] = "color-matcher"
    engine_version: str
    methods: list[TransferMethod]
    warmup_ms: float
    uptime_seconds: float
    memory: MemoryStats
    latency: LatencyStats


class BreakdownMs(BaseModel):
    decode_ms: float
    transfer_ms: float
    encode_ms: float
    total_ms: float


class SingleMatchResponse(BaseModel):
    preview_data_url: str
    download_data_url: str
    mime_type: str
    output_path: str | None
    suggested_filename: str
    width: int
    height: int
    format: OutputFormat
    method: TransferMethod
    intensity: float
    breakdown_ms: BreakdownMs
    memory: MemoryStats
    latency: LatencyStats


class BatchItemResult(BaseModel):
    filename: str
    status: Literal["ok", "error"]
    output_path: str | None
    output_filename: str | None
    width: int | None
    height: int | None
    duration_ms: float
    error: str | None
    preview_data_url: str | None = None
    download_data_url: str | None = None


class BatchMatchResponse(BaseModel):
    output_dir: str | None
    zip_data_url: str | None
    zip_filename: str
    method: TransferMethod
    intensity: float
    format: OutputFormat
    total_count: int
    succeeded_count: int
    failed_count: int
    total_ms: float
    items: list[BatchItemResult]
    memory: MemoryStats
    latency: LatencyStats


class ClientLogRequest(BaseModel):
    level: Literal["debug", "info", "warn", "warning", "error"] = "info"
    message: str = Field(min_length=1, max_length=8192)
    context: dict[str, object] = Field(default_factory=dict)


class ClientLogResponse(BaseModel):
    ok: bool = True


class ErrorResponse(BaseModel):
    detail: str
    failure_code: FailureCode
