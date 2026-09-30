import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { prefersReducedMotion } from '@/lib/gsap'

interface MetricCardProps {
  /** Mono uppercase label above the value. */
  label: string
  /**
   * The figure itself. Numeric values count up; anything else renders as
   * text. Null renders an em dash so a degraded index never shows a fake 0.
   */
  value: string | number | null
  /** Small sans caption under the value. */
  hint?: string
  /** Show the emerald status dot, per the third card in ui.html. */
  accent?: boolean
  /** Dim the card when the backing value is unavailable. */
  muted?: boolean
}

/**
 * One metric tile from ui.html:187-204, fed by live API values rather than
 * the mock's invented figures.
 */
export function MetricCard({ label, value, hint, accent = false, muted = false }: MetricCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef<HTMLDivElement>(null)
  const isNumeric = typeof value === 'number'
  const display = value == null ? '—' : isNumeric ? value.toLocaleString('en-US') : (value as string)

  useEffect(() => {
    // Text values have nothing to count, and a missing value is not a zero.
    if (!isNumeric || !valueRef.current || value == null) return
    if (prefersReducedMotion()) return

    const node = valueRef.current
    const start = () => {
      const counter = { v: 0 }
      const tween = gsap.to(counter, {
        v: value as number,
        duration: 1.1,
        ease: 'power2.out',
        onUpdate: () => {
          node.textContent = Math.round(counter.v).toLocaleString('en-US')
        },
        onComplete: () => {
          // Land on the exact server value, not a rounded intermediate.
          node.textContent = display
        },
      })
      return () => {
        tween.kill()
        node.textContent = display
      }
    }

    // Only count up once the card is actually on screen; animating values
    // that are still below the fold just burns frames.
    const cardEl = cardRef.current
    if (typeof IntersectionObserver === 'undefined' || !cardEl) {
      return start()
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect()
            start()
          }
        }
      },
      { threshold: 0.4 },
    )
    io.observe(cardEl)
    return () => io.disconnect()
  }, [isNumeric, value, display])

  // Text values (e.g. "Cosine") need a smaller size to sit on the same
  // baseline as a numeric one.
  const valueSize = isNumeric ? 'text-lg' : 'text-sm'

  return (
    <div
      ref={cardRef}
      className={`p-3 rounded-xl bg-white/80 border border-noir/10 shadow-sm backdrop-blur-sm ${
        muted ? 'opacity-50' : ''
      }`}
    >
      <div
        className={`text-[11px] font-mono uppercase tracking-wider ${
          accent ? 'text-emerald-700' : 'text-noir/50'
        } ${accent ? 'flex items-center space-x-1' : ''}`}
      >
        {accent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
        <span>{label}</span>
      </div>
      {/*
        data-value always carries the true figure. The visible text is what
        the count-up writes, so mid-animation the DOM still reports the real
        number to assistive tech and to anything reading the attribute.
      */}
      <div
        ref={valueRef}
        data-value={display}
        className={`${valueSize} font-mono font-bold text-noir mt-0.5`}
      >
        {display}
      </div>
      {hint && <div className="text-[11px] text-noir/70 font-sans mt-0.5">{hint}</div>}
    </div>
  )
}
