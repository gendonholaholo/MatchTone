"""Core image decoding, color-matcher execution, alpha preservation, and encoding."""

from __future__ import annotations

import asyncio
import base64
import math
import os
import re
import time
import warnings
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import numpy as np
from color_matcher import ColorMatcher
from color_matcher.normalizer import Normalizer
from PIL import Image, ImageOps, UnidentifiedImageError

from color_engine.errors import EngineError
from color_engine.schemas import (
    SUPPORTED_METHODS,
    BatchItemResult,
    BreakdownMs,
    OutputFormat,
    TransferMethod,
)

SUPPORTED_BATCH_EXTS: frozenset[str] = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif", ".bmp"}
)

FORMAT_TO_MIME: dict[OutputFormat, str] = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "tiff": "image/tiff",
}

_SAFE_STEM_RE = re.compile(r"[^A-Za-z0-9._-]+")
_MULTI_UNDERSCORE_RE = re.compile(r"_+")
MAX_INLINE_BATCH_DOWNLOADS = 30


@dataclass(slots=True)
class DecodedImage:
    rgb: Image.Image
    alpha: Image.Image | None
    width: int
    height: int


@dataclass(slots=True)
class EncodedImage:
    output_bytes: bytes
    preview_bytes: bytes
    mime_type: str
    preview_mime_type: str
    width: int
    height: int


@dataclass(slots=True)
class SingleProcessResult:
    preview_data_url: str
    download_data_url: str
    mime_type: str
    output_path: str | None
    suggested_filename: str
    width: int
    height: int
    output_format: OutputFormat
    method: TransferMethod
    intensity: float
    breakdown_ms: BreakdownMs


@dataclass(slots=True)
class BatchSourceCandidate:
    display_name: str
    raw_bytes: bytes | None = None
    file_path: Path | None = None


@dataclass(slots=True)
class BatchProcessResult:
    output_dir: str | None
    zip_data_url: str | None
    zip_filename: str
    method: TransferMethod
    intensity: float
    output_format: OutputFormat
    total_count: int
    succeeded_count: int
    failed_count: int
    total_ms: float
    items: list[BatchItemResult]
    item_durations_ms: list[float]


def get_max_upload_bytes() -> int:
    raw = os.environ.get("MATCHTONE_MAX_UPLOAD_MB", "64").strip()
    try:
        mb = float(raw)
    except ValueError:
        mb = 64.0
    if not math.isfinite(mb) or mb <= 0:
        mb = 64.0
    return max(1024, int(mb * 1024 * 1024))


def validate_method(raw_method: str) -> TransferMethod:
    normalized = raw_method.strip().lower()
    for candidate in SUPPORTED_METHODS:
        if normalized == candidate:
            return candidate
    allowed = ", ".join(SUPPORTED_METHODS)
    raise EngineError(
        400,
        "INVALID_METHOD",
        f"Unsupported color transfer method '{raw_method}'. Expected one of: {allowed}.",
    )


def validate_intensity(raw_intensity: float | str) -> float:
    try:
        val = float(raw_intensity)
    except (TypeError, ValueError):
        raise EngineError(
            400,
            "INVALID_INTENSITY",
            f"Intensity '{raw_intensity}' is not a valid number.",
        ) from None
    if not math.isfinite(val) or val < 0.0 or val > 100.0:
        raise EngineError(
            400,
            "INVALID_INTENSITY",
            f"Intensity must be between 0 and 100 (received {val}).",
        )
    return val


def validate_output_format(raw_format: str) -> OutputFormat:
    normalized = raw_format.strip().lower().lstrip(".")
    if normalized == "jpeg":
        return "jpg"
    if normalized == "tif":
        return "tiff"
    if normalized == "png":
        return "png"
    if normalized == "jpg":
        return "jpg"
    if normalized == "webp":
        return "webp"
    if normalized == "tiff":
        return "tiff"
    raise EngineError(
        400,
        "INVALID_IMAGE",
        f"Unsupported output format '{raw_format}'. Expected png, jpg, webp, or tiff.",
    )


