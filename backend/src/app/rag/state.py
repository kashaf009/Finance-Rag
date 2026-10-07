from __future__ import annotations

from typing import NotRequired, TypedDict


class RetrievedPage(TypedDict):
    doc_id: str
    page_number: int
    score: float
    image_base64: NotRequired[str]
    prompt_data_uri: NotRequired[str]
    width: int
    height: int
    source: str


class RAGState(TypedDict, total=False):
    question: str
    original_question: str
    query: str
    provider: str
    top_k: int
    pages: list[RetrievedPage]
    rewrite_count: int
    relevant: bool
    answer: str
    supported: bool
    trace: list[dict[str, object]]
