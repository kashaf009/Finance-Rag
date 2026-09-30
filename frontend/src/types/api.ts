/**
 * TypeScript mirrors of backend/src/app/api/schemas.py
 *
 * Keep this file in lockstep with the Pydantic models. Every field is
 * required unless the backend declares a default.
 */

/** schemas.py:11 CitationModel */
export interface Citation {
  /** Qdrant payload doc_id — the PDF filename stem, e.g. JPM_SE_Annual_2023_140 */
  doc_id: string
  /**
   * 1-based page number. The backend coerces with
   * `int(payload.get("page_number") or 0)`, so 0 means "unknown".
   */
  page_number: number
  /** Cosine similarity from Qdrant */
  score: number
  /** Full `data:image/jpeg;base64,...` URI. Use directly as an <img src>. */
  image: string
}

/** schemas.py:6 SearchRequest — query 1..1000 chars, limit 1..50 (default 5) */
export interface SearchRequest {
  query: string
  limit?: number
}

/** schemas.py:18 SearchResponse */
export interface SearchResponse {
  query: string
  hits: Citation[]
}

/** schemas.py:23 ChatRequest — question 1..2000 chars, top_k 1..20 (default null) */
export interface ChatRequest {
  question: string
  top_k?: number | null
}

/**
 * schemas.py:28 ChatResponse
 *
 * When `supported` is false the backend forces `answer` to a fixed refusal
 * string and empties `citations`. Branch on `supported` — never string-match
 * the answer text.
 */
export interface ChatResponse {
  question: string
  /** Final (possibly rewritten) retrieval query after LangGraph retrieval. */
  query: string
  answer: string
  supported: boolean
  rewrites: number
  pages_considered: number
  citations: Citation[]
  /**
   * Untyped in the OpenAPI schema (`dict[str, object]`). Parse defensively —
   * see lib/trace.ts. Known node names are `retrieve`, `grade`,
   * `rewrite_query`, `generate`, `self_check` (note: `grade`, not
   * `grade_documents`).
   */
  trace: Record<string, unknown>[]
}

/** schemas.py:39 HealthResponse */
export interface HealthResponse {
  status: 'ok' | 'degraded'
  qdrant_url: string
  collection: string
  collection_ready: boolean
  points: number | null
  /**
   * Active generation provider, or the literal `unconfigured` when the backend
   * cannot resolve a usable base URL and key. Never a guess: the backend only
   * reports a provider it can actually build a client for.
   */
  llm_provider: string
  /** Every provider the backend will accept, sorted. Drives the selector. */
  llm_providers: string[]
  /** Resolved model for the answer role, or `unconfigured`. */
  llm_model: string
  llm_base_url: string
  embed_model: string
  vector_size: number | null
}

/** schemas.py:57 LLMProviderResponse */
export interface LLMProviderResponse {
  provider: string
  model: string
  base_url: string
}

/** schemas.py:53 LLMProviderRequest — `null` reverts to the LLM_PROVIDER env value. */
export interface LLMProviderRequest {
  provider: string | null
}

/** schemas.py:51 CollectionInfo */
export interface CollectionInfo {
  name: string
  exists: boolean
  vector_size: number | null
  points: number | null
  distance: string | null
}

/** FastAPI's built-in validation error body */
export interface ValidationError {
  type: string
  loc: (string | number)[]
  msg: string
  input?: unknown
  ctx?: Record<string, unknown>
}

/** `{"detail": ...}` — a string for 502/503, an array for 422 */
export interface HttpErrorBody {
  detail: string | ValidationError[]
}

/** Backend constraint limits, mirrored for client-side validation. */
export const LIMITS = {
  searchQueryMaxLength: 1000,
  searchLimitMax: 50,
  searchLimitDefault: 5,
  questionMaxLength: 2000,
  topKMax: 20,
} as const

/**
 * GET /document/pages — the page renders the ingest already wrote to disk.
 * Source: backend/src/app/api/schemas.py DocumentPagesResponse
 *
 * Every field is measured per request. The nulls are real states meaning the
 * ingest has not run for this document, so the client must render an honest
 * empty state rather than substitute a plausible number.
 */
export interface DocumentPagesResponse {
  doc_id: string | null
  pdf_filename: string | null
  pdf_byte_size: number | null
  page_count: number
  page_width: number | null
  page_height: number | null
}

/**
 * The exact refusal the backend returns when supported is false.
 * Source: backend/src/app/rag/service.py NOT_FOUND_ANSWER
 */
export const NOT_FOUND_ANSWER =
  'I could not find the information in the indexed pages of this document.'