def sanitize_stem(raw_name: str | None) -> str:
    if not raw_name:
        return "image"
    base = os.path.basename(raw_name.strip().replace("\\", "/"))
    stem = Path(base).stem.strip()
    cleaned = _SAFE_STEM_RE.sub("_", stem).strip("._-")
    return cleaned or "image"


def sanitize_suffix(raw_suffix: str | None) -> str:
    if raw_suffix is None:
        return "_matchtone"
    cleaned = _SAFE_STEM_RE.sub("_", raw_suffix.strip())
    cleaned = _MULTI_UNDERSCORE_RE.sub("_", cleaned).strip(".")
    if not cleaned or cleaned in ("_", "-"):
        return "_matchtone"
    if not cleaned.startswith(("_", "-")):
        cleaned = f"_{cleaned}"
    return cleaned


def build_suggested_filename(
    raw_name: str | None,
    method: TransferMethod,
    output_format: OutputFormat,
    filename_suffix: str | None = None,
) -> str:
    stem = sanitize_stem(raw_name)
    suffix = sanitize_suffix(filename_suffix)
    return f"{stem}{suffix}_{method}.{output_format}"


def decode_image_bytes(
    raw_bytes: bytes,
    *,
    keep_alpha: bool,
    label: str = "Photo",
) -> DecodedImage:
    clean_label = os.path.basename(label.strip().replace("\\", "/")) or "Photo"
    if not raw_bytes:
        raise EngineError(
            400,
            "INVALID_IMAGE",
            f"Cannot open '{clean_label}' — file is empty.",
        )
    try:
        with Image.open(BytesIO(raw_bytes)) as opened:
            opened.load()
            transposed = ImageOps.exif_transpose(opened)
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
    ):
        raise EngineError(
            400,
            "INVALID_IMAGE",
            f"Cannot open '{clean_label}' — file is damaged or not a valid photo.",
        ) from None

    width, height = transposed.size
    if width < 2 or height < 2:
        raise EngineError(
            400,
            "IMAGE_TOO_SMALL",
            f"Image dimensions ({width}x{height}) must be at least 2x2 pixels.",
        )

    has_alpha = transposed.mode in ("RGBA", "LA", "PA") or (
        transposed.mode == "P" and "transparency" in transposed.info
    )
    if has_alpha:
        rgba = transposed.convert("RGBA")
        if keep_alpha:
            r_ch, g_ch, b_ch, a_ch = rgba.split()
            rgb = Image.merge("RGB", (r_ch, g_ch, b_ch))
            return DecodedImage(rgb=rgb, alpha=a_ch, width=width, height=height)
        white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        rgb = Image.alpha_composite(white, rgba).convert("RGB")
        return DecodedImage(rgb=rgb, alpha=None, width=width, height=height)

    if transposed.mode.startswith("I;16"):
        arr16 = np.asarray(transposed, dtype=np.float64)
        u8 = (
            Normalizer(arr16).uint8_norm()
            if float(arr16.max()) > float(arr16.min())
            else np.clip(np.round(arr16 / 257.0), 0, 255).astype(np.uint8)
        )
        rgb = Image.fromarray(u8, mode="L").convert("RGB")
    else:
        rgb = transposed.convert("RGB")
    return DecodedImage(rgb=rgb, alpha=None, width=width, height=height)


def decode_image_path(
    raw_path: str,
    *,
    keep_alpha: bool,
    label: str | None = None,
) -> DecodedImage:
    expanded = Path(raw_path).expanduser()
    if not expanded.exists() or not expanded.is_file():
        raise EngineError(400, "PATH_NOT_FOUND", f"Image file not found: {raw_path}")
    display_label = label or expanded.name or raw_path
    try:
        raw_bytes = expanded.read_bytes()
    except OSError as exc:
        raise EngineError(
            400, "PATH_NOT_FOUND", f"Cannot read image file '{display_label}': {exc}"
        ) from None
    return decode_image_bytes(raw_bytes, keep_alpha=keep_alpha, label=display_label)


