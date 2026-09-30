import { render } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import App from '@/App'
import { queryClient } from '@/lib/queryClient'
import type { DocumentPagesResponse, HealthResponse } from '@/types/api'

/** A fully healthy /health payload, matching the real backend shape. */
export const OK_HEALTH: HealthResponse = {
  status: 'ok',
  qdrant_url: 'http://localhost:6333',
  collection: 'finance_pages',
  collection_ready: true,
  points: 139,
  llm_provider: 'euron',
  llm_providers: ['euron', 'groq'],
  llm_model: 'gemini-2.5-flash',
  llm_base_url: 'https://api.euron.one/api/v1/euri',
  embed_model: 'gemini-embedding-2',
  vector_size: 1024,
}

/** Collection present but empty. */
export const DEGRADED_HEALTH: HealthResponse = {
  ...OK_HEALTH,
  status: 'degraded',
  collection_ready: false,
  points: 0,
}

/**
 * A real captured GET /document/pages response, against the real 139-page
 * render set. `pdf_byte_size` is the actual size of
 * docs/JPM_SE_Annual_2023_140.pdf, and the pixel dimensions are what the
 * ingest produced.
 */
export const DOCUMENT_PAGES: DocumentPagesResponse = {
  doc_id: 'JPM_SE_Annual_2023_140',
  pdf_filename: 'JPM_SE_Annual_2023_140.pdf',
  pdf_byte_size: 1_064_053,
  page_count: 139,
  page_width: 1024,
  page_height: 1408,
}

/** What the backend reports when the ingest has written nothing. */
export const NO_DOCUMENT_PAGES: DocumentPagesResponse = {
  doc_id: null,
  pdf_filename: null,
  pdf_byte_size: null,
  page_count: 0,
  page_width: null,
  page_height: null,
}

export function jsonResponse(body: unknown, status = 200): Response {  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function renderApp(initialPath = '/') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Installs a fetch stub. Pass a payload to answer 200, or a value to reject. */
export function stubHealth(health: HealthResponse | Error = OK_HEALTH) {
  const fetchMock = vi.fn()
  if (health instanceof Error) {
    fetchMock.mockRejectedValue(health)
  } else {
    fetchMock.mockResolvedValue(jsonResponse(health))
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Clears cached queries so a re-render re-fetches instead of reusing data. */
export function resetQueryCache() {
  queryClient.clear()
}

/**
 * The hero headline as a plain string, read from the word spans.
 *
 * Do NOT assert on `h1.textContent` for this. The words live in separate
 * inline-block spans with whitespace-only text nodes between them, and jsdom
 * places those text nodes in a different order than Chromium does — so
 * textContent reads " Every answer,anchored  to apage." in jsdom while the
 * browser renders and announces "Every answer, anchored to a page." correctly
 * (verified by measuring ~11.85px inter-word gaps, i.e. exactly one space).
 * Joining the word spans is order-stable in both environments.
 */
export function readHeadline(): string {
  return [...document.querySelectorAll('[data-hero-word]')]
    .map((el) => el.textContent?.trim() ?? '')
    .join(' ')
}

/** Health as reported when the backend cannot resolve a usable key or URL. */
export const UNCONFIGURED_HEALTH: HealthResponse = {
  ...OK_HEALTH,
  llm_provider: 'unconfigured',
  llm_model: 'unconfigured',
  llm_base_url: '',
}

/** Health as reported while groq is active, with its own resolved model. */
export const GROQ_HEALTH: HealthResponse = {
  ...OK_HEALTH,
  llm_provider: 'groq',
  llm_model: 'qwen/qwen3.8-27b',
  llm_base_url: 'https://api.groq.com/openai/v1',
}
