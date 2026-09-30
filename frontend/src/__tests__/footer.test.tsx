import { describe, expect, it, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'

import { resetQueryCache, renderApp, stubHealth, OK_HEALTH } from '@/test-utils/render'

/**
 * The footer replaces ui.html:517-538, whose copy was fabricated. Most of this
 * file is regression guards: if someone restores the mock's text, or drops the
 * real content in favour of an invented substitute, these should fail.
 *
 * The footer is static — it fetches nothing — so these tests need no health
 * stub beyond stopping a stray request escaping to the real network.
 */
beforeEach(() => {
  resetQueryCache()
  stubHealth(OK_HEALTH)
})

function footer() {
  return within(screen.getByRole('contentinfo'))
}

describe('footer', () => {
  it('renders on every route', () => {
    for (const path of ['/', '/chat', '/document']) {
      const { unmount } = renderApp(path)
      expect(screen.getByRole('contentinfo'), path).toBeInTheDocument()
      unmount()
    }
  })

  it('identifies the actual indexed file, not a placeholder', () => {
    renderApp()
    expect(footer().getByText('JPM_SE_Annual_2023_140.pdf')).toBeInTheDocument()
  })

  it('uses the real brand, never the mock AUREUS name', () => {
    renderApp()
    expect(footer().getByText('FINANCE RAG')).toBeInTheDocument()
    expect(screen.queryByText(/AUREUS/i)).not.toBeInTheDocument()
  })

  it('makes no compliance or regulatory claim', () => {
    renderApp()
    // SOC-2, FINRA and "deterministic" are all things this project is not.
    expect(screen.queryByText(/SOC-?2/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/FINRA/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/deterministic/i)).not.toBeInTheDocument()
    // The mock's invented corporate entity.
    expect(screen.queryByText(/Aureus Intelligence Labs/i)).not.toBeInTheDocument()
  })

  it('states the real limitation of the output', () => {
    renderApp()
    const text = footer().getByText(/model-generated/i).textContent ?? ''
    expect(text).toMatch(/not verified/i)
    expect(text).toMatch(/not financial advisory/i)
  })

  it('links to nothing, because there is no honest href', () => {
    renderApp()
    // The mock linked #edgar-sla and #cryptography; neither anchor exists.
    const links = screen.getByRole('contentinfo').querySelectorAll('a')
    expect(links).toHaveLength(0)
  })

  it('stamps the current year rather than a hardcoded one', () => {
    renderApp()
    expect(footer().getByText(`© ${new Date().getFullYear()} Finance RAG`)).toBeInTheDocument()
  })

  it('repeats no index statistics', () => {
    renderApp()
    // A bare "139" here would collide with the unscoped getByText('139') in
    // hero.test.tsx, and would be a fourth place the page count is claimed.
    const text = screen.getByRole('contentinfo').textContent ?? ''
    expect(text).not.toMatch(/139/)
    expect(text).not.toMatch(/gemini/i)
    expect(text).not.toMatch(/finance_pages/)
  })

  it('fetches nothing of its own', () => {
    const fetchMock = stubHealth(OK_HEALTH)
    renderApp()
    const footerCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/chat') || String(url).includes('/search'),
    )
    expect(footerCalls).toHaveLength(0)
  })
})
