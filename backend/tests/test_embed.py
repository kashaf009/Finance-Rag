from __future__ import annotations

import pytest
from PIL import Image

from app.core.config import AppSettings
from app.embed import EmbedError, GeminiEmbedder
from tests.fakes import FakeClient, FakeModels


def make_embedder(client: FakeClient, **overrides: object) -> GeminiEmbedder:
    settings = AppSettings(
        embed_dim=4,
        embed_workers=2,
        embed_retries=2,
        embed_retry_delay=0.0,
        google_api_key="test-key",
        **overrides,
    )
    return GeminiEmbedder(settings=settings, client=client)


def test_embed_image_dimension(fake_client: FakeClient) -> None:
    embedder = make_embedder(fake_client)
    vector = embedder.embed_image(Image.new("RGB", (10, 10), "white"))
    assert len(vector) == 4
    assert embedder.dim == 4


def test_embed_text_task_types(fake_client: FakeClient, fake_models: FakeModels) -> None:
    embedder = make_embedder(fake_client)
    embedder.embed_text("document")
    document_task = fake_models.calls[-1]["config"].task_type
    embedder.embed_text("query", query=True)
    query_task = fake_models.calls[-1]["config"].task_type
    assert document_task == "RETRIEVAL_DOCUMENT"
    assert query_task == "RETRIEVAL_QUERY"


def test_embed_config_uses_dimension(fake_client: FakeClient, fake_models: FakeModels) -> None:
    make_embedder(fake_client).embed_text("x")
    assert fake_models.calls[-1]["config"].output_dimensionality == 4


def test_embed_images_batch(fake_client: FakeClient, fake_models: FakeModels) -> None:
    embedder = make_embedder(fake_client)
    images = [Image.new("RGB", (8, 8), "white") for _ in range(3)]
    vectors = embedder.embed_images(images)
    assert len(vectors) == 3
    assert len(fake_models.calls) == 3


def test_embed_images_empty(fake_client: FakeClient) -> None:
    assert make_embedder(fake_client).embed_images([]) == []


def test_retry_then_succeed() -> None:
    models = FakeModels(dim=4, fail_times=1)
    embedder = make_embedder(FakeClient(models))
    vector = embedder.embed_image(Image.new("RGB", (4, 4), "white"))
    assert len(vector) == 4
    assert len(models.calls) == 2


def test_retries_exhausted_raises() -> None:
    models = FakeModels(dim=4, fail_times=10)
    embedder = make_embedder(FakeClient(models))
    with pytest.raises(EmbedError, match="Embedding failed"):
        embedder.embed_text("x")
    assert len(models.calls) == 3
