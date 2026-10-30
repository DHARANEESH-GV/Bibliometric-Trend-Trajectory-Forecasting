/**
 * StagePill — lifecycle label with the real taxonomy
 * (Emerging / Accelerating / Active / Watch). Stage pills show stability
 * evidence when known: "Emerging, held 6 quarters" — not bare "Emerging".
 *
 * The stage ink comes from a CSS custom property, NOT a
 * getComputedStyle() read. The read used to happen during render, i.e. a
 * forced synchronous layout on every mount. /matrix renders 20 of these
 * for its row tails and re-renders them on every hover, which measured as
 * 74 layouts + 300 ms of script per 3 s. Letting CSS resolve the variable
 * removes the layout cost entirely and keeps the token as the one source
 * of truth.
 */
import { STAGE_TOKEN } from '../lib/types'

interface StagePillProps {
  label: string
  /** Stability evidence sentence fragment, e.g. "held 6 quarters". */
  held?: string | null
}

export function StagePill({ label, held }: StagePillProps) {
  const token = STAGE_TOKEN[label] ?? '--stage-watch'
  // var() is resolved by the style engine at paint time, so no layout is
  // forced here and a token change repaints without a React re-render.
  const color = `var(${token})`
  return (
    <span
      className="stage-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 'var(--sp-2)',
        padding: '2px 10px',
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        borderRadius: 'var(--r-control)',
        color,
        fontSize: 'var(--text-sm)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          alignSelf: 'center',
          flexShrink: 0,
        }}
      />
      {label}
      {held ? <span style={{ color: 'var(--ink-2)' }}>, {held}</span> : null}
    </span>
  )
}
