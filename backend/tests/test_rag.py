from __future__ import annotations

import dataclasses
from typing import Any
from unittest.mock import patch

import pytest
from PIL import Image

from app.core.config import get_settings
from app.imaging.encode import image_to_base64
from app.llm import NOT_FOUND_ANSWER
from app.llm import images as prompt_images
from app.rag import AnswerResult, RagService, build_citations, build_graph
from app.rag.nodes import RagDeps
from app.rag.state import RetrievedPage
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


@pytest.mark.parametrize("streaming", [False, True])
def test_prompt_images_are_encoded_once_and_reused_across_turns(streaming: bool) -> None:
    utility = FakeLLM(["YES", "SUPPORTED"] * 2)
    answer = FakeLLM(["Financial results [p1, p2, p3, p4, p5]."] * 2)
    deps = _deps(utility, answer, [_page(number, 0.9) for number in range(1, 9)])
    service = RagService(deps=deps)

    def run() -> AnswerResult:
        if streaming:
            response = list(service.stream("What were the financial results?", top_k=8))[-1][
                "response"
            ]
            assert isinstance(response, AnswerResult)
            return response
        return service.answer("What were the financial results?", top_k=8)

    with patch.object(
        prompt_images, "image_to_jpeg_bytes", wraps=prompt_images.image_to_jpeg_bytes
    ) as encode:
        first = run()
        assert encode.call_count == 5
        repeated = run()
        assert encode.call_count == 5

    assert first.supported is repeated.supported is True
    assert first.pages_considered == repeated.pages_considered == 8
    assert first.citations == repeated.citations
    urls = [citation.image for citation in first.citations]
    for calls, expected in (
        (answer.calls, urls),
        (utility.calls[::2], urls[:2]),
        (utility.calls[1::2], urls),
    ):
        for call in calls:
            blocks = call[1].content
            assert [
                block["image_url"]["url"] for block in blocks if block["type"] == "image_url"
            ] == expected


def test_search_and_unprepared_citations_share_the_chat_image_cache() -> None:
    deps = _deps(
        FakeLLM(["YES", "SUPPORTED"]),
        FakeLLM(["Financial results [p1, p2, p3, p4, p5]."]),
        [_page(number, 0.9) for number in range(1, 6)],
    )
    service = RagService(deps=deps)
    pages = [RetrievedPage(**hit.payload, score=hit.score) for hit in deps.store.pages]
    with patch.object(
        prompt_images, "image_to_jpeg_bytes", wraps=prompt_images.image_to_jpeg_bytes
    ) as encode:
        hits = service.search("financial results")
        assert encode.call_count == 5
        result = service.answer("What were the financial results?")
        citations = build_citations(
            result.answer,
            pages,
            max_pages=5,
            settings=deps.settings,
        )
        assert encode.call_count == 5
        assert service.search("financial results") == hits
        assert encode.call_count == 5
    assert result.citations == citations == hits


def test_query_rewrites_reuse_images_for_overlapping_retrievals() -> None:
    deps = _deps(
        FakeLLM(["NO", "broader query", "NO", "another query", "YES", "SUPPORTED"]),
        FakeLLM(["Financial results [p1, p2, p3, p4, p5]."]),
        [_page(number, 0.9) for number in range(1, 6)],
    )
    with patch.object(
        prompt_images, "image_to_jpeg_bytes", wraps=prompt_images.image_to_jpeg_bytes
    ) as encode:
        result = RagService(deps=deps).answer("What were the financial results?")
    assert result.supported is True
    assert result.rewrites == 2
    assert encode.call_count == 5


