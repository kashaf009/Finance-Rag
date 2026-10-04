from __future__ import annotations

import dataclasses

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


def test_query_cache_reuses_whitespace_normalized_text(
    fake_client: FakeClient, fake_models: FakeModels
) -> None:
    embedder = make_embedder(fake_client)
    first = embedder.embed_text("  Net interest income 2023?  ", query=True)
    repeated = embedder.embed_text("Net\tinterest\nincome   2023?", query=True)
    assert repeated == first
    assert repeated is not first
    assert len(fake_models.calls) == 1
    assert fake_models.calls[0]["contents"] == "Net interest income 2023?"


def test_query_cache_preserves_case_punctuation_and_numbers(
    fake_client: FakeClient, fake_models: FakeModels
) -> None:
    embedder = make_embedder(fake_client)
    queries = ["US revenue 2023?", "us revenue 2023?", "US revenue 2023", "US revenue 2022?"]
    for query in queries:
        embedder.embed_text(query, query=True)
    for query in queries:
        embedder.embed_text(query, query=True)
    assert [call["contents"] for call in fake_models.calls] == queries


def test_query_cache_is_separate_from_document_embeddings(
    fake_client: FakeClient, fake_models: FakeModels
) -> None:
    embedder = make_embedder(fake_client)
    text = "  net interest income  "
    embedder.embed_text(text, query=True)
    embedder.embed_text(text)
    embedder.embed_text(text)
    embedder.embed_text(text.strip(), query=True)
    assert [call["contents"] for call in fake_models.calls] == [text.strip(), text, text]
    assert [call["config"].task_type for call in fake_models.calls] == [
        "RETRIEVAL_QUERY",
        "RETRIEVAL_DOCUMENT",
        "RETRIEVAL_DOCUMENT",
    ]


def test_query_cache_returns_vectors_that_callers_can_mutate(
    fake_client: FakeClient, fake_models: FakeModels
) -> None:
    embedder = make_embedder(fake_client)
    first = embedder.embed_text("net income", query=True)
    first[0] = 999.0
    first.append(123.0)
    repeated = embedder.embed_text("net income", query=True)
    assert repeated == [0.1] * 4
    assert len(fake_models.calls) == 1


def test_query_caches_are_isolated_between_clients_and_settings() -> None:
    settings = AppSettings(embed_dim=4, embed_model="model-a", embed_query_task="RETRIEVAL_QUERY")
    first_models = FakeModels(dim=4)
    same_settings_models = FakeModels(dim=4)
    different_settings_models = FakeModels(dim=8)
    embedders = [
        GeminiEmbedder(settings, FakeClient(first_models)),
        GeminiEmbedder(settings, FakeClient(same_settings_models)),
        GeminiEmbedder(
            dataclasses.replace(
                settings, embed_dim=8, embed_model="model-b", embed_query_task="QUESTION_ANSWERING"
            ),
            FakeClient(different_settings_models),
        ),
    ]
    for embedder, dimension in zip(embedders, [4, 4, 8], strict=True):
        assert len(embedder.embed_text("net income", query=True)) == dimension
        assert len(embedder.embed_text("net income", query=True)) == dimension
    assert (
        len(first_models.calls)
        == len(same_settings_models.calls)
        == len(different_settings_models.calls)
        == 1
    )
    assert first_models.calls[0]["model"] == "model-a"
    assert first_models.calls[0]["config"].task_type == "RETRIEVAL_QUERY"
    assert different_settings_models.calls[0]["model"] == "model-b"
    assert different_settings_models.calls[0]["config"].task_type == "QUESTION_ANSWERING"
    assert different_settings_models.calls[0]["config"].output_dimensionality == 8


def test_query_cache_evicts_least_recently_used_queries(
    fake_client: FakeClient, fake_models: FakeModels
) -> None:
    embedder = make_embedder(fake_client)
    for number in range(256):
        embedder.embed_text(f"query {number}", query=True)
    embedder.embed_text("query 0", query=True)
    assert len(fake_models.calls) == 256
    embedder.embed_text("query 256", query=True)
    embedder.embed_text("query 0", query=True)
    embedder.embed_text("query 256", query=True)
    assert len(fake_models.calls) == 257
    embedder.embed_text("query 1", query=True)
    assert len(fake_models.calls) == 258
    assert fake_models.calls[-1]["contents"] == "query 1"


def test_query_cache_allows_recovery_after_exhausted_retries() -> None:
    models = FakeModels(dim=4, fail_times=3)
    embedder = make_embedder(FakeClient(models))
    with pytest.raises(EmbedError, match="Embedding failed"):
        embedder.embed_text("  net income  ", query=True)
    assert len(models.calls) == 3
    recovered = embedder.embed_text("net income", query=True)
    assert recovered == [0.1] * 4
    assert embedder.embed_text("net income", query=True) == recovered
    assert len(models.calls) == 4


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
