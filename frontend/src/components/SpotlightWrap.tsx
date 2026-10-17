/**
 * Spotlight border light (ported from the cover, then reworked). A soft
 * pool of accent light plus a crisp lit edge follow the pointer via two
 * CSS vars set directly on the host element, so there is no React
 * re-render per frame.
 *
 * Two entry points:
 *  - SpotlightWrap: convenience wrapper for non-sticky panels.
 *  - useSpotlight() + <SpotlightRing>: for panels that must remain the
 *    grid/flex item themselves (e.g. position: sticky asides), where an
 *    extra wrapper would break sticky travel.
 */
import { useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'

export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const onMouseMove = (e: ReactMouseEvent<T>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  return { ref, onMouseMove }
}

export function SpotlightRing() {
  return <span className="spotlight-ring" aria-hidden />
}

interface SpotlightWrapProps {
  children: ReactNode
  className?: string
}

export function SpotlightWrap({ children, className }: SpotlightWrapProps) {
  const { ref, onMouseMove } = useSpotlight<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={className ? `spotlight-host ${className}` : 'spotlight-host'}
      onMouseMove={onMouseMove}
    >
      <SpotlightRing />
      {children}
    </div>
  )
}
