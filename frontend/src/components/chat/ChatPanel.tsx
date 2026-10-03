import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Check, Cpu, Loader2, RotateCcw, Send, Square } from 'lucide-react'

import { useChat } from '@/hooks/useChat'
import { useHealth } from '@/hooks/useHealth'
import { formatLatency, provenanceLine, type ChatProgress, type ChatTurn } from '@/lib/chat'
import { formatPage, formatScore } from '@/lib/citations'
import { DOCUMENT } from '@/lib/document'
import { LIMITS } from '@/types/api'
import { AnswerMarkdown } from '@/components/chat/AnswerMarkdown'
import { ProviderSelect } from '@/components/chat/ProviderSelect'

/** Ticking clock for the in-flight request. Frozen when inactive. */
function useElapsed(active: boolean): number {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    if (!active) return
    const t0 = performance.now()
    setMs(0)
    const id = setInterval(() => setMs(performance.now() - t0), 100)
    return () => clearInterval(id)
  }, [active])
  return Math.round(ms)
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The Self-RAG chat panel.
 *
 * Rendered twice: inside the dark band on the landing page, and on /chat. One
 * implementation, so the two cannot drift.
 *
 * Everything shown is measured or returned by the backend. The mock in
 * ui.html:337-370 is deliberately not reproduced:
 *   - "AUREUS RAG v4.2" / "Dense/Sparse Hybrid" -> real models from /health
 *   - "SEC 10-K Synced"                          -> real collection + point count
 *   - "Latency: 32ms"                            -> real client-side measurement
 *   - source pills for transcripts / Bloomberg /
 *     custody ledgers                            -> removed; only the indexed
 *                                                  PDF exists
 * There are no placeholder messages, so the panel opens empty.
 */
