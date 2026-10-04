from __future__ import annotations

import base64
import dataclasses
from unittest.mock import patch

import pytest
from PIL import Image

from app.core.config import get_settings, reset_settings
from app.imaging.encode import base64_to_image, image_to_base64
from app.llm import (
    ANSWER,
    NOT_FOUND_ANSWER,
    UTILITY,
    LLMConfigError,
    build_llm,
    is_refusal,
    provider_names,
    reset_llm_cache,
    reset_prompt_image_cache,
    resolve_provider,
    set_active_provider,
    text_of,
    to_prompt_data_uri,
)
from app.llm import images as prompt_images
from app.llm.prompts import answer_prompt
from tests.fakes import FakeLLM


def _encoded(size: tuple[int, int] = (1024, 1408)) -> str:
    return image_to_base64(Image.new("RGB", size, "white"), data_uri=False)


def test_prompt_image_is_downscaled_to_max_edge() -> None:
    uri = to_prompt_data_uri(_encoded())
    prefix, payload = uri.split(",", 1)
    assert prefix == "data:image/jpeg;base64"
    image = base64_to_image(uri)
    assert max(image.size) <= get_settings().llm_image_max_edge
    assert base64.b64decode(payload)[:2] == b"\xff\xd8"


def test_prompt_image_respects_explicit_max_edge() -> None:
    uri = to_prompt_data_uri(_encoded(), max_edge=256, quality=40)
    image = base64_to_image(uri)
    assert max(image.size) == 256


def test_prompt_image_does_not_upscale_small_images() -> None:
    uri = to_prompt_data_uri(_encoded((120, 90)))
    image = base64_to_image(uri)
    assert image.size == (120, 90)


def test_prompt_image_cache_reuses_equivalent_encoding_settings() -> None:
    encoded = _encoded()
    settings = get_settings()
    with patch.object(
        prompt_images, "image_to_jpeg_bytes", wraps=prompt_images.image_to_jpeg_bytes
    ) as encode:
        first = to_prompt_data_uri(encoded, doc_id="doc", page_number=1, settings=settings)
        repeated = to_prompt_data_uri(
            encoded,
            doc_id="doc",
            page_number=1,
            max_edge=settings.llm_image_max_edge,
            quality=settings.llm_image_quality,
            settings=dataclasses.replace(settings, log_level="DEBUG"),
        )
    assert repeated == first
    assert encode.call_count == 1


@pytest.mark.parametrize("change", ["document", "page", "edge", "quality", "optimize", "content"])
def test_prompt_image_cache_keeps_distinct_page_variants_fresh(change: str) -> None:
    encoded = _encoded()
    settings = get_settings()
    kwargs = {"doc_id": "doc", "page_number": 1, "settings": settings}
    changed = dict(kwargs)
    if change == "document":
        changed["doc_id"] = "another-doc"
    elif change == "page":
        changed["page_number"] = 2
    elif change == "edge":
        changed["max_edge"] = 256
    elif change == "quality":
        changed["quality"] = 40
    elif change == "optimize":
        changed["settings"] = dataclasses.replace(
            settings, jpeg_optimize=not settings.jpeg_optimize
        )
    new_encoded = (
        image_to_base64(Image.new("RGB", (1024, 1408), "red")) if change == "content" else encoded
    )
    with patch.object(
        prompt_images, "image_to_jpeg_bytes", wraps=prompt_images.image_to_jpeg_bytes
    ) as encode:
        to_prompt_data_uri(encoded, **kwargs)
        updated = to_prompt_data_uri(new_encoded, **changed)
        assert to_prompt_data_uri(new_encoded, **changed) == updated
        assert encode.call_count == 2
    uncached_kwargs = {k: v for k, v in changed.items() if k not in {"doc_id", "page_number"}}
    assert updated == to_prompt_data_uri(new_encoded, **uncached_kwargs)


def test_prompt_image_cache_evicts_old_pages() -> None:
    encoded = _encoded((120, 90))
    with patch.object(
        prompt_images, "image_to_jpeg_bytes", wraps=prompt_images.image_to_jpeg_bytes
    ) as encode:
        first = to_prompt_data_uri(encoded, doc_id="doc", page_number=1)
        for number in range(2, 258):
            to_prompt_data_uri(encoded, doc_id="doc", page_number=number)
        assert to_prompt_data_uri(encoded, doc_id="doc", page_number=257) == first
        assert encode.call_count == 257
        assert to_prompt_data_uri(encoded, doc_id="doc", page_number=1) == first
        assert encode.call_count == 258


