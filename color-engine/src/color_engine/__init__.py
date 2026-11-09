"""MatchTone color-engine sidecar package."""

from __future__ import annotations

import importlib.metadata
import tomllib
from pathlib import Path
from typing import cast


def get_version() -> str:
    """Resolve package version dynamically via stdlib importlib.metadata / tomllib."""
    try:
        return importlib.metadata.version("color-engine")
    except importlib.metadata.PackageNotFoundError:
        pyproject_path = Path(__file__).resolve().parents[2] / "pyproject.toml"
        if pyproject_path.is_file():
            with pyproject_path.open("rb") as fp:
                data = tomllib.load(fp)
            project = data.get("project")
            if isinstance(project, dict):
                project_map = cast(dict[str, object], project)
                version = project_map.get("version")
                if isinstance(version, str):
                    return version
        return "0.1.0"


__version__ = get_version()
