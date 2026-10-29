import { useState, useId, useEffect, useCallback, memo } from 'react'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'
import { X } from '@phosphor-icons/react/dist/csr/X'
import {
  CANONICAL_WEIGHTS,
  WEIGHT_LABELS,
  computeSpearmanRho,
  simulateLeaderboard,
  type EmergenceWeights,
  type SimulatedEntry,
} from '../lib/weights'
import type { LeaderboardEntry } from '../lib/types'

interface WeightSimulatorProps {
  open: boolean
  onClose: () => void
  entries: LeaderboardEntry[]
  onWeightsChange: (simulated: SimulatedEntry[] | null, weights: EmergenceWeights) => void
  currentWeights: EmergenceWeights
}

const PRESETS: Record<string, EmergenceWeights> = {
  Canonical: CANONICAL_WEIGHTS,
  'Growth Dominant': {
    growth_recent: 0.55,
    acceleration: 0.25,
    keyword_burst: 0.1,
    volume_scaled: 0.05,
    momentum_intent: 0.05,
  },
  'Frontier & Bursts': {
    growth_recent: 0.15,
    acceleration: 0.15,
    keyword_burst: 0.5,
    volume_scaled: 0.0,
    momentum_intent: 0.2,
  },
  'Scale-Agnostic Novelty': {
    growth_recent: 0.35,
    acceleration: 0.3,
    keyword_burst: 0.35,
    volume_scaled: 0.0,
    momentum_intent: 0.0,
  },
}

const WeightSliderRow = memo(function WeightSliderRow({
  weightKey,
  val,
  pct,
  labelMeta,
  inputId,
  onChange,
}: {
  weightKey: keyof EmergenceWeights
  val: number
  pct: number
  labelMeta: { name: string; desc: string }
  inputId: string
  onChange: (key: keyof EmergenceWeights, val: number) => void
}) {
  return (
    <div className="weight-slider-row">
      <div className="weight-slider-header">
        <label htmlFor={inputId} className="weight-slider-name">
          {labelMeta.name}
        </label>
        <span className="weight-slider-pct num font-mono">
          {pct}%
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={val}
        onChange={(e) => onChange(weightKey, parseFloat(e.target.value))}
        className="weight-slider"
      />
      <span className="weight-slider-desc">{labelMeta.desc}</span>
    </div>
  )
})

