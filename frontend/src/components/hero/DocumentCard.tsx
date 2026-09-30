import { ExternalLink, MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useIndexReady } from '@/hooks/useHealth'
import { usePreviewHit } from '@/hooks/usePreviewHit'
import { DOCUMENT, PREVIEW_QUERY, formatSize } from '@/lib/document'
import { formatPage, formatScore } from '@/lib/citations'
import { PagePreview } from '@/components/hero/PagePreview'

/**
 * The hero's right-hand document card, per ui.html:219-300.
 *
 * The mock showed a US SEC 10-K with a fabricated CIK, a fabricated chunk
 * number, a 0.984 cosine score, "1,536-dim Cohere Financial v3", a fake
 * provenance hash and invented financials. None of that survives here: the
 * card describes the document that is actually indexed, and the retrieval
 * figures below are whatever the backend really returns — including scores
 * around 0.46, which are what this index actually produces.
 */
export function DocumentCard() {
  const { points, ready, isPending: healthPending, isError: healthError } = useIndexReady()
  const { top, hits, scanning } = usePreviewHit()

  return (
    <div
      data-testid="document-card"
      className="relative w-full max-w-[500px] bg-white rounded-2xl border border-noir/15 shadow-float overflow-hidden p-6 sm:p-7"
    >
      {/* Scanner beam — only while the preview request is in flight, so the
          sweep means "retrieval is happening" rather than being decoration.
          The mock ran it forever, implying continuous page processing. */}
      {scanning && (
        <div className="scanner-beam absolute left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-gold to-transparent pointer-events-none z-20 shadow-[0_0_12px_#C9A45C]" />
      )}

      {/* Document identity — the real indexed file. */}
      <div className="border-b border-noir/15 pb-4 mb-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono tracking-widest uppercase font-semibold text-noir/50">
            J.P. Morgan SE · Annual Report 2023
          </span>
          <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-noir text-white">
            PDF
          </span>
        </div>
        <div className="mt-2.5 flex items-baseline justify-between gap-3">
          <div className="text-xs font-mono font-bold text-noir truncate">{DOCUMENT.filename}</div>
          <div className="text-[11px] font-mono text-noir/60 shrink-0">
            {formatSize(DOCUMENT.sizeBytes)}
          </div>
        </div>
        <div className="text-sm font-serif font-semibold text-noir mt-1">
          {healthError
            ? 'Backend unreachable'
            : healthPending
              ? 'Checking index…'
              : ready
                ? `Nearest indexed page for “${PREVIEW_QUERY}”`
                : 'Index is empty'}
        </div>
      </div>

      {/* Real retrieved page render, straight from the search response. */}
      <PagePreview
        image={top?.image ?? null}
        pageNumber={top?.page_number ?? 0}
        scanning={scanning}
        filename={DOCUMENT.filename}
        emptyReason={
          healthError ? 'no preview' : healthPending ? 'checking…' : 'no indexed pages'
        }
      />

      {/* Retrieval result — real page number and real cosine score. */}
      <div
        className={`mt-4 p-3 rounded-lg border border-gold/40 relative ${
          scanning ? 'chunk-active' : ''
        }`}
      >
        <div className="flex items-center justify-between text-[10px] font-mono text-gold-dark mb-1">
          <span className="font-bold flex items-center space-x-1">
            {scanning ? (
              <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-gold/40" />
            )}
            <span>{scanning ? 'RETRIEVING' : 'NEAREST PAGE'}</span>
          </span>
          {top && (
            <span className="bg-gold/20 px-1.5 py-0.5 rounded text-[9px]">
              Cosine {formatScore(top.score)}
            </span>
          )}
        </div>
        <p className="font-serif text-[12.5px] text-noir/80 leading-snug">
          {top ? (
            <>
              Page <strong className="text-noir font-bold">{formatPage(top.page_number)}</strong>{' '}
              returned for “{PREVIEW_QUERY}” at cosine similarity{' '}
              <strong className="text-noir font-bold">{formatScore(top.score)}</strong>.
            </>
          ) : scanning ? (
            'Querying the index for a representative page.'
          ) : (
            'No page retrieved.'
          )}
        </p>
      </div>

      {/* The real top-3 result set, page and score only. */}
      <div
        data-testid="retrieved-pages"
        className="mt-3 rounded-lg border border-noir/10 overflow-hidden bg-ivory/50"
      >
        <div className="bg-noir/5 px-3 py-1.5 text-[10px] font-mono font-semibold text-noir/70 flex justify-between">
          <span>RETRIEVED PAGES</span>
          <span>cosine</span>
        </div>
        <div className="divide-y divide-noir/5 text-[11px] font-mono">
          {hits.length > 0 ? (
            hits.map((hit, i) => (
              <div
                key={`${hit.doc_id}-${hit.page_number}-${i}`}
                className={`px-3 py-1.5 flex justify-between ${
                  i === 0 ? 'bg-gold/5' : ''
                }`}
              >
                <span className={i === 0 ? 'text-noir font-medium' : 'text-noir/70'}>
                  {formatPage(hit.page_number)}
                </span>
                <span className={i === 0 ? 'text-gold-dark font-bold' : 'text-noir/60'}>
                  {formatScore(hit.score)}
                </span>
              </div>
            ))
          ) : (
            <div className="px-3 py-1.5 text-noir/40">—</div>
          )}
        </div>
      </div>

      {/* Grounding footer — real collection, real metric. */}
      <div className="pt-3 mt-3 border-t border-noir/10 flex items-center justify-between text-[10px] font-mono text-noir/50">
        <span>
          {points != null ? `${points} pages indexed` : 'page count unavailable'} · Cosine
          distance
        </span>
        <Link
          to="/document"
          className="inline-flex items-center space-x-1 text-noir/70 hover:text-gold-dark font-semibold"
        >
          Reader <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* Ask the real question, which routes into the chat flow. */}
      <Link
        to="/chat"
        className="mt-3 w-full inline-flex items-center justify-center space-x-2 px-4 py-2.5 rounded-full border border-noir/20 text-noir text-xs font-semibold hover:border-gold/60 hover:shadow-gold-subtle transition-all duration-200"
      >
        <MessageSquare className="w-3.5 h-3.5 text-gold" />
        <span>Ask about this document</span>
      </Link>
    </div>
  )
}
