from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from PIL import Image


@runtime_checkable
class Embedder(Protocol):
    @property
    def dim(self) -> int: ...

    def warmup(self) -> None: ...

    def embed_image(self, image: Image.Image) -> list[float]: ...

    def embed_images(self, images: Sequence[Image.Image]) -> list[list[float]]: ...

    def embed_text(self, text: str, *, query: bool = False) -> list[float]: ...