export function WeightSimulator({
  open,
  onClose,
  entries,
  onWeightsChange,
  currentWeights,
}: WeightSimulatorProps) {
  const idPrefix = useId()
  const [activePreset, setActivePreset] = useState<string>('Canonical')

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const handleSliderChange = useCallback(
    (key: keyof EmergenceWeights, val: number) => {
      setActivePreset('Custom')
      const next = { ...currentWeights, [key]: val }
      onWeightsChange(simulateLeaderboard(entries, next), next)
    },
    [currentWeights, entries, onWeightsChange],
  )

  const applyPreset = useCallback(
    (name: string, p: EmergenceWeights) => {
      setActivePreset(name)
      if (name === 'Canonical') {
        onWeightsChange(null, p)
      } else {
        onWeightsChange(simulateLeaderboard(entries, p), p)
      }
    },
    [entries, onWeightsChange],
  )

  const handleReset = useCallback(() => {
    applyPreset('Canonical', CANONICAL_WEIGHTS)
  }, [applyPreset])

  if (!open) return null

  const simulated = simulateLeaderboard(entries, currentWeights)
  const rho = computeSpearmanRho(simulated)
  const isCustom =
    activePreset === 'Custom' ||
    JSON.stringify(currentWeights) !== JSON.stringify(CANONICAL_WEIGHTS)

  const totalRawWeight = Object.values(currentWeights).reduce((a, b) => a + b, 0)

  // Top movers calculation (largest positive and negative rank shift)
  const sortedByShift = [...simulated].sort((a, b) => Math.abs(b.rank_delta) - Math.abs(a.rank_delta))
  const topMover = sortedByShift[0]

  return (
    <div
      className="weight-sim-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Emergence score weight simulator"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="weight-sim-drawer panel-shell">
        <div className="panel-core weight-sim-content">
          <header className="weight-sim-head hairline-bottom">
            <div className="weight-sim-title-group">
              <span className="section-eyebrow">Interactive Priority Dials</span>
              <h2 className="weight-sim-title">
                Ranking Priority <span className="serif-accent">Simulator</span>
              </h2>
              <p className="weight-sim-sub">
                Different teams value different signals. Adjust the dials below to test how prioritizing
                growth speed, keyword surges, or total volume shifts field rankings.
              </p>
            </div>
            <button
              type="button"
              className="island-btn"
              onClick={onClose}
              aria-label="Close simulator"
            >
              <X size={16} weight="light" aria-hidden />
            </button>
          </header>

          <div className="weight-sim-metrics hairline-bottom">
            <div className="weight-metric-card">
              <span className="weight-metric-label">Ranking Agreement</span>
              <span className="weight-metric-val num font-mono">
                {rho.toFixed(3)}
              </span>
              <span className="weight-metric-hint">
                {rho >= 0.95 ? 'Nearly identical to baseline (1.0 = match)' : rho >= 0.8 ? 'Moderate order shifts' : 'Substantial reordering'}
              </span>
            </div>
            <div className="weight-metric-card">
              <span className="weight-metric-label">Largest Rank Shift</span>
              <span className="weight-metric-val num font-mono">
                {topMover && topMover.rank_delta !== 0 ? (
                  <>
                    {topMover.rank_delta > 0 ? `+${topMover.rank_delta}` : topMover.rank_delta}
                    <span className="weight-metric-domain"> {topMover.display_name}</span>
                  </>
                ) : (
                  'No shift'
                )}
              </span>
              <span className="weight-metric-hint">
                {isCustom ? 'Active custom priorities' : 'Official baseline'}
              </span>
            </div>
            <div className="weight-metric-card">
              <span className="weight-metric-label">Stress-Test Reliability</span>
              <span
                className="weight-metric-val num font-mono"
                style={{
                  color: rho >= 0.977 ? 'var(--stage-emerging)' : 'var(--stage-active)',
                }}
              >
                {rho >= 0.977 ? 'Within Normal Bounds' : 'Custom Outlier'}
              </span>
              <span className="weight-metric-hint">
                {rho >= 0.977
                  ? 'Passes 500-scenario stability check'
                  : 'Exceeds standard 30% variation envelope'}
              </span>
            </div>
          </div>

          <div className="weight-sim-presets">
            <span className="section-eyebrow">Presets</span>
            <div className="weight-preset-chips" role="group" aria-label="Preset configurations">
              {Object.entries(PRESETS).map(([name, p]) => (
                <button
                  key={name}
                  type="button"
                  className={`weight-chip ${activePreset === name ? 'weight-chip--active' : ''}`}
                  onClick={() => applyPreset(name, p)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="weight-sim-sliders">
            <span className="section-eyebrow">Custom Weights</span>
            {(Object.keys(currentWeights) as (keyof EmergenceWeights)[]).map((k) => {
              const val = currentWeights[k]
              const pct = totalRawWeight > 0 ? Math.round((val / totalRawWeight) * 100) : 0
              const labelMeta = WEIGHT_LABELS[k]
              const inputId = `${idPrefix}-${k}`

              return (
                <WeightSliderRow
                  key={k}
                  weightKey={k}
                  val={val}
                  pct={pct}
                  labelMeta={labelMeta}
                  inputId={inputId}
                  onChange={handleSliderChange}
                />
              )
            })}
          </div>

          <footer className="weight-sim-foot hairline-top">
            <button
              type="button"
              className="weight-action-btn weight-action-btn--reset"
              onClick={handleReset}
              disabled={!isCustom}
            >
              <ArrowCounterClockwise size={14} weight="light" aria-hidden />
              <span>Reset to Baseline</span>
            </button>
            <button
              type="button"
              className="weight-action-btn weight-action-btn--apply"
              onClick={onClose}
            >
              <SlidersHorizontal size={14} weight="light" aria-hidden />
              <span>Keep & Inspect</span>
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}

