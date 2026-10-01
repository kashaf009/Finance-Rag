from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.rag.nodes import (
    RagDeps,
    generate,
    grade_documents,
    retrieve,
    rewrite_query,
    self_check,
)
from app.rag.state import RAGState

Node = Callable[[RAGState], RAGState]


def _timed(name: str, fn: Callable[[RAGState, RagDeps], RAGState], deps: RagDeps) -> Node:
    """Wrap a node so the trace entry it appends carries its own wall clock.

    The duration is measured here, once, and both callers read it from the same
    place: POST /chat returns it in the trace, and the streaming endpoint emits
    it as the node's stage duration. Nothing downstream re-derives it, so the
    two paths cannot disagree.
    """

    def run(state: RAGState) -> RAGState:
        start = time.perf_counter()
        out = fn(state, deps)
        elapsed_ms = round((time.perf_counter() - start) * 1000)
        trace = list(out.get("trace") or [])
        if trace:
            trace[-1] = {**trace[-1], "ms": elapsed_ms}
        return {**out, "trace": trace}

    run.__name__ = name
    return run


def _make_router(deps: RagDeps) -> Callable[[RAGState], str]:
    def route(state: RAGState) -> str:
        if state.get("relevant"):
            return "generate"
        if state.get("rewrite_count", 0) < deps.settings.rag_max_rewrites:
            return "rewrite_query"
        return "generate"

    return route


def build_graph(deps: RagDeps) -> Any:
    builder: StateGraph = StateGraph(RAGState)
    builder.add_node("retrieve", lambda state: retrieve(state, deps))
    builder.add_node("grade_documents", lambda state: grade_documents(state, deps))
    builder.add_node("rewrite_query", lambda state: rewrite_query(state, deps))
    builder.add_node("generate", lambda state: generate(state, deps))
    builder.add_node("self_check", lambda state: self_check(state, deps))

    builder.add_edge(START, "retrieve")
    builder.add_edge("retrieve", "grade_documents")
    builder.add_conditional_edges(
        "grade_documents",
        _make_router(deps),
        {"rewrite_query": "rewrite_query", "generate": "generate"},
    )
    builder.add_edge("rewrite_query", "retrieve")
    builder.add_edge("generate", "self_check")
    builder.add_edge("self_check", END)
    return builder.compile()
