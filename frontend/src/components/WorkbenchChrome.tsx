/**
 * WorkbenchChrome — the SIGNAL/WIRE chrome layer: pointer light pool,
 * instrument reticle, and scroll progress hairline. All fixed, all
 * pointer-events none, all transform/opacity. The light pool tracks the
 * cursor via CSS vars (passive listener, rAF-throttled); the reticle
 * follows with a quickTo tween; the progress hairline scrubs with
 * ScrollTrigger. Everything silenced under reduced motion / coarse
 * pointers (CSS + JS guards).
 */
import { useRef } from 'react'
import { gsap, useGSAP, prefersReducedMotion } from '../lib/gsap'

export function WorkbenchChrome() {
  const pool = useRef<HTMLDivElement>(null)
  const reticle = useRef<HTMLDivElement>(null)
  const progress = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const poolEl = pool.current
      const ret = reticle.current
      const prog = progress.current

      // Light pool: CSS var update, rAF-throttled (no layout, paint only).
      let raf = 0
      let mx = 0
      let my = 0
      const onMove = (e: PointerEvent) => {
        mx = e.clientX
        my = e.clientY
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          if (poolEl) {
            poolEl.style.setProperty('--pool-x', `${mx}px`)
            poolEl.style.setProperty('--pool-y', `${my}px`)
            poolEl.classList.add('light-pool--on')
          }
          if (ret) ret.classList.add('reticle--on')
        })
      }
      const onLeave = () => {
        poolEl?.classList.remove('light-pool--on')
        ret?.classList.remove('reticle--on')
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeave)

      // Reticle follows with a quickTo tween (spring-ish, transform only).
      let moveX: ((v: number) => void) | null = null
      let moveY: ((v: number) => void) | null = null
      if (ret) {
        moveX = gsap.quickTo(ret, 'x', { duration: 0.35, ease: 'power3.out' })
        moveY = gsap.quickTo(ret, 'y', { duration: 0.35, ease: 'power3.out' })
        const onMoveRet = (e: PointerEvent) => {
          moveX?.(e.clientX)
          moveY?.(e.clientY)
        }
        window.addEventListener('pointermove', onMoveRet, { passive: true })
      }

      // Scroll progress hairline: scaleX scrub, transform only.
      let progTween: gsap.core.Tween | null = null
      if (prog) {
        progTween = gsap.fromTo(
          prog,
          { scaleX: 0 },
          {
            scaleX: 1,
            ease: 'none',
            scrollTrigger: {
              start: 0,
              end: 'max',
              scrub: 0.3,
            },
          },
        )
      }

      return () => {
        window.removeEventListener('pointermove', onMove)
        document.documentElement.removeEventListener('pointerleave', onLeave)
        if (raf) cancelAnimationFrame(raf)
        progTween?.scrollTrigger?.kill()
        progTween?.kill()
      }
    },
    { scope: pool },
  )

  return (
    <>
      <div ref={pool} className="light-pool" aria-hidden />
      <div ref={reticle} className="reticle" aria-hidden />
      <div ref={progress} className="scroll-progress" aria-hidden />
    </>
  )
}
