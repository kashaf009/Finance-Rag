from __future__ import annotations

from functools import lru_cache

from PIL import Image

from app.core.config import AppSettings, get_settings
from app.imaging.encode import base64_to_image, bytes_to_base64, image_to_jpeg_bytes


def to_prompt_data_uri(
    encoded: str,
    *,
    doc_id: str | None = None,
    page_number: int | None = None,
    max_edge: int | None = None,
    quality: int | None = None,
    settings: AppSettings | None = None,
) -> str:
    """Downscale a prompt image, reusing cached results when page identity is supplied."""
    cfg = settings or get_settings()
    edge = cfg.llm_image_max_edge if max_edge is None else max_edge
    jpeg_quality = cfg.llm_image_quality if quality is None else quality
    if doc_id is not None and page_number is not None:
        return _cached_prompt_data_uri(
            doc_id, page_number, edge, jpeg_quality, cfg.jpeg_optimize, encoded
        )
    return _encode_prompt_data_uri(encoded, edge, jpeg_quality, cfg.jpeg_optimize)


def _encode_prompt_data_uri(encoded: str, edge: int, quality: int, optimize: bool) -> str:
    image = base64_to_image(encoded)
    if edge > 0 and max(image.size) > edge:
        image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    payload = image_to_jpeg_bytes(
        image,
        quality=quality,
        optimize=optimize,
    )
    return bytes_to_base64(payload, data_uri=True)


@lru_cache(maxsize=256)
def _cached_prompt_data_uri(
    doc_id: str,
    page_number: int,
    edge: int,
    quality: int,
    optimize: bool,
    encoded: str,
) -> str:
    # Source bytes are part of the key so re-indexing a page cannot return stale
    # evidence. Only encoding settings enter the key, rather than the full config.
    return _encode_prompt_data_uri(encoded, edge, quality, optimize)


def reset_prompt_image_cache() -> None:
    _cached_prompt_data_uri.cache_clear()
