/**
 * lib/gsap.ts — ONE place where GSAP plugins are registered.
 * Import { gsap } from here everywhere; never from 'gsap' directly.
 * ScrollTrigger drives scroll-reveals; useGSAP (@gsap/react) keeps
 * animation context scoped to components so cleanup is automatic.
 */
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

/** True when the user asked for reduced motion; animations become no-ops
 *  and content renders fully visible instead. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export { gsap, ScrollTrigger, useGSAP }
