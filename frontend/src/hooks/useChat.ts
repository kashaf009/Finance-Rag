import { useCallback, useMemo, useRef, useState } from 'react'

import { api, ApiError } from '@/lib/api'
import { nextExchangeId, type ChatProgress, type ChatTurn } from '@/lib/chat'
import type { ChatStreamEvent } from '@/types/api'

/**
 * In-memory transcript for the Self-RAG chat.
 *
 * State is deliberately volatile: no localStorage, no sessionStorage. A reload
 * or `clear()` discards everything, which matches the backend having no
 * session or history concept either.
 *
 * POST /chat/stream keeps one request in flight and reports each completed
 * Self-RAG stage to the transcript. A new send cancels the previous one.
 */
export interface UseChat {
  turns: ChatTurn[]
  /** True while any turn is awaiting a response. */
  pending: boolean
  send: (question: string) => Promise<void>
  clear: () => void
  cancel: () => void
}

function userTurn(exchangeId: string, question: string): ChatTurn {
  return {
    id: `${exchangeId}:user`,
    exchangeId,
    role: 'user',
    question,
    response: null,
    elapsedMs: null,
    error: null,
    pending: true,
    progress: [],
  }
}

function assistantTurn(exchangeId: string, question: string): ChatTurn {
  return {
    id: `${exchangeId}:assistant`,
    exchangeId,
    role: 'assistant',
    question,
    response: null,
    elapsedMs: null,
    error: null,
    pending: true,
    progress: [
      {
        id: `${exchangeId}:stage-0`,
        stage: 'retrieve',
        status: 'running',
        message: 'Connecting to the retrieval pipeline',
      },
    ],
  }
}

function updateProgress(progress: ChatProgress[], event: ChatStreamEvent): ChatProgress[] {
  if (event.type !== 'stage') return progress
  const next = [...progress]
  const index = [...next]
    .map((item, i) => ({ item, i }))
    .reverse()
    .find(({ item }) => item.stage === event.stage && item.status === 'running')?.i

  const item: ChatProgress = {
    id: `${event.stage}-${event.step}`,
    stage: event.stage,
    status: event.status,
    message: event.message,
    meta: event.meta as Record<string, unknown> | undefined,
  }
  if (index == null) next.push(item)
  else next[index] = { ...next[index], ...item, id: next[index].id }
  return next
}

export function useChat(): UseChat {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  // Ref, not state: aborting must not re-render, and send() must not close
  // over a stale controller.
  const controllerRef = useRef<AbortController | null>(null)

  const abortInFlight = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const clear = useCallback(() => {
    abortInFlight()
    setTurns([])
  }, [abortInFlight])

  const send = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (q.length === 0) return

      // One request at a time; a new question supersedes the old one.
      abortInFlight()

      const exchangeId = nextExchangeId()
      const ac = new AbortController()
      controllerRef.current = ac

      const u = userTurn(exchangeId, q)
      const a = assistantTurn(exchangeId, q)
      setTurns((prev) => [...prev, u, a])

      const settle = (patch: Partial<ChatTurn>) =>
        setTurns((prev) => prev.map((t) => (t.id === u.id || t.id === a.id ? { ...t, ...patch } : t)))

      try {
        const { data, elapsedMs } = await api.streamChat(
          { question: q },
          (event) => {
            if (event.type === 'stage') {
              setTurns((prev) =>
                prev.map((turn) =>
                  turn.id === a.id ? { ...turn, progress: updateProgress(turn.progress, event) } : turn,
                ),
              )
            }
          },
          ac.signal,
        )
        settle({ pending: false, response: data, elapsedMs, error: null })
      } catch (err) {
        const apiErr =
          err instanceof ApiError ? err : new ApiError('network', (err as Error)?.message ?? 'Unknown error')
        settle({ pending: false, response: null, elapsedMs: null, error: apiErr })
      } finally {
        if (controllerRef.current === ac) controllerRef.current = null
      }
    },
    [abortInFlight],
  )

  const pending = useMemo(() => turns.some((t) => t.pending), [turns])

  return { turns, pending, send, clear, cancel: abortInFlight }
}
