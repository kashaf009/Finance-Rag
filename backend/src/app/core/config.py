from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[2]
APP_DIR = SRC_DIR / "app"
BACKEND_ROOT = SRC_DIR.parent
REPO_ROOT = BACKEND_ROOT.parent
DEFAULT_DOCS_DIR = REPO_ROOT / "docs"
DEFAULT_STORAGE_DIR = BACKEND_ROOT / "storage" / "pages"

_TRUE = {"1", "true", "yes", "on"}


def env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in _TRUE


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return int(value)


def env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return float(value)


def env_path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value).expanduser() if value not in (None, "") else default


@dataclass(frozen=True, slots=True)
class AppSettings:
    storage_dir: Path = field(default_factory=lambda: env_path("STORAGE_DIR", DEFAULT_STORAGE_DIR))
    docs_dir: Path = field(default_factory=lambda: env_path("DOCS_DIR", DEFAULT_DOCS_DIR))
    poppler_path: str | None = field(default_factory=lambda: env_str("POPPLER_PATH", "") or None)
    log_level: str = field(default_factory=lambda: env_str("LOG_LEVEL", "INFO"))

    source_dpi: int = field(default_factory=lambda: env_int("RENDER_SOURCE_DPI", 200))
    measure_dpi: int = field(default_factory=lambda: env_int("RENDER_MEASURE_DPI", 50))
    colorspace: str = field(default_factory=lambda: env_str("RENDER_COLORSPACE", "rgb"))
    render_trim: bool = field(default_factory=lambda: env_bool("RENDER_TRIM", True))
    render_chunk_pages: int = field(default_factory=lambda: env_int("RENDER_CHUNK_PAGES", 8))
    render_thread_count: int = field(default_factory=lambda: env_int("RENDER_THREAD_COUNT", 4))
    extract_text: bool = field(default_factory=lambda: env_bool("RENDER_EXTRACT_TEXT", True))

    normalize_mode: str = field(
        default_factory=lambda: env_str("IMAGE_NORMALIZE_MODE", "trim_fit_uniform")
    )
    target_w: int = field(default_factory=lambda: env_int("IMAGE_TARGET_W", 1024))
    target_h: int = field(default_factory=lambda: env_int("IMAGE_TARGET_H", 1408))
    resample: str = field(default_factory=lambda: env_str("IMAGE_RESAMPLE", "lanczos"))
    allow_upscale: bool = field(default_factory=lambda: env_bool("IMAGE_ALLOW_UPSCALE", False))
    max_pixels: int = field(default_factory=lambda: env_int("IMAGE_MAX_PIXELS", 4_000_000))
    jpeg_quality: int = field(default_factory=lambda: env_int("IMAGE_JPEG_QUALITY", 85))
    jpeg_optimize: bool = field(default_factory=lambda: env_bool("IMAGE_JPEG_OPTIMIZE", True))
    pad_color: str = field(default_factory=lambda: env_str("IMAGE_PAD_COLOR", "ffffff"))

    embed_model: str = field(default_factory=lambda: env_str("EMBED_MODEL", "gemini-embedding-2"))
    embed_dim: int = field(default_factory=lambda: env_int("EMBED_DIM", 1024))
    embed_workers: int = field(default_factory=lambda: env_int("EMBED_WORKERS", 4))
    embed_retries: int = field(default_factory=lambda: env_int("EMBED_RETRIES", 3))
    embed_retry_delay: float = field(default_factory=lambda: env_float("EMBED_RETRY_DELAY", 2.0))
    embed_document_task: str = field(
        default_factory=lambda: env_str("EMBED_DOCUMENT_TASK", "RETRIEVAL_DOCUMENT")
    )
    embed_query_task: str = field(
        default_factory=lambda: env_str("EMBED_QUERY_TASK", "RETRIEVAL_QUERY")
    )
    google_api_key: str | None = field(
        default_factory=lambda: (
            env_str("GOOGLE_API_KEY", "") or env_str("GEMINI_API_KEY", "") or None
        )
    )

    qdrant_url: str = field(default_factory=lambda: env_str("QDRANT_URL", "http://localhost:6333"))
    qdrant_api_key: str | None = field(
        default_factory=lambda: env_str("QDRANT_API_KEY", "") or None
    )
    qdrant_collection: str = field(
        default_factory=lambda: env_str("QDRANT_COLLECTION", "finance_pages")
    )
    qdrant_timeout: float = field(default_factory=lambda: env_float("QDRANT_TIMEOUT", 60.0))


_settings: AppSettings | None = None


def get_settings() -> AppSettings:
    global _settings
    if _settings is None:
        _settings = AppSettings()
    return _settings


def reset_settings() -> None:
    global _settings
    _settings = None
