/**
 * useInViewOnce — flips to true the first time the element scrolls into the
 * viewport, and stays true afterwards.
 *
 * Why this exists: both the time-lapse and the bar race auto-play on mount,
 * driving an ECharts setOption every 420/650 ms. On /matrix those panels sit
 * 1-3 viewport-heights below the fold, so the browser was repainting two
 * charts the user could not see — measured at 43 fps while scrolling the
 * matrix versus 60 fps with motion off. Gating autoplay on visibility keeps
 * the "the film should already be running when you reach it" intent while
 * never animating an off-screen chart.
 *
 * Deliberately NOT a visibility toggle: once true it stays true, so a panel
 * that scrolls back out keeps its state (and any user-chosen pause holds).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export function useInViewOnce<T extends HTMLElement>(
  rootMargin = '200px',
): { ref: React.RefCallback<T>; inView: boolean } {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  const attach = useCallback((node: T | null) => {
    ref.current = node
  }, [])

  useEffect(() => {
    if (inView) return
    const el = ref.current
    if (!el) return
    // No IntersectionObserver (very old browser / test env): behave as
    // visible so the autoplay is not silently disabled.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView, rootMargin])

  return { ref: attach, inView }
}
