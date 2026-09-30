import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import App from '@/App'
import { queryClient } from '@/lib/queryClient'
import type { HealthResponse } from '@/types/api'

function renderApp(initialPath = '/') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const OK_HEALTH: HealthResponse = {
  status: 'ok',
  qdrant_url: 'http://localhost:6333',
  collection: 'finance_pages',
  collection_ready: true,
  points: 139,
  llm_model: 'gemini-2.5-flash',
  llm_base_url: 'https://api.euron.one/api/v1/euri',
  embed_model: 'gemini-embedding-2',
  vector_size: 1024,
}

const DEGRADED_HEALTH: HealthResponse = {
  ...OK_HEALTH,
  status: 'degraded',
  collection_ready: false,
  points: 0,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  queryClient.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('app shell', () => {
  it('renders the fixed navbar on every route', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(OK_HEALTH), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    for (const path of ['/', '/chat', '/document']) {
      const { unmount } = renderApp(path)
      expect(screen.getByRole('banner'), `navbar missing on ${path}`).toBeInTheDocument()
      unmount()
      queryClient.clear()
    }
  })

  it('shows the real point count in the status pill, not a fake latency', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(OK_HEALTH), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Index Ready · 139 pages')).toBeInTheDocument()
    })
    // The mock's invented metric must never appear.
    expect(screen.queryByText(/P99/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/28ms/i)).not.toBeInTheDocument()
  })

  it('warns instead of claiming ready when the index is degraded', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(DEGRADED_HEALTH), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Index empty or not ready')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Index Ready/)).not.toBeInTheDocument()
  })

  it('reports an unreachable backend rather than hanging on "checking"', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    renderApp()

    await waitFor(
      () => {
        expect(screen.getByText('Backend unreachable')).toBeInTheDocument()
      },
      { timeout: 15_000 },
    )
  })

  it('always offers the chat CTA, which routes to /chat', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(OK_HEALTH), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    renderApp()

    const cta = screen.getByRole('link', { name: /enter chat interface/i })
    expect(cta).toHaveAttribute('href', '/chat')
  })

  it('exposes the three nav destinations that actually exist', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(OK_HEALTH), { status: 200 }))
    renderApp()
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveTextContent('RAG Pipeline')
    expect(nav).toHaveTextContent('Document Reader')
    expect(nav).toHaveTextContent('Grounding')
  })

  it('uses the SELF-RAG wordmark, not the mock AUREUS brand', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(OK_HEALTH), { status: 200 }))
    renderApp()
    expect(screen.getByText('FINANCE RAG')).toBeInTheDocument()
    expect(screen.getByText('SELF-RAG')).toBeInTheDocument()
    expect(screen.queryByText(/AUREUS/i)).not.toBeInTheDocument()
  })
})

describe('routing', () => {
  const routes: Array<[string, RegExp]> = [
    ['/', /landing shell/i],
    ['/chat', /step 8 — chat terminal/i],
    ['/document', /step 13 — pdf reader/i],
  ]

  it.each(routes)('%s renders its page', (path, marker) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(OK_HEALTH), { status: 200 }))
    renderApp(path)
    expect(screen.getByText(marker)).toBeInTheDocument()
  })

  it('falls back to the landing page for an unknown path', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(OK_HEALTH), { status: 200 }))
    renderApp('/nope')
    expect(screen.getByText(/landing shell/i)).toBeInTheDocument()
  })

  it('applies the on-noir class only to dark routes', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(OK_HEALTH), { status: 200 }))
    const { unmount } = renderApp('/chat')
    expect(screen.getByText(/step 8/i).closest('.on-noir')).toBeTruthy()
    unmount()
    queryClient.clear()

    renderApp('/')
    expect(screen.getByText(/landing shell/i).closest('.on-noir')).toBeFalsy()
  })
})

describe('ambient layers', () => {
  it('renders the fixed ivory grid and gold bloom on the landing route', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(OK_HEALTH), { status: 200 }))
    renderApp('/')
    const grids = document.querySelectorAll('.bg-rag-grid')
    expect(grids.length).toBeGreaterThan(0)
    expect(grids[0].className).toContain('fixed')
    expect(grids[0].className).toContain('pointer-events-none')
  })

  it('renders the gold radial bloom on the dark chat route', () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(OK_HEALTH), { status: 200 }))
    renderApp('/chat')
    const bloom = document.querySelectorAll('[class*="radial-gradient"]')
    expect(bloom.length).toBeGreaterThan(0)
    expect(bloom[0].getAttribute('class')).toContain('201,164,92')
  })
})
