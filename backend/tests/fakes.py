from __future__ import annotations

from collections.abc import Sequence
from types import SimpleNamespace

from PIL import Image


class FakeEmbedder:
    def __init__(self, dim: int = 8) -> None:
        self._dim = dim
        self.calls = 0

    @property
    def dim(self) -> int:
        return self._dim

    def _vector(self, seed: int) -> list[float]:
        return [float((seed + index) % 7) for index in range(self._dim)]

    def embed_image(self, image: Image.Image) -> list[float]:
        self.calls += 1
        return self._vector(image.width + image.height)

    def embed_images(self, images: Sequence[Image.Image]) -> list[list[float]]:
        return [self.embed_image(image) for image in images]

    def embed_text(self, text: str, *, query: bool = False) -> list[float]:
        self.calls += 1
        return self._vector(len(text))


class FakeModels:
    def __init__(self, dim: int = 4, fail_times: int = 0) -> None:
        self.dim = dim
        self.fail_times = fail_times
        self.calls: list[dict[str, object]] = []

    def embed_content(self, *, model: str, contents: object, config: object) -> object:
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self.fail_times > 0:
            self.fail_times -= 1
            raise RuntimeError("transient failure")
        embedding = SimpleNamespace(values=[0.1] * self.dim)
        return SimpleNamespace(embeddings=[embedding])


class FakeClient:
    def __init__(self, models: FakeModels) -> None:
        self.models = models
