import type {
  ChatRequest,
  ChatResponse,
  CollectionInfo,
  HealthResponse,
  HttpErrorBody,
  LLMProviderRequest,
  LLMProviderResponse,
  SearchRequest,
  SearchResponse,
  ValidationError,
} from '@/types/api'

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

/** Local inference only. The backend has no streaming. */
const HEALTH_TIMEOUT_MS = 8_000
const SEARCH_TIMEOUT_MS = 60_000
/**
 * POST /chat blocks for the whole LangGraph run. Measured 19.5s for a
 * supported answer and 33.9s for a refusal (2 query rewrites), with the
 * server's own LLM_TIMEOUT at 120s per call. Keep this well above that.
 */
const CHAT_TIMEOUT_MS = 300_000

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'not_configured' // 503 — LLMConfigError
  | 'pipeline' // 502 — RagError
  | 'validation' // 422
  | 'server' // 5xx other
  | 'http' // other non-2xx

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly detail: string | null
  readonly errors: ValidationError[]

  constructor(
    kind: ApiErrorKind,
    message: string,
    opts: { status?: number; detail?: string | null; errors?: ValidationError[] } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = opts.status ?? null
    this.detail = opts.detail ?? null
    this.errors = opts.errors ?? []
  }

  /** Human-readable copy for the UI, per backend failure mode. */
  get userMessage(): string {
    switch (this.kind) {
      case 'not_configured':
        return 'The language model is not configured on the backend. Set an API key for the selected provider in backend/.env (GROQ_API_KEY or EURON_API_KEY), then restart the server.'
      case 'pipeline':
        return this.detail ?? 'The retrieval pipeline failed while answering. Please try again.'
      case 'validation':
        return this.errors.map((e) => e.msg).join(' ') || 'The request was rejected as invalid.'
      case 'timeout':
        return 'The request took too long. The pipeline retries up to twice, so large questions can run for a minute or more.'
      case 'network':
        return 'Could not reach the backend. Make sure it is running on 127.0.0.1:8000.'
      case 'aborted':
        return 'Request cancelled.'
      default:
        return this.detail ?? `Unexpected error${this.status ? ` (${this.status})` : ''}.`
    }
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 503) return 'not_configured'
  if (status === 502) return 'pipeline'
  if (status === 422) return 'validation'
  if (status >= 500) return 'server'
  return 'http'
}

function parseBody(body: unknown): { detail: string | null; errors: ValidationError[] } {
  const raw = body as HttpErrorBody | null
  if (!raw || raw.detail == null) return { detail: null, errors: [] }
  if (typeof raw.detail === 'string') return { detail: raw.detail, errors: [] }
  if (Array.isArray(raw.detail)) return { detail: null, errors: raw.detail }
  return { detail: null, errors: [] }
}

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 30_000, signal: outerSignal, ...rest } = init
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const onOuterAbort = () => controller.abort()
  outerSignal?.addEventListener('abort', onOuterAbort)

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...rest, signal: controller.signal })
  } catch (err) {
    if (timedOut) {
      throw new ApiError('timeout', `Request to ${path} timed out after ${timeoutMs}ms`)
    }
    if (outerSignal?.aborted) {
      throw new ApiError('aborted', `Request to ${path} was aborted`)
    }
    throw new ApiError('network', `Request to ${path} failed: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onOuterAbort)
  }

  if (!response.ok) {
    let parsed: { detail: string | null; errors: ValidationError[] } = { detail: null, errors: [] }
    try {
      parsed = parseBody(await response.json())
    } catch {
      /* non-JSON error body */
    }
    const kind = kindForStatus(response.status)
    const message =
      parsed.detail ??
      parsed.errors[0]?.msg ??
      `${path} failed with status ${response.status}`
    throw new ApiError(kind, message, {
      status: response.status,
      detail: parsed.detail,
      errors: parsed.errors,
    })
  }

  return (await response.json()) as T
}

const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export interface Measured<T> {
  data: T
  /** Wall-clock duration in ms, measured client-side. */
  elapsedMs: number
}

async function measured<T>(fn: () => Promise<T>): Promise<Measured<T>> {
  const start = performance.now()
  const data = await fn()
  return { data, elapsedMs: Math.round(performance.now() - start) }
}

/** GET /health — degrades gracefully, never 5xx. Best liveness probe. */
export const getHealth = (signal?: AbortSignal) =>
  request<HealthResponse>('/health', { method: 'GET', timeoutMs: HEALTH_TIMEOUT_MS, signal })

/** GET /collections — 500s if Qdrant is down, unlike /health. */
export const getCollections = (signal?: AbortSignal) =>
  request<CollectionInfo>('/collections', { method: 'GET', timeoutMs: HEALTH_TIMEOUT_MS, signal })

/** POST /search — page-level vector search over the indexed document. */
export const search = (body: SearchRequest, signal?: AbortSignal) =>
  request<SearchResponse>('/search', {
    ...jsonPost(body),
    timeoutMs: SEARCH_TIMEOUT_MS,
    signal,
  })

/** POST /chat — full Self-RAG run. Long-running; no streaming available. */
export const chat = (body: ChatRequest, signal?: AbortSignal) =>
  measured(() =>
    request<ChatResponse>('/chat', {
      ...jsonPost(body),
      timeoutMs: CHAT_TIMEOUT_MS,
      signal,
    }),
  )

/**
 * POST /llm-provider — switch the generation provider.
 *
 * Pass `null` to revert to the `LLM_PROVIDER` env value. The backend rejects an
 * unknown name, or a known one whose API key is missing, with 422 and a detail
 * naming the variable to set, so the failure arrives as a `validation` ApiError.
 */
export const setLLMProvider = (body: LLMProviderRequest, signal?: AbortSignal) =>
  request<LLMProviderResponse>('/llm-provider', {
    ...jsonPost(body),
    timeoutMs: HEALTH_TIMEOUT_MS,
    signal,
  })

export const api = { getHealth, getCollections, search, chat, setLLMProvider }
export { BASE as API_BASE }
