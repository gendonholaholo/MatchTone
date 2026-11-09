"""Comprehensive test suite for MatchTone color-engine sidecar."""

from __future__ import annotations

import asyncio
import base64
import importlib.metadata
import zipfile
from collections.abc import Awaitable, Callable
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import httpx
import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from color_engine import __version__, get_version
from color_engine.app import create_app
from color_engine.schemas import SUPPORTED_METHODS


def _run_with_client(fn: Callable[[httpx.AsyncClient], Awaitable[None]]) -> None:
    async def _runner() -> None:
        app = create_app()
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8765",
            ) as client:
                await fn(client)

    asyncio.run(_runner())


def _make_gradient_bytes(
    width: int = 48,
    height: int = 36,
    *,
    fmt: str = "PNG",
    warm: bool = False,
    with_alpha: bool = False,
) -> bytes:
    y_idx, x_idx = np.mgrid[0:height, 0:width]
    if warm:
        r = np.clip(180 + (x_idx * 70) // max(1, width - 1), 0, 255).astype(np.uint8)
        g = np.clip(90 + (y_idx * 90) // max(1, height - 1), 0, 255).astype(np.uint8)
        b = np.full((height, width), 35, dtype=np.uint8)
    else:
        r = np.clip(25 + (x_idx * 80) // max(1, width - 1), 0, 255).astype(np.uint8)
        g = np.clip(80 + (y_idx * 110) // max(1, height - 1), 0, 255).astype(np.uint8)
        b = np.full((height, width), 210, dtype=np.uint8)

    if with_alpha:
        alpha = np.clip((x_idx * 255) // max(1, width - 1), 10, 245).astype(np.uint8)
        arr = np.stack([r, g, b, alpha], axis=-1)
        img = Image.fromarray(arr, mode="RGBA")
    else:
        arr = np.stack([r, g, b], axis=-1)
        img = Image.fromarray(arr, mode="RGB")

    buf = BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _decode_data_url(data_url: str) -> tuple[str, bytes]:
    header, encoded = data_url.split(",", 1)
    assert header.startswith("data:")
    assert header.endswith(";base64")
    mime = header[len("data:") : -len(";base64")]
    return mime, base64.b64decode(encoded)


def test_dynamic_version_and_tomllib_fallback() -> None:
    assert __version__ == "0.1.3"
    with patch(
        "importlib.metadata.version",
        side_effect=importlib.metadata.PackageNotFoundError("color-engine"),
    ):
        assert get_version() == "0.1.3"


def test_favicon_and_health_contract() -> None:
    async def _case(client: httpx.AsyncClient) -> None:
        fav = await client.get("/favicon.ico")
        assert fav.status_code == 204
        assert fav.content == b""

        res = await client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["ready"] is True
        assert body["version"] == "0.1.3"
        assert body["engine"] == "color-matcher"
        assert body["engine_version"] == "0.6.0"
        assert body["methods"] == list(SUPPORTED_METHODS)
        assert body["warmup_ms"] > 0.0
        assert body["uptime_seconds"] >= 0.0
        assert body["memory"]["rss_mb"] > 0.0
        assert body["memory"]["peak_rss_mb"] >= body["memory"]["rss_mb"]
        assert body["latency"] == {
            "count": 0,
            "p50_ms": 0.0,
            "p95_ms": 0.0,
            "last_ms": 0.0,
        }

    _run_with_client(_case)


@pytest.mark.parametrize("method", list(SUPPORTED_METHODS))
def test_single_all_six_methods_with_different_dimensions(method: str) -> None:
    src_bytes = _make_gradient_bytes(48, 36, warm=False)
    ref_bytes = _make_gradient_bytes(64, 44, warm=True)

    async def _case(client: httpx.AsyncClient) -> None:
        res = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("portrait.png", src_bytes, "image/png"),
                "ref_file": ("sunset.png", ref_bytes, "image/png"),
            },
            data={"method": method, "intensity": "100", "output_format": "png"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["method"] == method
        assert body["format"] == "png"
        assert body["mime_type"] == "image/png"
        assert body["width"] == 48
        assert body["height"] == 36
        assert body["output_path"] is None
        assert body["suggested_filename"] == f"portrait_matchtone_{method}.png"
        assert body["breakdown_ms"]["total_ms"] >= 0.0
        assert body["latency"]["count"] == 1

        mime, raw_out = _decode_data_url(str(body["download_data_url"]))
        assert mime == "image/png"
        with Image.open(BytesIO(raw_out)) as out_img:
            assert out_img.size == (48, 36)
            out_arr = np.asarray(out_img.convert("RGB"), dtype=np.float64)
        with Image.open(BytesIO(src_bytes)) as src_img:
            src_arr = np.asarray(src_img.convert("RGB"), dtype=np.float64)
        assert float(out_arr[..., 0].mean()) > float(src_arr[..., 0].mean())
        assert float(out_arr[..., 2].mean()) < float(src_arr[..., 2].mean())

    _run_with_client(_case)


def test_intensity_zero_fifty_hundred_blending() -> None:
    src_bytes = _make_gradient_bytes(40, 30, warm=False)
    ref_bytes = _make_gradient_bytes(40, 30, warm=True)

    async def _case(client: httpx.AsyncClient) -> None:
        outputs: dict[int, NDArray[np.float64]] = {}
        for level in (0, 50, 100):
            res = await client.post(
                "/v1/match/single",
                files={
                    "src_file": ("sample.png", src_bytes, "image/png"),
                    "ref_file": ("ref.png", ref_bytes, "image/png"),
                },
                data={"method": "mkl", "intensity": str(level), "output_format": "png"},
            )
            assert res.status_code == 200
            _, raw = _decode_data_url(str(res.json()["download_data_url"]))
            with Image.open(BytesIO(raw)) as im:
                outputs[level] = np.asarray(im.convert("RGB"), dtype=np.float64)

        with Image.open(BytesIO(src_bytes)) as orig:
            orig_arr = np.asarray(orig.convert("RGB"), dtype=np.float64)

        assert np.array_equal(outputs[0], orig_arr)
        mean_r_0 = float(outputs[0][..., 0].mean())
        mean_r_50 = float(outputs[50][..., 0].mean())
        mean_r_100 = float(outputs[100][..., 0].mean())
        assert mean_r_0 < mean_r_50 < mean_r_100

    _run_with_client(_case)


def test_rgba_alpha_preservation_and_jpg_composite() -> None:
    rgba_src = _make_gradient_bytes(32, 24, warm=False, with_alpha=True)
    ref_bytes = _make_gradient_bytes(32, 24, warm=True, with_alpha=False)

    with Image.open(BytesIO(rgba_src)) as orig_rgba:
        expected_alpha = np.asarray(orig_rgba.getchannel("A"))

    async def _case(client: httpx.AsyncClient) -> None:
        for fmt in ("png", "tiff"):
            res = await client.post(
                "/v1/match/single",
                files={
                    "src_file": ("badge.png", rgba_src, "image/png"),
                    "ref_file": ("ref.png", ref_bytes, "image/png"),
                },
                data={"method": "hm", "output_format": fmt},
            )
            assert res.status_code == 200
            _, out_raw = _decode_data_url(str(res.json()["download_data_url"]))
            with Image.open(BytesIO(out_raw)) as out_im:
                assert out_im.mode == "RGBA"
                actual_alpha = np.asarray(out_im.getchannel("A"))
                assert np.array_equal(actual_alpha, expected_alpha)

        res_webp = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("badge.png", rgba_src, "image/png"),
                "ref_file": ("ref.png", ref_bytes, "image/png"),
            },
            data={"method": "hm", "output_format": "webp"},
        )
        assert res_webp.status_code == 200
        _, webp_raw = _decode_data_url(str(res_webp.json()["download_data_url"]))
        with Image.open(BytesIO(webp_raw)) as webp_im:
            assert webp_im.mode == "RGBA"

        res_jpg = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("badge.png", rgba_src, "image/png"),
                "ref_file": ("ref.png", ref_bytes, "image/png"),
            },
            data={"method": "hm", "output_format": "jpg"},
        )
        assert res_jpg.status_code == 200
        _, jpg_raw = _decode_data_url(str(res_jpg.json()["download_data_url"]))
        with Image.open(BytesIO(jpg_raw)) as jpg_im:
            assert jpg_im.mode == "RGB"
            assert jpg_im.format == "JPEG"

    _run_with_client(_case)


def test_tiff_preview_is_png_while_download_and_disk_are_tiff(tmp_path: Path) -> None:
    src_path = tmp_path / "camera_shot.png"
    ref_path = tmp_path / "film_ref.png"
    out_dir = tmp_path / "exports"
    src_path.write_bytes(_make_gradient_bytes(44, 28, warm=False))
    ref_path.write_bytes(_make_gradient_bytes(44, 28, warm=True))

    async def _case(client: httpx.AsyncClient) -> None:
        res = await client.post(
            "/v1/match/single",
            data={
                "src_path": str(src_path),
                "ref_path": str(ref_path),
                "method": "reinhard",
                "intensity": "85",
                "output_format": "tiff",
                "output_dir": str(out_dir),
                "save_to_disk": "true",
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["format"] == "tiff"
        assert body["mime_type"] == "image/tiff"
        preview_url = str(body["preview_data_url"])
        download_url = str(body["download_data_url"])
        assert preview_url.startswith("data:image/png;base64,")
        assert download_url.startswith("data:image/tiff;base64,")

        prev_mime, prev_bytes = _decode_data_url(preview_url)
        assert prev_mime == "image/png"
        with Image.open(BytesIO(prev_bytes)) as prev_im:
            assert prev_im.format == "PNG"
            assert prev_im.size == (44, 28)

        dl_mime, dl_bytes = _decode_data_url(download_url)
        assert dl_mime == "image/tiff"
        with Image.open(BytesIO(dl_bytes)) as dl_im:
            assert dl_im.format == "TIFF"
            assert dl_im.size == (44, 28)

        saved_path = Path(str(body["output_path"]))
        assert saved_path.is_file()
        assert saved_path.name == "camera_shot_matchtone_reinhard.tiff"
        with Image.open(saved_path) as disk_im:
            assert disk_im.format == "TIFF"

    _run_with_client(_case)


def test_exif_orientation_transposed_on_load() -> None:
    raw_img = Image.open(BytesIO(_make_gradient_bytes(50, 20, warm=False)))
    exif = raw_img.getexif()
    exif[0x0112] = 6  # Rotate 90 CW -> 50x20 becomes 20x50
    buf = BytesIO()
    raw_img.save(buf, format="JPEG", exif=exif.tobytes())
    rotated_jpeg = buf.getvalue()
    ref_bytes = _make_gradient_bytes(30, 30, warm=True)

    async def _case(client: httpx.AsyncClient) -> None:
        res = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("rotated.jpg", rotated_jpeg, "image/jpeg"),
                "ref_file": ("ref.png", ref_bytes, "image/png"),
            },
            data={"method": "hm", "output_format": "png"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["width"] == 20
        assert body["height"] == 50

    _run_with_client(_case)


def test_batch_directory_mode_and_partial_corrupt_tolerance(tmp_path: Path) -> None:
    src_dir = tmp_path / "album"
    src_dir.mkdir()
    (src_dir / "01_scene.png").write_bytes(_make_gradient_bytes(32, 24, warm=False, fmt="PNG"))
    (src_dir / "02_scene.bmp").write_bytes(_make_gradient_bytes(30, 20, warm=False, fmt="BMP"))
    (src_dir / "03_corrupt.jpg").write_bytes(b"not-a-valid-jpeg-stream")
    (src_dir / "readme.txt").write_text("ignore non-image files", encoding="utf-8")

    ref_path = tmp_path / "lut_ref.png"
    ref_path.write_bytes(_make_gradient_bytes(32, 24, warm=True))

    async def _case(client: httpx.AsyncClient) -> None:
        res = await client.post(
            "/v1/match/batch",
            data={
                "ref_path": str(ref_path),
                "src_dir": str(src_dir),
                "method": "hm-mkl-hm",
                "intensity": "90",
                "output_format": "webp",
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        expected_out_dir = src_dir / "matchtone_hm-mkl-hm"
        assert body["output_dir"] == str(expected_out_dir.resolve())
        assert body["zip_data_url"] is None
        assert body["zip_filename"] == "matchtone_batch_hm-mkl-hm.zip"
        assert body["total_count"] == 3
        assert body["succeeded_count"] == 2
        assert body["failed_count"] == 1

        statuses = {str(item["filename"]): item for item in body["items"]}
        assert statuses["01_scene.png"]["status"] == "ok"
        assert statuses["01_scene.png"]["preview_data_url"] is not None
        assert statuses["01_scene.png"]["download_data_url"] is None
        assert statuses["02_scene.bmp"]["status"] == "ok"
        assert statuses["02_scene.bmp"]["preview_data_url"] is not None
        assert statuses["03_corrupt.jpg"]["status"] == "error"
        assert statuses["03_corrupt.jpg"]["error"] == (
            "Cannot open '03_corrupt.jpg' — file is damaged or not a valid photo."
        )
        assert "<_io.BytesIO" not in str(statuses["03_corrupt.jpg"]["error"])
        assert Path(str(statuses["01_scene.png"]["output_path"])).is_file()
        assert Path(str(statuses["02_scene.bmp"]["output_path"])).is_file()

    _run_with_client(_case)


def test_batch_browser_multipart_zip_mode() -> None:
    ref_bytes = _make_gradient_bytes(32, 24, warm=True)
    img_a = _make_gradient_bytes(32, 24, warm=False)
    img_b = _make_gradient_bytes(28, 28, warm=False)

    async def _case(client: httpx.AsyncClient) -> None:
        res = await client.post(
            "/v1/match/batch",
            files=[
                ("ref_file", ("ref.png", ref_bytes, "image/png")),
                ("src_files", ("shotA.png", img_a, "image/png")),
                ("src_files", ("shotA.jpg", img_b, "image/jpeg")),
                ("src_files", ("skip.txt", b"ignored", "text/plain")),
            ],
            data={"method": "mkl", "intensity": "100", "output_format": "png"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["output_dir"] is None
        assert body["total_count"] == 2
        assert body["succeeded_count"] == 2
        assert body["failed_count"] == 0
        zip_url = str(body["zip_data_url"])
        assert zip_url.startswith("data:application/zip;base64,")

        zip_mime, zip_bytes = _decode_data_url(zip_url)
        assert zip_mime == "application/zip"
        with zipfile.ZipFile(BytesIO(zip_bytes), mode="r") as zf:
            names = sorted(zf.namelist())
            assert names == [
                "shotA_matchtone_mkl.png",
                "shotA_matchtone_mkl_2.png",
            ]
            with Image.open(BytesIO(zf.read("shotA_matchtone_mkl.png"))) as z_im:
                assert z_im.size == (32, 24)

        for item in body["items"]:
            assert item["status"] == "ok"
            assert str(item["preview_data_url"]).startswith("data:image/webp;base64,")
            assert str(item["download_data_url"]).startswith("data:image/png;base64,")
            t_mime, t_bytes = _decode_data_url(str(item["preview_data_url"]))
            assert t_mime == "image/webp"
            with Image.open(BytesIO(t_bytes)) as t_im:
                assert t_im.width <= 160 and t_im.height <= 160

    _run_with_client(_case)


def test_error_codes_cors_client_log_and_base_exception_handling(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    valid_bytes = _make_gradient_bytes(16, 16, warm=False)
    tiny_buf = BytesIO()
    Image.new("RGB", (1, 1), (10, 20, 30)).save(tiny_buf, format="PNG")
    tiny_bytes = tiny_buf.getvalue()

    async def _case(client: httpx.AsyncClient) -> None:
        r_small = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("tiny.png", tiny_bytes, "image/png"),
                "ref_file": ("ref.png", valid_bytes, "image/png"),
            },
        )
        assert r_small.status_code == 400
        assert r_small.json()["failure_code"] == "IMAGE_TOO_SMALL"

        r_corrupt = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("bad.png", b"corrupt-bytes", "image/png"),
                "ref_file": ("ref.png", valid_bytes, "image/png"),
            },
        )
        assert r_corrupt.status_code == 400
        assert r_corrupt.json()["failure_code"] == "INVALID_IMAGE"
        assert r_corrupt.json()["detail"] == (
            "Cannot open 'bad.png' — file is damaged or not a valid photo."
        )
        assert "<_io.BytesIO" not in str(r_corrupt.json()["detail"])

        r_custom_suffix = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("portrait.png", valid_bytes, "image/png"),
                "ref_file": ("ref.png", valid_bytes, "image/png"),
            },
            data={"method": "mkl", "filename_suffix": "_film"},
        )
        assert r_custom_suffix.status_code == 200
        assert r_custom_suffix.json()["suggested_filename"] == "portrait_film_mkl.png"

        r_method = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("a.png", valid_bytes, "image/png"),
                "ref_file": ("b.png", valid_bytes, "image/png"),
            },
            data={"method": "unknown-lut"},
        )
        assert r_method.status_code == 400
        assert r_method.json()["failure_code"] == "INVALID_METHOD"

        for bad_int in ("-1", "101", "nan", "not-a-float"):
            r_int = await client.post(
                "/v1/match/single",
                files={
                    "src_file": ("a.png", valid_bytes, "image/png"),
                    "ref_file": ("b.png", valid_bytes, "image/png"),
                },
                data={"intensity": bad_int},
            )
            assert r_int.status_code == 400
            assert r_int.json()["failure_code"] == "INVALID_INTENSITY"

        r_missing = await client.post(
            "/v1/match/single",
            data={
                "src_path": str(tmp_path / "missing.png"),
                "ref_path": str(tmp_path / "missing_ref.png"),
            },
        )
        assert r_missing.status_code == 400
        assert r_missing.json()["failure_code"] == "PATH_NOT_FOUND"

        empty_dir = tmp_path / "empty_batch"
        empty_dir.mkdir()
        r_empty = await client.post(
            "/v1/match/batch",
            files={"ref_file": ("ref.png", valid_bytes, "image/png")},
            data={"src_dir": str(empty_dir)},
        )
        assert r_empty.status_code == 400
        assert r_empty.json()["failure_code"] == "EMPTY_BATCH"

        monkeypatch.setenv("MATCHTONE_MAX_UPLOAD_MB", "0.001")
        big_bmp = _make_gradient_bytes(64, 64, fmt="BMP", warm=True)
        assert len(big_bmp) > 2048
        r_large = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("large.bmp", big_bmp, "image/bmp"),
                "ref_file": ("ref.png", valid_bytes, "image/png"),
            },
        )
        assert r_large.status_code == 413
        assert r_large.json()["failure_code"] == "PAYLOAD_TOO_LARGE"
        monkeypatch.delenv("MATCHTONE_MAX_UPLOAD_MB", raising=False)

        with patch(
            "color_engine.matcher.ColorMatcher.transfer",
            side_effect=BaseException("simulated upstream color-matcher failure"),
        ):
            r_base_exc = await client.post(
                "/v1/match/single",
                files={
                    "src_file": ("a.png", valid_bytes, "image/png"),
                    "ref_file": ("b.png", valid_bytes, "image/png"),
                },
            )
            assert r_base_exc.status_code == 400
            assert r_base_exc.json()["failure_code"] == "INVALID_IMAGE"

        for route in ("/v1/unknown", "/api/does-not-exist"):
            r_404 = await client.get(route)
            assert r_404.status_code == 404
            assert r_404.json() == {
                "detail": "Route not found",
                "failure_code": "NOT_FOUND",
            }

        for allowed_origin in ("http://localhost:5173", "http://127.0.0.1:4100", "null"):
            r_cors = await client.get("/health", headers={"Origin": allowed_origin})
            assert r_cors.headers.get("access-control-allow-origin") == allowed_origin
        r_blocked = await client.get("/health", headers={"Origin": "https://evil.example.com"})
        assert "access-control-allow-origin" not in r_blocked.headers

        r_log = await client.post(
            "/v1/client-log",
            json={"level": "warn", "message": "drag-drop fallback used", "context": {"files": 2}},
        )
        assert r_log.status_code == 200
        assert r_log.json() == {"ok": True}

    _run_with_client(_case)


