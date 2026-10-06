import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'

import {
  DEGRADED_HEALTH,
  DOCUMENT_PAGES,
  jsonResponse,
  NO_DOCUMENT_PAGES,
  OK_HEALTH,
  renderApp,
  resetQueryCache,
} from '@/test-utils/render'
import { DOCUMENT, PREVIEW_QUERY, formatSize } from '@/lib/document'

/** A realistic /search response, including a real top hit and its page image. */
const SEARCH_RESULT = {
  query: PREVIEW_QUERY,
  hits: [
    {
      doc_id: DOCUMENT.docId,
      page_number: 128,
      score: 0.46112514,
      image: 'data:image/jpeg;base64,AAA',
    },
    {
      doc_id: DOCUMENT.docId,
      page_number: 102,
      score: 0.4529103,
      image: 'data:image/jpeg;base64,BBB',
    },
    {
      doc_id: DOCUMENT.docId,
      page_number: 127,
      score: 0.4502011,
      image: 'data:image/jpeg;base64,CCC',
    },
  ],
}

/**
 * Stubs both endpoints the landing page calls, routing on the URL.
 * /search is held separately so a test can leave it pending.
 */
function stubEndpoints(
  health: unknown = OK_HEALTH,
  searchResult: unknown = SEARCH_RESULT,
  documentPages: unknown = DOCUMENT_PAGES,
) {
  // The init arg is unused here but is read back from mock.calls, so the
  // signature must keep it.
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/search')) return Promise.resolve(jsonResponse(searchResult))
    if (url.includes('/document/pages')) return Promise.resolve(jsonResponse(documentPages))
    return Promise.resolve(jsonResponse(health))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const searchCalls = (m: ReturnType<typeof stubEndpoints>) =>
  m.mock.calls.filter((c) => String(c[0]).includes('/search'))

/** The card, scoped so the hero telemetry chip cannot satisfy the assertions. */
function card() {
  return within(screen.getByTestId('document-card'))
}

/**
 * The retrieved-pages table. Scoped separately because p.128 legitimately
 * appears twice inside the card: once in the prose and once in the table.
 */
function pagesList() {
  return within(screen.getByTestId('retrieved-pages'))
}

beforeEach(() => {
  resetQueryCache()
})

describe('document card identity', () => {
  it('names the document that is actually indexed', async () => {
    stubEndpoints()
    renderApp()

    await screen.findByTestId('document-card')
    const c = card()
    expect(c.getByText(/J\.P\. Morgan SE · Annual Report 2023/i)).toBeInTheDocument()
    // The size is what GET /document/pages measured, not a bundled constant.
    await waitFor(() =>
      expect(c.getByText(formatSize(DOCUMENT_PAGES.pdf_byte_size!))).toBeInTheDocument(),
    )
    // The filename legitimately appears twice: card header and viewer chrome.
    expect(c.getAllByText(DOCUMENT_PAGES.pdf_filename!)).toHaveLength(2)
    await waitFor(() => expect(c.getByText(/Nearest indexed page/i)).toBeInTheDocument())
  })

  it('omits the file size when the backend cannot measure one', async () => {
    stubEndpoints(OK_HEALTH, SEARCH_RESULT, NO_DOCUMENT_PAGES)
    renderApp()
    await waitFor(() => expect(card().getByText(/Nearest indexed page/i)).toBeInTheDocument())
    // Fall back to the label, but print no size we could not verify.
    expect(card().getAllByText(DOCUMENT.filename).length).toBe(2)
    expect(card().queryByText(/MB$/)).not.toBeInTheDocument()
  })

  it('never shows the mock SEC 10-K identity or its fabricated telemetry', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(card().getByText(/Nearest indexed page/i)).toBeInTheDocument())

    // Every one of these appeared in ui.html and is false for this index.
    for (const fake of [
      /SECURITIES AND EXCHANGE COMMISSION/i,
      /FORM 10-K/i,
      /CIK/i,
      /4,819/,
      /0\.984/,
      /98\.4/,
      /Cohere/i,
      /1,536/,
      /0x9f/i,
      /620,130/,
      /52,810/,
      /AUREUS/i,
    ]) {
      expect(screen.queryByText(fake), `mock content ${fake} leaked`).not.toBeInTheDocument()
    }
  })

  it('shows the real page count from /health, not a hardcoded one', async () => {
    const fetchMock = stubEndpoints()
    renderApp()

    await waitFor(() => expect(card().getByText(/Nearest indexed page/i)).toBeInTheDocument())
    expect(card().getByText(new RegExp(`${OK_HEALTH.points} pages indexed`))).toBeInTheDocument()
    // The health call happened, so the count is sourced rather than baked in.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/health'))).toBe(true)
  })

  it('shows a different page count when the backend reports one', async () => {
    stubEndpoints({ ...OK_HEALTH, points: 512 })
    renderApp()
    await waitFor(() => expect(card().getByText(/Nearest indexed page/i)).toBeInTheDocument())
    expect(card().getByText(/512 pages indexed/)).toBeInTheDocument()
    expect(screen.queryByText(/139 pages indexed/)).not.toBeInTheDocument()
  })
})