def _regularized_mkl_transfer(
    src_arr: np.ndarray,
    ref_arr: np.ndarray,
) -> tuple[np.ndarray, float]:
    """Compute Tikhonov-regularized MKL color transfer using symmetric eigh."""
    r = src_arr.reshape(-1, 3).T
    z = ref_arr.reshape(-1, 3).T
    mu_r = r.mean(axis=1, keepdims=True)
    mu_z = z.mean(axis=1, keepdims=True)

    raw_cov_r = np.cov(r)
    raw_cov_z = np.cov(z)
    if np.ndim(raw_cov_r) < 2 or np.ndim(raw_cov_z) < 2:
        return np.clip(src_arr - mu_r.T + mu_z.T, 0.0, 1.0), 1.0

    eig_raw = np.linalg.eigvalsh(raw_cov_r)
    min_eig = max(float(eig_raw[0]), 1e-9)
    max_eig = max(float(eig_raw[-1]), 1e-9)
    cond_val = max_eig / min_eig

    # Adaptive damping prevents minor-axis chroma noise blowup on portraits/indoor photos
    reg_eps = 0.018 if cond_val > 150.0 else 0.014
    cov_r = raw_cov_r + np.eye(3, dtype=np.float64) * reg_eps
    cov_z = raw_cov_z + np.eye(3, dtype=np.float64) * (reg_eps * 0.5)

    eig_val_r, eig_vec_r = np.linalg.eigh(cov_r)
    eig_val_r = np.maximum(eig_val_r, 1e-6)
    val_r = np.diag(np.sqrt(eig_val_r))
    inv_r = np.diag(1.0 / np.sqrt(eig_val_r))

    mat_c = val_r @ eig_vec_r.T @ cov_z @ eig_vec_r @ val_r
    eig_val_c, eig_vec_c = np.linalg.eigh(mat_c)
    eig_val_c = np.maximum(eig_val_c, 0.0)
    val_c = np.diag(np.sqrt(eig_val_c))

    transfer_mat = eig_vec_r @ inv_r @ eig_vec_c @ val_c @ eig_vec_c.T @ inv_r @ eig_vec_r.T
    res = (transfer_mat @ (r - mu_r) + mu_z).T.reshape(src_arr.shape)
    return np.clip(res, 0.0, 1.0), cond_val


def _apply_photographic_luma_lock(
    src_rgb: Image.Image,
    palette_arr: np.ndarray,
    *,
    cond_val: float,
) -> Image.Image:
    """Preserve original luminance gradients and guard specular highlights in YCbCr."""
    pal_u8 = np.clip(np.round(palette_arr * 255.0), 0.0, 255.0).astype(np.uint8)
    pal_img = Image.fromarray(pal_u8, mode="RGB")

    src_ycbcr = np.asarray(src_rgb.convert("YCbCr"), dtype=np.float64)
    pal_ycbcr = np.asarray(pal_img.convert("YCbCr"), dtype=np.float64)

    # Retain 60% original luminance so skies never band and shadow detail stays crisp
    luma_keep = 0.60
    y_orig = src_ycbcr[:, :, 0] / 255.0
    y_pal = pal_ycbcr[:, :, 0] / 255.0
    y_blend = luma_keep * y_orig + (1.0 - luma_keep) * y_pal

    # Gentle filmic S-curve toe/shoulder roll-off
    y_filmic = np.clip(y_blend - 0.055 * np.sin(2.0 * np.pi * y_blend), 0.0, 1.0)

    chroma_scale = 1.15
    cb_out = 128.0 + (pal_ycbcr[:, :, 1] - 128.0) * chroma_scale
    cr_out = 128.0 + (pal_ycbcr[:, :, 2] - 128.0) * chroma_scale

    # Specular highlight guard:
    # 1) Prevent cool cyan blowups across all bright highlights (y > 0.70)
    # 2) Keep extreme specular peaks (y > 0.86, e.g. eye sclera/teeth) neutral white
    cool_mask = np.clip((y_orig - 0.70) / 0.25, 0.0, 1.0) * 0.85
    spec_mask = np.clip((y_orig - 0.84) / 0.10, 0.0, 1.0) * 0.85
    hi_mask = np.where(cb_out > src_ycbcr[:, :, 1], np.maximum(cool_mask, spec_mask), spec_mask)
    cb_out = cb_out * (1.0 - hi_mask) + src_ycbcr[:, :, 1] * hi_mask
    cr_out = cr_out * (1.0 - hi_mask) + src_ycbcr[:, :, 2] * hi_mask

    out_ycbcr = np.empty_like(src_ycbcr)
    out_ycbcr[:, :, 0] = np.round(y_filmic * 255.0)
    out_ycbcr[:, :, 1] = np.clip(cb_out, 0.0, 255.0)
    out_ycbcr[:, :, 2] = np.clip(cr_out, 0.0, 255.0)

    return Image.fromarray(out_ycbcr.astype(np.uint8), mode="YCbCr").convert("RGB")


