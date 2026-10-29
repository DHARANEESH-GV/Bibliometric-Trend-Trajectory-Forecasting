/**
 * ScoreRadar — Dual-Domain 5-Axis Spider Radar Pentagon.
 * Superimposes Domain A (gold) and Domain B (blue) across the 5 emergence
 * score inputs (growth, acceleration, burst, volume, momentum) on concentric
 * pentagonal guide webs. Pure vector SVG, token-driven, fully responsive.
 */
import { useState } from 'react'
import { SCORE_INPUT_META, type ScoreInputs } from '../lib/types'
import { INPUT_CAPS } from '../lib/weights'

interface ScoreRadarProps {
  inputsA: ScoreInputs
  inputsB: ScoreInputs
  nameA: string
  nameB: string
  colorA?: string
  colorB?: string
  size?: number
}

const AXIS_KEYS: (keyof ScoreInputs)[] = [
  'growth_recent',
  'acceleration',
  'keyword_burst',
  'volume_scaled',
  'momentum_intent',
]

const SHORT_LABELS: Record<keyof ScoreInputs, string> = {
  growth_recent: 'Growth',
  acceleration: 'Acceleration',
  keyword_burst: 'Bursts',
  volume_scaled: 'Volume',
  momentum_intent: 'Momentum',
}

export function ScoreRadar({
  inputsA,
  inputsB,
  nameA,
  nameB,
  colorA = 'var(--cat-1)',
  colorB = 'var(--cat-2)',
  size = 320,
}: ScoreRadarProps) {
  const [hoveredAxis, setHoveredAxis] = useState<number | null>(null)

  const cx = size / 2
  const cy = size / 2
  const rMax = size * 0.36

  // 5 vertices at 72 deg increments, starting straight up (-90 deg)
  const getCoords = (index: number, ratio: number) => {
    const angle = ((index * 72 - 90) * Math.PI) / 180
    return {
      x: cx + Math.cos(angle) * (rMax * ratio),
      y: cy + Math.sin(angle) * (rMax * ratio),
    }
  }

  // Get normalized values (0 to 1) based on canonical caps
  const normA = AXIS_KEYS.map((k) => Math.min(1, Math.max(0, (inputsA[k] ?? 0) / (INPUT_CAPS[k] || 1))))
  const normB = AXIS_KEYS.map((k) => Math.min(1, Math.max(0, (inputsB[k] ?? 0) / (INPUT_CAPS[k] || 1))))

  // Build SVG path string for a polygon
  const buildPolygonPath = (values: number[]) => {
    return (
      values
        .map((v, i) => {
          const { x, y } = getCoords(i, v)
          return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
        })
        .join(' ') + ' Z'
    )
  }

  const rings = [0.25, 0.5, 0.75, 1.0]

  return (
    <div className="score-radar-wrap" style={{ position: 'relative', width: size, margin: '0 auto' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Emergence radar comparison between ${nameA} and ${nameB}`}
        style={{ overflow: 'visible' }}
      >
        {/* Concentric Pentagonal Grid Webs */}
        {rings.map((ring) => {
          const webPath =
            Array.from({ length: 5 })
              .map((_, i) => {
                const { x, y } = getCoords(i, ring)
                return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
              })
              .join(' ') + ' Z'
          return (
            <path
              key={ring}
              d={webPath}
              fill="none"
              stroke={ring === 1.0 ? 'var(--grid-major)' : 'var(--grid-minor)'}
              strokeWidth={ring === 1.0 ? 1.25 : 1}
              strokeDasharray={ring < 1.0 ? '2 2' : undefined}
            />
          )
        })}

        {/* 5 Radial Spokes */}
        {Array.from({ length: 5 }).map((_, i) => {
          const outer = getCoords(i, 1.0)
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={outer.x}
              y2={outer.y}
              stroke="var(--grid-minor)"
              strokeWidth={1}
            />
          )
        })}

        {/* Domain B Polygon (Layer beneath) */}
        <path
          d={buildPolygonPath(normB)}
          fill={`color-mix(in srgb, ${colorB} 18%, transparent)`}
          stroke={colorB}
          strokeWidth={1.75}
          strokeLinejoin="round"
          className="radar-poly radar-poly--b"
        />

        {/* Domain A Polygon (Layer on top) */}
        <path
          d={buildPolygonPath(normA)}
          fill={`color-mix(in srgb, ${colorA} 22%, transparent)`}
          stroke={colorA}
          strokeWidth={2}
          strokeLinejoin="round"
          className="radar-poly radar-poly--a"
        />

        {/* Vertex Dots & Interactive Hotspots */}
        {AXIS_KEYS.map((k, i) => {
          const ptA = getCoords(i, normA[i] ?? 0)
          const ptB = getCoords(i, normB[i] ?? 0)
          const labelPt = getCoords(i, 1.22)
          const angleDeg = i * 72 - 90
          const textAnchor =
            Math.abs(angleDeg - -90) < 5
              ? 'middle'
              : angleDeg > -90 && angleDeg < 90
              ? 'start'
              : 'end'

          return (
            <g
              key={k}
              onMouseEnter={() => setHoveredAxis(i)}
              onMouseLeave={() => setHoveredAxis(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Vertex Dot A */}
              <circle
                cx={ptA.x}
                cy={ptA.y}
                r={hoveredAxis === i ? 5 : 3.5}
                fill={colorA}
                stroke="var(--surface-1)"
                strokeWidth={1.5}
                style={{ transition: 'r 0.15s ease' }}
              />

              {/* Vertex Dot B */}
              <circle
                cx={ptB.x}
                cy={ptB.y}
                r={hoveredAxis === i ? 5 : 3.5}
                fill={colorB}
                stroke="var(--surface-1)"
                strokeWidth={1.5}
                style={{ transition: 'r 0.15s ease' }}
              />

              {/* Axis Label */}
              <text
                x={labelPt.x}
                y={labelPt.y + (Math.abs(angleDeg - -90) < 5 ? -6 : 4)}
                textAnchor={textAnchor}
                fill={hoveredAxis === i ? 'var(--ink-0)' : 'var(--ink-2)'}
                fontFamily="var(--font-mono)"
                fontSize={10.5}
                fontWeight={hoveredAxis === i ? 600 : 400}
                style={{ transition: 'fill 0.15s ease' }}
              >
                {SHORT_LABELS[k]}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Axis Hover Readout HUD */}
      {hoveredAxis != null ? (
        <div
          className="score-radar-hud panel-core"
          style={{
            position: 'absolute',
            bottom: -24,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            padding: '4px 10px',
            borderRadius: 'var(--r-control)',
            border: 'var(--hairline)',
            background: 'var(--surface-1)',
            boxShadow: 'var(--shadow-plate)',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            zIndex: 'var(--z-overlay)',
          }}
        >
          <span style={{ color: 'var(--ink-3)' }}>{SCORE_INPUT_META[hoveredAxis]?.label}:</span>
          <span style={{ color: colorA, fontWeight: 600 }}>
            {nameA}: {(((normA[hoveredAxis] ?? 0) * 100)).toFixed(0)}%
          </span>
          <span style={{ color: 'var(--ink-3)' }}>vs</span>
          <span style={{ color: colorB, fontWeight: 600 }}>
            {nameB}: {(((normB[hoveredAxis] ?? 0) * 100)).toFixed(0)}%
          </span>
        </div>
      ) : null}
    </div>
  )
}
