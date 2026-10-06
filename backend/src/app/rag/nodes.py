from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.config import AppSettings
from app.core.logging import get_logger
from app.embed import Embedder
from app.llm import ANSWER, MAX_GRADER_PAGES, UTILITY, build_llm, text_of, to_prompt_data_uri
from app.llm.prompts import (
    ANSWER_SYSTEM,
    GRADE_PROMPT,
    GRADER_SYSTEM,
    NOT_FOUND_ANSWER,
    REWRITE_PROMPT,
    REWRITER_SYSTEM,
    SELF_CHECK_PROMPT,
    SELF_CHECK_SYSTEM,
    answer_prompt,
    is_refusal,
)
from app.rag.state import RAGState, RetrievedPage
from app.vector.store import QdrantStore

logger = get_logger("rag.nodes")

# Matches one bracketed marker holding one or more page numbers, in any of the
# spellings the model emits: "[p24]", "[p24, p30]", "[p24,p30]", "[p24,30]".
# The repeated "p" prefix is optional after the first one. Capture group is the
# raw inner text ("24, p30"), so callers must extract the numbers themselves --
# see build_citations. The previous r"\[p(\d+)\]" matched nothing in a grouped
# marker, which left the citation filter with no referenced pages.
PAGE_MARKER = re.compile(r"\[p(\d+(?:\s*,\s*p?\s*\d+)*)\]")


class RagError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RagDeps:
    settings: AppSettings
    embedder: Embedder
    store: QdrantStore
    answer_llm: Any = None
    utility_llm: Any = None

    def answer_model(self) -> Any:
        return self.answer_llm if self.answer_llm is not None else build_llm(ANSWER, self.settings)

    def utility_model(self) -> Any:
        return (
            self.utility_llm if self.utility_llm is not None else build_llm(UTILITY, self.settings)
        )


def _trace(state: RAGState, node: str, **data: object) -> list[dict[str, object]]:
    trace = list(state.get("trace") or [])
    trace.append({"node": node, **data})
    return trace


def _image_blocks(pages: list[RetrievedPage], settings: AppSettings) -> list[dict[str, object]]:
    blocks: list[dict[str, object]] = []
    for page in pages:
        uri = page.get("prompt_data_uri")
        if not uri:
            uri = to_prompt_data_uri(
                page.get("image_base64", ""),
                doc_id=page["doc_id"],
                page_number=page["page_number"],
                settings=settings,
            )
        blocks.append(
            {
                "type": "text",
                "text": (
                    f"Page p{page['page_number']} - document {page['doc_id']}, "
                    f"retrieval score {page['score']:.3f}"
                ),
            }
        )
        blocks.append(
            {
                "type": "image_url",
                "image_url": {"url": uri},
            }
        )
    return blocks


def _page_fields(hit: Any) -> RetrievedPage:
    payload = hit.payload or {}
    return RetrievedPage(
        doc_id=str(payload.get("doc_id") or ""),
        page_number=int(payload.get("page_number") or 0),
        score=float(hit.score),
        image_base64=str(payload.get("image_base64") or ""),
        prompt_data_uri=str(payload.get("prompt_data_uri") or ""),
        width=int(payload.get("width") or 0),
        height=int(payload.get("height") or 0),
        source=str(payload.get("source") or ""),
    )


def retrieve(state: RAGState, deps: RagDeps) -> RAGState:
    query = state.get("query") or state["question"]
    limit = state.get("top_k") or deps.settings.rag_top_k
    vector = deps.embedder.embed_text(query, query=True)
    hits = deps.store.search(vector, limit=limit)
    pages = [_page_fields(hit) for hit in hits]
    # Prepare only pages that a downstream LLM can use; a larger top_k should
    # not encode images that will never appear in a prompt or citation.
    for page in pages[: max(MAX_GRADER_PAGES, deps.settings.llm_max_pages)]:
        if not page.get("prompt_data_uri"):
            page["prompt_data_uri"] = to_prompt_data_uri(
                page.get("image_base64", ""),
                doc_id=page["doc_id"],
                page_number=page["page_number"],
                settings=deps.settings,
            )
    return {
        **state,
        "query": query,
        "pages": pages,
        "trace": _trace(state, "retrieve", query=query, hits=len(pages)),
    }


