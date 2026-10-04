from __future__ import annotations

import dataclasses
from io import BytesIO
from unittest.mock import patch

import pytest
from PIL import Image

from app.core.config import get_settings
from app.imaging import base64_to_bytes, base64_to_image, image_to_base64, image_to_jpeg_bytes


def test_jpeg_magic_bytes() -> None:
    data = image_to_jpeg_bytes(Image.new("RGB", (32, 32), "white"))
    assert data[:2] == b"\xff\xd8"
    assert data[-2:] == b"\xff\xd9"


def test_jpeg_encoder_skips_conversion_for_rgb_images() -> None:
    source = Image.new("RGB", (32, 48), "white")
    with patch.object(source, "convert", side_effect=AssertionError("RGB image converted twice")):
        payload = image_to_jpeg_bytes(source)
    assert payload[:2] == b"\xff\xd8"
    with Image.open(BytesIO(payload)) as decoded:
        assert decoded.size == source.size
        assert decoded.mode == "RGB"


@pytest.mark.parametrize("mode", ["RGB", "RGBA", "L", "P", "CMYK"])
@pytest.mark.parametrize("optimize", [True, False])
def test_jpeg_encoder_preserves_existing_ingest_bytes(mode: str, optimize: bool) -> None:
    source = Image.effect_noise((48, 64), 64).convert(mode)
    pixels = source.tobytes()
    settings = dataclasses.replace(get_settings(), jpeg_quality=83, jpeg_optimize=optimize)
    # Compare against the previous encoder to protect stored ingest artifacts
    # while removing the redundant RGB conversion.
    expected = BytesIO()
    source.convert("RGB").save(
        expected, "JPEG", quality=settings.jpeg_quality, optimize=settings.jpeg_optimize
    )
    assert image_to_jpeg_bytes(source, settings=settings) == expected.getvalue()
    assert source.mode == mode
    assert source.tobytes() == pixels


def test_base64_round_trip() -> None:
    source = Image.new("RGB", (64, 96), "white")
    result = base64_to_image(image_to_base64(source))
    assert result.size == (64, 96)
    assert result.mode == "RGB"


def test_data_uri_prefix() -> None:
    encoded = image_to_base64(Image.new("RGB", (16, 16), "white"), data_uri=True)
    assert encoded.startswith("data:image/jpeg;base64,")
    assert base64_to_image(encoded).size == (16, 16)


def test_base64_to_bytes_strips_data_uri() -> None:
    payload = base64_to_bytes("data:image/jpeg;base64,AAAA")
    assert payload == b"\x00\x00\x00"


def test_quality_affects_size() -> None:
    source = Image.effect_noise((128, 128), 100).convert("RGB")
    low = image_to_jpeg_bytes(source, quality=20)
    high = image_to_jpeg_bytes(source, quality=95)
    assert len(high) > len(low)
