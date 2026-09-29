from __future__ import annotations

import pytest
from PIL import Image, ImageDraw

from app.imaging import (
    content_bbox,
    normalize_page,
    parse_hex_color,
    resolve_resample,
)


def test_parse_hex_color() -> None:
    assert parse_hex_color("ffffff") == (255, 255, 255)
    assert parse_hex_color("#000000") == (0, 0, 0)
    assert parse_hex_color("f00") == (255, 0, 0)


def test_parse_hex_color_invalid() -> None:
    with pytest.raises(ValueError, match="Invalid hex color"):
        parse_hex_color("zz")


def test_resolve_resample() -> None:
    assert resolve_resample("LANCZOS") == Image.Resampling.LANCZOS
    with pytest.raises(ValueError, match="Unknown resample"):
        resolve_resample("bogus")


def test_output_is_fixed_size(portrait_page: Image.Image, landscape_page: Image.Image) -> None:
    assert normalize_page(portrait_page).size == (1024, 1408)
    assert normalize_page(landscape_page).size == (1024, 1408)


def test_custom_target(portrait_page: Image.Image) -> None:
    assert normalize_page(portrait_page, target=(256, 256)).size == (256, 256)


def test_no_upscale_pads_small_source() -> None:
    source = Image.new("RGB", (100, 100), "red")
    result = normalize_page(source)
    assert result.size == (1024, 1408)
    assert result.getpixel((0, 0)) == (255, 255, 255)
    assert result.getpixel((512, 704)) == (255, 0, 0)


def test_allow_upscale_fills_target() -> None:
    source = Image.new("RGB", (80, 110), "red")
    result = normalize_page(source, allow_upscale=True)
    assert result.size == (1024, 1408)
    assert result.getpixel((0, 0)) == (255, 0, 0)
    assert result.getpixel((1023, 1407)) == (255, 0, 0)


def test_pad_color(portrait_page: Image.Image) -> None:
    result = normalize_page(portrait_page, pad_color="000000")
    assert result.getpixel((0, 0)) == (0, 0, 0)


def test_max_pixels_downscales_when_no_target() -> None:
    source = Image.new("RGB", (3000, 3000), "white")
    result = normalize_page(source, target=(0, 0), max_pixels=1_000_000)
    assert result.width * result.height <= 1_000_000


def test_content_bbox_trims_margins() -> None:
    source = Image.new("RGB", (200, 200), "white")
    ImageDraw.Draw(source).rectangle([50, 60, 149, 159], fill="black")
    assert content_bbox(source) == (50, 60, 150, 160)


def test_content_bbox_blank_page() -> None:
    assert content_bbox(Image.new("RGB", (200, 200), "white")) is None


def test_normalize_with_trim() -> None:
    source = Image.new("RGB", (200, 200), "white")
    ImageDraw.Draw(source).rectangle([50, 60, 149, 159], fill="black")
    result = normalize_page(source, trim=True)
    assert result.size == (1024, 1408)
    assert result.getpixel((512, 704)) == (0, 0, 0)
