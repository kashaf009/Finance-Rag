from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from PIL import Image

from app.api.deps import get_rag_service, get_settings_dep, get_store
from app.api.schemas import (
    ChatRequest,
    ChatResponse,
    CitationModel,
    CollectionInfo,
    DocumentPagesResponse,
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


def _page_dir(settings: AppSettings) -> Path | None:
    """The one document's render directory, or None if the ingest has not run.

    Only one document is indexed, so a single directory is the whole story.
    """
    root = settings.storage_dir
    if not root.is_dir():
        return None
    for entry in sorted(root.iterdir()):
        if entry.is_dir():
            return entry
    return None


def _page_path(doc_dir: Path, page_number: int) -> Path | None:
    """Resolve a page number to a file, or None.

    The name is built from an int, so no caller-supplied string reaches the
    filesystem and traversal is structurally impossible. Out-of-range numbers
    simply fail the is_file() check.
    """
    if page_number < 1:
        return None
    path = doc_dir / f"page_{page_number:04d}.jpg"
    return path if path.is_file() else None


@router.get("/document/pages", response_model=DocumentPagesResponse)
def document_pages(settings: SettingsDep) -> DocumentPagesResponse:
    """List the page renders the ingest already wrote.

    Degrades instead of raising, like /health: a missing ingest is a real state
    the client must be able to render honestly, not a 500.
    """
    doc_dir = _page_dir(settings)
    if doc_dir is None:
        return DocumentPagesResponse(
            doc_id=None,
            pdf_filename=None,
            pdf_byte_size=None,
            page_count=0,
            page_width=None,
            page_height=None,
        )

    page_files = sorted(doc_dir.glob("page_*.jpg"))
    pdf_path = settings.docs_dir / f"{doc_dir.name}.pdf"
    has_pdf = pdf_path.is_file()

    width = height = None
    if page_files:
        with Image.open(page_files[0]) as im:
            width, height = im.size

    return DocumentPagesResponse(
        doc_id=doc_dir.name,
        pdf_filename=pdf_path.name if has_pdf else None,
        pdf_byte_size=pdf_path.stat().st_size if has_pdf else None,
        page_count=len(page_files),
        page_width=width,
        page_height=height,
    )


@router.get("/document/page/{page_number}", response_class=FileResponse)
def document_page(page_number: int, settings: SettingsDep) -> FileResponse:
    """Serve one page render at full resolution.

    Read from disk rather than the Qdrant payload. The stored payload is
    already the full-resolution file — byte-identical to what the ingest
    wrote — so the real reason to prefer this route is that it does not pay
    the serve-time downscale. `/search` and `/chat` run every hit through
    `to_prompt_data_uri`, which resizes to llm_image_max_edge and returns
    559x768 here; nothing in the ingest path downscales.
    """
    doc_dir = _page_dir(settings)
    if doc_dir is None:
        raise HTTPException(
            status_code=404, detail="No rendered pages are available on disk."
        )
    path = _page_path(doc_dir, page_number)
    if path is None:
        raise HTTPException(
            status_code=404, detail=f"Page {page_number} is not available."
        )
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
