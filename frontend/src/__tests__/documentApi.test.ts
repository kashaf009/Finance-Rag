// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('document API URLs', () => {
  it.each([
    ['https://example.test/api///', 'https://example.test/api'],
    ['/api/', '/api'],
    ['', ''],
  ])('uses the same normalized base for inventory and images: %s', async (base, expected) => {
    vi.stubEnv('VITE_API_BASE_URL', base)
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ page_count: 1 })))
    vi.stubGlobal('fetch', fetchMock)
    const { getDocumentPages, pageImageUrl } = await import('@/lib/api')

    await getDocumentPages()

    expect(fetchMock).toHaveBeenCalledWith(
      `${expected}/document/pages`,
      expect.objectContaining({ method: 'GET' }),
    )
    expect(pageImageUrl(1)).toBe(`${expected}/document/page/1`)
  })
})
