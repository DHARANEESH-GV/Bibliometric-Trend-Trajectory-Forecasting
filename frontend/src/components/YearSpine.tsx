/**
 * YearSpine — the observatory's time instrument: a fixed vertical year
 * ruler (2000-2025) on the right viewport edge, with a playhead that
 * scrubs with scroll progress through the host view. Decade epochs get
 * emphasized ticks. Mounted only on the two time-based views (Trajectory,
 * Matrix) — the spine means "time" and belongs where time is the axis.
 * ScrollTrigger scrub, transform-only, aria-hidden, hidden <1100px and
 * static under reduced motion.
 */
import { useRef } from 'react'
import { gsap, useGSAP, prefersReducedMotion } from '../lib/gsap'

const YEARS = Array.from({ length: 26 }, (_, i) => 2000 + i)
const EPOCHS = new Set([2000, 2005, 2010, 2015, 2020, 2025])

export function YearSpine() {
  const root = useRef<HTMLDivElement>(null)
  const playhead = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLSpanElement>(null)

  useGSAP(
    () => {
      const ph = playhead.current
      const ro = readout.current
      if (!ph || !ro || prefersReducedMotion()) return

      // Scrub the playhead down the ruler with PAGE scroll progress (the
      // spine itself is fixed and never scrolls — triggering on it parks
      // the playhead forever). Transform-only: the playhead sits at the
      // ruler top and translates by the ruler's measured height.
      const ruler = ph.parentElement
      const travel = ruler ? ruler.offsetHeight - ph.offsetHeight : 400
      const setYear = (progress: number) => {
        const year = Math.round(2000 + progress * 25)
        ro.textContent = String(year)
      }
      const tween = gsap.fromTo(
        ph,
        { y: 0 },
        {
          y: travel,
          ease: 'none',
          scrollTrigger: {
            start: 0,
            end: 'max',
            scrub: 0.4,
            onUpdate: (self) => setYear(self.progress),
          },
        },
      )
      setYear(0)
      return () => {
        tween.scrollTrigger?.kill()
        tween.kill()
      }
    },
    { scope: root },
  )

  return (
    <div ref={root} className="year-spine" aria-hidden>
      <div className="year-spine-ruler">
        {YEARS.map((y) => (
          <span
            key={y}
            className={`year-spine-tick${EPOCHS.has(y) ? ' year-spine-tick--epoch' : ''}`}
            style={{ top: `${((y - 2000) / 25) * 100}%` }}
          >
            {EPOCHS.has(y) ? (
              <span className="year-spine-label year-spine-label--epoch">{y}</span>
            ) : null}
          </span>
        ))}
        <div ref={playhead} className="year-spine-playhead" style={{ top: '0%' }}>
          <span ref={readout} className="year-spine-readout">
            2000
          </span>
        </div>
      </div>
    </div>
  )
}
