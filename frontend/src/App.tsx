import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'

const Landing = lazy(() => import('@/pages/Landing').then(({ Landing }) => ({ default: Landing })))
const Chat = lazy(() => import('@/pages/Chat').then(({ Chat }) => ({ default: Chat })))
const Document = lazy(() => import('@/pages/Document').then(({ Document }) => ({ default: Document })))

function RouteFallback() {
  return (
    <div
      className="flex flex-1 min-h-[50vh] items-center justify-center bg-noir text-ivory text-xs font-mono"
      role="status"
      aria-live="polite"
    >
      Loading route…
    </div>
  )
}

/** Routes change scroll position to top, except for plain #anchor links. */
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) return
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname, hash])
  return null
}

/**
 * Column layout so the footer sits at the true bottom of the viewport on short
 * routes like /document, instead of a full screen below the content.
 *
 * <main> is both `flex-1` and a flex column so the page roots can carry `flex-1`
 * too. That matters on the dark routes: body is bg-ivory, so if a page's own
 * bg-noir wrapper did not stretch, the uncovered remainder of <main> would show
 * as an ivory band between the page and the noir footer.
 */
export default function App() {
  return (
    <div className="relative min-h-screen overflow-x-hidden flex flex-col">
      <ScrollToTop />
      <Navbar />
      <main className="flex-1 flex flex-col">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/document" element={<Document />} />
            <Route path="*" element={<Landing />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  )
}
