// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, streamChat } from '@/lib/api'
import type { ChatResponse } from '@/types/api'

import supportedChat from './fixtures/chat-supported.json'

const response = supportedChat as ChatResponse

function sseResponse(raw: string, status = 200): Response {
  const encoder = new TextEncoder()
  const chunks = [raw.slice(0, 19), raw.slice(19, 47), raw.slice(47)]
  let index = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
      },
    }),
    {
      status,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /chat/stream SSE parsing', () => {
  it('reassembles split frames and returns the complete response', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse(
        [
          'event: stage\ndata: {"stage":"retrieve","status":"running","message":"Retrieving","step":0}\n\n',
          `event: complete\ndata: ${JSON.stringify({ response })}\n\n`,
        ].join(''),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: unknown[] = []

    const result = await streamChat({ question: 'net income' }, (event) => events.push(event))

    expect(result.data).toEqual(response)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(events).toEqual([
      {
        type: 'stage',
        stage: 'retrieve',
        status: 'running',
        message: 'Retrieving',
        step: 0,
      },
      { type: 'complete', response },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/chat\/stream$/),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('turns a streamed backend error into an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          'event: error\ndata: {"status":502,"kind":"pipeline","detail":"grade failed"}\n\n',
        ),
      ),
    )

    const promise = streamChat({ question: 'net income' }, () => {})

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      kind: 'pipeline',
      status: 502,
      detail: 'grade failed',
    })
  })
})
