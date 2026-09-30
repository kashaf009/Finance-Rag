import { ChatPanel } from '@/components/chat/ChatPanel'

/**
 * The dark chat band on the landing page — ui.html:315-331.
 *
 * The section chrome (eyebrow, serif heading, sub) is the only thing lifted
 * from the mock; the panel itself is the shared component, identical to the
 * one at /chat.
 *
 * "LIVE SEC EDGAR VECTOR SESSION" in ui.html:323 is reworded to describe what
 * this backend actually is: a single local PDF index. There is no EDGAR feed.
 */
export function ChatSection() {
  return (
    <section
      className="relative py-20 bg-noir text-ivory border-t border-gold/25 z-10"
      id="chat-interface"
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,164,92,0.12),transparent_70%)] pointer-events-none"
        aria-hidden
      />
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-gold/15 border border-gold/30 text-gold-light text-xs font-mono mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
            <span>SELF-RAG · LOCAL VECTOR INDEX</span>
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl text-ivory font-normal tracking-tight">
            Conversational retrieval
          </h2>
          <p className="text-ivory/60 text-sm mt-2 font-sans font-normal">
            Answers grounded in retrieved pages, with page citations and cosine scores.
          </p>
        </div>

        <ChatPanel />
      </div>
    </section>
  )
}
