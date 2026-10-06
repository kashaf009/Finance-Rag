from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from qdrant_client import QdrantClient
from qdrant_client.http import models as rest

from app.core.config import AppSettings, get_settings
from app.core.logging import get_logger
from app.models import PageArtifact

logger = get_logger("vector.store")

PAGE_ID_NAMESPACE = uuid.UUID("6f5e2b3a-1c4d-4f6a-9b7e-2f1c8d4a5e60")


class VectorStoreError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class VectorPoint:
    id: str
    vector: list[float]
    payload: dict[str, object]


def page_point_id(doc_id: str, page_number: int) -> str:
    return str(uuid.uuid5(PAGE_ID_NAMESPACE, f"{doc_id}:{page_number}"))


def page_payload(
    artifact: PageArtifact,
    *,
    doc_id: str,
    prompt_data_uri: str,
    source: str | None = None,
) -> dict[str, object]:
    """Build the compact payload stored for a newly indexed page.

    The full-resolution artifact remains on disk for the document reader, but
    Qdrant only needs the prompt-sized image that chat and search send onward.
    """
    payload: dict[str, object] = {
        "doc_id": doc_id,
        "page_number": artifact.page_number,
        "mime": artifact.mime,
        "width": artifact.width,
        "height": artifact.height,
        "prompt_data_uri": prompt_data_uri,
    }
    if source is not None:
        payload["source"] = source
    return payload


class QdrantStore:
    def __init__(self, settings: AppSettings | None = None, client: QdrantClient | None = None):
        self._settings = settings or get_settings()
        self._client = client

    @property
    def client(self) -> QdrantClient:
        if self._client is None:
            self._client = QdrantClient(
                url=self._settings.qdrant_url,
                api_key=self._settings.qdrant_api_key,
                timeout=self._settings.qdrant_timeout,
            )
        return self._client

    @property
    def collection(self) -> str:
        return self._settings.qdrant_collection

    def exists(self) -> bool:
        return self.client.collection_exists(self.collection)

    def vector_size(self) -> int | None:
        vectors = self.client.get_collection(self.collection).config.params.vectors
        return getattr(vectors, "size", None)

    def count(self) -> int:
        return self.client.count(self.collection, exact=True).count

    def ensure_collection(
        self,
        dim: int | None = None,
        *,
        distance: rest.Distance = rest.Distance.COSINE,
        recreate: bool = False,
    ) -> None:
        name = self.collection
        size = dim or self._settings.embed_dim
        if recreate and self.client.collection_exists(name):
            logger.info("Deleting existing collection %s", name)
            self.client.delete_collection(name)
        if self.client.collection_exists(name):
            existing = self.vector_size()
            if existing is not None and existing != size:
                raise VectorStoreError(
                    f"Collection {name} has vector size {existing}, expected {size}"
                )
            return
        logger.info("Creating collection %s (size=%d, distance=%s)", name, size, distance)
        self.client.create_collection(
            collection_name=name,
            vectors_config=rest.VectorParams(size=size, distance=distance),
        )

    def upsert(self, points: Iterable[VectorPoint], *, batch_size: int = 64) -> int:
        total = 0
        batch: list[rest.PointStruct] = []
        for point in points:
            batch.append(rest.PointStruct(id=point.id, vector=point.vector, payload=point.payload))
            if len(batch) >= batch_size:
                self.client.upsert(self.collection, points=batch)
                total += len(batch)
                batch = []
        if batch:
            self.client.upsert(self.collection, points=batch)
            total += len(batch)
        return total

    def search(
        self,
        vector: list[float],
        *,
        limit: int = 5,
        with_payload: bool = True,
        query_filter: rest.Filter | None = None,
    ) -> list[rest.ScoredPoint]:
        response = self.client.query_points(
            collection_name=self.collection,
            query=list(vector),
            limit=limit,
            with_payload=with_payload,
            query_filter=query_filter,
        )
        return list(response.points)

    def close(self) -> None:
        if self._client is not None:
            self._client.close()


def get_store(settings: AppSettings | None = None) -> QdrantStore:
    return QdrantStore(settings=settings)
