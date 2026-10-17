/**
 * ScorePetal — polar rose of the 5 emergence-score inputs. The same
 * SCORE_INPUT_META contract as ScoreBar, drawn as a five-petal SVG rose:
 * petal length = input value (0-1), petal color = the ScoreBar palette.
 * Decorative companion to the bar (the bar stays the accessible readout);
 * aria-hidden, transform-only draw-on via stroke-dashoffset.
 */
import { SCORE_INPUT_META, type ScoreInputs } from '../lib/types'

const SIZE = 180
const CX = SIZE / 2
const CY = SIZE / 2
const R_MAX = 66

const PETAL_COLORS: Record<string, string> = {
  'Recent growth': 'var(--stage-emerging)',
  Acceleration: 'var(--stage-accelerating)',
  'Keyword burst': 'var(--stage-active)',
  Volume: 'var(--ink-2)',
  'Momentum intent': 'var(--ink-3)',
}

function petalPath(angleDeg: number, length: number): string {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  const tipX = CX + Math.cos(rad) * length
  const tipY = CY + Math.sin(rad) * length
  // Petal = two quadratic curves from center to tip, bulging at ±26°.
  const spread = 0.42
  const bulge = length * 0.36
  const leftRad = rad - spread
  const rightRad = rad + spread
  const lx = CX + Math.cos(leftRad) * bulge
  const ly = CY + Math.sin(leftRad) * bulge
  const rx = CX + Math.cos(rightRad) * bulge
  const ry = CY + Math.sin(rightRad) * bulge
  return `M ${CX} ${CY} Q ${lx} ${ly} ${tipX} ${tipY} Q ${rx} ${ry} ${CX} ${CY} Z`
}

export function ScorePetal({ inputs }: { inputs: ScoreInputs }) {
  const petals = SCORE_INPUT_META.map(({ key, label }, i) => ({
    label,
    value: Math.max(0, Math.min(1, inputs[key] ?? 0)),
    angle: i * 72,
  }))

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden
      className="score-petal"
      focusable="false"
    >
      {/* Guide rings at 25/50/75/100% */}
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <circle
          key={r}
          cx={CX}
          cy={CY}
          r={R_MAX * r}
          fill="none"
          stroke="var(--grid-minor)"
          strokeWidth={1}
        />
      ))}
      {/* Spokes */}
      {petals.map((p) => {
        const rad = ((p.angle - 90) * Math.PI) / 180
        return (
          <line
            key={`spoke-${p.label}`}
            x1={CX}
            y1={CY}
            x2={CX + Math.cos(rad) * R_MAX}
            y2={CY + Math.sin(rad) * R_MAX}
            stroke="var(--grid-minor)"
            strokeWidth={1}
          />
        )
      })}
      {/* Petals — draw-on via CSS animation on transform scale */}
      {petals.map((p, i) => (
        <path
          key={p.label}
          d={petalPath(p.angle, Math.max(6, p.value * R_MAX))}
          fill={PETAL_COLORS[p.label] ?? 'var(--ink-3)'}
          opacity={0.82}
          className="score-petal-leaf"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
      {/* Center hub */}
      <circle cx={CX} cy={CY} r={3} fill="var(--ink-0)" />
    </svg>
  )
}
