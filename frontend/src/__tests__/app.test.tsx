import { describe, expect, it, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'

import {
  DEGRADED_HEALTH,
  OK_HEALTH,
  readHeadline,
  renderApp,
  resetQueryCache,
  stubHealth,
} from '@/test-utils/render'

beforeEach(() => {
  resetQueryCache()
  stubHealth(OK_HEALTH)
})

describe('app shell', () => {
  it('renders the fixed navbar on every route', () => {
    for (const path of ['/', '/chat', '/document']) {
      const { unmount } = renderApp(path)
      expect(screen.getByRole('banner'), `navbar missing on ${path}`).toBeInTheDocument()
      unmount()
      resetQueryCache()
    }
  })

  it('shows the real point count in the status pill, not a fake latency', async () => {
    renderApp()
    await waitFor(() => {
      expect(screen.getByText('Index Ready · 139 pages')).toBeInTheDocument()
    })
    // The mock's invented metric must never appear.
    expect(screen.queryByText(/P99/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/28ms/i)).not.toBeInTheDocument()
  })

  it('warns instead of claiming ready when the index is degraded', async () => {
    resetQueryCache()
    stubHealth(DEGRADED_HEALTH)
    renderApp()

    await waitFor(() => {
      expect(screen.getByText('Index empty or not ready')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Index Ready/)).not.toBeInTheDocument()
  })

  it('reports an unreachable backend rather than hanging on "checking"', async () => {
    resetQueryCache()
    stubHealth(new TypeError('fetch failed'))
    renderApp()

    // Scoped to the navbar: the hero document card also surfaces this state.
    const nav = within(screen.getByRole('banner'))
    await waitFor(
      () => {
        expect(nav.getByText('Backend unreachable')).toBeInTheDocument()
      },
      { timeout: 15_000 },
    )
  })

  it('always offers the chat CTA, which routes to /chat', () => {
    renderApp()
    const cta = screen.getByRole('link', { name: /enter chat interface/i })
    expect(cta).toHaveAttribute('href', '/chat')
  })

  it('exposes the three nav destinations that actually exist', () => {
    renderApp()
    const nav = screen.getByRole('navigation')
    expect(nav).toHaveTextContent('RAG Pipeline')
    expect(nav).toHaveTextContent('Document Reader')
    expect(nav).toHaveTextContent('Grounding')
  })

  it('uses the SELF-RAG wordmark, not the mock AUREUS brand', () => {
    renderApp()
    // Scoped to the banner because the footer repeats the wordmark by design,
    // which makes a screen-level query ambiguous. The AUREUS check stays
    // screen-level on purpose: that name must not appear anywhere.
    const nav = within(screen.getByRole('banner'))
    expect(nav.getByText('FINANCE RAG')).toBeInTheDocument()
    expect(nav.getByText('SELF-RAG')).toBeInTheDocument()
    expect(screen.queryByText(/AUREUS/i)).not.toBeInTheDocument()
  })
})

describe('routing', () => {
  const routes: Array<[string, () => void]> = [
    ['/', () => expect(readHeadline()).toBe('Every answer, anchored to a page.')],
    ['/chat', () => expect(screen.getByTestId('chat-panel')).toBeInTheDocument()],
    ['/document', () => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()],
  ]

  it.each(routes)('%s renders its page', (path, assert) => {
    renderApp(path)
    assert()
  })

  it('falls back to the landing page for an unknown path', () => {
    renderApp('/nope')
    expect(readHeadline()).toBe('Every answer, anchored to a page.')
  })

  it('applies the on-noir class only to dark routes', () => {
    const { unmount } = renderApp('/chat')
    expect(screen.getByTestId('chat-panel').closest('.on-noir')).toBeTruthy()
    unmount()
    resetQueryCache()

    renderApp('/')
    expect(screen.getByRole('heading', { level: 1 }).closest('.on-noir')).toBeFalsy()
  })
})

describe('ambient layers', () => {
  it('renders the fixed ivory grid and gold bloom on the landing route', () => {
    const { container } = renderApp('/')
    const grids = container.querySelectorAll('.bg-rag-grid')
    expect(grids.length).toBeGreaterThan(0)
    expect(grids[0].className).toContain('fixed')
    expect(grids[0].className).toContain('pointer-events-none')
  })

  it('renders the gold radial bloom on the dark chat route', () => {
    const { container } = renderApp('/chat')
    const bloom = container.querySelectorAll('[class*="radial-gradient"]')
    expect(bloom.length).toBeGreaterThan(0)
    expect(bloom[0].getAttribute('class')).toContain('201,164,92')
  })
})
