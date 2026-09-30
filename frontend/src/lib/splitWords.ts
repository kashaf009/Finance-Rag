import { useMemo } from 'react'

/**
 * Splits a line into word spans for a masked reveal.
 *
 * GSAP's SplitText is a premium plugin, so this does the minimum needed:
 * words become spans inside an overflow-hidden mask. Whitespace between words
 * is preserved explicitly so the text still wraps and copies correctly.
 *
 * RENDERING RULE for consumers: emit `word.space` as a SIBLING of the word
 * span, never as a child of it. A word span is `display: inline-block`, and a
 * space at the end of an inline-block's own line box is collapsed away by CSS.
 * The text then renders as "Everyanswer" while `textContent` still reports
 * "Every answer", so text-level assertions all pass and the bug only shows up
 * in a browser. See the guard in `__tests__/hero.test.tsx`.
 *
 * Use a plain space, not &nbsp;: a non-breaking space removes the line-break
 * opportunity and overflows narrow viewports.
 */
export interface WordSpan {
  text: string
  /** Whitespace to render after this word, as a sibling node. */
  space: string
}

export function splitWords(line: string): WordSpan[] {
  return useMemo(() => {
    const parts = line.split(/(\s+)/)
    const out: WordSpan[] = []
    for (const part of parts) {
      if (part === '') continue
      if (/^\s+$/.test(part)) {
        if (out.length > 0) out[out.length - 1].space += part
      } else {
        out.push({ text: part, space: '' })
      }
    }
    return out
  }, [line])
}
