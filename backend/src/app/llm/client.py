from __future__ import annotations

from typing import Any, Final

from langchain_openai import ChatOpenAI

from app.core.config import AppSettings, get_settings
from app.core.logging import get_logger

logger = get_logger("llm.client")

ANSWER: Final = "answer"
UTILITY: Final = "utility"

_clients: dict[tuple[object, ...], ChatOpenAI] = {}


class LLMConfigError(RuntimeError):
    pass


def _cache_key(role: str, cfg: AppSettings, model: str, temperature: float) -> tuple[object, ...]:
    return (
        role,
        model,
        temperature,
        cfg.llm_base_url,
        cfg.llm_api_key,
        cfg.llm_max_completion_tokens,
        cfg.llm_timeout,
        cfg.llm_max_retries,
        cfg.llm_reasoning_effort,
    )


def build_llm(role: str = ANSWER, settings: AppSettings | None = None) -> ChatOpenAI:
    cfg = settings or get_settings()
    if not cfg.llm_base_url:
        raise LLMConfigError("Set LLM_BASE_URL or EURON_BASE_URL")
    if not cfg.llm_api_key:
        raise LLMConfigError("Set LLM_API_KEY or EURON_API_KEY")

    is_answer = role == ANSWER
    model = cfg.llm_model if is_answer else (cfg.llm_grader_model or cfg.llm_model)
    temperature = cfg.llm_temperature if is_answer else 0.0
    key = _cache_key(role, cfg, model, temperature)
    cached = _clients.get(key)
    if cached is not None:
        return cached

    extra_body: dict[str, object] = {}
    if not is_answer and cfg.llm_reasoning_effort:
        extra_body["reasoning_effort"] = cfg.llm_reasoning_effort

    client = ChatOpenAI(
        model=cfg.llm_model,
        api_key=cfg.llm_api_key,
        base_url=cfg.llm_base_url,
        temperature=cfg.llm_temperature,
        request_timeout=cfg.llm_timeout,
        model_kwargs={"max_completion_tokens": cfg.llm_max_completion_tokens},
        extra_body=extra_body or None,
    )
    _clients[key] = client
    return client


def reset_llm_cache() -> None:
    _clients.clear()


def text_of(message: Any) -> str:
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "\n".join(part for part in parts if part).strip()
    return str(content).strip()
