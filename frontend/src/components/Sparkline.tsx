/**
 * Sparkline — tiny annual/quarterly-derived trend as inline SVG.
 * Plots the 24 `sparkline` points as-given; no interpolation.
 * Hairline stroke, end-dot accent, optional forecast dash tail.
 */
import { useId } from 'react'

interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  /** Values continuing the series as a forecast (dashed tail). */
  forecast?: number[]
  /** Accessible summary; falls back to first/last readout. */
  ariaLabel?: string
}

export function Sparkline({ values, width = 120, height = 32, forecast, ariaLabel }: SparklineProps) {
  const pathId = useId()
  if (values.length < 2) {
    // Single-point series: real empty state, no fake trend line.
    return (
      <svg width={width} height={height} role="img" aria-label="Not enough data for a trend">
        <line
          x1={width / 2} y1={2} x2={width / 2} y2={height - 2}
          stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="2 3"
        />
      </svg>
    )
  }

  const all = forecast ? [...values, ...forecast] : values
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1
  const pad = 3
  const n = all.length - (forecast?.length ?? 0)

  const x = (i: number) => pad + (i / (all.length - 1)) * (width - pad * 2)
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)

  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const fPath = forecast
    ? forecast.map((v, j) => `L${x(n - 1 + j + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    : ''

  const label = ariaLabel ?? `Trend from ${values[0]} to ${values[values.length - 1]}`

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={label}
      style={{ overflow: 'visible' }}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--ink-1)"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {forecast ? (
        <path
          d={`M${x(n - 1).toFixed(1)},${y(values[values.length - 1] ?? 0).toFixed(1)}${fPath}`}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth={1.25}
          strokeDasharray="3 3"
        />
      ) : null}
      <circle
        cx={x(values.length - 1)}
        cy={y(values[values.length - 1] ?? 0)}
        r={2}
        fill="var(--accent)"
      />
      <title id={pathId}>{label}</title>
      <desc>
        {`Line chart of ${values.length} points from ${values[0]} to ${values[values.length - 1]}.`}
        {forecast ? ` Forecast continues ${forecast.length} points to ${forecast[forecast.length - 1]}.` : ''}
      </desc>
    </svg>
  )
}
