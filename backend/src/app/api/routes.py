from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_rag_service, get_settings_dep, get_store
from app.api.schemas import (
    ChatRequest,
    ChatResponse,
    CitationModel,
    CollectionInfo,
    HealthResponse,
    LLMProviderRequest,
    LLMProviderResponse,
    SearchRequest,
    SearchResponse,
)
from app.core.config import AppSettings
from app.llm import (
    LLMConfigError,
    provider_names,
    resolve_provider,
    set_active_provider,
)
from app.rag import RagError, RagService
from app.vector import QdrantStore

router = APIRouter(tags=["finance-rag"])

SettingsDep = Annotated[AppSettings, Depends(get_settings_dep)]
StoreDep = Annotated[QdrantStore, Depends(get_store)]
ServiceDep = Annotated[RagService, Depends(get_rag_service)]


def _citations(citations: object) -> list[CitationModel]:
    return [
        CitationModel(
            doc_id=item.doc_id,
            page_number=item.page_number,
            score=item.score,
            image=item.image,
        )
        for item in citations  # type: ignore[union-attr]
    ]


@router.get("/health", response_model=HealthResponse)
def health(settings: SettingsDep, store: StoreDep) -> HealthResponse:
    ready = False
    points: int | None = None
    vector_size: int | None = None
    try:
        ready = store.exists()
        if ready:
            points = store.count()
            vector_size = store.vector_size()
    except Exception:
        ready = False

    provider = "unconfigured"
    model = "unconfigured"
    base_url = ""
    try:
        resolved = resolve_provider(settings)
        provider, model, base_url = resolved.name, resolved.answer_model, resolved.base_url
    except LLMConfigError:
        pass

    return HealthResponse(
        status="ok" if ready else "degraded",
        qdrant_url=settings.qdrant_url,
        collection=store.collection,
        collection_ready=ready,
        points=points,
        llm_provider=provider,
        llm_providers=provider_names(),
        llm_model=model,
        llm_base_url=base_url,
        embed_model=settings.embed_model,
        vector_size=vector_size,
    )


@router.post("/llm-provider", response_model=LLMProviderResponse)
def select_llm_provider(payload: LLMProviderRequest, settings: SettingsDep) -> LLMProviderResponse:
    name = payload.provider.strip().lower() if payload.provider else None
    try:
        set_active_provider(name)
        resolved = resolve_provider(settings)
    except LLMConfigError as exc:
        set_active_provider(None)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return LLMProviderResponse(
        provider=resolved.name,
        model=resolved.answer_model,
        base_url=resolved.base_url,
    )


@router.get("/collections", response_model=CollectionInfo)
def collections(store: StoreDep) -> CollectionInfo:
    if not store.exists():
        return CollectionInfo(
            name=store.collection,
            exists=False,
            vector_size=None,
            points=None,
            distance=None,
        )
    return CollectionInfo(
        name=store.collection,
        exists=True,
        vector_size=store.vector_size(),
        points=store.count(),
        distance="Cosine",
    )


@router.post("/search", response_model=SearchResponse)
def search(payload: SearchRequest, service: ServiceDep) -> SearchResponse:
    try:
        hits = service.search(payload.query, limit=payload.limit)
    except LLMConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return SearchResponse(query=payload.query, hits=_citations(hits))


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, service: ServiceDep) -> ChatResponse:
    try:
        result = service.answer(payload.question, top_k=payload.top_k)
    except LLMConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RagError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ChatResponse(
        question=result.question,
        query=result.query,
        answer=result.answer,
        supported=result.supported,
        rewrites=result.rewrites,
        pages_considered=result.pages_considered,
        citations=_citations(result.citations),
        trace=result.trace,
    )