def test_prompt_image_cache_can_be_cleared() -> None:
    encoded = _encoded((120, 90))
    with patch.object(
        prompt_images, "image_to_jpeg_bytes", wraps=prompt_images.image_to_jpeg_bytes
    ) as encode:
        first = to_prompt_data_uri(encoded, doc_id="doc", page_number=1)
        reset_prompt_image_cache()
        assert to_prompt_data_uri(encoded, doc_id="doc", page_number=1) == first
        assert encode.call_count == 2


def test_text_of_handles_strings_and_messages() -> None:
    from langchain_core.messages import AIMessage

    assert text_of("plain reply") == "plain reply"
    assert text_of(AIMessage(content="message reply")) == "message reply"
    assert text_of(AIMessage(content="")) == ""


def test_build_llm_omits_reasoning_effort_unless_configured(monkeypatch) -> None:
    monkeypatch.setenv("EURON_API_KEY", "test-key")
    monkeypatch.setenv("EURI_BASE_URL", "https://example.invalid/v1")
    monkeypatch.delenv("LLM_REASONING_EFFORT", raising=False)
    reset_settings()
    reset_llm_cache()
    try:
        utility = build_llm(UTILITY)
        answer = build_llm(ANSWER)
        assert utility.extra_body is None
        assert answer.extra_body is None
        assert utility.request_timeout == get_settings().llm_timeout
    finally:
        reset_settings()
        reset_llm_cache()


def test_build_llm_sends_reasoning_effort_only_to_utility_when_set(monkeypatch) -> None:
    monkeypatch.setenv("EURON_API_KEY", "test-key")
    monkeypatch.setenv("EURI_BASE_URL", "https://example.invalid/v1")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "high")
    reset_settings()
    reset_llm_cache()
    try:
        utility = build_llm(UTILITY)
        answer = build_llm(ANSWER)
        assert utility.extra_body == {"reasoning_effort": "high"}
        assert answer.extra_body is None
    finally:
        reset_settings()
        reset_llm_cache()


