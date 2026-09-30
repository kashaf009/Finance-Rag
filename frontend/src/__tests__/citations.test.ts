import { describe, expect, it } from 'vitest'
import {
  findMarkers,
  formatPage,
  formatScore,
  formatSimilarity,
  linkifyMarkers,
  parseCiteHref,
  referencedPages,
  resolveMarkers,
  CITE_HREF_PREFIX,
} from '@/lib/citations'
import type { Citation } from '@/types/api'

import supportedChat from './fixtures/chat-supported.json'
import refusalChat from './fixtures/chat-refusal.json'

const SUPPORTED = supportedChat as unknown as { answer: string; citations: Citation[] }
const REFUSAL = refusalChat as unknown as { answer: string; citations: Citation[] }

describe('findMarkers — against the real supported answer', () => {
  it('extracts single markers', () => {
    const hits = findMarkers(SUPPORTED.answer)
    expect(hits.length).toBeGreaterThanOrEqual(3)
    expect(hits.map((h) => h.pages)).toContainEqual([2])
  })

  it('extracts the grouped marker [p24, p30] as two pages', () => {
    const hits = findMarkers(SUPPORTED.answer)
    const grouped = hits.find((h) => h.pages.length === 2)
    expect(grouped).toBeDefined()
    expect(grouped!.pages).toEqual([24, 30])
  })

  it('handles pp. / p. / P variants', () => {
    expect(findMarkers('[pp.7]').map((h) => h.pages)).toEqual([[7]])
    expect(findMarkers('[p.7]').map((h) => h.pages)).toEqual([[7]])
    expect(findMarkers('[P7]').map((h) => h.pages)).toEqual([[7]])
    expect(findMarkers('[pp 7, 9]').map((h) => h.pages)).toEqual([[7, 9]])
  })

  it('ignores non-marker brackets and markdown links', () => {
    expect(findMarkers('[note] and [total]')).toHaveLength(0)
    expect(findMarkers('see [Key Figures](#cite:2) table')).toHaveLength(0)
    expect(findMarkers('plain [12] bracket')).toHaveLength(0)
  })

  it('deduplicates repeated pages inside one marker', () => {
    expect(findMarkers('[p5, p5, p5]').map((h) => h.pages)).toEqual([[5]])
  })
})

describe('linkifyMarkers', () => {
  it('rewrites markers to sentinel hrefs without touching prose', () => {
    const out = linkifyMarkers('Value €1,439.8 million [p2] here.')
    expect(out).toBe(`Value €1,439.8 million [p2](${CITE_HREF_PREFIX}2) here.`)
  })

  it('rewrites grouped markers as one link with a multi-page href', () => {
    const out = linkifyMarkers('sections [p24, p30].')
    expect(out).toBe(`sections [p24, p30](${CITE_HREF_PREFIX}24,30).`)
  })

  it('leaves an existing markdown link alone', () => {
    const src = 'see [Key Figures](https://example.com) and [p2]'
    expect(linkifyMarkers(src)).toBe(`see [Key Figures](https://example.com) and [p2](${CITE_HREF_PREFIX}2)`)
  })

  it('is idempotent — a second pass does not double-wrap', () => {
    const once = linkifyMarkers('x [p2]')
    expect(linkifyMarkers(once)).toBe(once)
  })

  it('round-trips through parseCiteHref', () => {
    const out = linkifyMarkers('[p24, p30] and [p2]')
    const hrefs = [...out.matchAll(/\]\((#[^)]+)\)/g)].map((m) => parseCiteHref(m[1]))
    expect(hrefs).toEqual([[24, 30], [2]])
  })

  it('returns non-sentinel hrefs as null', () => {
    expect(parseCiteHref('https://example.com')).toBeNull()
    expect(parseCiteHref('#section')).toBeNull()
  })
})

describe('resolveMarkers — the missing-citation case', () => {
  it('flags p24 as missing because the backend dropped the grouped marker', () => {
    const resolved = resolveMarkers(SUPPORTED.answer, SUPPORTED.citations)

    const p24 = resolved.find((r) => r.hit.pages.includes(24))
    expect(p24).toBeDefined()
    // This is the real backend behaviour: the grouped [p24, p30] marker is not
    // matched by the backend's \[p(\d+)\] regex, so p24 never reaches the client.
    expect(p24!.citations.map((c) => c.page_number)).not.toContain(24)
    expect(p24!.missing).toContain(24)
    // ...but p30 in the same group IS present.
    expect(p24!.citations.map((c) => c.page_number)).toContain(30)
  })

  it('resolves every marker that has a backing citation', () => {
    const resolved = resolveMarkers(SUPPORTED.answer, SUPPORTED.citations)
    const single = resolved.filter((r) => r.hit.pages.length === 1)
    expect(single.length).toBeGreaterThan(0)
    for (const r of single) expect(r.missing).toHaveLength(0)
  })

  it('handles the refusal case: no markers, no citations', () => {
    const resolved = resolveMarkers(REFUSAL.answer, REFUSAL.citations)
    expect(resolved).toHaveLength(0)
    expect(REFUSAL.citations).toHaveLength(0)
  })
})

describe('referencedPages', () => {
  it('returns distinct pages ascending', () => {
    expect(referencedPages('[p30] [p2] [p24, p30] [p2]')).toEqual([2, 24, 30])
  })

  it('is empty when there are no markers', () => {
    expect(referencedPages('no pages here')).toEqual([])
  })
})

describe('formatters', () => {
  it('renders page 0 as unknown rather than p.0', () => {
    expect(formatPage(0)).toBe('page ?')
    expect(formatPage(86)).toBe('p.86')
  })

  it('formats scores and similarity', () => {
    expect(formatScore(0.4611)).toBe('0.461')
    expect(formatSimilarity(0.984)).toBe('98.4%')
  })
})
