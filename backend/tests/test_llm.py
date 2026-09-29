from __future__ import annotations

import base64

import pytest
from PIL import Image

from app.core.config import get_settings, reset_settings
from app.imaging.encode import base64_to_image, image_to_base64
from app.llm import (
    ANSWER,
    NOT_FOUND_ANSWER,
    UTILITY,
    build_llm,
    is_refusal,
    text_of,
    to_prompt_data_uri,
)
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


def test_text_of_handles_strings_and_messages() -> None:
    from langchain_core.messages import AIMessage

    assert text_of("plain reply") == "plain reply"
    assert text_of(AIMessage(content="message reply")) == "message reply"
    assert text_of(AIMessage(content="")) == ""


def test_build_llm_applies_reasoning_effort_only_to_utility(monkeypatch) -> None:
    monkeypatch.setenv("EURON_API_KEY", "test-key")
    monkeypatch.setenv("EURI_BASE_URL", "https://example.invalid/v1")
    reset_settings()
    try:
        utility = build_llm(UTILITY)
        answer = build_llm(ANSWER)
        assert utility.extra_body == {"reasoning_effort": "none"}
        assert answer.extra_body is None
        assert utility.request_timeout == get_settings().llm_timeout
    finally:
        reset_settings()


def test_build_llm_requires_api_key(monkeypatch) -> None:
    from app.llm import LLMConfigError

    monkeypatch.delenv("EURON_API_KEY", raising=False)
    reset_settings()
    try:
        with pytest.raises(LLMConfigError):
            build_llm(ANSWER)
    finally:
        reset_settings()


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