def test_utility_role_uses_grader_model_and_zero_temperature(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("LLM_MAX_PAGES", "3")
    monkeypatch.setenv("LLM_MODEL", "qwen/qwen3.8-27b")
    monkeypatch.setenv("LLM_GRADER_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
    reset_settings()
    reset_llm_cache()
    try:
        answer = build_llm(ANSWER)
        utility = build_llm(UTILITY)
        assert answer.model_name == "qwen/qwen3.8-27b"
        assert utility.model_name == "meta-llama/llama-4-scout-17b-16e-instruct"
        assert answer.temperature == get_settings().llm_temperature
        assert utility.temperature == 0.0
    finally:
        reset_settings()
        reset_llm_cache()


def test_resolve_provider_prefers_explicit_overrides(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("LLM_BASE_URL", "https://proxy.invalid/v1")
    monkeypatch.setenv("LLM_API_KEY", "override-key")
    monkeypatch.setenv("LLM_MODEL", "custom-model")
    reset_settings()
    try:
        resolved = resolve_provider()
        assert resolved.name == "groq"
        assert resolved.base_url == "https://proxy.invalid/v1"
        assert resolved.api_key == "override-key"
        assert resolved.answer_model == "custom-model"
    finally:
        reset_settings()


def test_resolve_provider_defaults_to_euron(monkeypatch) -> None:
    monkeypatch.setenv("EURON_API_KEY", "euron-key")
    monkeypatch.setenv("EURI_BASE_URL", "https://euron.invalid/v1")
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    reset_settings()
    try:
        resolved = resolve_provider()
        assert resolved.name == "euron"
        assert resolved.base_url == "https://euron.invalid/v1"
        assert resolved.answer_model == "gemini-2.5-flash"
        assert resolved.supports_reasoning_effort is True
    finally:
        reset_settings()


def test_resolve_provider_groq_defaults(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.delenv("GROQ_BASE_URL", raising=False)
    reset_settings()
    try:
        resolved = resolve_provider()
        assert resolved.base_url == "https://api.groq.com/openai/v1"
        assert resolved.answer_max_images == 3
        assert resolved.grader_max_images == 3
        assert resolved.supports_reasoning_effort is False
    finally:
        reset_settings()


def test_resolve_provider_rejects_unknown_provider(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "nope")
    reset_settings()
    try:
        with pytest.raises(LLMConfigError, match="Unknown LLM_PROVIDER"):
            resolve_provider()
    finally:
        reset_settings()


def test_resolve_provider_requires_key_for_selected_provider(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    reset_settings()
    try:
        with pytest.raises(LLMConfigError, match="GROQ_API_KEY"):
            resolve_provider()
    finally:
        reset_settings()


def test_build_llm_fails_loudly_when_page_count_exceeds_image_cap(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("LLM_MAX_PAGES", "4")
    reset_settings()
    reset_llm_cache()
    try:
        with pytest.raises(LLMConfigError, match="image\\(s\\) per request"):
            build_llm(ANSWER)
    finally:
        reset_settings()
        reset_llm_cache()


def test_set_active_provider_overrides_env(monkeypatch) -> None:
    monkeypatch.setenv("EURON_API_KEY", "euron-key")
    monkeypatch.setenv("EURI_BASE_URL", "https://euron.invalid/v1")
    monkeypatch.setenv("GROQ_API_KEY", "groq-key")
    monkeypatch.setenv("LLM_PROVIDER", "euron")
    reset_settings()
    try:
        assert resolve_provider().name == "euron"
        set_active_provider("groq")
        assert resolve_provider().name == "groq"
        set_active_provider(None)
        assert resolve_provider().name == "euron"
    finally:
        set_active_provider(None)
        reset_settings()
        reset_llm_cache()


def test_set_active_provider_rejects_unknown_name() -> None:
    with pytest.raises(LLMConfigError, match="Unknown LLM provider"):
        set_active_provider("nope")


def test_provider_names_lists_both_providers() -> None:
    assert provider_names() == ["euron", "groq"]


def test_build_llm_requires_api_key(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "euron")
    monkeypatch.delenv("EURON_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("EURI_BASE_URL", "https://example.invalid/v1")
    reset_settings()
    reset_llm_cache()
    try:
        with pytest.raises(LLMConfigError):
            build_llm(ANSWER)
    finally:
        reset_settings()
        reset_llm_cache()


def test_answer_prompt_asks_for_page_markers() -> None:
    prompt = answer_prompt("What was net income?", ["p12", "p13"])
    assert "p12" in prompt
    assert "p13" in prompt
    assert "[p" in prompt
    assert "net income" in prompt


def test_not_found_answer_is_exported() -> None:
    assert NOT_FOUND_ANSWER
    assert "not" in NOT_FOUND_ANSWER.lower()


@pytest.mark.parametrize(
    "text",
    [
        NOT_FOUND_ANSWER,
        "The information is not present in the indexed pages.",
        "Based on the provided pages, the information is not present in the indexed pages.",
        "I could not find the information in the indexed pages of this document.",
        "",
        "   ",
    ],
)
def test_is_refusal_detects_declined_answers(text: str) -> None:
    assert is_refusal(text)


@pytest.mark.parametrize(
    "text",
    [
        "Total operating income was 5,617,152 thousand [p102].",
        "The CET1 ratio was 18.6% [p86].",
        "Reported net interest income rose to 1,439,788 thousand [p102].",
    ],
)
def test_is_refusal_accepts_grounded_answers(text: str) -> None:
    assert not is_refusal(text)


def test_fake_llm_returns_scripted_replies_in_order() -> None:
    llm = FakeLLM(["YES", "rewritten query"])
    assert llm.invoke([]) == "YES"
    assert llm.invoke([]) == "rewritten query"
    assert llm.invoke([]) == ""


def test_build_llm_allows_grader_within_its_own_cap(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("LLM_PROVIDER", "groq")
    monkeypatch.setenv("LLM_MAX_PAGES", "3")
    reset_settings()
    reset_llm_cache()
    try:
        assert build_llm(UTILITY) is not None
    finally:
        reset_settings()
        reset_llm_cache()
