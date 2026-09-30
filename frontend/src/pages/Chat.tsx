import { AmbientDark } from '@/components/layout/Ambient'
import { ChatPanel } from '@/components/chat/ChatPanel'

/**
 * Dedicated chat route. Same panel as the landing band, so the two cannot
 * drift — see ChatSection.
 */
export function Chat() {
  return (
    <div className="on-noir relative flex-1 bg-noir text-ivory pt-20 flex flex-col">
      <AmbientDark />
      <div className="relative z-10 flex-1 flex flex-col justify-center py-10">
        <div className="max-w-7xl mx-auto px-6 w-full">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <h1 className="font-serif text-3xl sm:text-4xl text-ivory font-normal tracking-tight">
              Conversational retrieval
            </h1>
            <p className="text-ivory/60 text-sm mt-2 font-sans">
              Answers grounded in retrieved pages, with page citations and cosine scores.
            </p>
          </div>
          <ChatPanel className="max-h-none" />
        </div>
      </div>
    </div>
  )
}
