from __future__ import annotations

from pathlib import Path

from app.core.config import BACKEND_ROOT

DEFAULT_ENV_FILE = BACKEND_ROOT / ".env"


def load_env(path: Path | None = None, *, override: bool = False) -> bool:
    try:
        from dotenv import load_dotenv
    except ModuleNotFoundError:
        return False
    return bool(load_dotenv(path or DEFAULT_ENV_FILE, override=override))
