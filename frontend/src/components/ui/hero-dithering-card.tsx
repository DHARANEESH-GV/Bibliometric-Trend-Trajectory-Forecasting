/**
 * hero-dithering-card — shadcn-convention CTA card with a paper-dithering
 * shader backdrop (via @paper-design/shaders-react, lazily loaded).
 *
 * Adapted for Biblio from the community reference component: copy is
 * prop-driven (no hardcoded SaaS claims), the CTA is wired to a caller-
 * supplied action (the cover's curtain entry), and the shader accent is
 * passed in (default: the house amber). Kept from the original: the
 * lazy-load + Suspense fallback, hover-speed state, mix-blend behavior,
 * rounded-[48px] card, ping-dot kicker, serif headline, and the button's
 * ring/scale micro-interactions.
 */
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { useState, Suspense, lazy, useRef, useEffect, type ReactNode } from 'react'
import { gsap, useGSAP, prefersReducedMotion } from '../../lib/gsap'
import { motionReduced, onMotionChange } from '../../lib/motion'

const Dithering = lazy(() =>
  import('@paper-design/shaders-react').then((mod) => ({ default: mod.Dithering })),
)

/**
 * The shader is the single most expensive thing on the landing page: a
 * WebGL dither loop that redraws every frame. Measured on 2026-10-30 under
 * 4x CPU throttle with the orbs already fixed: removing it cut main-thread
 * task time from 896ms/s to 161ms/s (82%) and lifted the page 40.5 -> 51.4
 * fps. The earlier note in AGENTS.md claiming "~5fps" predated the orb fix
 * and was never re-measured; that number was wrong.
 *
 * It is still the most beautiful thing here, so the rule is: mount it when
 * on screen and the tab is visible, but keep it FROZEN (speed 0) unless the
 * pointer is actually over the card. `speed: 0` makes the library cease its
 * requestAnimationFrame loop entirely (see shader-mount.js: it only calls
 * requestRender when currentSpeed !== 0), so an idle cover paints a static
 * dithered texture for free and the dither only moves while you engage
 * with it. Reduced motion pins it to frozen regardless.
 */
function useShaderAllowed(ref: React.RefObject<HTMLDivElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(false)
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden)
  const [reduced, setReduced] = useState(() => motionReduced())

  useEffect(() => onMotionChange(() => setReduced(motionReduced())), [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(!!entry?.isIntersecting),
      { rootMargin: '120px' },
    )
    io.observe(el)
    const onVis = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ref])

  return !reduced && onScreen && visible
}

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
  /** Shader accent color; defaults to the house amber token value. */
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
  shaderColor = '#f5b84c',
  ariaLabel,
}: CTASectionProps) {
  const [isHovered, setIsHovered] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const shaderAllowed = useShaderAllowed(rootRef)

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
      // Passive: these only read pointer position and never preventDefault.
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
          {shaderAllowed ? (
            <Suspense fallback={<div className="absolute inset-0 bg-muted/20" />}>
              <div className="absolute inset-0 z-0 pointer-events-none opacity-50 mix-blend-multiply">
                <Dithering
                  colorBack="#00000000" // Transparent — paper shows through
                  colorFront={shaderColor}
                  shape="warp"
                  type="4x4"
                  // Frozen until the pointer is over the card. speed=0 makes
                  // the shader stop its rAF loop entirely (see the comment on
                  // useShaderAllowed), which is what keeps an idle cover cheap.
                  speed={isHovered ? 0.6 : 0}
                  className="size-full"
                  minPixelRatio={1}
                />
              </div>
            </Suspense>
          ) : null}

          <div className="relative z-10 px-6 max-w-4xl mx-auto text-center flex flex-col items-center">
            {/* No backdrop-blur here: the pill sits on the fully opaque card
                core, so the blur has nothing to blur but still forces a
                compositing pass every frame. */}
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
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

            {/* Button */}
            <button
              ref={btnRef}
              onClick={onCta}
              className="group relative inline-flex h-14 items-center justify-center gap-3 overflow-hidden rounded-full bg-primary px-12 text-base font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:scale-105 active:scale-95 hover:ring-4 hover:ring-primary/20"
            >
              <span className="relative z-10">{ctaLabel}</span>
              <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/5 dark:bg-white/15 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:scale-105">
                <ArrowRight weight="light" className="h-4 w-4" />
              </span>
            </button>
          </div>
        </div>
        </div>
      </div>
    </section>
  )
}
