from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_rag_service, get_store
from app.core.config import get_settings, reset_settings
from app.main import create_app
from app.rag import AnswerResult, Citation, RagError
from tests.conftest import _page
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


def test_health_lists_both_providers(client: TestClient) -> None:
    client.app.dependency_overrides[get_store] = lambda: FakeStore([])
    body = client.get("/health").json()
    assert body["llm_providers"] == ["euron", "groq"]


def test_health_reports_unconfigured_llm_when_no_key(monkeypatch, client: TestClient) -> None:
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("EURON_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    reset_settings()
    client.app.dependency_overrides[get_store] = lambda: FakeStore([])
    body = client.get("/health").json()
    assert body["llm_provider"] == "unconfigured"
    assert body["llm_model"] == "unconfigured"
    assert body["llm_base_url"] == ""


def test_health_reports_resolved_provider_and_model(monkeypatch, client: TestClient) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    reset_settings()
    client.app.dependency_overrides[get_store] = lambda: FakeStore([])
    body = client.get("/health").json()
    assert body["llm_provider"] == "groq"
    assert body["llm_model"] == "qwen/qwen3.8-27b"
    assert body["llm_base_url"] == "https://api.groq.com/openai/v1"


def test_select_llm_provider_switches_and_health_follows(monkeypatch, client: TestClient) -> None:
    monkeypatch.setenv("EURON_API_KEY", "euron-key")
    monkeypatch.setenv("EURI_BASE_URL", "https://euron.invalid/v1")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("LLM_PROVIDER", "euron")
    reset_settings()
    client.app.dependency_overrides[get_store] = lambda: FakeStore([])

    assert client.get("/health").json()["llm_provider"] == "euron"

    response = client.post("/llm-provider", json={"provider": "groq"})
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "groq"
    assert body["base_url"] == "https://api.groq.com/openai/v1"
    assert client.get("/health").json()["llm_provider"] == "groq"


def test_select_llm_provider_null_reverts_to_env(monkeypatch, client: TestClient) -> None:
    monkeypatch.setenv("EURON_API_KEY", "euron-key")
    monkeypatch.setenv("EURI_BASE_URL", "https://euron.invalid/v1")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("LLM_PROVIDER", "euron")
    reset_settings()
    client.app.dependency_overrides[get_store] = lambda: FakeStore([])

    client.post("/llm-provider", json={"provider": "groq"})
    response = client.post("/llm-provider", json={"provider": None})
    assert response.status_code == 200
    assert response.json()["provider"] == "euron"
    assert client.get("/health").json()["llm_provider"] == "euron"


def test_select_llm_provider_rejects_unknown_name(client: TestClient) -> None:
    response = client.post("/llm-provider", json={"provider": "openai"})
    assert response.status_code == 422
    assert "openai" in response.json()["detail"]


def test_select_llm_provider_rejects_name_without_key(monkeypatch, client: TestClient) -> None:
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    reset_settings()
    client.app.dependency_overrides[get_store] = lambda: FakeStore([])
    response = client.post("/llm-provider", json={"provider": "groq"})
    assert response.status_code == 422
    assert "GROQ_API_KEY" in response.json()["detail"]


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


# --- /document: the page-image reader ---------------------------------------
#
# These build real JPEGs in a tmp_path rather than stubbing the filesystem,
# because the route's whole job is reporting what is actually on disk. A stub
# would pass while the real glob and PIL calls stayed broken.

DOC_ID = "Test_Doc_2023_42"


def _seed_ingest(root: Path, page_count: int = 3, pdf_bytes: bytes = b"%PDF-1.7\n") -> Path:
    """Write page_NNNN.jpg renders plus the matching PDF, as ingest would."""
    doc_dir = root / "pages" / DOC_ID
    doc_dir.mkdir(parents=True)
    for n in range(1, page_count + 1):
        _page((120, 165), f"page {n}").save(doc_dir / f"page_{n:04d}.jpg", "JPEG")
    docs_dir = root / "docs"
    docs_dir.mkdir(parents=True)
    (docs_dir / f"{DOC_ID}.pdf").write_bytes(pdf_bytes)
    return doc_dir


def _client_for_ingest(monkeypatch: pytest.MonkeyPatch, root: Path) -> TestClient:
    monkeypatch.setenv("STORAGE_DIR", str(root / "pages"))
    monkeypatch.setenv("DOCS_DIR", str(root / "docs"))
    reset_settings()
    return TestClient(create_app())


def test_document_pages_reports_the_renders_on_disk(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    pdf = b"%PDF-1.7" + b"x" * 40
    _seed_ingest(tmp_path, page_count=3, pdf_bytes=pdf)
    with _client_for_ingest(monkeypatch, tmp_path) as client:
        response = client.get("/document/pages")
    assert response.status_code == 200
    body = response.json()
    assert body["doc_id"] == DOC_ID
    assert body["page_count"] == 3
    # Measured from the file we just wrote, not a hardcoded constant.
    assert body["pdf_byte_size"] == len(pdf)
    assert body["pdf_filename"] == f"{DOC_ID}.pdf"
    # Read from the render itself, not a constant.
    assert (body["page_width"], body["page_height"]) == (120, 165)


def test_document_page_serves_the_file_verbatim(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    doc_dir = _seed_ingest(tmp_path, page_count=3)
    with _client_for_ingest(monkeypatch, tmp_path) as client:
        response = client.get("/document/page/2")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    # The whole point: the bytes are the ingest's, unmodified.
    assert response.content == (doc_dir / "page_0002.jpg").read_bytes()


def test_document_page_sets_an_immutable_cache_header(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _seed_ingest(tmp_path, page_count=1)
    with _client_for_ingest(monkeypatch, tmp_path) as client:
        response = client.get("/document/page/1")
    assert "immutable" in response.headers["cache-control"]


@pytest.mark.parametrize("page", [0, -1, 4, 9999])
def test_document_page_404s_outside_the_rendered_range(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, page: int
) -> None:
    _seed_ingest(tmp_path, page_count=3)
    with _client_for_ingest(monkeypatch, tmp_path) as client:
        assert client.get(f"/document/page/{page}").status_code == 404


def test_document_page_rejects_a_non_integer(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _seed_ingest(tmp_path, page_count=1)
    with _client_for_ingest(monkeypatch, tmp_path) as client:
        assert client.get("/document/page/not-a-page").status_code == 422


def test_document_endpoints_degrade_when_the_ingest_has_not_run(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A missing ingest is a state the client must render honestly, not a 500."""
    with _client_for_ingest(monkeypatch, tmp_path) as client:
        response = client.get("/document/pages")
        assert response.status_code == 200
        body = response.json()
        assert body["page_count"] == 0
        assert body["doc_id"] is None
        assert body["pdf_byte_size"] is None
        assert body["page_width"] is None
        assert client.get("/document/page/1").status_code == 404


def test_document_pages_counts_renders_without_a_pdf(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Renders on disk but no PDF: the count is still real, the PDF is null."""
    doc_dir = tmp_path / "pages" / DOC_ID
    doc_dir.mkdir(parents=True)
    _page((80, 100), "only page").save(doc_dir / "page_0001.jpg", "JPEG")
    with _client_for_ingest(monkeypatch, tmp_path) as client:
        body = client.get("/document/pages").json()
    assert body["page_count"] == 1
    assert body["pdf_filename"] is None
    assert body["pdf_byte_size"] is None
