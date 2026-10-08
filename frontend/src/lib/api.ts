import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  CollectionInfo,
  DocumentPagesResponse,
  HealthResponse,
  HttpErrorBody,
  LLMProviderRequest,
  LLMProviderResponse,
  SearchRequest,
  SearchResponse,
  ValidationError,
} from '@/types/api'

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')

/** Local inference only. */
const HEALTH_TIMEOUT_MS = 8_000
const SEARCH_TIMEOUT_MS = 60_000
/** A local scandir plus one PIL header read. No reason for this to be slow. */
const DOCUMENT_TIMEOUT_MS = 8_000
/**
 * POST /chat and POST /chat/stream run the whole LangGraph pipeline, and how long that takes
 * depends on the active provider. Measured on this machine: euron
 * (gemini-2.5-flash) 19.5s for a supported answer and 33.9s for a refusal
 * with 2 query rewrites; groq (qwen/qwen3.8-27b) 140.2s for a supported
 * answer and 156.4s for a refusal. A single run makes 3-5 LLM calls, each
 * capped by the server's own LLM_TIMEOUT at 120s, so the worst case is well
 * above any of those. Keep this comfortably clear of the ceiling.
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
        return 'The request took too long. How long a run takes depends on the selected provider, and the pipeline may retry retrieval up to twice, so a slow provider can take several minutes.'
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

async function streamRequest<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number },
  onEvent: (event: ChatStreamEvent) => void,
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
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onOuterAbort)
    if (timedOut) throw new ApiError('timeout', `Request to ${path} timed out after ${timeoutMs}ms`)
    if (outerSignal?.aborted) throw new ApiError('aborted', `Request to ${path} was aborted`)
    throw new ApiError('network', `Request to ${path} failed: ${(err as Error).message}`)
  }

  if (!response.ok) {
    let parsed: { detail: string | null; errors: ValidationError[] } = { detail: null, errors: [] }
    try {
      parsed = parseBody(await response.json())
    } catch {
      /* non-JSON error body */
    }
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onOuterAbort)
    const kind = kindForStatus(response.status)
    const message =
      parsed.detail ?? parsed.errors[0]?.msg ?? `${path} failed with status ${response.status}`
    throw new ApiError(kind, message, {
      status: response.status,
      detail: parsed.detail,
      errors: parsed.errors,
    })
  }

  if (!response.body) {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onOuterAbort)
    throw new ApiError('pipeline', 'The streaming response had no body.', { status: 502 })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []
  let complete: T | null = null

  const emit = () => {
    if (dataLines.length === 0) {
      eventName = 'message'
      return
    }
    const raw = dataLines.join('\n')
    dataLines = []
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const event = { ...parsed, type: parsed.type ?? eventName } as ChatStreamEvent
    if (event.type === 'error') {
      throw new ApiError(event.kind, event.detail, { status: event.status, detail: event.detail })
    }
    onEvent(event)
    if (event.type === 'complete') complete = event.response as T
    eventName = 'message'
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
        else if (line === '') emit()
      }
      if (done) {
        if (buffer === '') emit()
        break
      }
    }
  } catch (err) {
    if (timedOut) throw new ApiError('timeout', `Request to ${path} timed out after ${timeoutMs}ms`)
    if (outerSignal?.aborted) throw new ApiError('aborted', `Request to ${path} was aborted`)
    if (err instanceof ApiError) throw err
    throw new ApiError('network', `Request to ${path} failed: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
    outerSignal?.removeEventListener('abort', onOuterAbort)
    reader.releaseLock()
  }

  if (complete === null) {
    throw new ApiError('pipeline', 'The streaming response ended before an answer was received.', {
      status: 502,
    })
  }
  return complete
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

/** POST /chat — full Self-RAG run, retained for non-interactive clients. */
export const chat = (body: ChatRequest, signal?: AbortSignal) =>
  measured(() =>
    request<ChatResponse>('/chat', {
      ...jsonPost(body),
      timeoutMs: CHAT_TIMEOUT_MS,
      signal,
    }),
  )

/** POST /chat/stream — full Self-RAG run with stage-by-stage SSE updates. */
export const streamChat = (
  body: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
) =>
  measured(() =>
    streamRequest<ChatResponse>(
      '/chat/stream',
      { ...jsonPost(body), timeoutMs: CHAT_TIMEOUT_MS, signal },
      onEvent,
    ),
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

/**
 * GET /document/pages — the page inventory, read from the ingest's own output.
 *
 * Reads the filesystem, not Qdrant, so this still works when the vector store
 * is down. Degrades to `page_count: 0` rather than raising, so a missing ingest
 * is renderable as an honest empty state.
 */
export const getDocumentPages = (signal?: AbortSignal) =>
  request<DocumentPagesResponse>('/document/pages', {
    method: 'GET',
    timeoutMs: DOCUMENT_TIMEOUT_MS,
    signal,
  })

/**
 * URL for one page render at full resolution.
 *
 * Deliberately a URL and not a fetch: returning a URL lets the browser handle
 * caching, range/lazy loading and decoding itself, which is the only way 139
 * full-size JPEGs stay tolerable. A fetch-to-blob would buffer all of them in
 * memory before anything painted.
 *
 * No `doc_id` in the path — the backend owns that lookup, and taking a
 * caller-supplied string into a filesystem path is how traversal bugs start.
 */
export function pageImageUrl(pageNumber: number): string {
  return `${BASE}/document/page/${pageNumber}`
}

export const api = {
  getHealth,
  getCollections,
  search,
  chat,
  streamChat,
  setLLMProvider,
  getDocumentPages,
}
export { BASE as API_BASE }
