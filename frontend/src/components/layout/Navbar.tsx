import { Link, NavLink } from 'react-router-dom'
import { ArrowDown } from 'lucide-react'
import { useIndexReady } from '@/hooks/useHealth'

/** Triangle mark from ui.html:113-117. */
function BrandMark() {
  return (
    <div className="w-10 h-10 rounded-xl bg-noir flex items-center justify-center shadow-md relative overflow-hidden group-hover:border group-hover:border-gold/60 transition-all duration-300">
      <div className="absolute inset-0 bg-gradient-to-tr from-noir via-noir to-gold/25 opacity-0 group-hover:opacity-100 transition-opacity" />
      <svg
        className="w-5 h-5 text-gold relative z-10 transition-transform duration-300 group-hover:scale-105"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        viewBox="0 0 24 24"
        aria-hidden
      >
        <polygon points="12 2 2 22 22 22" strokeLinecap="round" strokeLinejoin="round" />
        <line stroke="#E5C77D" strokeWidth={1.6} x1="7" x2="17" y1="14" y2="14" />
        <circle cx="12" cy="9" fill="#C9A45C" r="1.5" stroke="none" />
      </svg>
    </div>
  )
}

const linkBase =
  'hover:text-noir transition-colors relative py-1 group text-xs font-medium tracking-wide'
const linkUnderline =
  'absolute bottom-0 left-0 w-0 h-[1.5px] bg-gold transition-all duration-200 group-hover:w-full'

/**
 * Real liveness instead of the mock's "EDGAR Ingestion Live · P99 28ms".
 * Shows the point count the index actually holds, or why it is not ready.
 */
function StatusPill() {
  const { isPending, isError, ready, points } = useIndexReady()

  const tone = isError
    ? 'border-red-500/25 bg-red-500/5 text-red-700'
    : ready
      ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-800'
      : 'border-gold/30 bg-gold/5 text-gold-dark'

  const dot = isError ? 'bg-red-500' : ready ? 'bg-emerald-500' : 'bg-gold'

  const label = isPending
    ? 'Checking index…'
    : isError
      ? 'Backend unreachable'
      : ready
        ? `Index Ready · ${points} pages`
        : 'Index empty or not ready'

  return (
    <div
      className={`hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-full border ${tone} text-[11px] font-mono shadow-sm`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${dot} ${isPending ? 'animate-pulse' : 'animate-pulse'}`}
      />
      <span>{label}</span>
    </div>
  )
}

export function Navbar() {
  return (
    <header
      className="fixed top-0 left-0 w-full z-50 bg-ivory/90 backdrop-blur-md border-b border-noir/10 transition-all duration-300"
      id="main-nav"
    >
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center space-x-3.5 group" aria-label="Finance RAG home">
          <BrandMark />
          <div className="flex flex-col">
            <div className="flex items-center space-x-2">
              <span className="font-sans font-extrabold tracking-[0.2em] text-sm text-noir">
                FINANCE RAG
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/15 text-gold-dark font-mono font-medium tracking-tight">
                SELF-RAG
              </span>
            </div>
            <span className="text-[10px] font-mono tracking-widest text-noir/50 uppercase -mt-0.5">
              Grounded Annual Report Intelligence
            </span>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center space-x-8 text-noir/70">
          <NavLink
            to="/chat"
            className={({ isActive }) =>
              `text-noir font-semibold flex items-center space-x-1.5 py-1 transition-colors hover:text-gold-dark text-xs font-medium tracking-wide ${
                isActive ? 'text-noir' : ''
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-gold animate-pulse' : 'bg-gold/40'}`}
                />
                <span>RAG Pipeline</span>
              </>
            )}
          </NavLink>
          <NavLink to="/document" className={linkBase}>
            Document Reader
            <span className={linkUnderline} />
          </NavLink>
          <a href="/#grounding" className={linkBase}>
            Grounding
            <span className={linkUnderline} />
          </a>
        </nav>

        <div className="flex items-center space-x-3.5">
          <StatusPill />
          <Link
            to="/chat"
            className="relative group overflow-hidden rounded-full bg-noir px-5 py-2.5 text-xs font-semibold text-ivory shadow-subtle hover:shadow-gold-subtle transition-all duration-300 flex items-center space-x-2 border border-noir hover:border-gold/60"
          >
            <span className="relative z-10 flex items-center space-x-2">
              <span>Enter Chat Interface</span>
              <ArrowDown className="w-3.5 h-3.5 text-gold transition-transform group-hover:translate-y-0.5" />
            </span>
            <span className="absolute inset-0 bg-gradient-to-r from-gold/0 via-gold/20 to-gold/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          </Link>
        </div>
      </div>
    </header>
  )
}
