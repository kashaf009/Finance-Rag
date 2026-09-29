from __future__ import annotations

import dataclasses
from typing import Any

from PIL import Image

from app.core.config import get_settings
from app.imaging.encode import image_to_base64
from app.llm import NOT_FOUND_ANSWER
from app.rag import RagService, build_citations, build_graph
from app.rag.nodes import RagDeps
from tests.fakes import FakeEmbedder, FakeHit, FakeLLM, FakeStore

DOC = "JPM_SE_Annual_2023_140"


def _page(number: int, score: float) -> FakeHit:
    encoded = image_to_base64(Image.new("RGB", (300, 400), "white"))
    return FakeHit(
        score=score,
        payload={
            "doc_id": DOC,
            "page_number": number,
            "image_base64": encoded,
            "width": 300,
            "height": 400,
            "source": f"{DOC}.pdf",
        },
    )


def _deps(utility: Any, answer: Any, pages: list[FakeHit], **overrides: Any) -> RagDeps:
    settings = get_settings()
    if overrides:
        settings = dataclasses.replace(settings, **overrides)
    return RagDeps(
        settings=settings,
        embedder=FakeEmbedder(dim=8),
        store=FakeStore(pages),
        answer_llm=answer,
        utility_llm=utility,
    )


def test_graph_runs_happy_path_and_cites_pages() -> None:
    deps = _deps(
        FakeLLM(["YES the pages contain net income", "SUPPORTED"]),
        FakeLLM(["Net income was 37.7 billion. [p12]"]),
        [_page(12, 0.9)],
    )
    service = RagService(deps=deps, graph=build_graph(deps))
    result = service.answer("What was net income?")
    assert result.supported is True
    assert "37.7 billion" in result.answer
    assert result.citations
    assert result.citations[0].page_number == 12
    assert result.rewrites == 0
    nodes = [step["node"] for step in result.trace]
    assert nodes == ["retrieve", "grade", "generate", "self_check"]


def test_graph_rewrites_query_when_documents_graded_irrelevant() -> None:
    deps = _deps(
        FakeLLM(["NO", "net income fiscal 2023", "YES", "SUPPORTED"]),
        FakeLLM(["Net income was 37.7 billion. [p12]"]),
        [_page(12, 0.8)],
    )
    service = RagService(deps=deps, graph=build_graph(deps))
    result = service.answer("What was net income?")
    assert result.rewrites == 1
    assert result.query == "net income fiscal 2023"
    assert "37.7 billion" in result.answer


def test_graph_stops_rewriting_after_max_rewrites() -> None:
    deps = _deps(
        FakeLLM(["NO", "q1", "NO", "q2", "NO"]),
        FakeLLM([""]),
        [_page(5, 0.9)],
        rag_max_rewrites=2,
        rag_relevance_threshold=0.0,
    )
    service = RagService(deps=deps, graph=build_graph(deps))
    result = service.answer("unanswerable question?")
    assert result.rewrites == 2
    assert result.supported is False
    assert result.answer == NOT_FOUND_ANSWER
    assert result.citations == []


def test_graph_refuses_when_no_pages_retrieved() -> None:
    deps = _deps(FakeLLM([]), FakeLLM([]), [])
    service = RagService(deps=deps, graph=build_graph(deps))
    result = service.answer("anything?")
    assert result.answer == NOT_FOUND_ANSWER
    assert result.supported is False
    assert result.pages_considered == 0


def test_graph_rejects_unsupported_answer_with_refusal() -> None:
    deps = _deps(
        FakeLLM(["YES", "UNSUPPORTED"]),
        FakeLLM(["Net income was 999 billion. [p3]"]),
        [_page(3, 0.9)],
    )
    service = RagService(deps=deps, graph=build_graph(deps))
    result = service.answer("What was net income?")
    assert result.supported is False
    assert result.answer == NOT_FOUND_ANSWER
    assert result.citations == []


def test_low_score_short_circuits_grader() -> None:
    utility = FakeLLM(["YES", "SUPPORTED"])
    deps = _deps(
        utility,
        FakeLLM(["answer [p1]"]),
        [_page(1, 0.1)],
        rag_relevance_threshold=0.5,
        rag_max_rewrites=0,
    )
    service = RagService(deps=deps, graph=build_graph(deps))
    result = service.answer("What was net income?")
    grader_calls = [
        call for call in utility.calls if "do these pages contain" in str(call[1].content).lower()
    ]
    assert grader_calls == []
    assert result.supported is False
    assert [step["node"] for step in result.trace] == [
        "retrieve",
        "grade",
        "generate",
        "self_check",
    ]


def test_search_returns_citations_with_downscaled_images() -> None:
    deps = _deps(FakeLLM([]), FakeLLM([]), [_page(7, 0.77)])
    service = RagService(deps=deps, graph=build_graph(deps))
    hits = service.search("net income", limit=1)
    assert len(hits) == 1
    assert hits[0].page_number == 7
    assert hits[0].image.startswith("data:image/jpeg;base64,")


def test_build_citations_filters_by_page_markers() -> None:
    from app.rag.state import RetrievedPage

    pages: list[RetrievedPage] = [
        {
            "doc_id": DOC,
            "page_number": 5,
            "score": 0.9,
            "image_base64": image_to_base64(Image.new("RGB", (100, 100), "white")),
            "width": 100,
            "height": 100,
            "source": "x.pdf",
        },
        {
            "doc_id": DOC,
            "page_number": 6,
            "score": 0.8,
            "image_base64": image_to_base64(Image.new("RGB", (100, 100), "white")),
            "width": 100,
            "height": 100,
            "source": "x.pdf",
        },
    ]
    citations = build_citations(
        "Value found on [p6] only.", pages, max_pages=5, settings=get_settings()
    )
    assert [c.page_number for c in citations] == [6]


def test_build_citations_keeps_top_pages_when_no_markers() -> None:
    from app.rag.state import RetrievedPage

    page = RetrievedPage(
        doc_id=DOC,
        page_number=2,
        score=0.5,
        image_base64=image_to_base64(Image.new("RGB", (100, 100), "white")),
        width=100,
        height=100,
        source="x.pdf",
    )
    citations = build_citations(
        "No markers here.", [page, {**page, "page_number": 3}], max_pages=1, settings=get_settings()
    )
    assert len(citations) == 1
