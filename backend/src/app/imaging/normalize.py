from __future__ import annotations

import math
from typing import Final

from PIL import Image

from app.core.config import AppSettings, get_settings

RESAMPLE_MAP: Final[dict[str, Image.Resampling]] = {
    "lanczos": Image.Resampling.LANCZOS,
    "bicubic": Image.Resampling.BICUBIC,
    "bilinear": Image.Resampling.BILINEAR,
    "nearest": Image.Resampling.NEAREST,
    "box": Image.Resampling.BOX,
    "hamming": Image.Resampling.HAMMING,
}

RGB = tuple[int, int, int]


def parse_hex_color(value: str) -> RGB:
    digits = value.strip().lstrip("#")
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    if len(digits) != 6:
        raise ValueError(f"Invalid hex color: {value!r}")
    return int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)


def resolve_resample(name: str) -> Image.Resampling:
    try:
        return RESAMPLE_MAP[name.strip().lower()]
    except KeyError as exc:
        raise ValueError(f"Unknown resample filter: {name!r}") from exc


def content_bbox(
    image: Image.Image, *, threshold: int = 250, margin: int = 0
) -> tuple[int, int, int, int] | None:
    gray = image.convert("L")
    mask = gray.point(lambda pixel: 255 if pixel < threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return None
    left, top, right, bottom = bbox
    if margin <= 0:
        return left, top, right, bottom
    return (
        max(0, left - margin),
        max(0, top - margin),
        min(image.width, right + margin),
        min(image.height, bottom + margin),
    )


def _limit_pixels(image: Image.Image, max_pixels: int, resample: Image.Resampling) -> Image.Image:
    if max_pixels <= 0:
        return image
    pixels = image.width * image.height
    if pixels <= max_pixels:
        return image
    scale = math.sqrt(max_pixels / pixels)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, resample)


def normalize_page(
    image: Image.Image,
    *,
    target: tuple[int, int] | None = None,
    trim: bool = False,
    resample: str | None = None,
    allow_upscale: bool | None = None,
    max_pixels: int | None = None,
    pad_color: str | None = None,
    settings: AppSettings | None = None,
) -> Image.Image:
    cfg = settings or get_settings()
    filter_ = resolve_resample(resample or cfg.resample)
    target_size = target or (cfg.target_w, cfg.target_h)
    upscale = cfg.allow_upscale if allow_upscale is None else allow_upscale
    cap = cfg.max_pixels if max_pixels is None else max_pixels
    background = parse_hex_color(pad_color or cfg.pad_color)

    source = image.convert("RGB")
    if trim:
        bbox = content_bbox(source)
        if bbox is not None:
            source = source.crop(bbox)
    source = _limit_pixels(source, cap, filter_)

    target_w, target_h = target_size
    if target_w <= 0 or target_h <= 0:
        return source

    scale = min(target_w / source.width, target_h / source.height)
    if scale > 1.0 and not upscale:
        scale = 1.0

    new_w = max(1, round(source.width * scale))
    new_h = max(1, round(source.height * scale))
    if (new_w, new_h) != source.size:
        source = source.resize((new_w, new_h), filter_)

    canvas = Image.new("RGB", (target_w, target_h), background)
    canvas.paste(source, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return canvas
