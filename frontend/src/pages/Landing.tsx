import { AmbientLight } from '@/components/layout/Ambient'
import { HeroLeft } from '@/components/hero/HeroLeft'
import { DocumentCard } from '@/components/hero/DocumentCard'
import { ChatSection } from '@/components/chat/ChatSection'
import { useIndexReady } from '@/hooks/useHealth'
import { usePreviewHit } from '@/hooks/usePreviewHit'
import { formatPage, formatScore } from '@/lib/citations'

export function Landing() {
  const { ready } = useIndexReady()
  // Same query key as the document card, so the hero issues one /search call.
  const { top, scanning } = usePreviewHit()

  return (
    <div className="relative min-h-screen pt-20">
      <AmbientLight />

      {/* ui.html:165 — 12-col grid, 6/6 split */}
      <section
        className="relative pt-20 pb-20 md:pt-24 md:pb-28 max-w-7xl mx-auto px-6 z-10"
        id="hero"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          <HeroLeft />

          {/* Floating telemetry chip — real state only, per ui.html:220-227 */}
          <div className="lg:col-span-6 relative flex justify-center items-center">
            <div className="absolute -top-2 right-4 sm:right-8 lg:-right-4 z-30 bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-xl border border-gold/40 shadow-card flex items-center space-x-2.5 font-mono text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  ready ? 'bg-emerald-500' : 'bg-gold'
                } ${scanning ? 'animate-pulse' : ''}`}
              />
              <div>
                <span className="text-noir/50 text-[10px] block">
                  {scanning ? 'RETRIEVING PAGE' : 'NEAREST PAGE'}
                </span>
                <span className="font-semibold text-noir">
                  {top
                    ? `${formatPage(top.page_number)} · Cosine ${formatScore(top.score)}`
                    : scanning
                      ? 'querying index…'
                      : 'no page retrieved'}
                </span>
              </div>
            </div>

            <DocumentCard />
          </div>
        </div>
      </section>

      <ChatSection />
    </div>
  )
}
