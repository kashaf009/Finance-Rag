from __future__ import annotations

import pytest
from qdrant_client import QdrantClient

from app.core.config import AppSettings
from app.models import PageArtifact
from app.vector import QdrantStore, VectorPoint, VectorStoreError, page_payload, page_point_id

DIM = 4


def make_store(dim: int = DIM) -> QdrantStore:
    settings = AppSettings(qdrant_collection="test_pages", embed_dim=dim)
    return QdrantStore(settings=settings, client=QdrantClient(location=":memory:"))


def make_point(page: int, vector: list[float], source: str | None = "doc.pdf") -> VectorPoint:
    artifact = PageArtifact(page_number=page, base64="AAAA", width=1024, height=1408)
    return VectorPoint(
        id=page_point_id("doc", page),
        vector=vector,
        payload=page_payload(
            artifact,
            doc_id="doc",
            prompt_data_uri="data:image/jpeg;base64,AAAA",
            source=source,
        ),
    )


def test_page_point_id_is_deterministic() -> None:
    assert page_point_id("doc", 3) == page_point_id("doc", 3)
    assert page_point_id("doc", 3) != page_point_id("doc", 4)
    assert page_point_id("doc", 3) != page_point_id("other", 3)


def test_page_payload_shape() -> None:
    artifact = PageArtifact(page_number=7, base64="QUJD", width=1024, height=1408)
    payload = page_payload(
        artifact,
        doc_id="doc",
        prompt_data_uri="data:image/jpeg;base64,QUJD",
        source="doc.pdf",
    )
    assert payload == {
        "doc_id": "doc",
        "page_number": 7,
        "mime": "image/jpeg",
        "width": 1024,
        "height": 1408,
        "prompt_data_uri": "data:image/jpeg;base64,QUJD",
        "source": "doc.pdf",
    }


def test_page_payload_without_source() -> None:
    artifact = PageArtifact(page_number=1, base64="QUJD", width=8, height=8)
    payload = page_payload(
        artifact,
        doc_id="doc",
        prompt_data_uri="data:image/jpeg;base64,QUJD",
    )
    assert "source" not in payload
    assert "image_base64" not in payload


def test_ensure_collection_creates() -> None:
    store = make_store()
    assert not store.exists()
    store.ensure_collection(dim=DIM)
    assert store.exists()
    assert store.vector_size() == DIM


def test_ensure_collection_is_idempotent() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    store.ensure_collection(dim=DIM)
    assert store.vector_size() == DIM


def test_ensure_collection_dimension_mismatch() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    with pytest.raises(VectorStoreError, match="vector size"):
        store.ensure_collection(dim=8)


def test_ensure_collection_recreate_wipes_points() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    store.upsert([make_point(1, [1.0, 0.0, 0.0, 0.0])])
    assert store.count() == 1
    store.ensure_collection(dim=DIM, recreate=True)
    assert store.count() == 0


def test_upsert_and_count() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    assert store.upsert([make_point(1, [1.0, 0.0, 0.0, 0.0])]) == 1
    assert store.count() == 1


def test_upsert_batches() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    points = [make_point(n, [1.0, 0.0, 0.0, 0.0]) for n in range(5)]
    assert store.upsert(points, batch_size=2) == 5
    assert store.count() == 5


def test_upsert_is_idempotent() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    point = make_point(1, [1.0, 0.0, 0.0, 0.0])
    store.upsert([point])
    store.upsert([point])
    assert store.count() == 1


def test_search_ranks_closest_first() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    store.upsert(
        [
            make_point(1, [0.0, 1.0, 0.0, 0.0]),
            make_point(2, [1.0, 0.0, 0.0, 0.0]),
        ]
    )
    hits = store.search([1.0, 0.0, 0.0, 0.0], limit=2)
    assert [hit.payload["page_number"] for hit in hits] == [2, 1]
    assert hits[0].payload["prompt_data_uri"] == "data:image/jpeg;base64,AAAA"
    assert hits[0].payload["doc_id"] == "doc"


def test_search_respects_limit() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    store.upsert([make_point(n, [1.0, 0.0, 0.0, 0.0]) for n in range(4)])
    assert len(store.search([1.0, 0.0, 0.0, 0.0], limit=2)) == 2


def test_search_empty_collection() -> None:
    store = make_store()
    store.ensure_collection(dim=DIM)
    assert store.search([1.0, 0.0, 0.0, 0.0]) == []
