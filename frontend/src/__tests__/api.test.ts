// @vitest-environment node
// Hits the live backend over real fetch; jsdom has no usable fetch.
import { describe, expect, it } from 'vitest'
import { ApiError, chat, getCollections, getHealth, search } from '@/lib/api'
import { LIMITS, NOT_FOUND_ANSWER } from '@/types/api'

import healthFixture from './fixtures/health.json'
import collectionsFixture from './fixtures/collections.json'
import supportedChat from './fixtures/chat-supported.json'
import refusalChat from './fixtures/chat-refusal.json'
import searchFixture from './fixtures/search.json'

describe('fixtures match the backend contract', () => {
  it('health has every required field with the documented shape', () => {
    const h = healthFixture as unknown as Record<string, unknown>
    for (const k of [
      'status',
      'qdrant_url',
      'collection',
      'collection_ready',
      'points',
      'llm_model',
      'embed_model',
      'vector_size',
    ]) {
      expect(h, `missing ${k}`).toHaveProperty(k)
    }
    expect(['ok', 'degraded']).toContain(h.status)
    expect(h.points).toBeTypeOf('number')
    expect(h.vector_size).toBeTypeOf('number')
  })

  it('collections reports cosine distance', () => {
    expect((collectionsFixture as unknown as { distance: string }).distance).toBe('Cosine')
  })

  it('citations carry a base64 data-uri image', () => {
    const hits = (searchFixture as unknown as { hits: { image: string }[] }).hits
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) expect(h.image).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('chat citations carry metadata without page images', () => {
    const citations = (supportedChat as unknown as { citations: Record<string, unknown>[] }).citations
    expect(citations.length).toBeGreaterThan(0)
    for (const citation of citations) {
      expect(citation).toEqual(expect.objectContaining({ doc_id: expect.any(String), page_number: expect.any(Number), score: expect.any(Number) }))
      expect(citation).not.toHaveProperty('image')
    }
  })

  it('the refusal fixture is exactly the backend refusal contract', () => {
    const r = refusalChat as unknown as { answer: string; supported: boolean; citations: unknown[] }
    expect(r.supported).toBe(false)
    expect(r.answer).toBe(NOT_FOUND_ANSWER)
    expect(r.citations).toEqual([])
  })

  it('the supported fixture carries citations with positive scores', () => {
    const c = supportedChat as unknown as { supported: boolean; citations: { score: number }[] }
    expect(c.supported).toBe(true)
    expect(c.citations.length).toBeGreaterThan(0)
    for (const x of c.citations) expect(x.score).toBeGreaterThan(0)
  })
})

describe('ApiError', () => {
  it('maps 503 to not_configured with actionable copy', () => {
    const e = new ApiError('not_configured', 'boom', { status: 503 })
      expect(e.userMessage).toMatch(/GROQ_API_KEY/)
      expect(e.userMessage).toMatch(/EURON_API_KEY/)
  })

  it('maps 502 to pipeline and surfaces the backend detail', () => {
    const e = new ApiError('pipeline', 'boom', { status: 502, detail: 'grade node failed' })
    expect(e.userMessage).toBe('grade node failed')
  })

  it('maps 422 to validation and joins messages', () => {
    const e = new ApiError('validation', 'v', {
      status: 422,
      errors: [{ type: 'string_too_short', loc: ['body', 'question'], msg: 'too short' }],
    })
    expect(e.userMessage).toBe('too short')
    expect(e.errors).toHaveLength(1)
  })

  it('mentions the retry behaviour for timeouts', () => {
    const message = new ApiError('timeout', 't').userMessage
    expect(message).toMatch(/retry retrieval up to twice/)
    // No fixed duration: run time varies by provider, so quoting one would be
    // a claim the UI cannot back up.
    expect(message).not.toMatch(/\d+\s*seconds?/)
  })

  it('tells the user to start the backend for network errors', () => {
    expect(new ApiError('network', 'n').userMessage).toMatch(/127\.0\.0\.1:8000/)
  })
})

describe('limits mirror the backend constraints', () => {
  it('matches ChatRequest bounds', () => {
    expect(LIMITS.questionMaxLength).toBe(2000)
    expect(LIMITS.topKMax).toBe(20)
  })

  it('matches SearchRequest bounds', () => {
    expect(LIMITS.searchQueryMaxLength).toBe(1000)
    expect(LIMITS.searchLimitMax).toBe(50)
    expect(LIMITS.searchLimitDefault).toBe(5)
  })
})

describe('live backend integration', () => {
  it('GET /health returns a ready index', async () => {
    const h = await getHealth()
    expect(h.collection_ready).toBe(true)
    expect(h.points).toBeGreaterThan(0)
    expect(h.vector_size).toBeGreaterThan(0)
  })

  it('GET /collections returns cosine + a point count', async () => {
    const c = await getCollections()
    expect(c.exists).toBe(true)
    expect(c.distance).toBe('Cosine')
  })

  it('POST /search returns page hits with images', async () => {
    const r = await search({ query: 'net interest income', limit: 3 })
    expect(r.hits.length).toBeGreaterThan(0)
    for (const hit of r.hits) {
      expect(hit.image.startsWith('data:image/jpeg;base64,')).toBe(true)
      expect(hit.page_number).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(hit.score)).toBe(true)
    }
  })

  it('POST /chat enforces the 2000-char limit with a 422 validation error', async () => {
    await expect(chat({ question: 'a'.repeat(2001) })).rejects.toMatchObject({
      kind: 'validation',
      status: 422,
    })
  })

  it('POST /chat rejects an empty question', async () => {
    await expect(chat({ question: '' })).rejects.toMatchObject({ kind: 'validation', status: 422 })
  })

  it('POST /chat top_k above 20 is a 422', async () => {
    await expect(chat({ question: 'net interest income', top_k: 21 })).rejects.toMatchObject({
      status: 422,
    })
  })

  it('reports an aborted request as aborted, not as a network failure', async () => {
    const controller = new AbortController()
    const promise = chat({ question: 'net interest income' }, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ kind: 'aborted' })
  })
})