describe('document card retrieval figures', () => {
  it('renders the real page render, page number and cosine score', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    const img = card().getByAltText(/rendered page 128/i) as HTMLImageElement
    expect(img.getAttribute('src')).toBe(SEARCH_RESULT.hits[0].image)
    // The top hit's real score, in the prose and in the table header badge.
    expect(card().getByText(/returned for/i)).toBeInTheDocument()
    expect(screen.getAllByText('0.461').length).toBeGreaterThan(0)
  })

  it('lists the real top-3 result set, not an invented chunk', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    const list = pagesList()
    expect(list.getByText('p.102')).toBeInTheDocument()
    expect(list.getByText('p.127')).toBeInTheDocument()
    expect(list.getByText('0.453')).toBeInTheDocument()
    expect(list.getByText('0.450')).toBeInTheDocument()
  })

  it('queries with the documented probe query and asks for three hits', async () => {
    const fetchMock = stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    const call = searchCalls(fetchMock)[0]
    const body = JSON.parse((call?.[1] as RequestInit | undefined)?.body as string)
    expect(body).toEqual({ query: PREVIEW_QUERY, limit: 3 })
  })

  it('shares one /search call between the card and the telemetry chip', async () => {
    const fetchMock = stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    expect(searchCalls(fetchMock).length).toBe(1)
  })

  it('mirrors the top hit into the hero telemetry chip', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    // Both the chip and the card read "NEAREST PAGE"; the chip is the one
    // outside the card.
    const cardRoot = screen.getByTestId('document-card')
    const chip = screen
      .getAllByText('NEAREST PAGE')
      .find((el) => !cardRoot.contains(el)) as HTMLElement

    expect(chip).toBeTruthy()
    expect(chip.parentElement?.textContent).toContain('p.128')
    expect(chip.parentElement?.textContent).toContain('0.461')
  })
})

describe('page viewer presentation', () => {
  it('shows the page uncropped, not as a cover-cropped strip', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    const img = card().getByAltText(/rendered page 128/i)
    const cls = img.getAttribute('class') ?? ''
    // The earlier version used object-cover, which sliced the page in half.
    expect(cls).toContain('object-contain')
    expect(cls).not.toContain('object-cover')
    // Intrinsic size is declared so the stage never reflows when it loads.
    expect(img.getAttribute('width')).toBe('559')
    expect(img.getAttribute('height')).toBe('768')
  })

  it('labels the page in the chrome bar and describes the image for screen readers', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    const c = card()
    expect(c.getByText('p.128', { selector: 'span.font-mono.font-semibold' })).toBeInTheDocument()
    const img = c.getByAltText(/rendered page 128 of .* nearest indexed match/i)
    expect(img).toBeInTheDocument()
  })

  it('draws nothing over the page content', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    // A region highlight would need bounding boxes the API does not return.
    const stage = card().getByAltText(/rendered page 128/i).parentElement as HTMLElement
    expect(stage.querySelectorAll('[class*="highlight"]').length).toBe(0)
    expect(stage.querySelectorAll('svg').length).toBe(0)
  })

  it('keeps the stage height stable between the empty and loaded states', async () => {
    stubEndpoints(DEGRADED_HEALTH)
    const { container } = renderApp()
    await waitFor(() => expect(card().getByText('Index is empty')).toBeInTheDocument())

    const stage = container.querySelector(
      '[data-testid="document-card"] img, [data-testid="document-card"] .bg-gradient-to-b',
    ) as HTMLElement
    expect(stage.style.height).toBe('320px')
  })
})

describe('scanner only runs during a real request', () => {
  it('is absent while idle', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    // Idle means idle: an always-on beam would imply continuous processing.
    expect(document.querySelectorAll('.scanner-beam').length).toBe(0)
    expect(document.querySelectorAll('.chunk-active').length).toBe(0)
  })

  it('sweeps while the retrieval is in flight, then stops', async () => {
    let release: (v: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    // The init arg is unused here but is read back from mock.calls, so the
  // signature must keep it.
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).includes('/search')) return pending
      return Promise.resolve(jsonResponse(OK_HEALTH))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderApp()

    await waitFor(() => {
      expect(document.querySelectorAll('.scanner-beam').length).toBe(1)
    })
    const c = card()
    expect(c.getByText('RETRIEVING')).toBeInTheDocument()
    // Scoped to the card so the chip's "RETRIEVING PAGE" cannot match.
    expect(c.getByText('retrieving page…')).toBeInTheDocument()

    release(jsonResponse(SEARCH_RESULT))

    await waitFor(() => {
      expect(document.querySelectorAll('.scanner-beam').length).toBe(0)
    })
    expect(c.queryByText('RETRIEVING')).not.toBeInTheDocument()
    expect(c.getByText('NEAREST PAGE')).toBeInTheDocument()
  })
})

describe('document card degraded states', () => {
  it('does not search an empty index', async () => {
    const fetchMock = stubEndpoints(DEGRADED_HEALTH)
    renderApp()

    await waitFor(() => {
      expect(card().getByText('Index is empty')).toBeInTheDocument()
    })
    // A refusal is guaranteed against an empty collection, so don't bother.
    expect(searchCalls(fetchMock).length).toBe(0)
    expect(card().getByText('no indexed pages')).toBeInTheDocument()
    expect(card().getByText(/0 pages indexed/)).toBeInTheDocument()
  })

  it('reports an unreachable backend instead of a blank page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    renderApp()

    await waitFor(
      () => {
        expect(card().getByText('Backend unreachable')).toBeInTheDocument()
      },
      { timeout: 15_000 },
    )
    expect(card().getByText('no preview')).toBeInTheDocument()
  })
})

describe('document card actions', () => {
  it('links to the reader and into the chat flow', async () => {
    stubEndpoints()
    renderApp()
    await waitFor(() => expect(pagesList().getByText('p.128')).toBeInTheDocument())

    expect(card().getByRole('link', { name: /reader/i })).toHaveAttribute('href', '/document')
    expect(card().getByRole('link', { name: /ask about this document/i })).toHaveAttribute(
      'href',
      '/chat',
    )
  })
})
