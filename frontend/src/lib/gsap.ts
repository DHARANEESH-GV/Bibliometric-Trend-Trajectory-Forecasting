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

/** True when motion should be silenced: the in-app Motion toggle (lib/motion)
 *  wins over the OS setting. Single verdict for every animation site. */
import { motionReduced } from './motion'
export function prefersReducedMotion(): boolean {
  return motionReduced()
}

export { gsap, ScrollTrigger, useGSAP }
