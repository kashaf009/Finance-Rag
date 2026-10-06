import type { ChatResponse } from '@/types/api'

/**
 * The backend types `trace` as `list[dict[str, object]]` — literally untyped
 * in the OpenAPI schema. Real keys per node, from backend/src/app/rag/nodes.py:
 *
 *   retrieve      { node, query: str, hits: int }
 *   grade         { node, relevant: bool, reason?: str } | { ..., reply: str }
 *   rewrite_query { node, query: str }
 *   generate      { node, pages: int, outcome: "refusal" } | { ..., chars: int }
 *   self_check    { node, supported: bool, reason?: str } | { ..., reply: str }
 *
 * Every graph node also carries `ms`, the measured wall-clock duration.
 *
 * Note the grading node key is `grade`, NOT `grade_documents`. Everything here
 * is defensive: a malformed or unknown entry must never crash the chat UI.
 */

export type TraceNode =
  | 'retrieve'
  | 'grade'
  | 'rewrite_query'
  | 'generate'
  | 'self_check'
  | 'unknown'

export interface TraceStep {
  index: number
  node: TraceNode
  /** Verbatim `node` value when it was not one of the known names. */
  rawNode: string
  /** Wall-clock duration reported by the backend, or null when unavailable. */
  ms: number | null
  ok: boolean | null
  detail: string
  /** Short mono label for the collapsed view. */
  label: string
}

const KNOWN: ReadonlySet<string> = new Set([
  'retrieve',
  'grade',
  'rewrite_query',
  'generate',
  'self_check',
])

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asMilliseconds(v: unknown): number | null {
  const ms = asNumber(v)
  return ms != null && ms >= 0 ? ms : null
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/** Keep reasons/replies to one tidy line so the panel never overflows. */
function tidy(s: string, max = 200): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function parseEntry(entry: Record<string, unknown>, index: number): TraceStep {
  // Preserve whatever actually came back, even a non-string node value, so
  // the trace panel can surface it instead of hiding it behind "unknown".
  const nodeValue = entry.node
  const rawNode =
    typeof nodeValue === 'string'
      ? nodeValue
      : nodeValue == null
        ? 'unknown'
        : String(nodeValue)
  const node: TraceNode = (KNOWN.has(rawNode) ? rawNode : 'unknown') as TraceNode
  const reason = asString(entry.reason)
  const reply = asString(entry.reply)
  const query = asString(entry.query)

  const step: TraceStep = {
    index,
    node,
    rawNode,
    ms: asMilliseconds(entry.ms),
    ok: null,
    detail: '',
    label: rawNode,
  }

  switch (node) {
    case 'retrieve': {
      const hits = asNumber(entry.hits)
      step.label = 'retrieve'
      step.detail = query
        ? `${hits ?? '?'} pages · ${tidy(query, 120)}`
        : `${hits ?? '?'} pages`
      break
    }
    case 'grade': {
      const relevant = asBool(entry.relevant)
      step.ok = relevant
      step.label = 'grade'
      step.detail = tidy(reason ?? reply ?? '')
      break
    }
    case 'rewrite_query': {
      step.label = 'rewrite'
      step.detail = query ? tidy(query, 120) : ''
      break
    }
    case 'generate': {
      const pages = asNumber(entry.pages)
      const chars = asNumber(entry.chars)
      const outcome = asString(entry.outcome)
      // The refusal run does NOT set `outcome` — a real captured refusal
      // trace emits `{"node":"generate","pages":5,"chars":71}`. So only an
      // explicit "refusal" means false; otherwise the verdict is unknown and
      // the response-level `supported` flag is the source of truth.
      const refused = outcome === 'refusal'
      step.ok = refused ? false : null
      step.label = 'generate'
      step.detail = refused
        ? `refused · ${pages ?? '?'} pages`
        : `${pages ?? '?'} pages · ${chars ?? 0} chars`
      break
    }
    case 'self_check': {
      const supported = asBool(entry.supported)
      step.ok = supported
      step.label = 'self-check'
      step.detail = tidy(reason ?? reply ?? '')
      break
    }
    default: {
      // Unknown node: surface whatever is there rather than dropping it.
      const fallback = reply ?? reason ?? query ?? ''
      step.detail = tidy(fallback)
      break
    }
  }

  return step
}

/** Parse a ChatResponse trace defensively. Never throws. */
export function parseTrace(trace: ChatResponse['trace'] | undefined | null): TraceStep[] {
  if (!Array.isArray(trace)) return []
  const out: TraceStep[] = []
  trace.forEach((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      out.push(parseEntry(entry as Record<string, unknown>, out.length))
    } else {
      out.push({
        index: out.length,
        node: 'unknown',
        rawNode: String(entry),
        ms: null,
        ok: null,
        detail: '',
        label: 'unknown',
      })
    }
  })
  return out
}

export interface TraceSummary {
  steps: number
  rewrites: number
  pages: number
  /** Stages that ran, in order, deduplicated — used by the thinking UI. */
  stages: TraceNode[]
}

export function summarizeTrace(steps: TraceStep[], response: ChatResponse): TraceSummary {
  return {
    steps: steps.length,
    rewrites: response.rewrites,
    pages: response.pages_considered,
    stages: steps.map((s) => s.node),
  }
}

/**
 * A human sentence for the collapsed trace bar, e.g.
 * "4 steps · 0 rewrites · 5 pages" or "10 steps · 2 rewrites · refused".
 */
export function traceHeadline(res: ChatResponse, steps: TraceStep[]): string {
  const n = steps.length
  const plural = (v: number) => `${v} ${v === 1 ? 'step' : 'steps'}`
  const rewrites = `${res.rewrites} ${res.rewrites === 1 ? 'rewrite' : 'rewrites'}`
  const tail = res.supported ? `${res.pages_considered} pages` : 'refused'
  return `${plural(n)} · ${rewrites} · ${tail}`
}
