/**
 * RevealShell — shared scroll-entrance choreography for workbench views.
 * Header rises first, then panels/rows cascade with a stagger. The
 * fromTo + targeted clearProps pattern (never `from`, never 'all') so a
 * re-run can never latch onto stale transforms or wipe inline styles.
 * Skipped entirely under reduced motion.
 */
import { useRef, type ReactNode } from 'react'
import { gsap, useGSAP, prefersReducedMotion } from '../lib/gsap'

interface RevealShellProps {
  children: ReactNode
  /** Selector for the cascade targets (default: panels). */
  rowSelector?: string
}

export function RevealShell({ children, rowSelector = '.panel:not(.spotlight-host)' }: RevealShellProps) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const ctx = gsap.context(() => {
        gsap.fromTo(
          'header',
          { y: 18, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: 0.6,
            ease: 'power2.out',
            clearProps: 'transform,opacity,visibility',
          },
        )
        gsap.fromTo(
          rowSelector,
          { y: 14, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: 0.45,
            ease: 'power2.out',
            stagger: 0.045,
            delay: 0.15,
            // Targeted cleanup ONLY of the animation props — 'all' wiped
            // inline grid styles and broke layouts. Sticky hosts
            // (.spotlight-host) are excluded: a transform on a sticky
            // element creates a containing block and breaks the stick.
            clearProps: 'transform,opacity,visibility',
          },
        )
      }, ref)
      return () => ctx.revert()
    },
    { scope: ref },
  )
  return <div ref={ref}>{children}</div>
}
