from __future__ import annotations

from functools import lru_cache

from app.core.config import AppSettings, get_settings
from app.embed import Embedder, get_embedder
from app.rag import RagService
from app.vector import QdrantStore


@lru_cache(maxsize=1)
def get_settings_dep() -> AppSettings:
    return get_settings()


@lru_cache(maxsize=1)
def get_store() -> QdrantStore:
    return QdrantStore(get_settings())


@lru_cache(maxsize=1)
def get_embedder_dep() -> Embedder:
    return get_embedder(get_settings())


@lru_cache(maxsize=1)
def get_rag_service() -> RagService:
    return RagService()


def reset_deps() -> None:
    get_settings_dep.cache_clear()
    get_store.cache_clear()
    get_embedder_dep.cache_clear()
    get_rag_service.cache_clear()
