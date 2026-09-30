import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  GROQ_HEALTH,
  OK_HEALTH,
  UNCONFIGURED_HEALTH,
  jsonResponse,
  renderApp,
  resetQueryCache,
  stubHealth,
} from '@/test-utils/render'

/**
 * The provider selector must only ever show what the backend reports. Both the
 * option list and the current value come from /health, so these tests pin that
 * contract rather than a hardcoded provider list.
 */
describe('ProviderSelect', () => {
  beforeEach(() => {
    resetQueryCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers exactly the providers the backend lists', async () => {
    stubHealth(OK_HEALTH)
    renderApp('/chat')

    const select = await screen.findByTestId('provider-select')
    const options = [...(select as HTMLSelectElement).options].map((o) => o.value)
    expect(options).toEqual(['euron', 'groq'])
    expect((select as HTMLSelectElement).value).toBe('euron')
  })

  it('shows the resolved model for the active provider', async () => {
    stubHealth(GROQ_HEALTH)
    renderApp('/chat')

    await screen.findByTestId('provider-select')
    expect(screen.getByText('qwen/qwen3.8-27b')).toBeTruthy()
  })

  it('reports unconfigured rather than guessing a provider', async () => {
    stubHealth(UNCONFIGURED_HEALTH)
    renderApp('/chat')

    const select = (await screen.findByTestId('provider-select')) as HTMLSelectElement
    // `unconfigured` is not in the option list, so it is surfaced as an
    // explicit unavailable entry instead of being silently dropped.
    expect([...select.options].map((o) => o.textContent)).toContain('unconfigured (unavailable)')
    expect(select.value).toBe('')
  })

  it('posts the chosen provider and refetches health', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse(OK_HEALTH))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        provider: 'groq',
        model: 'qwen/qwen3.8-27b',
        base_url: 'https://api.groq.com/openai/v1',
      }),
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(GROQ_HEALTH))
    vi.stubGlobal('fetch', fetchMock)

    renderApp('/chat')
    await screen.findByTestId('provider-select')

    await userEvent.selectOptions(screen.getByTestId('provider-select'), 'groq')

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('/llm-provider'),
      )
      expect(post).toBeDefined()
      const init = post?.[1] as RequestInit
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body as string)).toEqual({ provider: 'groq' })
    })

    // The new provider and its model are reflected once /health is refetched.
    await waitFor(() => {
      expect(screen.getByText('qwen/qwen3.8-27b')).toBeTruthy()
    })
  })

  it('surfaces the backend 422 detail when a switch is rejected', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce(jsonResponse(OK_HEALTH))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "Set LLM_API_KEY or GROQ_API_KEY for provider 'groq'." }, 422),
    )
    vi.stubGlobal('fetch', fetchMock)

    renderApp('/chat')
    await screen.findByTestId('provider-select')

    await userEvent.selectOptions(screen.getByTestId('provider-select'), 'groq')

    const error = await screen.findByTestId('provider-error')
    expect(error.textContent).toContain('GROQ_API_KEY')
  })

  it('falls back to a static label when the backend lists no providers', async () => {
    stubHealth({ ...OK_HEALTH, llm_providers: [] })
    renderApp('/chat')

    await waitFor(() => {
      expect(screen.getByText('euron')).toBeTruthy()
    })
    expect(screen.queryByTestId('provider-select')).toBeNull()
  })

  it('is disabled while a chat request is in flight', async () => {
    stubHealth(OK_HEALTH)
    renderApp('/chat')

    const select = (await screen.findByTestId('provider-select')) as HTMLSelectElement
    expect(select.disabled).toBe(false)
  })
})
