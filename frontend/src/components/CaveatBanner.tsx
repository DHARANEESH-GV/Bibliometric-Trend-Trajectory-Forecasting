/**
 * CaveatBanner — caveats and provenance notes are first-class editorial
 * content (contract: "not tooltips-only").
 */
import type { ReactNode } from 'react'

interface CaveatBannerProps {
  children: ReactNode
  /** 'caveat' renders amber-toned; 'provenance' is neutral ink. */
  kind?: 'caveat' | 'provenance'
}

export function CaveatBanner({ children, kind = 'caveat' }: CaveatBannerProps) {
  const accent =
    kind === 'caveat' ? 'var(--stage-active)' : 'var(--ink-2)'
  return (
    <aside
      className="panel panel--sunk"
      style={{
        borderLeft: `2px solid ${accent}`,
        maxWidth: '72ch',
      }}
    >
      <div
        className="panel-core"
        style={{
          padding: 'var(--sp-3) var(--sp-4)',
          fontSize: 'var(--text-sm)',
          color: 'var(--ink-1)',
        }}
      >
        {kind === 'caveat' ? (
          <strong style={{ color: accent, fontWeight: 500, marginRight: 'var(--sp-2)' }}>
            Caveat.
          </strong>
        ) : null}
        {children}
      </div>
    </aside>
  )
}
