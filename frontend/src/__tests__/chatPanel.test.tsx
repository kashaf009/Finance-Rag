import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import { ChatPanel } from '@/components/chat/ChatPanel'
import { queryClient } from '@/lib/queryClient'
import { DEGRADED_HEALTH, OK_HEALTH, jsonResponse } from '@/test-utils/render'
import type { ChatResponse, ChatStageEvent, HealthResponse } from '@/types/api'
import { DOCUMENT } from '@/lib/document'
import * as citations from '@/lib/citations'

/** A real answer captured from the live backend during preflight. */
const REAL_ANSWER: ChatResponse = {
  question: 'What was net interest income in 2023?',
  query: 'net interest income 2023',
  answer:
    'In 2023, net interest income was **€1,439,788 thousand** [p102] ' +
    '(reported as **€1,439.8 million** [p2] or **€1,440 million** rounded [p30]).',
  supported: true,
  rewrites: 0,
  pages_considered: 5,
  citations: [
    { doc_id: 'JPM_SE_Annual_2023_140', page_number: 102, score: 0.4998, image: 'data:image/jpeg;base64,AAA' },
    { doc_id: 'JPM_SE_Annual_2023_140', page_number: 2, score: 0.5051, image: 'data:image/jpeg;base64,BBB' },
    { doc_id: 'JPM_SE_Annual_2023_140', page_number: 30, score: 0.5183, image: 'data:image/jpeg;base64,CCC' },
  ],
  trace: [
    { node: 'retrieve', ok: true },
    { node: 'grade', ok: true },
    { node: 'generate', ok: true },
    { node: 'self_check', ok: true },
  ],
}

/** A refusal, as returned when the pages do not support an answer. */
const REFUSAL: ChatResponse = {
  ...REAL_ANSWER,
  answer:
    'I could not find the information in the indexed pages of this document.',
  supported: false,
  rewrites: 2,
  citations: [],
}

function renderPanel() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChatPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * Stubs /health and /chat/stream. `chatImpl` decides how the POST resolves so tests
 * can hold a request open or reject it.
 */
function stub(
  chatImpl: (init: RequestInit) => Promise<Response>,
  health: HealthResponse | Error = OK_HEALTH,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url.endsWith('/health')) {
      if (health instanceof Error) throw health
      return jsonResponse(health)
    }
    if (url.endsWith('/chat/stream')) return chatImpl(init)
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

type StreamEvent = ChatStageEvent | { type: 'complete'; response: ChatResponse }

function sseFrame(event: StreamEvent): Uint8Array {
  const encoder = new TextEncoder()
  const { type, ...payload } = event
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
}

function streamResponse(events: StreamEvent[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(sseFrame(event))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function controlledStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
  return {
    response,
    send(event: StreamEvent) {
      controller?.enqueue(sseFrame(event))
    },
    close() {
      controller?.close()
    },
  }
}

const stage = (event: Omit<ChatStageEvent, 'type'>): ChatStageEvent => ({ type: 'stage', ...event })

const okChat = (body: ChatResponse) => async () =>
  streamResponse([
    stage({ stage: 'retrieve', status: 'running', message: 'Retrieving relevant pages', step: 0 }),
    stage({
      stage: 'retrieve',
      status: 'complete',
      message: 'Retrieved 3 relevant pages',
      step: 1,
      meta: { hits: 3, pages: [{ page_number: 102, score: 0.5 }] },
    }),
    stage({ stage: 'grade', status: 'running', message: 'Checking page relevance', step: 1 }),
    stage({ stage: 'grade', status: 'complete', message: 'Pages passed the relevance check', step: 2 }),
    stage({ stage: 'generate', status: 'running', message: 'Generating a grounded answer', step: 2 }),
    stage({ stage: 'generate', status: 'complete', message: 'Answer drafted from 5 pages', step: 3 }),
    stage({ stage: 'self_check', status: 'running', message: 'Verifying the answer against the pages', step: 3 }),
    stage({ stage: 'self_check', status: 'complete', message: 'Answer verified against the source pages', step: 4 }),
    { type: 'complete', response: body },
  ])

/** A /chat that never settles until its signal aborts, like the real fetch. */
const hangChat = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    )
  })

function panel() {
  return within(screen.getByTestId('chat-panel'))
}

function chatBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/chat/stream'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string))
}

beforeEach(() => {
  queryClient.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('panel identity comes from /health, not a hardcoded banner', () => {
  it('names the real model, dimension and collection', async () => {
    stub(okChat(REAL_ANSWER))
    renderPanel()

    await waitFor(() => {
      expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument()
    })
    expect(panel().getByText('1024-dim')).toBeInTheDocument()
    expect(panel().getByText('finance_pages · 139 pages')).toBeInTheDocument()
    expect(panel().getByText('gemini-embedding-2')).toBeTruthy()
  })

  it('never renders the mock version string, latency or source pills', async () => {
    stub(okChat(REAL_ANSWER))
    const { container } = renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    const text = container.textContent ?? ''
    // ui.html:337-370 fabrications.
    expect(text).not.toMatch(/AUREUS/i)
    expect(text).not.toMatch(/v4\.2/)
    expect(text).not.toMatch(/Dense\/Sparse Hybrid/i)
    expect(text).not.toMatch(/32ms/)
    expect(text).not.toMatch(/SEC 10-K Synced/i)
    expect(text).not.toMatch(/Earnings Transcripts/i)
    expect(text).not.toMatch(/Bloomberg/i)
    expect(text).not.toMatch(/Custody Ledgers/i)
  })

  it('shows no latency until a real request has been measured', async () => {
    stub(okChat(REAL_ANSWER))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    // "—" rather than a placeholder number.
    expect(panel().getByText('—')).toBeInTheDocument()
  })

  it('lists the one real source and nothing else', async () => {
    stub(okChat(REAL_ANSWER))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    expect(panel().getByText(DOCUMENT.filename)).toBeInTheDocument()
    expect(panel().getByRole('link', { name: /open reader/i })).toHaveAttribute('href', '/document')
  })
})

describe('sending a question', () => {
  it('posts the question verbatim and renders the grounded answer', async () => {
    const user = userEvent.setup()
    const fetchMock = stub(okChat(REAL_ANSWER))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'What was net interest income in 2023?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))

    await waitFor(() => expect(screen.getByTestId('chat-answer')).toBeInTheDocument())
    expect(chatBodies(fetchMock)).toEqual([{ question: 'What was net interest income in 2023?' }])

    const answer = within(screen.getByTestId('chat-answer'))
    expect(answer.getByText('GROUNDED')).toBeInTheDocument()
    expect(answer.getByText('grounded · 5 pages · 0 rewrites')).toBeInTheDocument()
    expect(answer.getByText('€1,439,788 thousand')).toBeInTheDocument()
  })

  it('shows live pipeline stages with a real clock and a cancel action while pending', async () => {
    const user = userEvent.setup()
    const stream = controlledStream()
    stub(async () => stream.response)
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'How much was net interest income?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))

    const thinking = await screen.findByTestId('chat-thinking')
    expect(thinking).toBeInTheDocument()
    expect(within(thinking).getByText('Connecting to the retrieval pipeline')).toBeInTheDocument()
    expect(panel().getByRole('button', { name: /cancel/i })).toBeInTheDocument()

    stream.send(stage({ stage: 'retrieve', status: 'complete', message: 'Retrieved 3 relevant pages', step: 1 }))
    await waitFor(() => expect(screen.getByText('Retrieved 3 relevant pages')).toBeInTheDocument())
    stream.send(stage({ stage: 'grade', status: 'running', message: 'Checking page relevance', step: 1 }))
    await waitFor(() => expect(screen.getByText('Check relevance')).toBeInTheDocument())
    stream.send({ type: 'complete', response: REAL_ANSWER })
    stream.close()
    await waitFor(() => expect(screen.getByTestId('chat-answer')).toBeInTheDocument())
    expect(screen.queryByTestId('chat-thinking')).not.toBeInTheDocument()
  })

  it('clears the transcript and the measured latency', async () => {
    const user = userEvent.setup()
    stub(okChat(REAL_ANSWER))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'net interest income?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    await waitFor(() => expect(screen.getByTestId('chat-answer')).toBeInTheDocument())

    await user.click(panel().getByRole('button', { name: /clear/i }))
    expect(screen.queryByTestId('chat-user')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-answer')).not.toBeInTheDocument()
    expect(panel().getByText('—')).toBeInTheDocument()
  })

  it('updates only the clock while pending and stops its timer on completion', async () => {
    const user = userEvent.setup()
    const stream = controlledStream()
    let requests = 0
    stub(async () => ++requests === 1 ? okChat(REAL_ANSWER)() : stream.response)
    const parseMarkers = vi.spyOn(citations, 'linkifyMarkers')
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())
    await user.type(panel().getByRole('textbox'), 'net income?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    await screen.findByTestId('chat-answer')

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const stopInterval = vi.spyOn(globalThis, 'clearInterval')
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await user.type(panel().getByRole('textbox'), 'total assets?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    const thinking = await screen.findByTestId('chat-thinking')
    const clockTimer = intervals.mock.results[intervals.mock.calls.findIndex((call) => call[1] === 100)].value
    expect(within(thinking).getByText('0:00')).toBeInTheDocument()
    const parseCount = parseMarkers.mock.calls.length
    now = 2500
    act(() => vi.advanceTimersByTime(2500))
    expect(within(thinking).getByText('0:02')).toBeInTheDocument()
    expect(parseMarkers).toHaveBeenCalledTimes(parseCount)

    stream.send({ type: 'complete', response: REAL_ANSWER })
    stream.close()
    await waitFor(() => expect(screen.queryByTestId('chat-thinking')).not.toBeInTheDocument())
    expect(stopInterval).toHaveBeenCalledWith(clockTimer)
  })

  it('sends on Enter but not on Shift+Enter', async () => {
    const user = userEvent.setup()
    const fetchMock = stub(okChat(REAL_ANSWER))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    const box = panel().getByRole('textbox')
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect((box as HTMLTextAreaElement).value).toBe('line one\nline two')
    expect(chatBodies(fetchMock)).toHaveLength(0)

    await user.type(box, '{Enter}')
    await waitFor(() => expect(chatBodies(fetchMock)).toHaveLength(1))
    expect(chatBodies(fetchMock)[0].question).toBe('line one\nline two')
  })
})

describe('citation chips', () => {
  it('renders one chip per page with its real cosine score', async () => {
    const user = userEvent.setup()
    stub(okChat(REAL_ANSWER))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'net interest income?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    await waitFor(() => expect(screen.getByTestId('chat-answer')).toBeInTheDocument())

    // Inline prose chips only; the "Pages" index row is asserted separately.
    const chips = [...document.querySelectorAll('.citation-chip:not([data-testid="page-index-chip"])')]
    expect(chips.map((c) => c.textContent)).toEqual(['p.102 · 0.500', 'p.2 · 0.505', 'p.30 · 0.518'])
    expect(chips.every((c) => (c as HTMLElement).dataset.cited === 'yes')).toBe(true)
  })

  it('separates page from score so p.30 + 0.518 cannot read as p.300.518', async () => {
    const user = userEvent.setup()
    stub(okChat(REAL_ANSWER))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'net interest income?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    await waitFor(() => expect(screen.getByTestId('chat-answer')).toBeInTheDocument())

    // Both renderers are affected: the inline prose chips and the index row.
    const inline = [...document.querySelectorAll('.citation-chip')].find((c) =>
      c.textContent?.startsWith('p.30'),
    )
    expect(inline?.textContent).toBe('p.30 · 0.518')
    expect(inline?.textContent).not.toMatch(/p\.300\.518/)

    const index = [...screen.getAllByTestId('page-index-chip')].map((c) => c.textContent)
    expect(index).toEqual(['p.102 · 0.500', 'p.2 · 0.505', 'p.30 · 0.518'])
    expect(index.some((t) => /p\.\d+\d\.\d/.test(t ?? ''))).toBe(false)
  })

  it('marks a referenced page with no returned citation instead of hiding it', async () => {
    const user = userEvent.setup()
    // The answer names p24, which the backend does not return a citation for.
    stub(
      okChat({
        ...REAL_ANSWER,
        answer: 'Net interest income was €1,684 million [p24, p30].',
        citations: [REAL_ANSWER.citations[2]],
      }),
    )
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'net interest income?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    await waitFor(() => expect(screen.getByTestId('chat-answer')).toBeInTheDocument())

    const chips = [...document.querySelectorAll('.citation-chip')] as HTMLElement[]
    const unbacked = chips.find((c) => c.dataset.cited === 'no')
    expect(unbacked?.textContent).toBe('p.24')
    expect(chips.find((c) => c.dataset.cited === 'yes')?.textContent).toBe('p.30 · 0.518')
  })

  it('leaves ordinary markdown links alone', async () => {
    const user = userEvent.setup()
    stub(
      okChat({
        ...REAL_ANSWER,
        answer: 'See the [Key Figures](https://example.com/table) table on page 4 [p30].',
      }),
    )
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'key figures?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    await waitFor(() => expect(screen.getByTestId('chat-answer')).toBeInTheDocument())

    const link = within(screen.getByTestId('chat-answer')).getByRole('link', { name: /Key Figures/i })
    expect(link).toHaveAttribute('href', 'https://example.com/table')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})

describe('refusals and failures', () => {
  it('branches on supported rather than string-matching the answer', async () => {
    const user = userEvent.setup()
    stub(okChat(REFUSAL))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'what is the ceo email?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    await waitFor(() => expect(screen.getByTestId('chat-answer')).toBeInTheDocument())

    const answer = within(screen.getByTestId('chat-answer'))
    expect(answer.getByText('REFUSED')).toBeInTheDocument()
    expect(answer.getByText('no supporting pages found')).toBeInTheDocument()
    expect(document.querySelectorAll('.citation-chip')).toHaveLength(0)
  })

  it('surfaces a backend error with its real message', async () => {
    const user = userEvent.setup()
    stub(async () => jsonResponse({ detail: 'retrieval exploded' }, 502))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'net interest income?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))

    const err = await screen.findByTestId('chat-error')
    expect(within(err).getByText('REQUEST FAILED')).toBeInTheDocument()
    expect(within(err).getByText('retrieval exploded')).toBeInTheDocument()
  })

  it('reports a real abort as cancelled, with no answer rendered', async () => {
    const user = userEvent.setup()
    stub(hangChat)
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    await user.type(panel().getByRole('textbox'), 'net interest income?')
    await user.click(panel().getByRole('button', { name: /^Ask$/ }))
    await screen.findByTestId('chat-thinking')

    await user.click(panel().getByRole('button', { name: /cancel/i }))

    const err = await screen.findByTestId('chat-error')
    expect(within(err).getByText('CANCELLED')).toBeInTheDocument()
    expect(within(err).getByText('Request cancelled.')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-answer')).not.toBeInTheDocument()
  })
})

describe('degraded states', () => {
  it('disables the composer when the index is empty', async () => {
    stub(okChat(REAL_ANSWER), DEGRADED_HEALTH)
    renderPanel()

    await waitFor(() => expect(panel().getByText(/0 pages/)).toBeInTheDocument())
    const box = panel().getByRole('textbox') as HTMLTextAreaElement
    expect(box).toBeDisabled()
    expect(panel().getByRole('button', { name: /^Ask$/ })).toBeDisabled()
  })

  it('opens empty with no placeholder conversation', async () => {
    stub(okChat(REAL_ANSWER))
    const { container } = renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    expect(screen.queryByTestId('chat-user')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-answer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-thinking')).not.toBeInTheDocument()
    expect(container.textContent).toMatch(/Ask a question about/i)
  })

  it('disables the composer when the backend is unreachable', async () => {
    stub(okChat(REAL_ANSWER), new TypeError('fetch failed'))
    renderPanel()

    await waitFor(() => expect(panel().getByText('Backend unreachable')).toBeInTheDocument(), {
      timeout: 15_000,
    })
    expect(panel().getByRole('textbox')).toBeDisabled()
  })
})

describe('accessibility', () => {
  it('exposes the transcript as a live log and labels the composer', async () => {
    stub(okChat(REAL_ANSWER))
    renderPanel()
    await waitFor(() => expect(panel().getByText('gemini-2.5-flash')).toBeInTheDocument())

    const stream = screen.getByTestId('chat-stream')
    expect(stream).toHaveAttribute('role', 'log')
    expect(stream).toHaveAttribute('aria-live', 'polite')
    expect(panel().getByRole('textbox')).toHaveAccessibleName(/ask a question/i)
  })
})