export function ChatPanel({ className = '' }: { className?: string }) {
  const { data: health, isError: healthError } = useHealth()
  const { turns, pending, send, clear, cancel } = useChat()
  const [draft, setDraft] = useState('')
  const streamRef = useRef<HTMLDivElement>(null)
  const textareaId = useId()

  const ready = Boolean(health?.collection_ready) && (health?.points ?? 0) > 0
  const canSend = ready && !pending && draft.trim().length > 0
  const overLimit = draft.length > LIMITS.questionMaxLength
  const elapsed = useElapsed(pending)
  const lastLatency = [...turns].reverse().find((t) => t.elapsedMs != null)?.elapsedMs ?? null

  // Keep the newest turn in view as the transcript grows.
  useEffect(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  const submit = () => {
    if (!canSend) return
    const q = draft
    setDraft('')
    void send(q)
  }

  return (
    <div
      data-testid="chat-panel"
      className={`max-w-[880px] mx-auto bg-noir-light rounded-2xl border border-gold/30 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col ${className}`}
    >
      {/* 1. Top bar — real pipeline identity, not a version string */}
      <div className="px-5 py-3.5 bg-noir border-b border-noir-border flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 bg-noir-surface px-2.5 py-1 rounded-lg border border-white/10 text-ivory">
            <Cpu className="w-3.5 h-3.5 text-gold" aria-hidden />
            <span className="font-semibold">{health?.llm_model ?? 'model unavailable'}</span>
            <span className="text-ivory/40 text-[10px]">
              {health?.vector_size != null ? `${health.vector_size}-dim` : 'embedder unknown'}
            </span>
          </div>
          {/* Provider list and current provider both come from /health, so this
              cannot claim a provider the backend is not actually using. */}
          <ProviderSelect
            active={health?.llm_provider}
            options={health?.llm_providers ?? []}
            disabled={pending || healthError}
          />
          <div className="flex items-center space-x-1.5 text-emerald-400 text-[11px]">
            <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-400' : 'bg-gold'}`} />
            <span>
              {healthError
                ? 'Backend unreachable'
                : health?.collection
                  ? `${health.collection} · ${health.points ?? 0} pages`
                  : 'Checking index…'}
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-ivory/60">
          <span className="text-[11px]">
            Last answer:{' '}
            <strong className="text-gold font-normal">
              {lastLatency == null ? '—' : formatLatency(lastLatency)}
            </strong>
          </span>
          {turns.length > 0 ? (
            <button
              onClick={clear}
              className="hover:text-ivory text-ivory/50 flex items-center space-x-1 transition-colors text-[11px]"
              type="button"
            >
              <RotateCcw className="w-3 h-3" aria-hidden />
              <span>Clear</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* 2. Real source line. Not pills — only one document is indexed. */}
      <div className="px-5 py-2.5 bg-noir-surface/60 border-b border-noir-border flex items-center gap-2 overflow-x-auto text-[11px] font-mono no-scrollbar">
        <span className="text-ivory/40 uppercase tracking-wider text-[10px] shrink-0">Source</span>
        <span className="px-2.5 py-1 rounded-full bg-gold/20 text-gold-light border border-gold/40 whitespace-nowrap">
          {DOCUMENT.filename}
        </span>
        <span className="text-ivory/40 whitespace-nowrap">·</span>
        {/* The embedder that produced the page vectors, from /health. */}
        <span className="text-ivory/50 whitespace-nowrap">{health?.embed_model ?? 'embedder unknown'}</span>
        <span className="text-ivory/40 whitespace-nowrap">·</span>
        <Link to="/document" className="text-ivory/70 hover:text-gold transition-colors whitespace-nowrap">
          open reader
        </Link>
      </div>

      {/* 3. Transcript */}
      <div
        ref={streamRef}
        role="log"
        aria-live="polite"
        aria-label="Chat transcript"
        data-testid="chat-stream"
        className="p-5 sm:p-7 space-y-6 max-h-[560px] overflow-y-auto"
      >
        {turns.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-ivory/45 text-sm font-sans max-w-md mx-auto">
              Ask a question about the {DOCUMENT.filename.replace('.pdf', '')} annual report. Answers are
              grounded in retrieved pages and carry page citations — and are refused when the pages do
              not support them.
            </p>
            {!ready ? (
              <p className="mt-4 text-[11px] font-mono text-gold/70">
                {healthError ? 'Backend unreachable — the panel will enable once it responds.' : 'Waiting for the index…'}
              </p>
            ) : null}
          </div>
        ) : (
          turns.map((turn) => <Turn key={turn.id} turn={turn} elapsed={elapsed} />)
        )}
      </div>

      {/* 4. Composer */}
      <div className="px-5 py-4 bg-noir border-t border-noir-border">
        <label htmlFor={textareaId} className="sr-only">
          Ask a question about the indexed document
        </label>
        <textarea
          id={textareaId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          maxLength={LIMITS.questionMaxLength}
          disabled={!ready}
          placeholder={
            ready
              ? 'Ask about the annual report…'
              : healthError
                ? 'Backend unreachable'
                : 'Waiting for the index…'
          }
          className="w-full bg-transparent border-0 text-ivory placeholder-ivory/35 text-xs sm:text-sm font-sans focus:ring-0 resize-none p-1 disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-3 mt-2">
          <span
            className={`text-[10px] font-mono ${overLimit ? 'text-red-400' : 'text-ivory/30'}`}
            aria-live="polite"
          >
            {draft.length > LIMITS.questionMaxLength - 200
              ? `${draft.length} / ${LIMITS.questionMaxLength}`
              : 'Enter to send · Shift+Enter for a new line'}
          </span>
          <div className="flex items-center gap-2">
            {pending ? (
              <button
                onClick={cancel}
                type="button"
                className="px-3 py-1.5 rounded-lg border border-white/15 text-ivory/70 hover:text-ivory hover:border-gold/40 text-xs flex items-center gap-1.5 transition-colors"
              >
                <Square className="w-3 h-3" aria-hidden />
                <span>Cancel</span>
              </button>
            ) : null}
            <button
              onClick={submit}
              disabled={!canSend}
              type="button"
              className="px-4 py-1.5 rounded-lg bg-gold hover:bg-gold-light text-noir font-semibold text-xs flex items-center gap-1.5 shadow-md transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3" aria-hidden />
              <span>Ask</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Turn({ turn, elapsed }: { turn: ChatTurn; elapsed: number }) {
  if (turn.role === 'user') {
    return (
      <div className="flex items-start space-x-3.5 justify-end" data-testid="chat-user">
        <div className="max-w-[85%] bg-noir-surface border border-white/10 text-ivory p-4 rounded-2xl rounded-tr-none shadow-sm">
          <div className="text-[10px] font-mono text-gold mb-1">QUESTION</div>
          <p className="text-sm font-sans leading-relaxed text-ivory/95 whitespace-pre-wrap">{turn.question}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center text-xs font-mono font-bold text-gold shrink-0">
          YOU
        </div>
      </div>
    )
  }

  if (turn.pending) {
    const latest = turn.progress[turn.progress.length - 1]
    return (
      <div className="flex items-start space-x-3.5" data-testid="chat-thinking">
        <div className="w-8 h-8 rounded-full bg-noir border border-gold flex items-center justify-center text-gold shrink-0 mt-1 shadow-sm">
          <Cpu className="w-4 h-4" aria-hidden />
        </div>
        <div className="max-w-[92%] sm:max-w-[88%] rounded-2xl bg-noir border border-white/10 px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] font-mono text-gold">
            <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" aria-hidden />
            <span aria-live="polite">{latest?.message ?? 'Running the retrieval pipeline'}</span>
            <span className="text-ivory/40 ml-auto tabular-nums">{formatClock(elapsed)}</span>
          </div>
          <StageProgress progress={turn.progress} />
        </div>
      </div>
    )
  }

  if (turn.error) {
    return (
      <div className="flex items-start space-x-3.5" data-testid="chat-error">
        <div className="w-8 h-8 rounded-full bg-noir border border-red-500/50 flex items-center justify-center shrink-0 mt-1">
          <AlertCircle className="w-4 h-4 text-red-400" aria-hidden />
        </div>
        <div className="max-w-[92%] sm:max-w-[88%] rounded-2xl bg-noir border border-red-500/25 px-5 py-4">
          <div className="text-[11px] font-mono text-red-300 mb-1">
            {turn.error.kind === 'aborted' ? 'CANCELLED' : 'REQUEST FAILED'}
          </div>
          <p className="text-sm font-sans text-ivory/80">{turn.error.userMessage}</p>
        </div>
      </div>
    )
  }

  const res = turn.response
  if (!res) return null

  return (
    <div className="flex items-start space-x-3.5" data-testid="chat-answer">
      <div className="w-8 h-8 rounded-full bg-noir border border-gold flex items-center justify-center text-gold shrink-0 mt-1 shadow-sm">
        <Cpu className="w-4 h-4" aria-hidden />
      </div>
      <div className="max-w-[92%] sm:max-w-[88%] space-y-3.5">
        {/* Citation chips are also inline in the prose; this is the index. */}
        {res.citations.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-ivory/40 uppercase tracking-wider">Pages</span>
            {res.citations.map((c) => (
              <span
                key={`${c.doc_id}-${c.page_number}`}
                className="citation-chip"
                data-testid="page-index-chip"
              >
                {formatPage(c.page_number)}
                {/* Spaces inside the string, not on a flex gap — see
                    AnswerMarkdown. Otherwise "p.30" + "0.518" reads as
                    "p.300.518". */}
                <span className="citation-chip-score"> · {formatScore(c.score)}</span>
              </span>
            ))}
          </div>
        ) : null}

        <div className="bg-noir p-5 rounded-2xl border border-white/10 text-ivory">
          <AnswerMarkdown answer={res.answer} citations={res.citations} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-ivory/40">
          <span className={res.supported ? 'text-emerald-400/80' : 'text-gold/80'}>
            {res.supported ? 'GROUNDED' : 'REFUSED'}
          </span>
          <span>{provenanceLine(res)}</span>
          {turn.elapsedMs != null ? <span>{formatLatency(turn.elapsedMs)}</span> : null}
        </div>
      </div>
    </div>
  )
}

const STAGE_LABELS: Record<ChatProgress['stage'], string> = {
  retrieve: 'Retrieve pages',
  grade: 'Check relevance',
  rewrite_query: 'Refine query',
  generate: 'Generate answer',
  self_check: 'Verify grounding',
}

function progressDetail(item: ChatProgress): string | null {
  const meta = item.meta
  if (!meta) return null
  if (item.stage === 'retrieve') {
    const pages = Array.isArray(meta.pages) ? meta.pages : []
    const labels = pages
      .map((page) => {
        if (!page || typeof page !== 'object') return null
        const value = page as { page_number?: unknown; score?: unknown }
        return typeof value.page_number === 'number' && typeof value.score === 'number'
          ? `p${value.page_number} · ${value.score.toFixed(3)}`
          : null
      })
      .filter((value): value is string => value !== null)
    return labels.length > 0 ? labels.join('  ') : null
  }
  if (item.stage === 'rewrite_query' && typeof meta.query === 'string') return meta.query
  if (item.stage === 'generate' && typeof meta.pages === 'number') return `${meta.pages} pages supplied`
  return null
}

function StageProgress({ progress }: { progress: ChatProgress[] }) {
  return (
    <ol
      className="mt-3 space-y-1.5 border-l border-gold/25 pl-3"
      aria-label="RAG pipeline progress"
      data-testid="pipeline-progress"
    >
      {progress.map((item, index) => {
        const detail = progressDetail(item)
        return (
          <li
            key={item.id}
            data-testid={`stage-${item.stage}-${index}`}
            className="relative text-[10px] font-mono text-ivory/65"
          >
            <span className="absolute -left-[19px] top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-noir">
              {item.status === 'complete' ? (
                <Check className="h-2.5 w-2.5 text-emerald-400" aria-hidden />
              ) : (
                <Loader2 className="h-2.5 w-2.5 animate-spin text-gold" aria-hidden />
              )}
            </span>
            <span className={item.status === 'running' ? 'text-gold' : 'text-ivory/65'}>
              {STAGE_LABELS[item.stage]}
            </span>
            <span className="ml-2 text-ivory/35">{item.status === 'complete' ? 'done' : 'in progress'}</span>
            {detail ? <span className="mt-0.5 block truncate text-ivory/35">{detail}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}
