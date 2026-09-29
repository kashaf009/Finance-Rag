from __future__ import annotations

from pathlib import Path

import pytest

from app.render import RenderError, iter_page_chunks, page_count, render_pdf_pages


def test_page_count(tiny_pdf: Path) -> None:
    assert page_count(tiny_pdf) == 2


def test_render_all_pages(tiny_pdf: Path) -> None:
    pages = render_pdf_pages(tiny_pdf, dpi=72)
    assert len(pages) == 2
    assert all(page.mode == "RGB" for page in pages)
    assert all(page.width > 0 and page.height > 0 for page in pages)


def test_render_single_page(tiny_pdf: Path) -> None:
    pages = render_pdf_pages(tiny_pdf, first_page=2, last_page=2, dpi=72)
    assert len(pages) == 1


def test_render_grayscale(tiny_pdf: Path) -> None:
    pages = render_pdf_pages(tiny_pdf, dpi=72, colorspace="gray")
    assert all(page.mode == "L" for page in pages)


def test_render_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        render_pdf_pages(tmp_path / "nope.pdf")


def test_page_count_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        page_count(tmp_path / "nope.pdf")


def test_invalid_range(tiny_pdf: Path) -> None:
    with pytest.raises(ValueError, match="after last_page"):
        render_pdf_pages(tiny_pdf, first_page=3, last_page=1, dpi=72)


def test_iter_page_chunks(tiny_pdf: Path) -> None:
    chunks = list(iter_page_chunks(tiny_pdf, chunk_pages=1, dpi=72))
    assert [start for start, _ in chunks] == [1, 2]
    assert all(len(images) == 1 for _, images in chunks)


def test_iter_page_chunks_limit(tiny_pdf: Path) -> None:
    chunks = list(iter_page_chunks(tiny_pdf, chunk_pages=8, first_page=1, last_page=1, dpi=72))
    assert len(chunks) == 1
    assert chunks[0][0] == 1
    assert len(chunks[0][1]) == 1


def test_render_error_is_runtime_error() -> None:
    assert issubclass(RenderError, RuntimeError)
