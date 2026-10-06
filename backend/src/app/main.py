from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.deps import get_embedder_dep, get_rag_service, get_store, reset_deps
from app.api.routes import reset_document_pages_cache, router
from app.core.config import get_settings
from app.core.env import load_env
from app.core.logging import get_logger, setup_logging

logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    reset_document_pages_cache()
    setup_logging(get_settings().log_level)
    try:
        store = get_store()
        ready = store.exists()
        logger.info(
            "Qdrant %s collection=%s ready=%s",
            get_settings().qdrant_url,
            store.collection,
            ready,
        )
    except Exception as exc:
        logger.warning("Qdrant not reachable at startup: %s", exc)
    try:
        get_rag_service()
        get_embedder_dep().warmup()
        logger.info("RAG graph and embedding client warmed up")
    except Exception as exc:
        logger.warning("RAG warm-up failed at startup: %s", exc)
    try:
        yield
    finally:
        reset_document_pages_cache()
        reset_deps()


def create_app() -> FastAPI:
    load_env()
    settings = get_settings()
    setup_logging(settings.log_level)

    app = FastAPI(
        title="Finance RAG API",
        version="0.1.0",
        summary="Self-RAG question answering over scanned bank annual reports",
        lifespan=lifespan,
    )
    if settings.api_cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.api_cors_origins),
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    # Starlette's default excluded content types include text/event-stream.
    # Keeping that default is essential: compressing SSE would buffer frames
    # and defeat the incremental chat progress channel.
    app.add_middleware(GZipMiddleware, minimum_size=500)
    app.include_router(router)
    return app


app = create_app()
