/**
 * ShimmerAxes — the loading state (§8: never spinners). The chart's real
 * axes with a shimmering band placeholder across the plot area.
 * Pure SVG — no chart engine needed to show an empty skeleton.
 */
import { useId } from 'react'

interface ShimmerAxesProps {
  /** Real axis tick labels when the caller already knows them. */
  xLabels?: string[]
  height?: number
  /** Accessible description of what is loading. */
  label?: string
}

export function ShimmerAxes({ xLabels, height = 320, label = 'Loading chart' }: ShimmerAxesProps) {
  const id = useId()
  const width = 800
  const padL = 56
  const padR = 16
  const padT = 16
  const padB = 32
  const plotW = width - padL - padR
  const y0 = height - padB

  const ticks = xLabels ?? ['', '', '', '', '', '', '', '']
  const step = ticks.length > 1 ? plotW / (ticks.length - 1) : plotW

  return (
    <div style={{ position: 'relative', height }} role="img" aria-label={label}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: '100%' }}
      >
        <defs>
          <linearGradient id={`shimmer-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--grid-minor)" />
            <stop offset="50%" stopColor="var(--grid-major)" />
            <stop offset="100%" stopColor="var(--grid-minor)" />
            <animate
              attributeName="x1"
              from="-1" to="1" dur="1.6s" repeatCount="indefinite"
            />
            <animate
              attributeName="x2"
              from="0" to="2" dur="1.6s" repeatCount="indefinite"
            />
          </linearGradient>
        </defs>

        {/* zero baseline + hairline grid */}
        <line x1={padL} y1={y0} x2={width - padR} y2={y0} stroke="var(--grid-major)" strokeWidth={1} />
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={padL} y1={padT + f * (y0 - padT)} x2={width - padR} y2={padT + f * (y0 - padT)}
            stroke="var(--grid-minor)" strokeWidth={1}
          />
        ))}

        {/* the shimmering placeholder band */}
        <rect
          x={padL} y={padT} width={plotW} height={y0 - padT}
          fill={`url(#shimmer-${id})`}
        />

        {/* x tick stubs */}
        {ticks.map((_t, i) => (
          <line
            key={i}
            x1={padL + i * step} y1={y0} x2={padL + i * step} y2={y0 + 4}
            stroke="var(--grid-major)" strokeWidth={1}
          />
        ))}
      </svg>
      {xLabels && xLabels.length > 0 ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0, right: 0, bottom: 6,
            display: 'flex', justifyContent: 'space-between',
            padding: '0 var(--sp-2)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--ink-3)',
          }}
        >
          <span>{xLabels[0]}</span>
          <span>{xLabels[xLabels.length - 1]}</span>
        </div>
      ) : null}
    </div>
  )
}
