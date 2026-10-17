/**
 * ScoreBar — horizontal decomposition of a scalar into labeled components
 * (used for the 5 emergence-score inputs). Hairline segments, mono labels,
 * tabular numerals.
 */
import { SCORE_INPUT_META, type ScoreInputs } from '../lib/types'
import { fmtScore } from '../lib/format'

interface ScoreBarProps {
  inputs: ScoreInputs
  /** Show per-segment labels; off for compact contexts. */
  labeled?: boolean
}

export function ScoreBar({ inputs, labeled = true }: ScoreBarProps) {
  // Inputs are already 0–1 normalized min-max across the panel (emergence.py).
  const segments = SCORE_INPUT_META.map(({ key, label }) => ({
    label,
    value: Math.max(0, Math.min(1, inputs[key] ?? 0)),
  }))
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1

  return (
    <div>
      <div
        role="img"
        aria-label={`Score components: ${segments.map((s) => `${s.label} ${fmtScore(s.value * 100)}`).join(', ')}`}
        style={{
          display: 'flex',
          height: 6,
          borderRadius: 'var(--r-control)',
          overflow: 'hidden',
          background: 'var(--surface-2)',
        }}
      >
        {segments.map((seg) => (
          <div
            key={seg.label}
            className="score-seg"
            style={{
              width: `${(seg.value / total) * 100}%`,
              background:
                seg.label === 'Recent growth'
                  ? 'var(--stage-emerging)'
                  : seg.label === 'Acceleration'
                    ? 'var(--stage-accelerating)'
                    : seg.label === 'Keyword burst'
                      ? 'var(--stage-active)'
                      : seg.label === 'Volume'
                        ? 'var(--ink-2)'
                        : 'var(--ink-3)',
            }}
          />
        ))}
      </div>
      {labeled ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--sp-1) var(--sp-4)',
            marginTop: 'var(--sp-2)',
            fontSize: 'var(--text-xs)',
            color: 'var(--ink-2)',
          }}
        >
          {segments.map((seg) => (
            <span key={seg.label}>
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 2,
                  verticalAlign: 'middle',
                  marginRight: 4,
                  background:
                    seg.label === 'Recent growth'
                      ? 'var(--stage-emerging)'
                      : seg.label === 'Acceleration'
                        ? 'var(--stage-accelerating)'
                        : seg.label === 'Keyword burst'
                          ? 'var(--stage-active)'
                          : seg.label === 'Volume'
                            ? 'var(--ink-2)'
                            : 'var(--ink-3)',
                }}
              />
              {seg.label} <span className="num">{fmtScore(seg.value * 100)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
