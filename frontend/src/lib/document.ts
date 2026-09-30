/**
 * Static facts about the indexed document.
 *
 * These are properties of a specific file on disk, not live metrics. The page
 * count and readiness are NOT here — those come from GET /health, because a
 * stale hardcoded page count is exactly the kind of lie this build avoids.
 *
 * `sizeBytes` is measured from docs/JPM_SE_Annual_2023_140.pdf. Step 13 adds
 * GET /documents/{doc_id}/pdf; that route reports the size authoritatively and
 * this constant should be dropped in favour of it.
 */
export const DOCUMENT = {
  /** Qdrant `doc_id` — the PDF filename stem. Matches Citation.doc_id. */
  docId: 'JPM_SE_Annual_2023_140',
  /** The real file on disk, which is what the backend serves. */
  filename: 'JPM_SE_Annual_2023_140.pdf',
  sizeBytes: 1_064_053,
} as const

/**
 * The probe query the document card runs to fetch a genuine retrieved page.
 *
 * This is a real POST /search against the real index, not a bundled image, so
 * the page number, cosine score and page render are whatever retrieval
 * actually returns. Change it and the card shows a different real page.
 */
export const PREVIEW_QUERY = 'net interest income'

/** 1,064,053 bytes as MiB, to one decimal. */
export function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
