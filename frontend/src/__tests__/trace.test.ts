import { describe, expect, it } from 'vitest'
import { parseTrace, summarizeTrace, traceHeadline } from '@/lib/trace'
import type { ChatResponse } from '@/types/api'

import supportedChat from './fixtures/chat-supported.json'
import refusalChat from './fixtures/chat-refusal.json'

const SUPPORTED = supportedChat as ChatResponse
const REFUSAL = refusalChat as ChatResponse

describe('parseTrace — real supported trace (4 nodes)', () => {
  const steps = parseTrace(SUPPORTED.trace)

  it('parses every node', () => {
    expect(steps).toHaveLength(4)
    expect(steps.map((s) => s.node)).toEqual(['retrieve', 'grade', 'generate', 'self_check'])
  })

  it('does not invent a grade_documents node', () => {
    // The backend key is `grade`, not `grade_documents`.
    expect(steps.some((s) => s.rawNode === 'grade_documents')).toBe(false)
  })

  it('extracts hit counts from retrieve', () => {
    expect(steps[0].detail).toContain('5 pages')
    expect(steps[0].ok).toBeNull()
  })

  it('carries the grade verdict and reply', () => {
    expect(steps[1].ok).toBe(true)
    expect(steps[1].detail).toMatch(/net interest income/i)
  })

  it('carries the self-check verdict', () => {
    expect(steps[3].ok).toBe(true)
  })

  it('leaves the generate verdict unknown, deferring to the response flag', () => {
    expect(steps[2].ok).toBeNull()
    expect(steps[2].detail).toMatch(/5 pages · \d+ chars/)
    expect(SUPPORTED.supported).toBe(true)
  })
})

describe('parseTrace — real refusal trace (10 nodes, 2 rewrites)', () => {
  const steps = parseTrace(REFUSAL.trace)

  it('parses all ten nodes', () => {
    expect(steps).toHaveLength(10)
  })

  it('shows the retrieve/grade/rewrite/retrieve retry cycle', () => {
    expect(steps.map((s) => s.node)).toEqual([
      'retrieve',
      'grade',
      'rewrite_query',
      'retrieve',
      'grade',
      'rewrite_query',
      'retrieve',
      'grade',
      'generate',
      'self_check',
    ])
  })

  it('marks every grade as irrelevant', () => {
    const grades = steps.filter((s) => s.node === 'grade')
    expect(grades).toHaveLength(3)
    expect(grades.every((g) => g.ok === false)).toBe(true)
  })

  it('does not claim success on the refusal generate node', () => {
    // Real refusal trace emits {"node":"generate","pages":5,"chars":71} with
    // NO `outcome` key, so the parser must report "unknown", not "succeeded".
    const gen = steps.find((s) => s.node === 'generate')!
    expect(gen.ok).toBeNull()
    expect(gen.detail).toBe('5 pages · 71 chars')
    // The verdict comes from the response flag, not from this node.
    expect(REFUSAL.supported).toBe(false)
  })

  it('reports an explicit outcome:"refusal" when the backend does send one', () => {
    const [step] = parseTrace([{ node: 'generate', pages: 3, outcome: 'refusal' }])
    expect(step.ok).toBe(false)
    expect(step.detail).toBe('refused · 3 pages')
  })

  it('trims long grader replies to one line', () => {
    for (const s of steps) expect(s.detail).not.toMatch(/\n/)
  })
})

describe('parseTrace — defensive behaviour', () => {
  it('returns [] for missing or non-array input', () => {
    expect(parseTrace(undefined)).toEqual([])
    expect(parseTrace(null)).toEqual([])
    expect(parseTrace('nope' as unknown as ChatResponse['trace'])).toEqual([])
  })

  it('survives a null entry without throwing', () => {
    const steps = parseTrace([null as never, { node: 'retrieve', hits: 3 }])
    expect(steps).toHaveLength(2)
    expect(steps[0].node).toBe('unknown')
    expect(steps[1].node).toBe('retrieve')
  })

  it('keeps an unknown node instead of dropping it', () => {
    const steps = parseTrace([{ node: 'some_future_node', foo: 1 }])
    expect(steps).toHaveLength(1)
    expect(steps[0].node).toBe('unknown')
    expect(steps[0].rawNode).toBe('some_future_node')
  })

  it('handles non-string node values', () => {
    const steps = parseTrace([{ node: 42, hits: 'x' }])
    expect(steps[0].node).toBe('unknown')
    expect(steps[0].rawNode).toBe('42')
  })

  it('falls back through reason -> reply -> query for grade', () => {
    expect(parseTrace([{ node: 'grade', reason: 'because r' }])[0].detail).toBe('because r')
    expect(parseTrace([{ node: 'grade', reply: 'because q' }])[0].detail).toBe('because q')
    expect(parseTrace([{ node: 'grade' }])[0].detail).toBe('')
  })

  it('truncates over-long details with an ellipsis', () => {
    const long = 'x'.repeat(500)
    const step = parseTrace([{ node: 'grade', reply: long }])[0]
    expect(step.detail).toHaveLength(200)
    expect(step.detail.endsWith('…')).toBe(true)
  })
})

describe('summarizeTrace / traceHeadline', () => {
  it('summarises the supported run', () => {
    const steps = parseTrace(SUPPORTED.trace)
    const sum = summarizeTrace(steps, SUPPORTED)
    expect(sum).toMatchObject({ steps: 4, rewrites: 0, pages: 5 })
    expect(traceHeadline(SUPPORTED, steps)).toBe('4 steps · 0 rewrites · 5 pages')
  })

  it('summarises the refusal run and marks it refused', () => {
    const steps = parseTrace(REFUSAL.trace)
    const sum = summarizeTrace(steps, REFUSAL)
    expect(sum).toMatchObject({ steps: 10, rewrites: 2, pages: 5 })
    expect(traceHeadline(REFUSAL, steps)).toBe('10 steps · 2 rewrites · refused')
  })

  it('uses singular wording correctly', () => {
    const res = { ...SUPPORTED, rewrites: 1, pages_considered: 1 }
    expect(traceHeadline(res, [parseTrace(SUPPORTED.trace)[0]])).toBe('1 step · 1 rewrite · 1 pages')
  })
})
