from __future__ import annotations

from dataclasses import dataclass

from PIL import Image

JPEG_MIME = "image/jpeg"


@dataclass(frozen=True, slots=True)
class RenderedPage:
    page_number: int
    image: Image.Image
    width: int
    height: int

    @classmethod
    def from_image(cls, page_number: int, image: Image.Image) -> RenderedPage:
        return cls(
            page_number=page_number,
            image=image,
            width=image.width,
            height=image.height,
        )


@dataclass(frozen=True, slots=True)
class PageArtifact:
    page_number: int
    base64: str
    width: int
    height: int
    mime: str = JPEG_MIME
