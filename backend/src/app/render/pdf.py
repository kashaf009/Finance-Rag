from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

from pdf2image import convert_from_path, pdfinfo_from_path
from PIL import Image

from app.core.config import AppSettings, get_settings
from app.core.logging import get_logger

logger = get_logger("render.pdf")

_GRAYSCALE_NAMES = {"gray", "grey", "grayscale", "greyscale", "l"}


class RenderError(RuntimeError):
    pass


def resolve_poppler_path(
    settings: AppSettings | None = None, override: str | None = None
) -> str | None:
    if override:
        return override
    configured = (settings or get_settings()).poppler_path
    if configured:
        return configured
    if shutil.which("pdftoppm"):
        return None
    for candidate in ("/opt/homebrew/bin", "/usr/local/bin"):
        if shutil.which("pdftoppm", path=candidate):
            return candidate
    return None


def page_count(
    pdf_path: str | Path,
    *,
    poppler_path: str | None = None,
    settings: AppSettings | None = None,
) -> int:
    path = Path(pdf_path)
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")
    try:
        info = pdfinfo_from_path(
            str(path), poppler_path=resolve_poppler_path(settings, poppler_path)
        )
    except Exception as exc:
        raise RenderError(f"Failed to read PDF info for {path}: {exc}") from exc
    pages = info.get("Pages")
    if not pages:
        raise RenderError(f"Could not determine page count for {path}")
    return int(pages)


def _to_mode(image: Image.Image, colorspace: str) -> Image.Image:
    return image.convert("L" if colorspace.strip().lower() in _GRAYSCALE_NAMES else "RGB")


def render_pdf_pages(
    pdf_path: str | Path,
    *,
    first_page: int | None = None,
    last_page: int | None = None,
    dpi: int | None = None,
    colorspace: str | None = None,
    thread_count: int | None = None,
    poppler_path: str | None = None,
    settings: AppSettings | None = None,
) -> list[Image.Image]:
    cfg = settings or get_settings()
    path = Path(pdf_path)
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")
    if first_page is not None and last_page is not None and first_page > last_page:
        raise ValueError(f"first_page ({first_page}) is after last_page ({last_page})")

    rendered = convert_from_path(
        str(path),
        dpi=dpi or cfg.source_dpi,
        first_page=first_page,
        last_page=last_page,
        thread_count=thread_count or cfg.render_thread_count,
        poppler_path=resolve_poppler_path(cfg, poppler_path),
    )
    return [_to_mode(image, colorspace or cfg.colorspace) for image in rendered]


def iter_page_chunks(
    pdf_path: str | Path,
    *,
    chunk_pages: int | None = None,
    first_page: int | None = None,
    last_page: int | None = None,
    dpi: int | None = None,
    colorspace: str | None = None,
    thread_count: int | None = None,
    poppler_path: str | None = None,
    settings: AppSettings | None = None,
) -> Iterator[tuple[int, list[Image.Image]]]:
    cfg = settings or get_settings()
    total = page_count(pdf_path, poppler_path=poppler_path, settings=cfg)
    start = first_page or 1
    end = min(last_page or total, total)
    size = chunk_pages if chunk_pages is not None else cfg.render_chunk_pages
    if size <= 0:
        size = end - start + 1

    logger.info("Rendering %s pages %d-%d at %d dpi", pdf_path, start, end, dpi or cfg.source_dpi)
    for chunk_start in range(start, end + 1, size):
        chunk_end = min(chunk_start + size - 1, end)
        images = render_pdf_pages(
            pdf_path,
            first_page=chunk_start,
            last_page=chunk_end,
            dpi=dpi,
            colorspace=colorspace,
            thread_count=thread_count,
            poppler_path=poppler_path,
            settings=cfg,
        )
        yield chunk_start, images
