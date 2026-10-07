from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.core.config import AppSettings, get_settings
from app.core.logging import get_logger
from app.embed import get_embedder
from app.llm import NOT_FOUND_ANSWER, to_prompt_data_uri
from app.llm.prompts import is_refusal
from app.rag.graph import build_graph, route_after_grade
from app.rag.nodes import PAGE_MARKER, RagDeps
from app.rag.state import RAGState, RetrievedPage
from app.vector import QdrantStore

logger = get_logger("rag.service")


def _running_stage_message(stage: str) -> str:
    return {
        "retrieve": "Retrieving relevant pages",
        "grade": "Checking page relevance",
        "rewrite_query": "Refining the retrieval query",
        "generate": "Generating a grounded answer",
        "self_check": "Verifying the answer against the pages",
    }.get(stage, f"Running {stage}")


def _completed_stage_message(stage: str, step: dict[str, object]) -> str:
    if stage == "retrieve":
        return f"Retrieved {step.get('hits', 0)} relevant pages"
    if stage == "grade":
        return (
            "Pages passed the relevance check"
            if step.get("relevant")
            else "Pages did not pass the relevance check"
        )
    if stage == "rewrite_query":
        return "Retrieval query refined"
    if stage == "generate":
        if step.get("outcome") == "refusal":
            return "No grounded answer could be drafted"
        return f"Answer drafted from {step.get('pages', 0)} pages"
    if stage == "self_check":
        return (
            "Answer verified against the source pages"
            if step.get("supported")
            else "Answer was not supported by the source pages"
        )
    return f"Completed {stage}"


def _next_stage(stage: str, state: RAGState, settings: AppSettings) -> str | None:
    if stage == "retrieve":
        return "grade"
    if stage == "grade":
        return route_after_grade(state, settings)
    if stage == "rewrite_query":
        return "retrieve"
    if stage == "generate":
        return "self_check"
    return None


def _stream_meta(stage: str, step: dict[str, object], state: RAGState) -> dict[str, object]:
    if stage == "retrieve":
        pages = state.get("pages") or []
        return {
            "query": state.get("query") or "",
            "hits": len(pages),
            "pages": [
                {"page_number": page["page_number"], "score": page["score"]} for page in pages
            ],
        }
    if stage == "rewrite_query":
        return {"query": step.get("query") or state.get("query") or ""}
    if stage == "generate":
        return {"pages": step.get("pages", 0), "chars": step.get("chars", 0)}
    if stage == "grade":
        return {"relevant": bool(step.get("relevant"))}
    if stage == "self_check":
        return {"supported": bool(step.get("supported"))}
    return {}


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
        int(number) for group in PAGE_MARKER.findall(answer) for number in re.findall(r"\d+", group)
    }
    selected = [
        page for page in pages[:max_pages] if not referenced or page["page_number"] in referenced
    ]
    return [
        Citation(
            doc_id=page["doc_id"],
            page_number=page["page_number"],
            score=page["score"],
            image=page.get("prompt_data_uri")
            or to_prompt_data_uri(
                page.get("image_base64", ""),
                doc_id=page["doc_id"],
                page_number=page["page_number"],
                settings=settings,
            ),
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
        citations: list[Citation] = []
        for hit in hits:
            payload = hit.payload or {}
            doc_id = str(payload.get("doc_id") or "")
            page_number = int(payload.get("page_number") or 0)
            citations.append(
                Citation(
                    doc_id=doc_id,
                    page_number=page_number,
                    score=float(hit.score),
                    image=str(payload.get("prompt_data_uri") or "")
                    or to_prompt_data_uri(
                        str(payload.get("image_base64") or ""),
                        doc_id=doc_id,
                        page_number=page_number,
                        settings=cfg,
                    ),
                )
            )
        return citations

    def answer(
        self, question: str, top_k: int | None = None, *, provider: str | None = None
    ) -> AnswerResult:
        final: RAGState = self._graph.invoke(self._initial_state(question, top_k, provider))
        return self._result_from_state(question, final)

    def stream(
        self, question: str, top_k: int | None = None, *, provider: str | None = None
    ) -> Iterator[dict[str, object]]:
        """Yield truthful pipeline updates while the Self-RAG graph is running.

        LangGraph emits a state snapshot after each node. The stream translates
        those snapshots into small UI-safe events, so retrieval and grading can
        be shown before the slower generation and verification calls finish.
        """
        initial = self._initial_state(question, top_k, provider)
        yield {
            "type": "stage",
            "stage": "retrieve",
            "status": "running",
            "message": "Retrieving relevant pages",
            "step": 0,
        }

        previous_trace: list[dict[str, object]] = []
        final: RAGState | None = None
        for snapshot in self._graph.stream(initial, stream_mode="values"):
            state = dict(snapshot)
            final = state
            trace = list(state.get("trace") or [])
            new_steps = trace[len(previous_trace) :]
            for step in new_steps:
                node = str(step.get("node") or "unknown")
                yield {
                    "type": "stage",
                    "stage": node,
                    "status": "complete",
                    "message": _completed_stage_message(node, step),
                    "step": len(previous_trace) + 1,
                    "meta": _stream_meta(node, step, state),
                }
                next_stage = _next_stage(node, state, self._deps.settings)
                if next_stage is not None:
                    yield {
                        "type": "stage",
                        "stage": next_stage,
                        "status": "running",
                        "message": _running_stage_message(next_stage),
                        "step": len(previous_trace) + 1,
                    }
                previous_trace.append(step)

        if final is None:
            final = initial
        yield {"type": "complete", "response": self._result_from_state(question, final)}

    def _initial_state(self, question: str, top_k: int | None, provider: str | None) -> RAGState:
        cfg = self._deps.settings
        return {
            "question": question,
            "original_question": question,
            "query": question,
            "provider": cfg.llm_provider if provider is None else provider,
            "top_k": top_k or cfg.rag_top_k,
            "pages": [],
            "rewrite_count": 0,
            "relevant": False,
            "answer": "",
            "supported": False,
            "trace": [],
        }

    def _result_from_state(self, question: str, final: RAGState) -> AnswerResult:
        cfg = self._deps.settings
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
