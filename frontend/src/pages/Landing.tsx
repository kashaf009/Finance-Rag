import { AmbientLight } from '@/components/layout/Ambient'
import { HeroLeft } from '@/components/hero/HeroLeft'

export function Landing() {
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

          {/* Document card lands in step 5. */}
          <div className="lg:col-span-6 relative flex justify-center items-center min-h-[420px]">
            <p className="font-mono text-xs text-noir/40">Step 5 — document card.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
