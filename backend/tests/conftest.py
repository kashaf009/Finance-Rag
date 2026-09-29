from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

from app.core.config import reset_settings
from tests.fakes import FakeClient, FakeEmbedder, FakeModels


@pytest.fixture(autouse=True)
def _reset_settings() -> Iterator[None]:
    reset_settings()
    yield
    reset_settings()


def _page(size: tuple[int, int], label: str) -> Image.Image:
    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle([20, 20, size[0] - 20, size[1] - 20], outline="black", width=3)
    draw.text((40, 40), label, fill="black")
    return image


@pytest.fixture
def tiny_pdf(tmp_path: Path) -> Path:
    path = tmp_path / "tiny.pdf"
    pages = [_page((400, 600), "PAGE ONE"), _page((600, 400), "PAGE TWO")]
    pages[0].save(path, save_all=True, append_images=pages[1:], resolution=72)
    return path


@pytest.fixture
def portrait_page() -> Image.Image:
    return Image.new("RGB", (400, 600), "white")


@pytest.fixture
def landscape_page() -> Image.Image:
    return Image.new("RGB", (600, 400), "white")


@pytest.fixture
def fake_embedder() -> FakeEmbedder:
    return FakeEmbedder(dim=8)


@pytest.fixture
def fake_models() -> FakeModels:
    return FakeModels(dim=4)


@pytest.fixture
def fake_client(fake_models: FakeModels) -> FakeClient:
    return FakeClient(fake_models)
