/**
 * RouteTransition — a short entrance beat each time the pathname changes,
 * so workbench navigation feels continuous rather than a hard swap. The
 * canvas node persists across route changes (only its children swap), so
 * the tween runs on the stable wrapper. Skipped on first mount (the cover's
 * cinema curtain already owns that arrival) and silenced under reduced
 * motion. Transform/opacity only, cleaned up via useGSAP context.
 *
 * SIGNAL/WIRE: an ink-wipe overlay sweeps across on every route change —
 * the cover curtain's language extended into the app. The wipe is a fixed
 * overlay that scales X across the viewport, then hands off to the
 * content fade. z-index 100 (documented curtain layer).
 */
import { useRef, type ReactNode } from 'react'
import { gsap, useGSAP, prefersReducedMotion } from '../lib/gsap'

interface RouteTransitionProps {
  routeKey: string
  children: ReactNode
}

export function RouteTransition({ routeKey, children }: RouteTransitionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const wipe = useRef<HTMLDivElement>(null)
  const firstRun = useRef(true)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (firstRun.current) {
        firstRun.current = false
        return
      }
      if (prefersReducedMotion()) return

      const wipeEl = wipe.current
      const tl = gsap.timeline()
      if (wipeEl) {
        // Ink sweep: wipe grows from the right, then exits left.
        tl.fromTo(
          wipeEl,
          { scaleX: 0, transformOrigin: 'right center' },
          { scaleX: 1, duration: 0.28, ease: 'power3.in' },
        )
          .set(wipeEl, { transformOrigin: 'left center' })
          .to(wipeEl, { scaleX: 0, duration: 0.34, ease: 'power3.out' }, '+=0.04')
      }
      tl.fromTo(
        el,
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.38,
          ease: 'power3.out',
          clearProps: 'transform,opacity,visibility',
        },
        wipeEl ? '-=0.30' : '0',
      )
      return () => {
        tl.kill()
      }
    },
    { dependencies: [routeKey], scope: ref },
  )

  return (
    <>
      <div ref={wipe} className="ink-wipe" aria-hidden />
      <div ref={ref} className="route-canvas">
        {children}
      </div>
    </>
  )
}
