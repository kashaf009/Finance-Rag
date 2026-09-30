import { AmbientLight } from '@/components/layout/Ambient'

export function Landing() {
  return (
    <div className="relative min-h-screen pt-20">
      <AmbientLight />
      <p className="relative z-10 mx-auto max-w-7xl px-6 py-24 font-mono text-sm text-noir/50">
        Step 3 — landing shell. Hero lands in step 4.
      </p>
    </div>
  )
}
