import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText, X } from 'lucide-react'

import { ApiError, getDocumentPages, pageImageUrl } from '@/lib/api'
import { formatSize } from '@/lib/document'

/**
 * Reads the page renders the ingest already produced.
 *
 * It shows the JPEG files in `backend/storage/pages/`, not the PDF. There is no
 * PDF parsing here and no client-side page rasteriser: the renders exist, they
 * are the highest-resolution copy of the document the system holds, and
 * re-deriving them in the browser would be strictly worse.
 *
 * Note the resolution difference from citation chips. `/search` and `/chat`
 * run each page through a serve-time downscale to `llm_image_max_edge`, so a
 * citation thumbnail arrives at 559x768 for this document. These routes return
 * the original 1024x1408 file. Same page, not the same bytes — so this view is
 * sharper than the thumbnails in an answer, and is not presented as a copy of
 * them.
 *
 * Every number on screen comes from `GET /document/pages`. When that reports
 * `page_count: 0` the ingest has not run, and the honest thing to render is an
 * empty state naming that, not a plausible-looking count.
 */
export function PageReader() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['document-pages'],
    queryFn: ({ signal }) => getDocumentPages(signal),
    staleTime: Infinity,
  })
  const [openPage, setOpenPage] = useState<number | null>(null)

  // userMessage is the copy written for users; `message` is the internal one.
  // A failure here is not an empty ingest, so the two must read differently.
  const errorText =
    error instanceof ApiError
      ? error.userMessage
      : error instanceof Error && error.message
        ? error.message
        : 'Could not read the page inventory.'

  const pageCount = data?.page_count ?? 0
  // "1024 / 1408" as a CSS aspect-ratio, from the measured render.
  const pageRatio =
    data?.page_width && data?.page_height
      ? `${data.page_width} / ${data.page_height}`
      : null
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1)

  const close = useCallback(() => setOpenPage(null), [])
  const step = useCallback(
    (delta: number) =>
      setOpenPage((current) =>
        current === null ? current : Math.min(Math.max(current + delta, 1), pageCount),
      ),
    [pageCount],
  )

  // Keyboard nav only while the lightbox owns the screen, so arrows still
  // scroll the page normally in the grid.
  useEffect(() => {
    if (openPage === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowRight') step(1)
      if (event.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPage, close, step])

  return (
    <div className="on-noir relative flex-1 bg-noir text-ivory">
      <div className="relative z-10 mx-auto max-w-7xl px-6 pb-32 pt-32">
        {/* A div, not a <header>: the navbar already owns the page's only
            `banner` landmark and a second one is invalid. */}
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
            The indexed document
          </p>
          <h1 className="mt-4 font-serif text-4xl text-ivory sm:text-5xl">
            Every page, as rendered at ingest.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ivory/60">
            These are the exact files the retrieval index was built from — the same
            images the model reads. Not a re-parse of the PDF in your browser.
          </p>
        </div>

        <DocumentFacts data={data} />

        {isPending && <p className="mt-16 font-mono text-sm text-ivory/50">Reading the index…</p>}

        {isError && (
          <p className="mt-16 font-mono text-sm text-red-300/80">{errorText}</p>
        )}

        {!isPending && !isError && pageCount === 0 && (
          <div className="mt-16 max-w-xl border border-noir-border bg-noir-light p-8">
            <FileText className="h-6 w-6 text-gold" aria-hidden />
            <p className="mt-4 font-serif text-xl text-ivory">No pages on disk.</p>
            <p className="mt-2 text-sm leading-relaxed text-ivory/60">
              The backend reported zero rendered pages, so the ingest has not written{' '}
              <code className="font-mono text-ivory/80">backend/storage/pages/</code> yet.
              There is nothing to show, and inventing a page count would be worse than
              admitting it.
            </p>
          </div>
        )}

        {pageCount > 0 && (
          <ul className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {pages.map((page) => (
              <li key={page}>
                <button
                  type="button"
                  onClick={() => setOpenPage(page)}
                  className="group block w-full border border-noir-border bg-noir-light p-2 text-left transition-colors hover:border-gold/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                >
                  <span className="relative block w-full overflow-hidden bg-ivory-300">
                    <img
                      src={pageImageUrl(page)}
                      // 139 full-resolution renders is ~19MB. The browser fetches
                      // what is near the viewport and nothing else.
                      loading="lazy"
                      decoding="async"
                      alt={`Page ${page}`}
                      // object-contain, never object-cover: cropping a page
                      // render to fill a card hides evidence of what is on it.
                      className="block w-full object-contain"
                      // The reserved box comes from the render's own measured
                      // dimensions, not a hardcoded 1024/1408. If the ingest's
                      // max edge is ever changed the grid follows it instead of
                      // reserving the wrong space and letterboxing every page.
                      // Left unset when unknown, where object-contain still
                      // prevents cropping.
                      style={
                        pageRatio
                          ? { aspectRatio: pageRatio }
                          : { minHeight: '1px' }
                      }
                    />
                  </span>
                  <span className="mt-2 block font-mono text-xs text-ivory/60">
                    {`Page ${page}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openPage !== null && (
        <PageLightbox
          page={openPage}
          pageCount={pageCount}
          onClose={close}
          onStep={step}
        />
      )}
    </div>
  )
}

/** The shape the facts row reads, derived from the client so it cannot drift. */
type DocumentData = Awaited<ReturnType<typeof getDocumentPages>>

/** Real, measured facts only. Every one of these comes from the endpoint. */
function DocumentFacts({ data }: { data: DocumentData | undefined }) {
  if (!data || data.page_count === 0) return null
  const facts: string[] = []
  if (data.doc_id) facts.push(data.doc_id)
  if (data.page_count > 0) facts.push(`${data.page_count} pages`)
  if (data.pdf_byte_size !== null) facts.push(formatSize(data.pdf_byte_size))
  if (data.page_width && data.page_height) {
    facts.push(`${data.page_width} x ${data.page_height} px`)
  }
  return (
    // One string, not a gap-separated flex row. A flex `gap` looks like
    // separation but vanishes from textContent, so a copy or a screen reader
    // got "JPM_SE_Annual_2023_140139 pages1.01 MB1024 x 1408 px". The
    // separator has to live inside the string. Also a list, not a <dl>: these
    // are peer facts, and pairing them forced a screen-reader-only <dt> that
    // duplicated every value.
    <p
      data-testid="reader-facts"
      className="mt-10 border-t border-noir-border pt-6 font-mono text-sm text-ivory/70"
    >
      {facts.join(' · ')}
    </p>
  )
}

function PageLightbox({
  page,
  pageCount,
  onClose,
  onStep,
}: {
  page: number
  pageCount: number
  onClose: () => void
  onStep: (delta: number) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)

  // Move focus into the dialog on open so Esc and the arrow keys are reachable
  // without a click, and so a keyboard user is not left behind on the grid.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Page ${page}`}
      className="fixed inset-0 z-50 flex flex-col bg-noir/95 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-noir-border px-6 py-4">
        <p className="font-mono text-sm text-ivory/70">
          {`Page ${page} of ${pageCount}`}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close page view"
          className="text-ivory/60 transition-colors hover:text-ivory focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <img
          src={pageImageUrl(page)}
          alt={`Page ${page}`}
          className="max-h-full max-w-full object-contain"
        />
      </div>

      <div className="flex items-center justify-center gap-4 border-t border-noir-border px-6 py-4">
        <LightboxButton
          onClick={() => onStep(-1)}
          disabled={page <= 1}
          label="Previous page"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </LightboxButton>
        <p className="font-mono text-xs text-ivory/50">
          Use the arrow keys, or Esc to close.
        </p>
        <LightboxButton
          onClick={() => onStep(1)}
          disabled={page >= pageCount}
          label="Next page"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </LightboxButton>
      </div>
    </div>
  )
}

function LightboxButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="border border-noir-border p-2 text-ivory/70 transition-colors hover:border-gold/60 hover:text-ivory disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
    >
      {children}
    </button>
  )
}
