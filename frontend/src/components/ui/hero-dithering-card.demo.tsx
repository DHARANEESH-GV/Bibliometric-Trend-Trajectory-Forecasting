/**
 * Reference usage for hero-dithering-card (shadcn demo convention).
 * Kept as documentation; the live instance is mounted by
 * src/views/Cover.tsx with snapshot-derived props.
 */
import { CTASection } from '@/components/ui/hero-dithering-card'

export default function DemoOne() {
  return (
    <CTASection
      kicker="Issue 20260923T082601Z, fresh off the press"
      titleLines={['Twenty fields,', 'watched quietly.']}
      description="278 bursts, 20 fields, one quiet watch."
      ctaLabel="Enter the observatory"
      onCta={() => {}}
      shaderColor="#f5b84c"
      ariaLabel="Biblio reference demo"
    />
  )
}
