from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

from langchain_openai import ChatOpenAI

from app.core.config import (
    DEFAULT_GROQ_BASE_URL,
    DEFAULT_LLM_PROVIDER,
    AppSettings,
    get_settings,
)
from app.core.logging import get_logger

logger = get_logger("llm.client")

ANSWER: Final = "answer"
UTILITY: Final = "utility"

# Pages whose renders are shown to the retrieval grader. Lives here so the image
# budget can be validated against the active provider's cap without importing the
# graph nodes, which depend on this module.
MAX_GRADER_PAGES: Final = 2


class LLMConfigError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class Provider:
    name: str
    api_key_attr: str
    base_url_attr: str
    answer_model: str
    grader_model: str
    supports_reasoning_effort: bool
    answer_max_images: int
    grader_max_images: int
    default_base_url: str = ""


# Image caps are per model, not per provider: the same Groq account serves models
# with different multimodal limits, and the answer and grader roles use different
# models. groq/qwen3.8-27b was measured to reject a 4th image; gemini's limit is a
# conservative guard, not a measured provider maximum.
PROVIDERS: Final[dict[str, Provider]] = {
    "groq": Provider(
        name="groq",
        api_key_attr="groq_api_key",
        base_url_attr="groq_base_url",
        answer_model="qwen/qwen3.8-27b",
        grader_model="qwen/qwen3.8-27b",
        supports_reasoning_effort=False,
        answer_max_images=3,
        grader_max_images=3,
        default_base_url=DEFAULT_GROQ_BASE_URL,
    ),
    "euron": Provider(
        name="euron",
        api_key_attr="euron_api_key",
        base_url_attr="euron_base_url",
        answer_model="gemini-2.5-flash",
        grader_model="gemini-2.5-flash",
        supports_reasoning_effort=True,
        answer_max_images=20,
        grader_max_images=20,
    ),
}


@dataclass(frozen=True, slots=True)
class ResolvedProvider:
    name: str
    base_url: str
    api_key: str
    answer_model: str
    grader_model: str
    supports_reasoning_effort: bool
    answer_max_images: int
    grader_max_images: int


_clients: dict[tuple[object, ...], ChatOpenAI] = {}
_override: str | None = None


def provider_names() -> list[str]:
    return sorted(PROVIDERS)


def get_active_provider() -> str | None:
    return _override


def set_active_provider(name: str | None) -> None:
    global _override
    if name is not None and name not in PROVIDERS:
        raise LLMConfigError(
            f"Unknown LLM provider {name!r}. Available: {', '.join(provider_names())}."
        )
    _override = name
    reset_llm_cache()
    logger.info("llm.provider.changed active=%s", name or DEFAULT_LLM_PROVIDER)


def resolve_provider(settings: AppSettings | None = None) -> ResolvedProvider:
    cfg = settings or get_settings()
    name = (_override or cfg.llm_provider or DEFAULT_LLM_PROVIDER).strip().lower()
    provider = PROVIDERS.get(name)
    if provider is None:
        raise LLMConfigError(
            f"Unknown LLM_PROVIDER {name!r}. Available: {', '.join(provider_names())}."
        )

    base_url = cfg.llm_base_url or getattr(cfg, provider.base_url_attr) or provider.default_base_url
    if not base_url:
        raise LLMConfigError(
            f"Set LLM_BASE_URL or {provider.base_url_attr.upper()} for provider {name!r}."
        )

    api_key = cfg.llm_api_key or getattr(cfg, provider.api_key_attr)
    if not api_key:
        raise LLMConfigError(
            f"Set LLM_API_KEY or {provider.api_key_attr.upper()} for provider {name!r}."
        )

    return ResolvedProvider(
        name=name,
        base_url=base_url,
        api_key=api_key,
        answer_model=cfg.llm_model or provider.answer_model,
        grader_model=cfg.llm_grader_model or provider.grader_model,
        supports_reasoning_effort=provider.supports_reasoning_effort,
        answer_max_images=provider.answer_max_images,
        grader_max_images=provider.grader_max_images,
    )


def _cache_key(
    role: str, resolved: ResolvedProvider, cfg: AppSettings, model: str, temperature: float
) -> tuple[object, ...]:
    return (
        role,
        resolved.name,
        resolved.base_url,
        resolved.api_key,
        model,
        temperature,
        cfg.llm_max_completion_tokens,
        cfg.llm_timeout,
        cfg.llm_max_retries,
        cfg.llm_reasoning_effort if resolved.supports_reasoning_effort else "",
    )


def build_llm(role: str = ANSWER, settings: AppSettings | None = None) -> ChatOpenAI:
    cfg = settings or get_settings()
    resolved = resolve_provider(cfg)

    is_answer = role == ANSWER
    model = resolved.answer_model if is_answer else resolved.grader_model
    temperature = cfg.llm_temperature if is_answer else 0.0
    max_images = resolved.answer_max_images if is_answer else resolved.grader_max_images
    images_sent = cfg.llm_max_pages if is_answer else MAX_GRADER_PAGES

    if images_sent > max_images:
        raise LLMConfigError(
            f"Provider {resolved.name!r} model {model!r} accepts at most {max_images} "
            f"image(s) per request, but {images_sent} would be sent "
            f"(LLM_MAX_PAGES={cfg.llm_max_pages}). Lower LLM_MAX_PAGES to {max_images} "
            f"or fewer, or select a provider whose model allows more."
        )

    key = _cache_key(role, resolved, cfg, model, temperature)
    cached = _clients.get(key)
    if cached is not None:
        return cached

    extra_body: dict[str, object] = {}
    if not is_answer and resolved.supports_reasoning_effort and cfg.llm_reasoning_effort:
        extra_body["reasoning_effort"] = cfg.llm_reasoning_effort

    client = ChatOpenAI(
        model=model,
        api_key=resolved.api_key,
        base_url=resolved.base_url,
        temperature=temperature,
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
