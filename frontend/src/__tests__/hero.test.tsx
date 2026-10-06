import { describe, expect, it, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  DEGRADED_HEALTH,
  readHeadline,
  renderApp,
  resetQueryCache,
  stubHealth,
} from '@/test-utils/render'

/** Reads a metric card's authoritative value, immune to the count-up tween. */
function metricValue(container: HTMLElement, label: string): string | null {
  const card = Array.from(container.querySelectorAll('#hero-metrics > div')).find((el) =>
    el.textContent?.includes(label),
  )
  return card?.querySelector('[data-value]')?.getAttribute('data-value') ?? null
}

beforeEach(() => {
  resetQueryCache()
  stubHealth()
})

describe('hero typography', () => {
  it('renders the headline as one h1, with the second line in italic light', async () => {
    renderApp()

    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(readHeadline()).toBe('Every answer, anchored to a page.')

    const italicWords = Array.from(h1.querySelectorAll('span[style*="italic"]')).map((el) =>
      el.textContent?.trim(),
    )
    expect(italicWords).toEqual(['to', 'a', 'page.'])
  })

  it('wraps every headline word in its own maskable span', async () => {
    renderApp()
    const words = (await screen.findByRole('heading', { level: 1 }))
      .querySelectorAll('[data-hero-word]')
    const texts = Array.from(words).map((w) => w.textContent?.trim())
    expect(texts).toEqual(['Every', 'answer,', 'anchored', 'to', 'a', 'page.'])
  })

  it('puts the gold hairline under the eyebrow pill', async () => {
    const { container } = renderApp()
    await screen.findByRole('heading', { level: 1 })
    const underline = container.querySelector('#hero-eyebrow-underline')
    expect(underline).toBeTruthy()
    expect(underline?.className).toContain('bg-gold')
  })

  it('renders word separators as siblings of the word spans, never children', async () => {
    const { container } = renderApp()
    await screen.findByRole('heading', { level: 1 })
    const mask = container.querySelector('.mask-lines') as HTMLElement

    // Each span must hold only its own word. A trailing space INSIDE an
    // inline-block is discarded as trailing whitespace by CSS, so the words
    // rendered glued ("Everyanswer") while textContent still reported a space
    // and every other test passed.
    const words = [...mask.querySelectorAll('[data-hero-word]')]
    expect(words.map((w) => w.textContent)).toEqual(['Every', 'answer,', 'anchored'])
    for (const word of words) {
      expect(word.textContent?.trim()).toBe(word.textContent)
    }

    // The separators are whitespace text nodes between the spans.
    const separators = [...mask.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
    expect(separators.filter((t) => t === ' ').length).toBe(2)
  })

  it('stacks the two lines with a gap instead of using a br', async () => {
    const { container } = renderApp()
    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(h1.querySelector('br')).toBeNull()
    expect(h1.className).toContain('headline')
    // The italic line is a sibling of the first, not text after a br.
    expect(h1.querySelectorAll('.mask-lines').length).toBe(2)
    expect(container.querySelectorAll('h1 > br').length).toBe(0)
  })

  it('keeps a real space of air between the headline lines', () => {
    // A space in Newsreader measures 0.204em. The gap was briefly 0.04em, a
    // fifth of a space, which welded the two lines together. jsdom cannot
    // compute this, so pin the source value; the rendered value is checked in
    // the browser layout audit.
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
    const block = css.match(/\.headline\s*\{([^}]*)\}/)?.[1] ?? ''
    const gap = block.match(/gap:\s*([\d.]+)em/)?.[1]

    expect(Number(gap)).toBeGreaterThanOrEqual(0.2)
  })

  it('separates the two headline lines with a real text node', async () => {
    // The separator between the two lines was silently absent from the source
    // once, which left the rendered text reading "anchoredto a page.". It must
    // be an explicit expression child, because whitespace-only JSX text is
    // dropped by the transform.
    renderApp()
    const h1 = await screen.findByRole('heading', { level: 1 })
    const kids = [...h1.childNodes]
    const lineIdx = kids.findIndex(
      (n) =>
        n instanceof HTMLElement &&
        (n.classList.contains('mask-lines') || n.querySelector('.mask-lines') !== null),
    )
    expect(lineIdx).toBeGreaterThanOrEqual(0)

    const separators = kids.filter(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() === '',
    )
    expect(separators.length).toBe(1)
    expect(kids.indexOf(separators[0])).toBeGreaterThan(lineIdx)
  })

  it('uses arbitrary font sizes so leading-[1.08] is not overridden', async () => {
    renderApp()
    const h1 = await screen.findByRole('heading', { level: 1 })
    // text-4xl/text-5xl emit a line-height that beats leading-[1.08] on
    // source order, which collapsed the serif leading to 1.
    expect(h1.className).not.toMatch(/text-(4xl|5xl)/)
    expect(h1.className).toContain('leading-[1.08]')
    expect(h1.className).toContain('lg:text-[58px]')
  })
})

