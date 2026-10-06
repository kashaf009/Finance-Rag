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
        return _cached_prompt_data_uri(doc_id, page_number, edge, jpeg_quality, encoded)
    return _encode_prompt_data_uri(encoded, edge, jpeg_quality)


def image_to_prompt_data_uri(
    image: Image.Image,
    *,
    max_edge: int | None = None,
    quality: int | None = None,
    settings: AppSettings | None = None,
) -> str:
    """Encode an already decoded page image at the prompt settings.

    Indexing already has the normalized PIL image in memory. Using this path
    avoids the full-image base64 decode that ``to_prompt_data_uri`` needs for
    images read from a Qdrant payload.
    """
    cfg = settings or get_settings()
    edge = cfg.llm_image_max_edge if max_edge is None else max_edge
    jpeg_quality = cfg.llm_image_quality if quality is None else quality
    prepared = image.copy()
    if edge > 0 and max(prepared.size) > edge:
        prepared.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    return _image_to_prompt_data_uri(prepared, jpeg_quality)


def _encode_prompt_data_uri(encoded: str, edge: int, quality: int) -> str:
    image = base64_to_image(encoded)
    return _image_to_prompt_data_uri(image, quality, max_edge=edge)


def _image_to_prompt_data_uri(
    image: Image.Image, quality: int, *, max_edge: int | None = None
) -> str:
    if max_edge is not None and max_edge > 0 and max(image.size) > max_edge:
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    payload = image_to_jpeg_bytes(image, quality=quality, optimize=False)
    return bytes_to_base64(payload, data_uri=True)


@lru_cache(maxsize=256)
def _cached_prompt_data_uri(
    doc_id: str,
    page_number: int,
    edge: int,
    quality: int,
    encoded: str,
) -> str:
    # Source bytes are part of the key so re-indexing a page cannot return stale
    # evidence. Only encoding settings enter the key, rather than the full config.
    return _encode_prompt_data_uri(encoded, edge, quality)


def reset_prompt_image_cache() -> None:
    _cached_prompt_data_uri.cache_clear()
