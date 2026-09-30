import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Navbar } from '@/components/layout/Navbar'
import { Landing } from '@/pages/Landing'
import { Chat } from '@/pages/Chat'
import { Document } from '@/pages/Document'

/** Routes change scroll position to top, except for plain #anchor links. */
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) return
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <ScrollToTop />
      <Navbar />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/document" element={<Document />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </div>
  )
}
