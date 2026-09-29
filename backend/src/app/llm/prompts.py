from __future__ import annotations

from typing import Final

GRADER_SYSTEM: Final = """You are a strict retrieval grader for a financial document QA system.
You receive scanned page images from a bank annual report and decide whether those pages
actually contain the information needed to answer the user's question.
Be strict. If the specific figures, table or section required are not visible, answer NO.
Reply with a single word, YES or NO, optionally followed by one short sentence of reason."""

REWRITER_SYSTEM: Final = """You rewrite search queries for retrieval over bank annual reports.
Produce one concise, keyword-rich search query that will retrieve the correct pages.
Do not answer the question. Reply with the query only, on a single line, with no labels,
quotation marks or trailing punctuation."""

ANSWER_SYSTEM: Final = """You are a precise financial analyst answering questions about bank
annual reports, for example the J.P. Morgan SE 2023 report. You are given scanned page images.

Rules:
- Answer only from the attached page images. Never use outside knowledge.
- If the pages do not contain the answer, reply with exactly this sentence and nothing else:
  "I could not find the information in the indexed pages of this document."
- Quote exact figures with their unit and currency.
- Cite every figure inline with the page marker of the page it came from, for example [p4].
- Keep the answer concise and factual. Do not speculate."""

SELF_CHECK_SYSTEM: Final = """You verify whether a proposed answer is fully supported by the given
document page images. Reply with a single word, SUPPORTED or UNSUPPORTED, then one short
sentence of reason. If any factual claim in the answer is not visible in the pages,
reply UNSUPPORTED."""

GRADE_PROMPT: Final = """Question: {question}

Attached pages: {pages}

Do these pages contain the information needed to answer the question? Reply YES or NO."""

REWRITE_PROMPT: Final = """Original question: {question}

Previous search query that returned poor results: {previous}

Write one improved search query."""

SELF_CHECK_PROMPT: Final = """Question: {question}

Proposed answer: {answer}

Is every factual claim in the answer visible in the attached pages?"""


def answer_prompt(question: str, page_markers: list[str]) -> str:
    markers = ", ".join(page_markers)
    return f"""Question: {question}

You have {len(page_markers)} page images attached ({markers}).
Answer the question using only those pages and cite the pages you use as [pN]."""


NOT_FOUND_ANSWER: Final = "I could not find the information in the indexed pages of this document."

_REFUSAL_PATTERNS: Final = (
    "not present in the indexed",
    "not in the indexed",
    "not present in the",
    "could not find the information",
    "cannot find the information",
    "no such information",
    "not available in the",
    "does not contain the",
    "do not contain the",
    "not mentioned in the",
    "is not disclosed",
    "are not disclosed",
)


def is_refusal(text: str) -> bool:
    """True when the answer declines to answer instead of citing page evidence."""
    normalized = " ".join((text or "").lower().split())
    if not normalized:
        return True
    if normalized == NOT_FOUND_ANSWER.lower():
        return True
    return any(pattern in normalized for pattern in _REFUSAL_PATTERNS)
