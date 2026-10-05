from __future__ import annotations

import time
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Any

from PIL import Image

from app.core.config import AppSettings, get_settings
from app.core.logging import get_logger

logger = get_logger("embed.gemini")


class EmbedError(RuntimeError):
    pass


class GeminiEmbedder:
    def __init__(self, settings: AppSettings | None = None, client: Any | None = None) -> None:
        self._settings = settings or get_settings()
        self._client = client
        self._cached_query = lru_cache(maxsize=256)(self._embed_query)

    @property
    def dim(self) -> int:
        return self._settings.embed_dim

    def warmup(self) -> None:
        """Initialize the SDK client locally without making an embedding request."""
        self._ensure_client()

    def _ensure_client(self) -> Any:
        if self._client is None:
            from google import genai

            api_key = self._settings.google_api_key
            self._client = genai.Client(api_key=api_key) if api_key else genai.Client()
        return self._client

    def _config(self, *, query: bool) -> Any:
        from google.genai import types

        cfg = self._settings
        return types.EmbedContentConfig(
            task_type=cfg.embed_query_task if query else cfg.embed_document_task,
            output_dimensionality=cfg.embed_dim,
        )

    def _embed_one(self, content: Any, *, query: bool) -> list[float]:
        cfg = self._settings
        last: Exception | None = None
        for attempt in range(cfg.embed_retries + 1):
            try:
                response = self._ensure_client().models.embed_content(
                    model=cfg.embed_model,
                    contents=content,
                    config=self._config(query=query),
                )
                return [float(value) for value in response.embeddings[0].values]
            except Exception as exc:
                last = exc
                if attempt < cfg.embed_retries:
                    delay = cfg.embed_retry_delay * (2**attempt)
                    logger.warning(
                        "Embedding attempt %d/%d failed (%s); retrying in %.1fs",
                        attempt + 1,
                        cfg.embed_retries + 1,
                        type(exc).__name__,
                        delay,
                    )
                    time.sleep(delay)
        raise EmbedError(f"Embedding failed for model {cfg.embed_model}: {last}") from last

    def embed_image(self, image: Image.Image) -> list[float]:
        return self._embed_one(image, query=False)

    def _embed_query(self, text: str) -> tuple[float, ...]:
        return tuple(self._embed_one(text, query=True))

    def embed_text(self, text: str, *, query: bool = False) -> list[float]:
        if query:
            normalized = " ".join(text.split())
            # Keep immutable cached vectors scoped to this client's settings,
            # and give each caller its own list to avoid cache corruption.
            return list(self._cached_query(normalized))
        return self._embed_one(text, query=False)

    def embed_images(self, images: Sequence[Image.Image]) -> list[list[float]]:
        items = list(images)
        if not items:
            return []
        workers = max(1, self._settings.embed_workers)
        if workers == 1 or len(items) == 1:
            return [self.embed_image(image) for image in items]
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(self.embed_image, items))


def get_embedder(settings: AppSettings | None = None) -> GeminiEmbedder:
    return GeminiEmbedder(settings=settings)