def test_hm_mvgd_hm_preserves_luminance_order_on_opposite_spatial_layouts() -> None:
    """Ensure hm-mvgd-hm uses ColorMatcher().transfer() without inverting spatial scenes."""
    y_idx, x_idx = np.mgrid[0:48, 0:64]
    # Source: bright sky at top, dark water at bottom
    src_luma = (230.0 - (y_idx / 47.0) * 190.0).astype(np.uint8)
    src_arr = np.stack(
        [src_luma, np.clip(src_luma + 10, 0, 255).astype(np.uint8), src_luma], axis=-1
    )
    # Reference: dark clouds at top, bright golden mist at bottom (opposite spatial layout)
    ref_luma = (30.0 + (y_idx / 47.0) * 210.0 + (x_idx % 5)).clip(0, 255).astype(np.uint8)
    ref_arr = np.stack(
        [
            ref_luma,
            (ref_luma * 0.72).astype(np.uint8),
            (ref_luma * 0.35).astype(np.uint8),
        ],
        axis=-1,
    )
    src_buf, ref_buf = BytesIO(), BytesIO()
    Image.fromarray(src_arr, mode="RGB").save(src_buf, format="PNG")
    Image.fromarray(ref_arr, mode="RGB").save(ref_buf, format="PNG")

    async def _case(client: httpx.AsyncClient) -> None:
        res = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("lake.png", src_buf.getvalue(), "image/png"),
                "ref_file": ("sunset.png", ref_buf.getvalue(), "image/png"),
            },
            data={"method": "hm-mvgd-hm", "intensity": "100"},
        )
        assert res.status_code == 200
        _, out_bytes = _decode_data_url(res.json()["preview_data_url"])
        out_arr = np.asarray(Image.open(BytesIO(out_bytes)).convert("RGB"), dtype=np.float64)
        # Top sky of source must remain brighter than bottom water (no spatial solarization)
        assert float(out_arr[:12].mean()) > float(out_arr[-12:].mean()) + 40.0

    _run_with_client(_case)


