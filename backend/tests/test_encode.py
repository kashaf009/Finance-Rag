from __future__ import annotations

from PIL import Image

from app.imaging import base64_to_bytes, base64_to_image, image_to_base64, image_to_jpeg_bytes


def test_jpeg_magic_bytes() -> None:
    data = image_to_jpeg_bytes(Image.new("RGB", (32, 32), "white"))
    assert data[:2] == b"\xff\xd8"
    assert data[-2:] == b"\xff\xd9"


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
