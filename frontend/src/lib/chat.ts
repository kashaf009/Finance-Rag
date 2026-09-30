import type { ApiError } from '@/lib/api'
import type { ChatResponse } from '@/types/api'

/**
 * One row in the transcript.
 *
 * A user turn and its assistant turn are separate entries that share a
 * `exchangeId`, so the list can interleave cleanly while still rendering as a
 * flat, keyed array.
 */
export interface ChatTurn {
  id: string
  exchangeId: string
  role: 'user' | 'assistant'
  /** The question, verbatim, on both turns of an exchange. */
  question: string
  /** Populated once the request settles. Null while pending or on error. */
  response: ChatResponse | null
  /** Real client-side wall-clock duration of POST /chat. Never estimated. */
  elapsedMs: number | null
  error: ApiError | null
  pending: boolean
}

let sequence = 0

/** Monotonic ids so React keys stay stable and unique per exchange. */
export function nextExchangeId(): string {
  sequence += 1
  return `ex-${sequence}`
}

/** Test seam: keeps ids deterministic across test files. */
export function resetExchangeIds(): void {
  sequence = 0
}

/**
 * Human latency label, e.g. "23.4s".
 *
 * The mock in ui.html:348 hardcodes "32ms", which is off by three orders of
 * magnitude — POST /chat blocks for 19-34s. This only ever formats a value we
 * actually measured.
 */
export function formatLatency(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** "0 rewrites" / "1 rewrite" / "2 rewrites" */
export function formatRewrites(n: number): string {
  return `${n} ${n === 1 ? 'rewrite' : 'rewrites'}`
}

/**
 * The one-line provenance summary under an answer.
 * e.g. "grounded · 5 pages · 0 rewrites" or "no supporting pages found".
 */
export function provenanceLine(res: ChatResponse | null): string {
  if (!res) return ''
  if (!res.supported) return 'no supporting pages found'
  const pages = `${res.pages_considered} ${res.pages_considered === 1 ? 'page' : 'pages'}`
  return `grounded · ${pages} · ${formatRewrites(res.rewrites)}`
}
