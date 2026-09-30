import '@testing-library/jest-dom/vitest'

// This setup file also runs for @vitest-environment node suites, which have no
// window. Only patch matchMedia when a DOM is actually present.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// jsdom has no layout, so scrollTo throws "Not implemented" noise on every
// route change. Stub it; the ScrollToTop effect only needs it to exist.
if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as unknown as typeof window.scrollTo
}

// jsdom ships no IntersectionObserver, which the count-up and scroll-reveal
// effects gate on. Report everything as visible so those code paths run.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class AlwaysIntersectingObserver implements IntersectionObserver {
    readonly root = null
    readonly rootMargin = '0px'
    readonly thresholds = [0]
    private readonly targets = new Set<Element>()

    constructor(private callback: IntersectionObserverCallback) {
      this.handle = (entries: IntersectionObserverEntry[]) => {
        for (const entry of entries) {
          this.callback([{ ...entry, isIntersecting: true } as IntersectionObserverEntry], this)
        }
      }
    }
    private readonly handle: (entries: IntersectionObserverEntry[]) => void

    observe(target: Element) {
      this.targets.add(target)
      this.handle([{ target, isIntersecting: true } as IntersectionObserverEntry])
    }
    unobserve(target: Element) {
      this.targets.delete(target)
    }
    disconnect() {
      this.targets.clear()
    }
    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  globalThis.IntersectionObserver =
    AlwaysIntersectingObserver as unknown as typeof IntersectionObserver
}
