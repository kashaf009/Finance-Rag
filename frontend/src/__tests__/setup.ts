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
