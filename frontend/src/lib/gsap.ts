import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'

/**
 * True when the OS asks for reduced motion.
 *
 * Every animation in this app must branch on this: one-shot reveals collapse
 * to a fade, infinite loops never start. Reading it in an effect (rather than
 * at module scope) keeps it reactive to the user toggling the setting.
 */
export function usePrefersReducedMotion(): boolean {
  const ref = useRef(false)

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      ref.current = mq.matches
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return ref.current
}

/** Synchronous one-shot read, for animation setup inside useLayoutEffect. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface GsapScope<T extends HTMLElement = HTMLElement> {
  /** gsap.context scope ref, so selectors resolve inside this subtree. */
  scope: React.RefObject<T>
}

/**
 * Runs a GSAP setup inside a `gsap.context` scoped to the returned ref, so
 * every selector and tween is cleaned up on unmount. This is the React-safe
 * equivalent of gsap.context() and prevents the classic "tween on an
 * unmounted node" leak.
 *
 * T is the element type the returned ref will be attached to, so the ref
 * stays assignable to `header`, `section`, `div`, etc.
 */
export function useGsapContext<T extends HTMLElement = HTMLElement>(
  setup: (scope: T, reduced: boolean) => void,
  deps: unknown[] = [],
): GsapScope<T> {
  const scope = useRef<T>(null)

  useLayoutEffect(() => {
    const el = scope.current
    if (!el) return

    const reduced = prefersReducedMotion()
    const ctx = gsap.context(() => setup(el, reduced), el)
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { scope }
}