describe('hero metric cards are fed by live health, not mock figures', () => {
  it('shows the real point count, embedding size and model', async () => {
    const { container } = renderApp()

    await waitFor(() => {
      expect(metricValue(container, 'Index Size')).toBe('139')
    })
    expect(metricValue(container, 'Embedding')).toBe('1,024')
    expect(metricValue(container, 'Similarity')).toBe('Cosine')
    // Scoped to the hero: the chat source row also names the embedder.
    const hero = within(document.getElementById('hero') as HTMLElement)
    expect(hero.getByText('gemini-embedding-2')).toBeInTheDocument()
  })

  it('animates the count up to the exact server value', async () => {
    renderApp()

    await waitFor(
      () => {
        expect(screen.getByText('139')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  })

  it('never renders the invented headline metrics from the reference design', async () => {
    const { container } = renderApp()
    await waitFor(() => expect(metricValue(container, 'Index Size')).toBe('139'))

    for (const fake of [/142M/i, /Sub-40ms/i, /vectors indexed/i, /999\d+/]) {
      expect(screen.queryByText(fake), `mock metric ${fake} leaked`).not.toBeInTheDocument()
    }
  })

  it('renders an em dash rather than a fabricated zero when health is unavailable', async () => {
    resetQueryCache()
    stubHealth(new TypeError('fetch failed'))
    const { container } = renderApp()

    await waitFor(
      () => {
        expect(metricValue(container, 'Index Size')).toBe('—')
        expect(metricValue(container, 'Embedding')).toBe('—')
      },
      { timeout: 15_000 },
    )
    expect(screen.getByText('checking index…')).toBeInTheDocument()
  })

  it('dims the cards when the backend cannot be reached', async () => {
    resetQueryCache()
    stubHealth(new TypeError('fetch failed'))
    const { container } = renderApp()

    await waitFor(
      () => {
        expect(container.querySelectorAll('#hero-metrics > .opacity-50').length).toBe(3)
      },
      { timeout: 15_000 },
    )
  })

  it('reports a genuinely empty index as zero and withholds the ready dot', async () => {
    resetQueryCache()
    stubHealth(DEGRADED_HEALTH)
    const { container } = renderApp()

    await waitFor(() => {
      expect(metricValue(container, 'Index Size')).toBe('0')
    })
    // Degraded is not an error, so the cards stay legible.
    expect(container.querySelectorAll('#hero-metrics > .opacity-50').length).toBe(0)
    expect(container.querySelectorAll('#hero-metrics .bg-emerald-500').length).toBe(0)
  })

  it('shows the ready dot only when the collection is populated', async () => {
    const { container } = renderApp()
    await waitFor(() => {
      expect(container.querySelectorAll('#hero-metrics .bg-emerald-500').length).toBe(1)
    })
  })
})

describe('hero actions', () => {
  it('links the primary CTA to /chat and shows the real LLM model', async () => {
    renderApp()
    const cta = await screen.findByRole('link', { name: /launch chat interface/i })
    expect(cta).toHaveAttribute('href', '/chat')

    // Scoped to the hero: the chat panel header also names the model.
    const hero = within(document.getElementById('hero') as HTMLElement)
    await waitFor(() => {
      expect(hero.getByText(/gemini-2\.5-flash/)).toBeInTheDocument()
    })
  })
})
