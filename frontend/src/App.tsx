export default function App() {
  return (
    <div className="min-h-screen bg-ivory px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <h1 className="font-serif text-4xl text-noir">Scaffold OK</h1>
        <p className="mt-2 font-mono text-sm text-noir/60">
          Step 1 — tokens wired from ui.html
        </p>
        <div className="mt-6 flex gap-3">
          <span className="rounded-full bg-gold/15 px-3 py-1 font-mono text-xs text-gold-dark">
            gold
          </span>
          <span className="rounded-full bg-noir px-3 py-1 font-mono text-xs text-ivory">
            noir
          </span>
          <span className="rounded-full border border-noir/10 px-3 py-1 font-mono text-xs text-noir/70">
            serif
          </span>
        </div>
      </div>
    </div>
  )
}
