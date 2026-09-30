from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from app.embed import get_embedder
from app.llm import NOT_FOUND_ANSWER, to_prompt_data_uri
from app.llm.prompts import is_refusal
from app.rag.graph import build_graph
from app.rag.nodes import PAGE_MARKER, RagDeps
from app.rag.state import RAGState, RetrievedPage
from app.vector import QdrantStore

logger = get_logger("rag.service")


@dataclass(frozen=True, slots=True)
class Citation:
    doc_id: str
    page_number: int
    score: float
    image: str


@dataclass(frozen=True, slots=True)
class AnswerResult:
    question: str
    query: str
    answer: str
    supported: bool
    rewrites: int
    pages_considered: int
    citations: list[Citation] = field(default_factory=list)
    trace: list[dict[str, object]] = field(default_factory=list)


def build_citations(
    answer: str, pages: list[RetrievedPage], max_pages: int, settings: Any = None
) -> list[Citation]:
    # PAGE_MARKER captures the whole bracket body, which may name several pages
    # ("24, p30"), so pull every number out of it rather than int()-ing the group.
    referenced = {
        int(number)
        for group in PAGE_MARKER.findall(answer)
        for number in re.findall(r"\d+", group)
    }
    selected = [
        page for page in pages[:max_pages] if not referenced or page["page_number"] in referenced
    ]
    return [
        Citation(
            doc_id=page["doc_id"],
            page_number=page["page_number"],
            score=page["score"],
            image=to_prompt_data_uri(page["image_base64"], settings=settings),
        )
        for page in selected
    ]


class RagService:
    def __init__(self, deps: RagDeps | None = None, graph: Any | None = None) -> None:
        if deps is None:
            settings = get_settings()
            deps = RagDeps(
                settings=settings,
                embedder=get_embedder(settings),
                store=QdrantStore(settings),
            )
        self._deps = deps
        self._graph = graph if graph is not None else build_graph(deps)

    @property
    def settings(self) -> Any:
        return self._deps.settings

    def search(self, query: str, limit: int | None = None) -> list[Citation]:
        cfg = self._deps.settings
        vector = self._deps.embedder.embed_text(query, query=True)
        hits = self._deps.store.search(vector, limit=limit or cfg.rag_top_k)
        return [
            Citation(
                doc_id=str((hit.payload or {}).get("doc_id") or ""),
                page_number=int((hit.payload or {}).get("page_number") or 0),
                score=float(hit.score),
                image=to_prompt_data_uri(
                    str((hit.payload or {}).get("image_base64") or ""), settings=cfg
                ),
            )
            for hit in hits
        ]

    def answer(self, question: str, top_k: int | None = None) -> AnswerResult:
        cfg = self._deps.settings
        initial: RAGState = {
            "question": question,
            "original_question": question,
            "query": question,
            "top_k": top_k or cfg.rag_top_k,
            "pages": [],
            "rewrite_count": 0,
            "relevant": False,
            "answer": "",
            "supported": False,
            "trace": [],
        }
        final: RAGState = self._graph.invoke(initial)
        pages = final.get("pages") or []
        supported = bool(final.get("supported"))
        answer = final.get("answer") or ""
        if not supported or is_refusal(answer):
            return AnswerResult(
                question=question,
                query=final.get("query") or question,
                answer=NOT_FOUND_ANSWER,
                supported=False,
                rewrites=final.get("rewrite_count", 0),
                pages_considered=len(pages),
                citations=[],
                trace=list(final.get("trace") or []),
            )
        return AnswerResult(
            question=question,
            query=final.get("query") or question,
            answer=answer,
            supported=True,
            rewrites=final.get("rewrite_count", 0),
            pages_considered=len(pages),
            citations=build_citations(answer, pages, cfg.llm_max_pages, cfg),
            trace=list(final.get("trace") or []),
        )
