from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_rag_service, get_store
from app.core.config import get_settings, reset_settings
from app.main import create_app
from app.rag import AnswerResult, Citation, RagError
from tests.fakes import FakeHit, FakeStore


class StubService:
    def __init__(self, result: AnswerResult | None = None, error: Exception | None = None) -> None:
        self.result = result
        self.error = error
        self.answered: list[tuple[str, int | None]] = []
        self.searched: list[tuple[str, int | None]] = []

    def search(self, query: str, limit: int | None = None) -> list[Citation]:
        self.searched.append((query, limit))
        if self.error is not None:
            raise self.error
        return self.result.citations if self.result else []

    def answer(self, question: str, top_k: int | None = None) -> AnswerResult:
        self.answered.append((question, top_k))
        if self.error is not None:
            raise self.error
        assert self.result is not None
        return self.result


def _result(**overrides: Any) -> AnswerResult:
    data: dict[str, Any] = {
        "question": "What was net income?",
        "query": "net income",
        "answer": "Net income was 37.7 billion. [p12]",
        "supported": True,
        "rewrites": 0,
        "pages_considered": 1,
        "citations": [
            Citation(doc_id="doc", page_number=12, score=0.91, image="data:image/jpeg;base64,AAAA")
        ],
        "trace": [{"node": "retrieve"}],
    }
    data.update(overrides)
    return AnswerResult(**data)


def _stub_factory(service: StubService) -> Any:
    def provide() -> StubService:
        return service

    return provide


@pytest.fixture
def client() -> Iterator[TestClient]:
    reset_settings()
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def service() -> StubService:
    stub = StubService(result=_result())
    return stub


@pytest.fixture
def client_with_service(client: TestClient, service: StubService) -> TestClient:
    client.app.dependency_overrides[get_rag_service] = _stub_factory(service)
    return client


def test_health_reports_ok_when_collection_exists(client: TestClient) -> None:
    app = client.app
    app.dependency_overrides[get_store] = lambda: FakeStore([FakeHit(0.9, {})])
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["collection_ready"] is True
    assert body["llm_model"]
    assert body["vector_size"] == 1024


def test_health_is_degraded_when_collection_missing(client: TestClient) -> None:
    client.app.dependency_overrides[get_store] = lambda: FakeStore([])
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["collection_ready"] is False
    assert body["points"] is None


def test_health_survives_store_failure(client: TestClient) -> None:
    class BrokenStore:
        collection = "finance_pages"

        def exists(self) -> bool:
            raise RuntimeError("connection refused")

    client.app.dependency_overrides[get_store] = BrokenStore
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "degraded"


def test_collections_returns_metadata(client: TestClient) -> None:
    client.app.dependency_overrides[get_store] = lambda: FakeStore([FakeHit(0.9, {})])
    response = client.get("/collections")
    assert response.status_code == 200
    body = response.json()
    assert body["exists"] is True
    assert body["points"] == 1
    assert body["distance"] == "Cosine"


def test_collections_reports_missing_collection(client: TestClient) -> None:
    client.app.dependency_overrides[get_store] = lambda: FakeStore([])
    response = client.get("/collections")
    assert response.status_code == 200
    assert response.json() == {
        "name": "fake_pages",
        "exists": False,
        "vector_size": None,
        "points": None,
        "distance": None,
    }


def test_search_returns_citations(client_with_service: TestClient, service: StubService) -> None:
    response = client_with_service.post("/search", json={"query": "net income", "limit": 3})
    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "net income"
    assert body["hits"][0]["page_number"] == 12
    assert body["hits"][0]["image"].startswith("data:image/jpeg;base64,")


def test_search_rejects_empty_query(client_with_service: TestClient, service: StubService) -> None:
    assert client_with_service.post("/search", json={"query": ""}).status_code == 422


def test_search_rejects_out_of_range_limit(
    client_with_service: TestClient, service: StubService
) -> None:
    assert client_with_service.post("/search", json={"query": "x", "limit": 0}).status_code == 422
    assert client_with_service.post("/search", json={"query": "x", "limit": 999}).status_code == 422


def test_chat_returns_answer_and_trace(
    client_with_service: TestClient, service: StubService
) -> None:
    response = client_with_service.post("/chat", json={"question": "What was net income?"})
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "Net income was 37.7 billion. [p12]"
    assert body["supported"] is True
    assert body["rewrites"] == 0
    assert body["citations"][0]["page_number"] == 12
    assert body["trace"] == [{"node": "retrieve"}]


def test_chat_passes_top_k(client_with_service: TestClient, service: StubService) -> None:
    client_with_service.post("/chat", json={"question": "q", "top_k": 2})
    assert service.answered == [("q", 2)]


def test_chat_rejects_empty_question(client_with_service: TestClient, service: StubService) -> None:
    assert client_with_service.post("/chat", json={"question": ""}).status_code == 422


def test_chat_maps_rag_error_to_502(client: TestClient) -> None:
    client.app.dependency_overrides[get_rag_service] = lambda: StubService(error=RagError("boom"))
    response = client.post("/chat", json={"question": "q"})
    assert response.status_code == 502
    assert response.json()["detail"] == "boom"


def test_chat_maps_llm_config_error_to_503(client: TestClient) -> None:
    from app.llm import LLMConfigError

    client.app.dependency_overrides[get_rag_service] = lambda: StubService(
        error=LLMConfigError("missing key")
    )
    assert client.post("/chat", json={"question": "q"}).status_code == 503


def test_openapi_schema_documents_core_endpoints(client_with_service: TestClient) -> None:
    schema = client_with_service.get("/openapi.json").json()
    assert "/health" in schema["paths"]
    assert "/collections" in schema["paths"]
    assert "/search" in schema["paths"]
    assert "/chat" in schema["paths"]


def test_cors_headers_applied_when_origin_allowed(monkeypatch) -> None:
    monkeypatch.setenv("API_CORS_ORIGINS", "http://localhost:5173")
    reset_settings()
    with TestClient(create_app()) as test_client:
        response = test_client.get("/health", headers={"Origin": "http://localhost:5173"})
        assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_settings_defaults_bind_to_loopback() -> None:
    assert get_settings().api_host == "127.0.0.1"