def test_stream_reports_stage_updates_and_retrieval_metadata() -> None:
    deps = _deps(
        FakeLLM(["YES", "SUPPORTED"]),
        FakeLLM(["Net income was 37.7 billion. [p12]"]),
        [_page(12, 0.9)],
    )
    service = RagService(deps=deps, graph=build_graph(deps))

    events = list(service.stream("What was net income?"))
    completed = [event for event in events if event.get("status") == "complete"]

    assert events[0] == {
        "type": "stage",
        "stage": "retrieve",
        "status": "running",
        "message": "Retrieving relevant pages",
        "step": 0,
    }
    assert [event["stage"] for event in completed] == [
        "retrieve",
        "grade",
        "generate",
        "self_check",
    ]
    retrieve = completed[0]
    assert retrieve["meta"] == {
        "query": "What was net income?",
        "hits": 1,
        "pages": [{"page_number": 12, "score": 0.9}],
    }
    assert events[-1]["type"] == "complete"
    assert events[-1]["response"].supported is True  # type: ignore[union-attr]


def test_stream_reports_query_refinement_before_retrying_retrieval() -> None:
    deps = _deps(
        FakeLLM(["NO", "net income fiscal 2023", "YES", "SUPPORTED"]),
        FakeLLM(["Net income was 37.7 billion. [p12]"]),
        [_page(12, 0.8)],
    )
    service = RagService(deps=deps, graph=build_graph(deps))

    completed = [
        event
        for event in service.stream("What was net income?")
        if event.get("status") == "complete"
    ]

    assert [event["stage"] for event in completed] == [
        "retrieve",
        "grade",
        "rewrite_query",
        "retrieve",
        "grade",
        "generate",
        "self_check",
    ]
    assert completed[2]["meta"] == {"query": "net income fiscal 2023"}


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


def _retrieved(number: int, score: float) -> RetrievedPage:
    return RetrievedPage(
        doc_id=DOC,
        page_number=number,
        score=score,
        image_base64=image_to_base64(Image.new("RGB", (100, 100), "white")),
        width=100,
        height=100,
        source=f"{DOC}.pdf",
    )


def test_build_citations_parses_grouped_page_markers() -> None:
    """A grouped marker must cite exactly the pages it names.

    PAGE_MARKER used to be r"\\[p(\\d+)\\]", which matches nothing in
    "[p24, p30]". That left `referenced` empty, and an empty set hits the
    `not referenced` fallback in build_citations — so the backend returned
    top-k pages the answer never mentioned, inventing provenance.
    """
    pages = [_retrieved(24, 0.71), _retrieved(30, 0.66), _retrieved(7, 0.94)]
    citations = build_citations(
        "Reported on [p24, p30].", pages, max_pages=5, settings=get_settings()
    )
    cited = [c.page_number for c in citations]
    assert cited == [24, 30]
    # Page 7 scored highest but was never cited, so it must not appear.
    assert 7 not in cited


def test_build_citations_mixes_single_and_grouped_markers() -> None:
    pages = [_retrieved(5, 0.8), _retrieved(9, 0.7), _retrieved(11, 0.6), _retrieved(3, 0.9)]
    citations = build_citations(
        "Interest margin [p5], then credit risk [p9, p11].",
        pages,
        max_pages=5,
        settings=get_settings(),
    )
    assert [c.page_number for c in citations] == [5, 9, 11]


def test_build_citations_accepts_grouped_marker_spellings() -> None:
    """The model is not consistent about spacing or the repeated 'p' prefix.

    Page 88 is a decoy that no spelling should pull in, which is what makes
    this test able to fail at all — with only the two cited pages present the
    no-marker fallback happens to return the same list.
    """
    pages = [_retrieved(24, 0.7), _retrieved(30, 0.6), _retrieved(88, 0.99)]
    for marker in ("[p24, p30]", "[p24,p30]", "[p24,30]", "[p24 , p30]"):
        citations = build_citations(f"See {marker}.", pages, max_pages=5, settings=get_settings())
        assert [c.page_number for c in citations] == [24, 30], marker


def test_build_citations_ignores_unbracketed_page_numbers() -> None:
    """Only bracketed markers are citations; bare numbers in prose are not."""
    pages = [_retrieved(24, 0.7), _retrieved(30, 0.6)]
    citations = build_citations(
        "On page 30 of 139, growth was 4 percent.", pages, max_pages=5, settings=get_settings()
    )
    assert [c.page_number for c in citations] == [24, 30]
