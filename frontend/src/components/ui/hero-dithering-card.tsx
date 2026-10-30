/**
 * hero-dithering-card — clean, high-performance CTA card with double-bezel glass
 * architecture and smooth micro-interactions.
 */
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { useState, useRef, type ReactNode } from 'react'
import { gsap, useGSAP, prefersReducedMotion } from '../../lib/gsap'

export interface CTASectionProps {
  /** Small pill copy above the headline (kept the live ping dot). */
  kicker: string
  /** Headline: [plain line, dimmed line]. */
  titleLines: [string, string]
  /** Supporting copy under the headline. */
  description: ReactNode
  /** Button label. */
  ctaLabel: string
  /** Button action (Biblio: the curtain entry into the observatory). */
  onCta: () => void
  /** Accent color (optional). */
  shaderColor?: string
  /** Accessible name for the interaction region. */
  ariaLabel?: string
}

export function CTASection({
  kicker,
  titleLines,
  description,
  ctaLabel,
  onCta,
  ariaLabel,
}: CTASectionProps) {
  const [, setIsHovered] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Magnetic hover: the CTA leans toward the cursor. Self-contained in the
  // card, silenced by reduced motion. quickTo keeps it outside React render.
  useGSAP(
    () => {
      const btn = btnRef.current
      if (!btn || prefersReducedMotion()) return
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3' })
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3' })
      const move = (e: MouseEvent) => {
        const r = btn.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        xTo(dx * 0.12)
        yTo(dy * 0.18)
      }
      const reset = () => { xTo(0); yTo(0) }
      const zone = rootRef.current
      zone?.addEventListener('mousemove', move, { passive: true })
      zone?.addEventListener('mouseleave', reset)
      return () => {
        zone?.removeEventListener('mousemove', move)
        zone?.removeEventListener('mouseleave', reset)
      }
    },
  )

  return (
    <section className="py-12 w-full flex justify-center items-center px-4 md:px-6" aria-label={ariaLabel}>
      <div
        ref={rootRef}
        className="w-full max-w-7xl relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Outer shell: the aluminum tray the glass plate sits in */}
        <div className="rounded-[2.75rem] p-1.5 bg-primary/5 ring-1 ring-black/5 dark:ring-white/10 shadow-[0_16px_48px_-16px_rgba(23,21,18,0.22)]">
          {/* Inner core: concentric radius = outer - padding */}
          <div className="relative overflow-hidden rounded-[calc(2.75rem-0.375rem)] border border-border bg-card min-h-[600px] md:min-h-[600px] flex flex-col items-center justify-center duration-500">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-primary/5 pointer-events-none" />

            <div className="relative z-10 px-6 max-w-4xl mx-auto text-center flex flex-col items-center">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary backdrop-blur-sm">
                {kicker}
              </div>

              {/* Headline */}
              <h2 className="font-serif text-5xl md:text-7xl lg:text-8xl font-medium tracking-tight text-foreground mb-8 leading-[1.05] [text-wrap:balance]">
                {titleLines[0]} <br />
                <span className="text-foreground/80">{titleLines[1]}</span>
              </h2>

              {/* Description */}
              <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mb-12 leading-relaxed">
                {description}
              </p>

              {/* Action */}
              <button
                ref={btnRef}
                type="button"
                onClick={onCta}
                className="group relative inline-flex items-center gap-3 rounded-full bg-foreground px-8 py-4 text-base font-medium text-background shadow-lg transition-all duration-300 hover:bg-foreground/90 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span>{ctaLabel}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background/15 transition-transform duration-300 group-hover:translate-x-0.5">
                  <ArrowRight weight="light" className="h-4 w-4 text-background" />
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
