"""Process telemetry (RSS/Peak RSS, P50/P95 latency, warmup) and stdlib JSON logging."""

from __future__ import annotations

import json
import logging
import os
import resource
import sys
import threading
import time
from collections import deque
from datetime import UTC, datetime
from typing import cast

import numpy as np
import psutil
from color_matcher import ColorMatcher
from color_matcher.normalizer import Normalizer

from color_engine.schemas import LatencyStats, MemoryStats

_BYTES_PER_MB = 1024.0 * 1024.0
_KIB_PER_MB = 1024.0


class JsonLogFormatter(logging.Formatter):
    """Standard library logging.Formatter serializing structured JSON lines."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        extra_fields = getattr(record, "structured", None)
        if isinstance(extra_fields, dict):
            payload.update(cast(dict[str, object], extra_fields))
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> logging.Logger:
    """Configure color_engine logger using stdlib logging."""
    level_name = os.environ.get("MATCHTONE_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logger = logging.getLogger("color_engine")
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonLogFormatter())
        logger.addHandler(handler)
    logger.propagate = False
    return logger


class EngineTelemetry:
    """Thread-safe runtime telemetry tracker for RSS memory, warmup, and request latency."""

    def __init__(self) -> None:
        self._process = psutil.Process()
        self._started_at = time.monotonic()
        self._lock = threading.Lock()
        self._latencies_ms: deque[float] = deque(maxlen=1000)
        self._peak_rss_mb: float = 0.0
        self._warmup_ms: float = 0.0
        self._ready: bool = False

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def warmup_ms(self) -> float:
        return round(self._warmup_ms, 2)

    @property
    def uptime_seconds(self) -> float:
        return round(max(0.0, time.monotonic() - self._started_at), 2)

    def run_warmup(self) -> float:
        """Execute a deterministic 8x8 color-matcher warmup pass."""
        t0 = time.perf_counter()
        y_idx, x_idx = np.mgrid[0:8, 0:8]
        src = np.stack(
            [x_idx / 7.0, y_idx / 7.0, np.full_like(x_idx, 0.5, dtype=np.float64)], axis=-1
        )
        ref = np.stack(
            [1.0 - x_idx / 7.0, y_idx / 7.0, np.full_like(x_idx, 0.25, dtype=np.float64)], axis=-1
        )
        res = ColorMatcher().transfer(src=src, ref=ref, method="hm-mvgd-hm")
        _ = Normalizer(np.real(res)).uint8_norm()
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        with self._lock:
            self._warmup_ms = elapsed_ms
            self._ready = True
        self.memory_stats()
        return round(elapsed_ms, 2)

    def record_latency(self, duration_ms: float) -> LatencyStats:
        val = max(0.0, float(duration_ms))
        with self._lock:
            self._latencies_ms.append(val)
            return self._compute_latency_unlocked()

    def latency_stats(self) -> LatencyStats:
        with self._lock:
            return self._compute_latency_unlocked()

    def _compute_latency_unlocked(self) -> LatencyStats:
        count = len(self._latencies_ms)
        if count == 0:
            return LatencyStats(count=0, p50_ms=0.0, p95_ms=0.0, last_ms=0.0)
        arr = np.asarray(self._latencies_ms, dtype=np.float64)
        p50, p95 = np.percentile(arr, [50.0, 95.0])
        last = self._latencies_ms[-1]
        return LatencyStats(
            count=count,
            p50_ms=round(float(p50), 2),
            p95_ms=round(float(p95), 2),
            last_ms=round(float(last), 2),
        )

    def memory_stats(self) -> MemoryStats:
        rss_mb = self._process.memory_info().rss / _BYTES_PER_MB
        ru_maxrss = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        os_peak_mb = (
            ru_maxrss / _BYTES_PER_MB if sys.platform == "darwin" else ru_maxrss / _KIB_PER_MB
        )
        with self._lock:
            self._peak_rss_mb = max(self._peak_rss_mb, rss_mb, os_peak_mb)
            peak_mb = self._peak_rss_mb
        return MemoryStats(
            rss_mb=round(rss_mb, 2),
            peak_rss_mb=round(peak_mb, 2),
        )
