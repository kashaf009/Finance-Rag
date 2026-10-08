import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  DOCUMENT_PAGES,
  jsonResponse,
  NO_DOCUMENT_PAGES,
  OK_HEALTH,
  renderApp,
  resetQueryCache,
} from '@/test-utils/render'
import { formatSize } from '@/lib/document'
import { queryClient } from '@/lib/queryClient'

/**
 * The reader's contract with GET /document/pages.
 *
 * The assertions that matter are the negative ones: with 139 real pages on
 * disk the component must not be able to invent a count, and with zero pages it
 * must say so rather than render a plausible-looking grid.
 */
function stubDocument(pages: unknown = DOCUMENT_PAGES, health: unknown = OK_HEALTH) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/document/pages')) return Promise.resolve(jsonResponse(pages))
    return Promise.resolve(jsonResponse(health))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Waits for the facts row to mention `text`, and returns the element.
 *
 *  Scoped to the reader because the navbar status pill independently reports a
 *  page count from /health. Those are two different measurements — Qdrant
 *  points versus renders on disk — and they happen to agree for this document,
 *  so an unscoped assertion could pass on the wrong one. */
async function expectFacts(text: string) {
  const el = await waitFor(() => {
    const node = screen.queryByTestId('reader-facts')
    expect(node?.textContent ?? '').toContain(text)
    return node as HTMLElement
  })
  return el
}

beforeEach(() => {
  resetQueryCache()
})

describe('page reader', () => {
  it('shows the measured page count, size and pixel dimensions', async () => {
    stubDocument()
    renderApp('/document')

    const row = await expectFacts('139 pages')
    expect(row).toHaveTextContent(formatSize(DOCUMENT_PAGES.pdf_byte_size!))
    expect(row).toHaveTextContent('1024 x 1408 px')
    expect(row).toHaveTextContent('JPM_SE_Annual_2023_140')
  })

  it('keeps the facts row readable as text', async () => {
    stubDocument()
    renderApp('/document')
    await expectFacts('139 pages')

    // The separator must live inside the string. A flex gap looks like
    // separation but is absent from textContent, which previously yielded
    // "JPM_SE_Annual_2023_140139 pages1.01 MB1024 x 1408 px".
    expect(screen.getByTestId('reader-facts').textContent).toBe(
      'JPM_SE_Annual_2023_140 · 139 pages · 1.01 MB · 1024 x 1408 px',
    )
  })

  it('reserves each card box from the measured render dimensions', async () => {
    stubDocument()
    renderApp('/document')
    await expectFacts('139 pages')

    // Not a hardcoded 1024/1408: the box follows whatever the endpoint reports.
    expect(screen.getByAltText('Page 1').style.aspectRatio).toBe('1024 / 1408')
  })

  it('moves the card box when the ingest dimensions change', async () => {
    // A different max edge at embed time must not leave the grid reserving the
    // old shape and letterboxing every page.
    stubDocument({ ...DOCUMENT_PAGES, page_width: 800, page_height: 1100 })
    renderApp('/document')
    await expectFacts('800 x 1100 px')
    expect(screen.getByAltText('Page 1').style.aspectRatio).toBe('800 / 1100')
  })

  it('links each card to the full-resolution render for that page', async () => {
    stubDocument()
    renderApp('/document')
    await expectFacts('139 pages')

    const first = screen.getByAltText('Page 1') as HTMLImageElement
    expect(first.getAttribute('src')).toMatch(/\/document\/page\/1$/)
    // object-contain, not object-cover: a cropped page hides what is on it.
    expect(first.className).toContain('object-contain')
    expect(first.className).not.toContain('object-cover')
    expect(first.getAttribute('loading')).toBe('lazy')

    const last = screen.getByAltText('Page 139') as HTMLImageElement
    expect(last.getAttribute('src')).toMatch(/\/document\/page\/139$/)
  })

  it('shows a fallback and can retry when a page image cannot load', async () => {
    const user = userEvent.setup()
    stubDocument({ ...DOCUMENT_PAGES, page_count: 1 })
    renderApp('/documents')
    await expectFacts('1 pages')

    fireEvent.error(screen.getByAltText('Page 1'))

    expect(screen.getByRole('img', { name: 'Page 1 unavailable' })).toHaveTextContent(
      'Page image unavailable',
    )
    expect(screen.queryByAltText('Page 1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh pages' }))
    expect(screen.getByAltText('Page 1')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Page 1 unavailable' })).not.toBeInTheDocument()
  })

  it('refreshes an empty inventory cached before entering the reader', async () => {
    queryClient.setQueryData(['document-pages'], NO_DOCUMENT_PAGES)
    const fetchMock = stubDocument({ ...DOCUMENT_PAGES, page_count: 3 })
    renderApp('/documents')

    await expectFacts('3 pages')
    expect(screen.getByAltText('Page 3')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/document/pages'))).toBe(true)
  })

  it('finds renders added while the reader is open when refreshed', async () => {
    const user = userEvent.setup()
    stubDocument(NO_DOCUMENT_PAGES)
    renderApp('/documents')
    await screen.findByText('No pages on disk.')

    stubDocument({ ...DOCUMENT_PAGES, page_count: 2 })
    await user.click(screen.getByRole('button', { name: 'Refresh pages' }))

    await expectFacts('2 pages')
    expect(screen.getByAltText('Page 2')).toBeInTheDocument()
    expect(screen.queryByText('No pages on disk.')).not.toBeInTheDocument()
  })

  it('renders exactly as many cards as the backend counted', async () => {
    stubDocument({ ...DOCUMENT_PAGES, page_count: 4 })
    renderApp('/document')
    await expectFacts('4 pages')
    expect(screen.getByAltText('Page 4')).toBeInTheDocument()
    expect(screen.queryByAltText('Page 5')).not.toBeInTheDocument()
  })

  it('admits an empty ingest instead of inventing pages', async () => {
    stubDocument(NO_DOCUMENT_PAGES)
    renderApp('/document')

    await waitFor(() => expect(screen.getByText(/No pages on disk/i)).toBeInTheDocument())
    expect(screen.getByText(/ingest has not written/i)).toBeInTheDocument()
    // No grid, and the reader's own facts row is gone entirely.
    expect(screen.queryByAltText('Page 1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reader-facts')).not.toBeInTheDocument()
  })

  it('surfaces a failed inventory read rather than showing an empty reader', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/document/pages')
          ? Promise.resolve(jsonResponse({ detail: 'boom' }, 500))
          : Promise.resolve(jsonResponse(OK_HEALTH)),
      ),
    )
    renderApp('/document')
    // The query client retries twice with backoff, so the error state lands
    // around 3s. Same 15s budget the other error-path tests use.
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument(), {
      timeout: 15_000,
    })
    // Critically: not "No pages on disk", which would be a false diagnosis.
    expect(screen.queryByText(/No pages on disk/i)).not.toBeInTheDocument()
  })
})

