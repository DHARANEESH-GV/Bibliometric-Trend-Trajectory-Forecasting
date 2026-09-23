/**
 * StagePill — lifecycle label with the real taxonomy
 * (Emerging / Accelerating / Active / Watch). Stage pills show stability
 * evidence when known: "Emerging, held 6 quarters" — not bare "Emerging".
 */
import { stageColor } from '../lib/types'
import { useTokens } from '../lib/useTokens'

interface StagePillProps {
  label: string
  /** Stability evidence sentence fragment, e.g. "held 6 quarters". */
  held?: string | null
}

export function StagePill({ label, held }: StagePillProps) {
  const tokens = useTokens()
  const color = stageColor(label, getComputedStyle(document.documentElement))
  void tokens
  return (
    <span
      className="stage-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 'var(--sp-2)',
        padding: '2px 10px',
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        borderRadius: '2px',
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
