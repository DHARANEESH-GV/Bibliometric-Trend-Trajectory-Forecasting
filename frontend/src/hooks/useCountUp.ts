/**
 * useCountUp — rolls a number from 0 to `value` the first time it enters
 * the viewport. Honesty rule: the FINAL rendered value is always exactly
 * `value` (no rounding drift), the animation is purely visual. Under
 * prefers-reduced-motion the value renders immediately.
 */
import { useEffect, useRef, useState } from 'react'
import { gsap, prefersReducedMotion } from '../lib/gsap'

export function useCountUp(value: number, decimals = 0): {
  ref: React.RefObject<HTMLElement | null>
  display: string
} {
  const ref = useRef<HTMLElement | null>(null)
  const [current, setCurrent] = useState(() =>
    prefersReducedMotion() ? value : 0,
  )
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion()) {
      setCurrent(value)
      return
    }
    if (started.current) return
    started.current = true
    const state = { n: 0 }
    const tween = gsap.to(state, {
      n: value,
      duration: 1.4,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      onUpdate: () => setCurrent(state.n),
      onComplete: () => setCurrent(value), // guarantee exact final value
    })
    return () => {
      tween.kill()
    }
  }, [value])

  return {
    ref,
    display: current.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  }
}
