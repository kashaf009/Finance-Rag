from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Request

from app.core.config import AppSettings, get_settings
from app.embed import Embedder, get_embedder
from app.llm import ProviderSelection
from app.rag import RagService
from app.rag.nodes import RagDeps
from app.vector import QdrantStore


@lru_cache(maxsize=1)
def get_settings_dep() -> AppSettings:
    return get_settings()


def get_provider_selection(request: Request) -> ProviderSelection:
    return request.app.state.provider_selection


def get_llm_settings(
    settings: Annotated[AppSettings, Depends(get_settings_dep)],
    selection: Annotated[ProviderSelection, Depends(get_provider_selection)],
) -> AppSettings:
    return selection.snapshot(settings)


@lru_cache(maxsize=1)
def get_store() -> QdrantStore:
    return QdrantStore(get_settings())


@lru_cache(maxsize=1)
def get_embedder_dep() -> Embedder:
    return get_embedder(get_settings())


@lru_cache(maxsize=1)
def get_rag_service() -> RagService:
    return RagService(
        deps=RagDeps(
            settings=get_settings(),
            embedder=get_embedder_dep(),
            store=get_store(),
        )
    )


def reset_deps() -> None:
    get_settings_dep.cache_clear()
    get_store.cache_clear()
    get_embedder_dep.cache_clear()
    get_rag_service.cache_clear()
