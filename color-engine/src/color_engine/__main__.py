"""CLI entrypoint for MatchTone color-engine sidecar."""

from __future__ import annotations

import argparse
import multiprocessing
import os
import sys
import threading

import uvicorn

from color_engine.app import app


def _watch_parent_stdin() -> None:
    """Exit immediately when parent Electron process closes stdin pipe."""
    try:
        while True:
            chunk = sys.stdin.read(1)
            if chunk == "":
                break
    except BaseException:
        pass
    os._exit(0)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    default_host = os.environ.get("MATCHTONE_ENGINE_HOST", "127.0.0.1")
    default_port = int(os.environ.get("MATCHTONE_ENGINE_PORT", "8765"))
    parser = argparse.ArgumentParser(description="MatchTone color-engine sidecar")
    parser.add_argument("--host", default=default_host, help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=default_port, help="Bind port (default: 8765)")
    parser.add_argument(
        "--watch-stdin",
        action="store_true",
        help="Terminate sidecar when parent stdin reaches EOF",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    multiprocessing.freeze_support()
    args = parse_args(argv)
    if args.watch_stdin:
        watcher = threading.Thread(target=_watch_parent_stdin, name="stdin-watchdog", daemon=True)
        watcher.start()
    log_level = os.environ.get("MATCHTONE_LOG_LEVEL", "info").lower()
    uvicorn.run(
        app,
        host=str(args.host),
        port=int(args.port),
        log_level=log_level,
        access_log=False,
    )


if __name__ == "__main__":
    main()
