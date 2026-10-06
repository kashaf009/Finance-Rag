from __future__ import annotations

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    limit: int = Field(default=5, ge=1, le=50)


class CitationModel(BaseModel):
    doc_id: str
    page_number: int
    score: float
    image: str


class ChatCitationModel(BaseModel):
    """Citation metadata for chat; page images are not rendered there."""

    doc_id: str
    page_number: int
    score: float


class SearchResponse(BaseModel):
    query: str
    hits: list[CitationModel]


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    top_k: int | None = Field(default=None, ge=1, le=20)


class ChatResponse(BaseModel):
    question: str
    query: str
    answer: str
    supported: bool
    rewrites: int
    pages_considered: int
    citations: list[ChatCitationModel]
    trace: list[dict[str, object]]


class HealthResponse(BaseModel):
    status: str
    qdrant_url: str
    collection: str
    collection_ready: bool
    points: int | None
    llm_provider: str
    llm_providers: list[str]
    llm_model: str
    llm_base_url: str
    embed_model: str
    vector_size: int | None


class LLMProviderRequest(BaseModel):
    provider: str | None = None


class LLMProviderResponse(BaseModel):
    provider: str
    model: str
    base_url: str


class CollectionInfo(BaseModel):
    name: str
    exists: bool
    vector_size: int | None
    points: int | None
    distance: str | None = None


class DocumentPagesResponse(BaseModel):
    """Inventory of the page renders already written by the ingest run.

    Every field is measured from disk at request time. The nulls are real
    states, not placeholders: they mean the ingest has not run (or produced
    nothing) for this document, and the client must not invent values for
    them.
    """

    doc_id: str | None
    pdf_filename: str | None
    pdf_byte_size: int | None
    page_count: int
    page_width: int | None
    page_height: int | None