def grade_documents(state: RAGState, deps: RagDeps) -> RAGState:
    pages = state.get("pages") or []
    if not pages:
        return {
            **state,
            "relevant": False,
            "trace": _trace(state, "grade", relevant=False, reason="no pages"),
        }

    best = pages[0]["score"]
    floor = deps.settings.rag_rewrite_score_floor
    if best < floor:
        return {
            **state,
            "relevant": False,
            "trace": _trace(
                state,
                "grade",
                relevant=False,
                reason=f"top score {best:.3f} below rewrite floor {floor:.3f}; skipping rewrites",
            ),
        }
    if best < deps.settings.rag_relevance_threshold:
        reason = f"top score {best:.3f} below threshold"
        return {
            **state,
            "relevant": False,
            "trace": _trace(state, "grade", relevant=False, reason=reason),
        }

    sample = pages[:MAX_GRADER_PAGES]
    content: list[dict[str, object]] = [
        {
            "type": "text",
            "text": GRADE_PROMPT.format(question=state["question"], pages=len(sample)),
        }
    ]
    content.extend(_image_blocks(sample, deps.settings))
    try:
        reply = text_of(
            deps.utility_model().invoke(
                [SystemMessage(content=GRADER_SYSTEM), HumanMessage(content=content)]
            )
        )
    except Exception as exc:
        raise RagError(f"Retrieval grading failed: {exc}") from exc

    head = reply.strip().upper().split(maxsplit=1)[0] if reply.strip() else ""
    relevant = head.startswith("YES")
    return {
        **state,
        "relevant": relevant,
        "trace": _trace(state, "grade", relevant=relevant, reply=reply[:200]),
    }


def rewrite_query(state: RAGState, deps: RagDeps) -> RAGState:
    prompt = REWRITE_PROMPT.format(
        question=state["original_question"], previous=state.get("query", "")
    )
    try:
        reply = text_of(
            deps.utility_model().invoke(
                [SystemMessage(content=REWRITER_SYSTEM), HumanMessage(content=prompt)]
            )
        )
    except Exception as exc:
        raise RagError(f"Query rewrite failed: {exc}") from exc

    new_query = reply.strip().splitlines()[0].strip() if reply.strip() else state.get("query", "")
    return {
        **state,
        "query": new_query or state.get("query", ""),
        "rewrite_count": state.get("rewrite_count", 0) + 1,
        "trace": _trace(state, "rewrite_query", query=new_query[:200]),
    }


def generate(state: RAGState, deps: RagDeps) -> RAGState:
    pages = state.get("pages") or []
    if not pages:
        return {
            **state,
            "answer": NOT_FOUND_ANSWER,
            "trace": _trace(state, "generate", pages=0, outcome="refusal"),
        }

    selected = pages[: deps.settings.llm_max_pages]
    markers = [f"p{page['page_number']}" for page in selected]
    content: list[dict[str, object]] = [
        {"type": "text", "text": answer_prompt(state["question"], markers)}
    ]
    content.extend(_image_blocks(selected, deps.settings))
    try:
        reply = text_of(
            deps.answer_model().invoke(
                [SystemMessage(content=ANSWER_SYSTEM), HumanMessage(content=content)]
            )
        )
    except Exception as exc:
        raise RagError(f"Answer generation failed: {exc}") from exc

    answer = reply or NOT_FOUND_ANSWER
    return {
        **state,
        "answer": answer,
        "trace": _trace(state, "generate", pages=len(selected), chars=len(answer)),
    }


def self_check(state: RAGState, deps: RagDeps) -> RAGState:
    answer = state.get("answer") or ""
    pages = state.get("pages") or []
    if is_refusal(answer):
        return {
            **state,
            "supported": False,
            "trace": _trace(state, "self_check", supported=False, reason="refusal answer"),
        }
    if not answer or not pages:
        return {
            **state,
            "supported": False,
            "trace": _trace(state, "self_check", supported=False, reason="nothing to verify"),
        }

    selected = pages[: deps.settings.llm_max_pages]
    content: list[dict[str, object]] = [
        {
            "type": "text",
            "text": SELF_CHECK_PROMPT.format(question=state["question"], answer=answer),
        }
    ]
    content.extend(_image_blocks(selected, deps.settings))
    try:
        reply = text_of(
            deps.utility_model().invoke(
                [SystemMessage(content=SELF_CHECK_SYSTEM), HumanMessage(content=content)]
            )
        )
    except Exception as exc:
        raise RagError(f"Self check failed: {exc}") from exc

    supported = reply.strip().upper().startswith("SUPPORTED")
    return {
        **state,
        "supported": supported,
        "trace": _trace(state, "self_check", supported=supported, reply=reply[:200]),
    }


NODE_NAMES = ("retrieve", "grade_documents", "rewrite_query", "generate", "self_check")
