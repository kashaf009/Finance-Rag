import { FileText, Loader2 } from 'lucide-react'

interface PagePreviewProps {
  /** Full `data:image/jpeg;base64,...` URI from the search response. */
  image: string | null
  pageNumber: number
  /** True only while the retrieval request is in flight. */
  scanning: boolean
  /** Why there is no page yet, for the empty state. */
  emptyReason: string | null
  filename: string
}

const STAGE_H = 320

/**
 * A rendered page of the indexed PDF, presented as a document viewer.
 *
 * The earlier version was a 248px `object-cover` crop, which sliced the page
 * through the middle and read as an arbitrary image strip. The page renders
 * whole here, letterboxed on a stage, with two offset sheets behind it for
 * depth and a chrome bar carrying the real filename and page number.
 *
 * Nothing is drawn over the page content: there is no region highlight,
 * because the API returns no bounding boxes and inventing one would be a lie.
 */
export function PagePreview({
  image,
  pageNumber,
  scanning,
  emptyReason,
  filename,
}: PagePreviewProps) {
  const alt = `Rendered page ${pageNumber} of ${filename}, returned as the nearest indexed match`

  return (
    <div className="mt-4 rounded-xl border border-noir/10 overflow-hidden bg-white">
      {/* Viewer chrome. Three gold dots read as window controls in-brand. */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-noir/[0.035] border-b border-noir/10">
        <span className="flex items-center gap-1 shrink-0" aria-hidden>
          <span className="w-1.5 h-1.5 rounded-full bg-gold" />
          <span className="w-1.5 h-1.5 rounded-full bg-gold/50" />
          <span className="w-1.5 h-1.5 rounded-full bg-gold/25" />
        </span>
        <span className="text-[10px] font-mono text-noir/55 truncate">{filename}</span>
        <span className="text-[10px] font-mono font-semibold text-gold-dark shrink-0">
          p.{pageNumber}
        </span>
      </div>

      {/* Stage: fixed height so the card never reflows when the page lands. */}
      <div
        className="relative flex items-center justify-center overflow-hidden bg-gradient-to-b from-ivory/70 to-noir/[0.07]"
        style={{ height: STAGE_H }}
      >
        {image ? (
          <>
            {/* Sheet stack behind the page, for depth. */}
            <span
              aria-hidden
              className="absolute w-[54%] h-[84%] rounded-[3px] bg-white/60 shadow-sm ring-1 ring-noir/5"
              style={{ transform: 'translate(-10px, 7px) rotate(-2deg)' }}
            />
            <span
              aria-hidden
              className="absolute w-[56%] h-[86%] rounded-[3px] bg-white/85 shadow-sm ring-1 ring-noir/5"
              style={{ transform: 'translate(-4px, 3px) rotate(0.9deg)' }}
            />
            {/* The page itself, whole and uncropped. */}
            <img
              src={image}
              alt={alt}
              width={559}
              height={768}
              className="relative h-[88%] w-auto max-w-[82%] object-contain rounded-[2px] ring-1 ring-noir/10 shadow-[0_18px_38px_-14px_rgba(15,15,15,0.45)]"
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-noir/35">
            {scanning ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <FileText className="w-6 h-6" />
            )}
            <span className="text-[11px] font-mono">
              {scanning ? 'retrieving page…' : (emptyReason ?? 'no indexed pages')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
