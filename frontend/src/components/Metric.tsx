/**
 * Metric — a labeled numeric readout. Tabular numerals always.
 * `rule` adds a hairline top rule (for panel metric rows); `tick` sets a
 * small stage-colored cap above the label. Both opt-in so the default
 * readout is unchanged where it already sits inside a tight layout.
 */
import type { CSSProperties, ReactNode } from 'react'

interface MetricProps {
  label: string
  value: ReactNode
  detail?: ReactNode
  style?: CSSProperties
  /** Hairline rule above the readout. */
  rule?: boolean
  /** CSS color for a small stage tick above the label. */
  tick?: string
}

export function Metric({ label, value, detail, style, rule, tick }: MetricProps) {
  return (
    <div className={rule ? 'metric metric--rule' : 'metric'} style={style}>
      {tick ? <span className="metric-tick" style={{ background: tick }} aria-hidden /> : null}
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--ink-2)',
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </div>
      <div
        className="num"
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 500,
          lineHeight: 'var(--leading-tight)',
        }}
      >
        {value}
      </div>
      {detail ? (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{detail}</div>
      ) : null}
    </div>
  )
}
