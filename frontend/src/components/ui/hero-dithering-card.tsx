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
import { ArrowRight } from 'lucide-react'
import { useState, Suspense, lazy, type ReactNode } from 'react'

const Dithering = lazy(() =>
  import('@paper-design/shaders-react').then((mod) => ({ default: mod.Dithering })),
)

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

  return (
    <section className="py-12 w-full flex justify-center items-center px-4 md:px-6" aria-label={ariaLabel}>
      <div
        className="w-full max-w-7xl relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="relative overflow-hidden rounded-[48px] border border-border bg-card shadow-sm min-h-[600px] md:min-h-[600px] flex flex-col items-center justify-center duration-500">
          <Suspense fallback={<div className="absolute inset-0 bg-muted/20" />}>
            <div className="absolute inset-0 z-0 pointer-events-none opacity-40 dark:opacity-30 mix-blend-multiply dark:mix-blend-screen">
              <Dithering
                colorBack="#00000000" // Transparent — paper shows through
                colorFront={shaderColor}
                shape="warp"
                type="4x4"
                speed={isHovered ? 0.6 : 0.2}
                className="size-full"
                minPixelRatio={1}
              />
            </div>
          </Suspense>

          <div className="relative z-10 px-6 max-w-4xl mx-auto text-center flex flex-col items-center">
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              {kicker}
            </div>

            {/* Headline */}
            <h2 className="font-serif text-5xl md:text-7xl lg:text-8xl font-medium tracking-tight text-foreground mb-8 leading-[1.05]">
              {titleLines[0]} <br />
              <span className="text-foreground/80">{titleLines[1]}</span>
            </h2>

            {/* Description */}
            <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mb-12 leading-relaxed">
              {description}
            </p>

            {/* Button */}
            <button
              onClick={onCta}
              className="group relative inline-flex h-14 items-center justify-center gap-3 overflow-hidden rounded-full bg-primary px-12 text-base font-medium text-primary-foreground transition-all duration-300 hover:bg-primary/90 hover:scale-105 active:scale-95 hover:ring-4 hover:ring-primary/20"
            >
              <span className="relative z-10">{ctaLabel}</span>
              <ArrowRight className="h-5 w-5 relative z-10 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
