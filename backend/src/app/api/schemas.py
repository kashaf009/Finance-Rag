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
    citations: list[CitationModel]
    trace: list[dict[str, object]]


class HealthResponse(BaseModel):
    status: str
    qdrant_url: str
    collection: str
    collection_ready: bool
    points: int | None
    llm_model: str
    llm_base_url: str
    embed_model: str
    vector_size: int | None


class CollectionInfo(BaseModel):
    name: str
    exists: bool
    vector_size: int | None
    points: int | None
    distance: str | None = None
