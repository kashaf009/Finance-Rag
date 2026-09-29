from __future__ import annotations

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
