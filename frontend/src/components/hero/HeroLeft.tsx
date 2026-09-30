import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import gsap from 'gsap'

import { MetricCard } from '@/components/hero/MetricCard'
import { useHealth } from '@/hooks/useHealth'
import { useGsapContext } from '@/lib/gsap'
import { splitWords } from '@/lib/splitWords'

const HEADLINE_LINES = ['Every answer, anchored', 'to a page.'] as const

/** Line of headline text split into masked word spans. */
function HeadlineLine({ line, italic = false }: { line: string; italic?: boolean }) {
  const words = splitWords(line)
  return (
    <span className="mask-lines">
      {words.map((word, i) => (
        // The space must be a SIBLING of the word span, never a child of it.
        // Inside an inline-block it counts as trailing whitespace and CSS
        // discards it, so the words render glued together ("Everyanswer")
        // even though textContent still reports a space.
        <Fragment key={`${word.text}-${i}`}>
          <span
            className="inline-block will-animate"
            data-hero-word
            style={italic ? { fontStyle: 'italic', fontWeight: 300 } : undefined}
          >
            {word.text}
          </span>
          {word.space ? ' ' : null}
        </Fragment>
      ))}
    </span>
  )
}

export function HeroLeft() {
  const { data: health, isError } = useHealth()
  const points = health?.points ?? null
  const ready = Boolean(health?.collection_ready) && (health?.points ?? 0) > 0

  // Timings follow ui.html:556-561 exactly. The headline reveal is upgraded
  // from a single block tween to a per-line masked stagger.
  const { scope } = useGsapContext<HTMLDivElement>((root, reduced) => {
    const q = gsap.utils.selector(root)

    if (reduced) {
      gsap.set([q('#hero-eyebrow'), q('#hero-subheadline'), q('#hero-metrics > div')], {
        opacity: 1,
        y: 0,
      })
      gsap.set(q('[data-hero-word]'), { yPercent: 0, opacity: 1 })
      return
    }

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

    tl.from(q('#hero-eyebrow'), { y: 20, opacity: 0, duration: 0.6 }, 0.25)
      // Gold hairline draws out from the pill as it lands.
      .from(q('#hero-eyebrow-underline'), { scaleX: 0, transformOrigin: 'left center', duration: 0.7 }, 0.55)
      .from(
        q('[data-hero-word]'),
        { yPercent: 110, opacity: 0, duration: 0.85, ease: 'power4.out', stagger: 0.055 },
        0.4,
      )
      .from(q('#hero-rule'), { scaleX: 0, transformOrigin: 'left center', duration: 0.8 }, 0.62)
      .from(q('#hero-subheadline'), { y: 20, opacity: 0, duration: 0.7 }, 0.6)
      .from(q('#hero-metrics > div'), { y: 15, opacity: 0, stagger: 0.1, duration: 0.6 }, 0.75)
      .from(q('#hero-actions'), { y: 18, opacity: 0, duration: 0.6 }, 0.95)

    return () => {
      tl.kill()
    }
  }, [])

  return (
    <div className="lg:col-span-6 flex flex-col space-y-6" ref={scope}>
      {/* Eyebrow pill — ui.html:170-175 */}
      <div
        className="inline-flex items-center space-x-2 w-fit px-3.5 py-1.5 rounded-full bg-gold/10 border border-gold/30 text-noir text-[11px] font-mono tracking-wider relative overflow-hidden"
        id="hero-eyebrow"
      >
        <span className="w-2 h-2 rounded-full bg-gold animate-ping" />
        <span className="font-semibold text-gold-dark tracking-wide uppercase">
          Page-Level Vision Retrieval
        </span>
        <span className="text-noir/30">|</span>
        <span className="text-noir/70 font-medium">
          {points != null ? `${points} pages indexed` : 'checking index…'}
        </span>
        <span
          id="hero-eyebrow-underline"
          className="absolute bottom-0 left-0 h-px w-full bg-gold/60 will-animate"
        />
      </div>

      {/* Headline — ui.html:177-180, word-masked.
          The two lines are flex items (see .headline), not <br />-separated: a
          br leaves no whitespace in textContent, so the lines read as
          "anchoredto a page." when copied or announced. The explicit {' '}
          below is what puts the space back into the text; in a flex container
          a whitespace-only node renders nothing, so it adds no visual gap.
          Font sizes are arbitrary on purpose. text-4xl/text-5xl also emit a
          line-height, and their media-query rules win on source order, which
          silently overrides leading-[1.08] and collapses the serif leading. */}
      <h1 className="headline font-serif text-[36px] sm:text-[48px] lg:text-[58px] leading-[1.08] tracking-[-0.025em] text-noir font-normal">
        <HeadlineLine line={HEADLINE_LINES[0]} />
        {/* Separator. Must be an explicit expression: whitespace-only JSX text
            is dropped by the transform, which left the lines reading
            "anchoredto a page.". It contributes nothing visually — .headline
            is a flex container, so a whitespace-only node makes no box and the
            vertical gap comes from `gap` — but it is what puts the word
            boundary into textContent for copy-paste and screen readers. */}
        {'\u0020'}
        <HeadlineLine line={HEADLINE_LINES[1]} italic />
        <span
          id="hero-rule"
          className="block mt-4 h-px w-24 bg-noir/15 will-animate"
          aria-hidden
        />
      </h1>

      {/* Subtitle — ui.html:182-184 */}
      <p
        className="text-noir/75 text-base sm:text-lg leading-relaxed max-w-xl font-sans font-normal"
        id="hero-subheadline"
      >
        {points != null ? (
          <>
            {points} pages of the J.P. Morgan SE 2023 annual report, embedded page by page.
            Answers carry page citations and cosine scores — and are refused outright when the
            evidence is not there.
          </>
        ) : (
          <>
            Page-by-page retrieval over the J.P. Morgan SE 2023 annual report. Answers carry
            page citations and cosine scores — and are refused outright when the evidence is not
            there.
          </>
        )}
      </p>

      {/* Metric cards — ui.html:186-205, all values live */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2" id="hero-metrics">
        <MetricCard
          label="Index Size"
          value={points}
          hint="Indexed page vectors"
          muted={isError}
        />
        <MetricCard
          label="Embedding"
          value={health?.vector_size ?? null}
          hint={health?.embed_model ?? 'embedder unavailable'}
          muted={isError}
        />
        <MetricCard
          label="Similarity"
          value="Cosine"
          hint="Qdrant distance metric"
          accent={ready}
          muted={isError}
        />
      </div>

      {/* Actions — ui.html:207-216 */}
      <div className="pt-2 flex flex-wrap items-center gap-4" id="hero-actions">
        <Link
          to="/chat"
          className="inline-flex items-center space-x-2.5 px-6 py-3.5 rounded-full bg-noir text-ivory text-sm font-semibold shadow-lg hover:shadow-gold-subtle hover:bg-noir-light transition-all duration-200 border border-noir"
        >
          <span>Launch Chat Interface</span>
          <ArrowRight className="w-4 h-4 text-gold" />
        </Link>
        <div className="flex items-center space-x-2 text-xs font-mono text-noir/60 pl-2">
          <ShieldCheck className="w-4 h-4 text-gold" />
          <span>
            {health?.llm_model ? `Local inference · ${health.llm_model}` : 'Local inference'}
          </span>
        </div>
      </div>
    </div>
  )
}
