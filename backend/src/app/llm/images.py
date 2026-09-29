from __future__ import annotations

from PIL import Image

from app.core.config import AppSettings, get_settings
from app.imaging.encode import base64_to_image, bytes_to_base64, image_to_jpeg_bytes


def to_prompt_data_uri(
    encoded: str,
    *,
    max_edge: int | None = None,
    quality: int | None = None,
    settings: AppSettings | None = None,
) -> str:
    cfg = settings or get_settings()
    image = base64_to_image(encoded)
    edge = cfg.llm_image_max_edge if max_edge is None else max_edge
    if edge > 0 and max(image.size) > edge:
        image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    payload = image_to_jpeg_bytes(
        image,
        quality=cfg.llm_image_quality if quality is None else quality,
        settings=cfg,
    )
    return bytes_to_base64(payload, data_uri=True)
