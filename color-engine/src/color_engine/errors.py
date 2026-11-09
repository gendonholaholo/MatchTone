"""Typed domain errors mapped 1:1 to MatchTone API failure codes."""

from __future__ import annotations

from typing import Literal

FailureCode = Literal[
    "INVALID_IMAGE",
    "IMAGE_TOO_SMALL",
    "PAYLOAD_TOO_LARGE",
    "INVALID_METHOD",
    "INVALID_INTENSITY",
    "PATH_NOT_FOUND",
    "EMPTY_BATCH",
    "NOT_FOUND",
    "INTERNAL_ERROR",
]


class EngineError(Exception):
    """Structured engine exception carrying HTTP status and failure_code."""

    def __init__(self, status_code: int, failure_code: FailureCode, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.failure_code: FailureCode = failure_code
        self.detail = detail