def run_color_transfer(
    src: DecodedImage,
    ref_rgb: Image.Image,
    method: TransferMethod,
    intensity: float,
) -> Image.Image:
    if intensity == 0.0:
        return src.rgb.copy()

    src_arr = np.asarray(src.rgb, dtype=np.float64) / 255.0
    ref_arr = np.asarray(ref_rgb, dtype=np.float64) / 255.0

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            cm = ColorMatcher()
            raw_res = cm.transfer(src=src_arr.copy(), ref=ref_arr.copy(), method=method)
            real_res = np.asarray(np.real(raw_res), dtype=np.float64)
            if not np.isfinite(real_res).all():
                fallback_res = cm.transfer(src=src_arr.copy(), ref=ref_arr.copy(), method="hm")
                real_res = np.asarray(np.real(fallback_res), dtype=np.float64)
    except (KeyboardInterrupt, SystemExit, asyncio.CancelledError):
        raise
    except BaseException as exc:
        raise EngineError(
            400,
            "INVALID_IMAGE",
            f"Color transfer failed ({method}): {exc}",
        ) from None

    if not np.isfinite(real_res).all():
        raise EngineError(
            400,
            "INVALID_IMAGE",
            f"Color transfer produced non-finite pixel values ({method}).",
        )

    clipped_raw = np.clip(real_res, 0.0, 1.0)
    reg_mkl, cond_val = _regularized_mkl_transfer(src_arr, ref_arr)

    if method in ("mkl", "mvgd"):
        palette_arr = reg_mkl
    else:
        palette_arr = np.clip(0.50 * reg_mkl + 0.50 * clipped_raw, 0.0, 1.0)

    transferred_rgb = _apply_photographic_luma_lock(
        src.rgb,
        palette_arr,
        cond_val=cond_val,
    )
    if intensity < 100.0:
        return Image.blend(src.rgb, transferred_rgb, intensity / 100.0)
    return transferred_rgb


def encode_matched_image(
    matched_rgb: Image.Image,
    alpha: Image.Image | None,
    output_format: OutputFormat,
    *,
    include_preview: bool,
) -> EncodedImage:
    if alpha is not None:
        rgba = matched_rgb.copy()
        rgba.putalpha(alpha)
        if output_format == "jpg":
            white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            final_img = Image.alpha_composite(white, rgba).convert("RGB")
        else:
            final_img = rgba
    else:
        final_img = matched_rgb

    out_buf = BytesIO()
    if output_format == "png":
        final_img.save(out_buf, format="PNG")
    elif output_format == "jpg":
        final_img.save(out_buf, format="JPEG", quality=92, subsampling=0)
    elif output_format == "webp":
        final_img.save(out_buf, format="WEBP", quality=92)
    else:
        final_img.save(out_buf, format="TIFF", compression="tiff_adobe_deflate")

    output_bytes = out_buf.getvalue()
    mime_type = FORMAT_TO_MIME[output_format]

    if include_preview and output_format == "tiff":
        prev_buf = BytesIO()
        final_img.save(prev_buf, format="PNG")
        preview_bytes = prev_buf.getvalue()
        preview_mime = "image/png"
    else:
        preview_bytes = output_bytes
        preview_mime = mime_type

    return EncodedImage(
        output_bytes=output_bytes,
        preview_bytes=preview_bytes,
        mime_type=mime_type,
        preview_mime_type=preview_mime,
        width=final_img.width,
        height=final_img.height,
    )