def test_ill_conditioned_portrait_prevents_cyan_highlight_solarization() -> None:
    """Ensure high-condition-number portraits (collinear RGB + bright sclera) never solarize."""
    h, w = 64, 48
    src_arr = np.zeros((h, w, 3), dtype=np.uint8)
    # Top half: dark hair (tightly collinear RGB)
    src_arr[:28, :] = [14, 12, 11]
    # Bottom half: warm skin
    src_arr[28:, :] = [215, 178, 162]
    # Small specular sclera patch (slightly cool white)
    src_arr[32:38, 18:28] = [235, 240, 246]

    # Reference: bimodal dark teal + bright orange clouds
    ref_arr = np.zeros((h, w, 3), dtype=np.uint8)
    ref_arr[:32, :] = [8, 42, 58]
    ref_arr[32:, :] = [238, 128, 24]

    src_buf, ref_buf = BytesIO(), BytesIO()
    Image.fromarray(src_arr, mode="RGB").save(src_buf, format="PNG")
    Image.fromarray(ref_arr, mode="RGB").save(ref_buf, format="PNG")

    async def _case(client: httpx.AsyncClient) -> None:
        res = await client.post(
            "/v1/match/single",
            files={
                "src_file": ("selfie.png", src_buf.getvalue(), "image/png"),
                "ref_file": ("cinema.png", ref_buf.getvalue(), "image/png"),
            },
            data={"method": "hm-mvgd-hm", "intensity": "100"},
        )
        assert res.status_code == 200
        _, out_bytes = _decode_data_url(res.json()["preview_data_url"])
        out_im = np.asarray(Image.open(BytesIO(out_bytes)).convert("RGB"), dtype=np.float64)

        hair_luma = float(out_im[:28, :].mean())
        skin_luma = float(out_im[40:, :].mean())
        sclera_patch = out_im[32:38, 18:28]
        sclera_luma = float(sclera_patch.mean())
        # Luminance hierarchy must remain hair < skin < sclera
        assert hair_luma < skin_luma < sclera_luma
        # Sclera must not blow up into radioactive cyan (Blue - Red < 60)
        assert abs(float(sclera_patch[..., 2].mean()) - float(sclera_patch[..., 0].mean())) < 60.0

    _run_with_client(_case)
