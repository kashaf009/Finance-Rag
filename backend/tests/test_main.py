from __future__ import annotations

import asyncio
from collections.abc import Iterator
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app import main
from app.api import deps
from app.rag import service as rag_service
from tests.fakes import FakeClient, FakeModels, FakeStore


@pytest.fixture
def startup_components(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[Mock, Mock, FakeModels, FakeStore]]:
    deps.reset_deps()
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("EMBED_DIM", "4")
    monkeypatch.setenv("RAG_MAX_REWRITES", "0")
    store = FakeStore([])
    models = FakeModels(dim=4)
    create_client = Mock(return_value=FakeClient(models))
    build_graph = Mock(wraps=rag_service.build_graph)
    monkeypatch.setattr(deps, "QdrantStore", lambda cfg: store)
    monkeypatch.setattr("google.genai.Client", create_client)
    monkeypatch.setattr(rag_service, "build_graph", build_graph)
    try:
        yield create_client, build_graph, models, store
    finally:
        deps.reset_deps()


@pytest.mark.parametrize("qdrant_offline", [False, True])
def test_startup_warms_shared_dependencies_before_requests(
    startup_components: tuple[Mock, Mock, FakeModels, FakeStore],
    monkeypatch: pytest.MonkeyPatch,
    qdrant_offline: bool,
) -> None:
    create_client, build_graph, models, store = startup_components
    if qdrant_offline:
        monkeypatch.setattr(store, "exists", Mock(side_effect=RuntimeError("offline")))
    llm_factory = Mock(side_effect=AssertionError("No LLM calls expected"))
    monkeypatch.setattr("app.rag.nodes.build_llm", llm_factory)
    with TestClient(main.create_app()) as client:
        create_client.assert_called_once_with(api_key="test-key")
        build_graph.assert_called_once()
        warmed_deps = build_graph.call_args.args[0]
        assert warmed_deps.embedder is deps.get_embedder_dep()
        assert warmed_deps.store is deps.get_store() is store
        assert models.calls == []
        assert deps.get_rag_service.cache_info().currsize == 1
        assert client.post("/search", json={"query": "net income"}).status_code == 200
        assert client.post("/chat", json={"question": "net income"}).status_code == 200
        response = client.post("/chat/stream", json={"question": "net income"})
        assert response.status_code == 200
        assert "event: complete" in response.text
        assert "event: error" not in response.text
        create_client.assert_called_once()
        build_graph.assert_called_once()
        llm_factory.assert_not_called()
        assert len(models.calls) == 1
        assert len(store.queries) == 3
    for dependency in (deps.get_rag_service, deps.get_embedder_dep, deps.get_store):
        assert dependency.cache_info().currsize == 0


def test_failed_client_warmup_keeps_api_available_and_can_retry(
    startup_components: tuple[Mock, Mock, FakeModels, FakeStore],
    caplog: pytest.LogCaptureFixture,
) -> None:
    create_client, build_graph, models, _ = startup_components
    create_client.side_effect = [ValueError("missing key"), FakeClient(models)]
    with TestClient(main.create_app()) as client:
        assert "RAG warm-up failed at startup: missing key" in caplog.text
        assert client.get("/health").status_code == 200
        build_graph.assert_called_once()
        assert create_client.call_count == 1
        assert models.calls == []
        assert client.post("/search", json={"query": "net income"}).status_code == 200
        assert create_client.call_count == 2
        assert len(models.calls) == 1
        build_graph.assert_called_once()
    assert deps.get_rag_service.cache_info().currsize == 0


def test_lifespan_clears_caches_when_application_body_raises(
    startup_components: tuple[Mock, Mock, FakeModels, FakeStore],
) -> None:
    async def run() -> None:
        async with main.lifespan(main.create_app()):
            assert deps.get_rag_service.cache_info().currsize == 1
            raise RuntimeError("application failed")

    with pytest.raises(RuntimeError, match="application failed"):
        asyncio.run(run())
    for dependency in (deps.get_rag_service, deps.get_embedder_dep, deps.get_store):
        assert dependency.cache_info().currsize == 0
