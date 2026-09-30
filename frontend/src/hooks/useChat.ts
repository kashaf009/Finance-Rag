import { useCallback, useMemo, useRef, useState } from 'react'

import { api, ApiError } from '@/lib/api'
import { nextExchangeId, type ChatTurn } from '@/lib/chat'

/**
 * In-memory transcript for the Self-RAG chat.
 *
 * State is deliberately volatile: no localStorage, no sessionStorage. A reload
 * or `clear()` discards everything, which matches the backend having no
 * session or history concept either.
 *
 * POST /chat blocks for the whole LangGraph run (19-34s measured) and the API
 * has no streaming, so exactly one request is in flight at a time and the
 * transcript cannot show partial tokens. A new send cancels the previous one.
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
  }
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
        const { data, elapsedMs } = await api.chat({ question: q }, ac.signal)
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
