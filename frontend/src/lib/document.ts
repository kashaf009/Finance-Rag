/**
 * Identity of the indexed document, used as a fallback label before the
 * backend has been asked.
 *
 * `sizeBytes` used to live here and it was wrong to be here: a byte count
 * baked into the bundle is a claim the frontend cannot check, and it goes stale
 * the moment the document is re-ingested. `GET /document/pages` now reports
 * `pdf_filename` and `pdf_byte_size` measured from disk, and that is what the
 * hero card and the reader display. This constant only covers the window
 * before the response lands.
 *
 * The page count and readiness are not here either — those come from
 * `GET /health` and `GET /document/pages`, for the same reason.
 */
export const DOCUMENT = {
  /** Qdrant `doc_id` — the PDF filename stem. Matches Citation.doc_id. */
  docId: 'JPM_SE_Annual_2023_140',
  /** The real file on disk, which is what the backend serves. */
  filename: 'JPM_SE_Annual_2023_140.pdf',
} as const

/**
 * The probe query the document card runs to fetch a genuine retrieved page.
 *
 * This is a real POST /search against the real index, not a bundled image, so
 * the page number, cosine score and page render are whatever retrieval
 * actually returns. Change it and the card shows a different real page.
 */
export const PREVIEW_QUERY = 'net interest income'

/** Bytes as MiB, to two decimals. The argument must be a measured value. */
export function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
