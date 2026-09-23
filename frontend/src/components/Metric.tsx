/**
 * Metric — a labeled numeric readout. Tabular numerals always.
 */
import type { CSSProperties, ReactNode } from 'react'

interface MetricProps {
  label: string
  value: ReactNode
  detail?: ReactNode
  style?: CSSProperties
}

export function Metric({ label, value, detail, style }: MetricProps) {
  return (
    <div style={style}>
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
