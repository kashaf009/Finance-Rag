from __future__ import annotations

import base64
from io import BytesIO

from PIL import Image

from app.core.config import AppSettings, get_settings

JPEG_MIME = "image/jpeg"
DATA_URI_PREFIX = f"data:{JPEG_MIME};base64,"


def image_to_jpeg_bytes(
    image: Image.Image,
    *,
    quality: int | None = None,
    optimize: bool | None = None,
    settings: AppSettings | None = None,
) -> bytes:
    cfg = settings or get_settings()
    buffer = BytesIO()
    if image.mode != "RGB":
        image = image.convert("RGB")
    image.save(
        buffer,
        format="JPEG",
        quality=cfg.jpeg_quality if quality is None else quality,
        optimize=cfg.jpeg_optimize if optimize is None else optimize,
    )
    return buffer.getvalue()


def image_to_base64(
    image: Image.Image,
    *,
    quality: int | None = None,
    optimize: bool | None = None,
    data_uri: bool = False,
    settings: AppSettings | None = None,
) -> str:
    payload = base64.b64encode(
        image_to_jpeg_bytes(image, quality=quality, optimize=optimize, settings=settings)
    ).decode("ascii")
    return f"{DATA_URI_PREFIX}{payload}" if data_uri else payload


def bytes_to_base64(data: bytes, *, data_uri: bool = False) -> str:
    payload = base64.b64encode(data).decode("ascii")
    return f"{DATA_URI_PREFIX}{payload}" if data_uri else payload


def base64_to_bytes(data: str) -> bytes:
    if data.startswith("data:"):
        _, _, data = data.partition(",")
    return base64.b64decode(data)


def base64_to_image(data: str) -> Image.Image:
    with Image.open(BytesIO(base64_to_bytes(data))) as image:
        return image.convert("RGB")
