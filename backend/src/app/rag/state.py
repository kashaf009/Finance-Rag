from __future__ import annotations

from typing import TypedDict


class RetrievedPage(TypedDict):
    doc_id: str
    page_number: int
    score: float
    image_base64: str
    width: int
    height: int
    source: str


class RAGState(TypedDict, total=False):
    question: str
    original_question: str
    query: str
    top_k: int
    pages: list[RetrievedPage]
    rewrite_count: int
    relevant: bool
    answer: str
    supported: bool
    trace: list[dict[str, object]]