describe('page lightbox', () => {
  it('reports image failures without breaking navigation to the next page', async () => {
    const user = userEvent.setup()
    stubDocument({ ...DOCUMENT_PAGES, page_count: 2 })
    renderApp('/documents')
    await expectFacts('2 pages')
    await user.click(screen.getByAltText('Page 1'))

    const dialog = await screen.findByRole('dialog')
    fireEvent.error(within(dialog).getByAltText('Page 1'))
    expect(within(dialog).getByRole('img', { name: 'Page 1 unavailable' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Next page' }))
    expect(within(dialog).getByAltText('Page 2')).toBeInTheDocument()
    expect(within(dialog).queryByText('Page image unavailable')).not.toBeInTheDocument()
  })

  it('opens a full-resolution view and closes on Escape', async () => {
    const user = userEvent.setup()
    stubDocument({ ...DOCUMENT_PAGES, page_count: 3 })
    renderApp('/document')
    await expectFacts('3 pages')

    await user.click(screen.getByAltText('Page 2'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Page 2 of 3')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('navigates with the arrow keys and stops at both ends', async () => {
    const user = userEvent.setup()
    stubDocument({ ...DOCUMENT_PAGES, page_count: 3 })
    renderApp('/document')
    await expectFacts('3 pages')

    await user.click(screen.getByAltText('Page 1'))
    await screen.findByRole('dialog')

    // Backwards from the first page must not go to page 0.
    await user.keyboard('{ArrowLeft}')
    expect(within(screen.getByRole('dialog')).getByText('Page 1 of 3')).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')
    // Forwards past the last page must not go to page 4.
    expect(within(screen.getByRole('dialog')).getByText('Page 3 of 3')).toBeInTheDocument()
  })

  it('disables the next control on the final page', async () => {
    const user = userEvent.setup()
    stubDocument({ ...DOCUMENT_PAGES, page_count: 2 })
    renderApp('/document')
    await expectFacts('2 pages')

    await user.click(screen.getByAltText('Page 2'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Previous page' })).toBeEnabled()
  })
})