def encode_thumbnail_data_url(
    matched_rgb: Image.Image,
    alpha: Image.Image | None,
    *,
    max_dim: int = 160,
) -> str:
    if alpha is not None:
        img = matched_rgb.copy()
        img.putalpha(alpha)
    else:
        img = matched_rgb
    thumb = ImageOps.contain(img, (max_dim, max_dim), Image.Resampling.BILINEAR)
    buf = BytesIO()
    thumb.save(buf, format="WEBP", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{b64}"


def _resolve_single_output_path(
    *,
    suggested_filename: str,
    output_dir: str | None,
    save_to_disk: bool,
    src_path: str | None,
) -> Path | None:
    cleaned_dir = output_dir.strip() if output_dir else ""
    if cleaned_dir:
        target_dir = Path(cleaned_dir).expanduser().resolve()
        if target_dir.exists() and not target_dir.is_dir():
            raise EngineError(
                400,
                "PATH_NOT_FOUND",
                f"Output path is not a directory: {output_dir}",
            )
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / suggested_filename

    if save_to_disk and src_path and src_path.strip():
        src_parent = Path(src_path).expanduser().resolve().parent
        src_parent.mkdir(parents=True, exist_ok=True)
        return src_parent / suggested_filename

    return None


def process_single_sync(
    *,
    src_bytes: bytes | None,
    src_path: str | None,
    ref_bytes: bytes | None,
    ref_path: str | None,
    method: TransferMethod,
    intensity: float,
    output_format: OutputFormat,
    output_dir: str | None,
    save_to_disk: bool,
    source_name: str | None,
    reference_name: str | None = None,
    filename_suffix: str | None = None,
) -> SingleProcessResult:
    t_total = time.perf_counter()

    src_label = (
        source_name.strip()
        if source_name and source_name.strip()
        else (Path(src_path.strip()).name if src_path and src_path.strip() else "Source photo")
    )
    ref_label = (
        reference_name.strip()
        if reference_name and reference_name.strip()
        else (Path(ref_path.strip()).name if ref_path and ref_path.strip() else "Reference photo")
    )

    t_decode = time.perf_counter()
    if src_bytes is not None:
        src_img = decode_image_bytes(src_bytes, keep_alpha=True, label=src_label)
    elif src_path and src_path.strip():
        src_img = decode_image_path(src_path.strip(), keep_alpha=True, label=src_label)
    else:
        raise EngineError(400, "INVALID_IMAGE", "Either src_file or src_path is required.")

    if ref_bytes is not None:
        ref_img = decode_image_bytes(ref_bytes, keep_alpha=False, label=ref_label)
    elif ref_path and ref_path.strip():
        ref_img = decode_image_path(ref_path.strip(), keep_alpha=False, label=ref_label)
    else:
        raise EngineError(400, "INVALID_IMAGE", "Either ref_file or ref_path is required.")
    decode_ms = (time.perf_counter() - t_decode) * 1000.0

    t_transfer = time.perf_counter()
    matched_rgb = run_color_transfer(src_img, ref_img.rgb, method, intensity)
    transfer_ms = (time.perf_counter() - t_transfer) * 1000.0

    t_encode = time.perf_counter()
    encoded = encode_matched_image(
        matched_rgb,
        src_img.alpha,
        output_format,
        include_preview=True,
    )
    suggested_filename = build_suggested_filename(
        source_name,
        method,
        output_format,
        filename_suffix=filename_suffix,
    )
    target_path = _resolve_single_output_path(
        suggested_filename=suggested_filename,
        output_dir=output_dir,
        save_to_disk=save_to_disk,
        src_path=src_path,
    )
    saved_output_path: str | None = None
    if target_path is not None:
        try:
            target_path.write_bytes(encoded.output_bytes)
        except OSError as exc:
            raise EngineError(
                400,
                "PATH_NOT_FOUND",
                f"Failed to write output file '{target_path}': {exc}",
            ) from None
        saved_output_path = str(target_path)

    download_b64 = base64.b64encode(encoded.output_bytes).decode("ascii")
    download_data_url = f"data:{encoded.mime_type};base64,{download_b64}"
    if encoded.preview_bytes is encoded.output_bytes:
        preview_data_url = download_data_url
    else:
        preview_b64 = base64.b64encode(encoded.preview_bytes).decode("ascii")
        preview_data_url = f"data:{encoded.preview_mime_type};base64,{preview_b64}"

    encode_ms = (time.perf_counter() - t_encode) * 1000.0
    total_ms = (time.perf_counter() - t_total) * 1000.0

    return SingleProcessResult(
        preview_data_url=preview_data_url,
        download_data_url=download_data_url,
        mime_type=encoded.mime_type,
        output_path=saved_output_path,
        suggested_filename=suggested_filename,
        width=encoded.width,
        height=encoded.height,
        output_format=output_format,
        method=method,
        intensity=round(intensity, 2),
        breakdown_ms=BreakdownMs(
            decode_ms=round(decode_ms, 2),
            transfer_ms=round(transfer_ms, 2),
            encode_ms=round(encode_ms, 2),
            total_ms=round(total_ms, 2),
        ),
    )


def _deduplicate_filename(filename: str, used: set[str]) -> str:
    if filename not in used:
        used.add(filename)
        return filename
    p = Path(filename)
    idx = 2
    while True:
        candidate = f"{p.stem}_{idx}{p.suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        idx += 1


def process_batch_sync(
    *,
    ref_bytes: bytes | None,
    ref_path: str | None,
    candidates: list[BatchSourceCandidate],
    method: TransferMethod,
    intensity: float,
    output_format: OutputFormat,
    resolved_output_dir: Path | None,
    reference_name: str | None = None,
    filename_suffix: str | None = None,
) -> BatchProcessResult:
    t_batch = time.perf_counter()

    ref_label = (
        reference_name.strip()
        if reference_name and reference_name.strip()
        else (Path(ref_path.strip()).name if ref_path and ref_path.strip() else "Reference photo")
    )

    if ref_bytes is not None:
        ref_img = decode_image_bytes(ref_bytes, keep_alpha=False, label=ref_label)
    elif ref_path and ref_path.strip():
        ref_img = decode_image_path(ref_path.strip(), keep_alpha=False, label=ref_label)
    else:
        raise EngineError(400, "INVALID_IMAGE", "Either ref_file or ref_path is required.")

    if not candidates:
        raise EngineError(
            400, "EMPTY_BATCH", "No supported image files found for batch processing."
        )

    if resolved_output_dir is not None:
        if resolved_output_dir.exists() and not resolved_output_dir.is_dir():
            raise EngineError(
                400,
                "PATH_NOT_FOUND",
                f"Output path is not a directory: {resolved_output_dir}",
            )
        resolved_output_dir.mkdir(parents=True, exist_ok=True)

    zip_buffer = BytesIO() if resolved_output_dir is None else None
    zf = (
        zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED)
        if zip_buffer is not None
        else None
    )

    include_inline_downloads = (
        resolved_output_dir is None and len(candidates) <= MAX_INLINE_BATCH_DOWNLOADS
    )

    items: list[BatchItemResult] = []
    item_durations_ms: list[float] = []
    used_filenames: set[str] = set()
    succeeded_count = 0
    failed_count = 0

    try:
        for candidate in candidates:
            t_item = time.perf_counter()
            try:
                if candidate.raw_bytes is not None:
                    src_img = decode_image_bytes(
                        candidate.raw_bytes,
                        keep_alpha=True,
                        label=candidate.display_name,
                    )
                elif candidate.file_path is not None:
                    src_img = decode_image_path(
                        str(candidate.file_path),
                        keep_alpha=True,
                        label=candidate.display_name,
                    )
                else:
                    raise EngineError(400, "INVALID_IMAGE", "Missing image source.")

                matched_rgb = run_color_transfer(src_img, ref_img.rgb, method, intensity)
                encoded = encode_matched_image(
                    matched_rgb,
                    src_img.alpha,
                    output_format,
                    include_preview=False,
                )
                thumb_url = encode_thumbnail_data_url(matched_rgb, src_img.alpha)
                out_name = _deduplicate_filename(
                    build_suggested_filename(
                        candidate.display_name,
                        method,
                        output_format,
                        filename_suffix=filename_suffix,
                    ),
                    used_filenames,
                )

                saved_item_path: str | None = None
                item_download_url: str | None = None
                if resolved_output_dir is not None:
                    target = resolved_output_dir / out_name
                    target.write_bytes(encoded.output_bytes)
                    saved_item_path = str(target)
                elif zf is not None:
                    zf.writestr(out_name, encoded.output_bytes)
                    if include_inline_downloads:
                        dl_b64 = base64.b64encode(encoded.output_bytes).decode("ascii")
                        item_download_url = f"data:{encoded.mime_type};base64,{dl_b64}"

                duration_ms = (time.perf_counter() - t_item) * 1000.0
                item_durations_ms.append(duration_ms)
                succeeded_count += 1
                items.append(
                    BatchItemResult(
                        filename=candidate.display_name,
                        status="ok",
                        output_path=saved_item_path,
                        output_filename=out_name,
                        width=encoded.width,
                        height=encoded.height,
                        duration_ms=round(duration_ms, 2),
                        error=None,
                        preview_data_url=thumb_url,
                        download_data_url=item_download_url,
                    )
                )
            except (KeyboardInterrupt, SystemExit, asyncio.CancelledError):
                raise
            except EngineError as exc:
                duration_ms = (time.perf_counter() - t_item) * 1000.0
                failed_count += 1
                items.append(
                    BatchItemResult(
                        filename=candidate.display_name,
                        status="error",
                        output_path=None,
                        output_filename=None,
                        width=None,
                        height=None,
                        duration_ms=round(duration_ms, 2),
                        error=exc.detail,
                    )
                )
            except BaseException as exc:
                duration_ms = (time.perf_counter() - t_item) * 1000.0
                failed_count += 1
                items.append(
                    BatchItemResult(
                        filename=candidate.display_name,
                        status="error",
                        output_path=None,
                        output_filename=None,
                        width=None,
                        height=None,
                        duration_ms=round(duration_ms, 2),
                        error=str(exc),
                    )
                )
    finally:
        if zf is not None:
            zf.close()

    zip_data_url: str | None = None
    if zip_buffer is not None:
        zip_b64 = base64.b64encode(zip_buffer.getvalue()).decode("ascii")
        zip_data_url = f"data:application/zip;base64,{zip_b64}"

    total_ms = (time.perf_counter() - t_batch) * 1000.0
    return BatchProcessResult(
        output_dir=str(resolved_output_dir) if resolved_output_dir is not None else None,
        zip_data_url=zip_data_url,
        zip_filename=f"matchtone_batch_{method}.zip",
        method=method,
        intensity=round(intensity, 2),
        output_format=output_format,
        total_count=len(candidates),
        succeeded_count=succeeded_count,
        failed_count=failed_count,
        total_ms=round(total_ms, 2),
        items=items,
        item_durations_ms=item_durations_ms,
    )
