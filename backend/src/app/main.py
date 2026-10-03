from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import get_store, reset_deps
from app.api.routes import router
from app.core.config import get_settings
from app.core.env import load_env
from app.core.logging import get_logger, setup_logging

logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
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
    yield
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
    app.include_router(router)
    return app


app = create_app()
