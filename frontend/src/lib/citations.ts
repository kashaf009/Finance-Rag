import type { Citation } from '@/types/api'

/**
 * Answer page markers.
 *
 * The backend builds citations with `re.compile(r"\[p(\d+)\]")`
 * (backend/src/app/rag/nodes.py PAGE_MARKER), which does NOT match grouped
 * markers. A real answer captured during preflight contained all three forms:
 *
 *   €1,439.8 million [p2]              → single marker
 *   €1,684 million [p24, p30]          → grouped marker
 *   ...reported as ... [p30]           → single marker
 *
 * The grouped form is silently dropped from `citations` server-side, so the
 * frontend has to extract it from the raw text itself. This parser is
 * deliberately more tolerant than the backend regex.
 */

/** Any bracketed run that is not a markdown link destination. */
const BRACKET = /\[\s*([^[\]]+?)\s*\]/g
/** A bracket group is a page marker when it opens with p/pp (not a word). */
const MARKER_START = /^\s*pp?(?![a-z])/i
/** Bare number inside a marker group, e.g. the 7 in "pp 7" or the 30 in "p24, p30". */
const BARE_NUMBER = /\d+/g

export interface MarkerHit {
  /** Every page number in the marker, e.g. [24, 30] */
  pages: number[]
  /** The marker text as it appeared, e.g. "p24, p30" */
  raw: string
  start: number
  end: number
}

/**
 * Page numbers inside a marker group.
 *
 * Once a group is confirmed to be a page marker, every number in it counts, so
 * grouped forms work whether or not each page is re-prefixed:
 *   "p2"       -> [2]
 *   "p24, p30" -> [24, 30]
 *   "pp 7, 9"  -> [7, 9]
 * Returns [] for anything that is not a marker, which keeps prose like
 * "[Key Figures]", "[note]" and "[policy 5]" out of the results.
 */
function pagesIn(body: string): number[] {
  if (!MARKER_START.test(body)) return []
  const pages: number[] = []
  for (const m of body.matchAll(BARE_NUMBER)) {
    const page = Number.parseInt(m[0], 10)
    if (Number.isFinite(page) && !pages.includes(page)) pages.push(page)
  }
  return pages
}

/** True when the `]` at `end` is followed by `(`, i.e. it's a markdown link. */
function isMarkdownLink(text: string, end: number): boolean {
  return text[end] === '('
}

/** Find every page marker in an answer, including grouped ones. */
export function findMarkers(answer: string): MarkerHit[] {
  const hits: MarkerHit[] = []
  for (const match of answer.matchAll(BRACKET)) {
    const start = match.index
    const end = start + match[0].length
    if (isMarkdownLink(answer, end)) continue

    const pages = pagesIn(match[1])
    if (pages.length > 0) hits.push({ pages, raw: match[1], start, end })
  }
  return hits
}

/**
 * Rewrite page markers into markdown links with a sentinel href so that
 * react-markdown turns each one into an inline chip component.
 *
 *   "[p24, p30]"  →  "[p24, p30](#cite:24,30)"
 *
 * Rewriting (rather than post-processing the DOM) keeps markers working
 * inside paragraphs, list items, bold spans and table cells alike.
 */
export function linkifyMarkers(answer: string): string {
  return answer.replace(BRACKET, (whole, body: string, offset: number) => {
    const end = offset + whole.length
    if (isMarkdownLink(answer, end)) return whole

    const pages = pagesIn(body)
    if (pages.length === 0) return whole

    // "[p2]" -> "[p2](#cite:2)"  ·  "[p24, p30]" -> "[p24, p30](#cite:24,30)"
    return `${whole.slice(0, -1)}](#cite:${pages.join(',')})`
  })
}

export const CITE_HREF_PREFIX = '#cite:'

export function parseCiteHref(href: string): number[] | null {
  if (!href.startsWith(CITE_HREF_PREFIX)) return null
  return href
    .slice(CITE_HREF_PREFIX.length)
    .split(',')
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n))
}

/** page_number can be 0 when the Qdrant payload lacked the key. */
export function formatPage(page: number): string {
  return page > 0 ? `p.${page}` : 'page ?'
}

export function formatScore(score: number): string {
  return score.toFixed(3)
}

export function formatSimilarity(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

export interface ResolvedMarker {
  hit: MarkerHit
  /** Citations from the response that back these pages. May be short. */
  citations: Citation[]
  /** Pages named in the marker with no matching citation. */
  missing: number[]
}

/**
 * Join markers to the citations the backend returned.
 *
 * A page can be referenced but absent from `citations` (the grouped-marker
 * case), so `missing` is surfaced rather than silently dropped.
 */
export function resolveMarkers(answer: string, citations: Citation[]): ResolvedMarker[] {
  const byPage = new Map<number, Citation>()
  for (const c of citations) {
    if (!byPage.has(c.page_number)) byPage.set(c.page_number, c)
  }
  return findMarkers(answer).map((hit) => {
    const matched: Citation[] = []
    const missing: number[] = []
    for (const page of hit.pages) {
      const c = byPage.get(page)
      if (c) matched.push(c)
      else missing.push(page)
    }
    return { hit, citations: matched, missing }
  })
}

/** Distinct pages referenced by the answer, ascending. */
export function referencedPages(answer: string): number[] {
  const pages = new Set<number>()
  for (const hit of findMarkers(answer)) for (const p of hit.pages) pages.add(p)
  return [...pages].sort((a, b) => a - b)
}
