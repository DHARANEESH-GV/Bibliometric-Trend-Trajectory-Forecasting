/**
 * Data contracts — matched to what is actually on disk in
 * snapshots/<run_id>/ (the contract of record), which supersedes the
 * Phase 5 spec (annual, not quarterly; `label` taxonomy; 5 score_inputs).
 *
 * Every JSON file carries the same _meta + lineage envelope.
 */

export interface SnapshotMeta {
  generated_utc: string
  run_id: string
  lineage: Record<string, string>
}

/** Backtest gate — methodology-footnote material. Surfaced verbatim, never
 *  hardcoded: the site-wide footnote computes its sentence from this. */
export interface ModelGate {
  beats_naive_share: number
  gate_passed: boolean
  wins: number
  series: number
}

export type GateBlock = Record<string, ModelGate>

/** Lifecycle label taxonomy as actually rendered by stats/emergence.py.
 *  From observed data: Accelerating | Active | Emerging | Watch.
 *  The plan's emerging/growth/maturity/decline cascade never shipped those
 *  words; UI keys colors off THIS set. */
export type LifecycleLabel = 'Emerging' | 'Accelerating' | 'Active' | 'Watch' | (string & {})

export interface ScoreInputs {
  growth_recent: number
  acceleration: number
  keyword_burst: number
  volume_scaled: number
  momentum_intent: number
}

export interface LeaderboardEntry {
  rank: number
  domain: string
  display_name: string
  label: LifecycleLabel
  emergence_score: number
  score_inputs: ScoreInputs
  yoy_delta: number
  /** 24 quarterly-derived points spanning sparkline_years. Plotted as-given. */
  sparkline: number[]
  sparkline_years: [number, number]
  forecast_next3: number[]
  forecast_model: string
  caveat: string | null
  notes: string[]
}

export interface LeaderboardFile {
  _meta: SnapshotMeta
  gate: GateBlock
  leaderboard: LeaderboardEntry[]
}

export interface TrajectoryPoint {
  /** Annual year 2000–2025. No quarters exist — do not interpolate. */
  year: number
  works: number | null
  /** Set only on forecast horizon years (e.g. 2026–2028). */
  forecast: number | null
}

export interface TrajectoryDomain {
  domain: string
  display_name: string
  series: TrajectoryPoint[]
}

export interface TrajectoriesFile {
  _meta: SnapshotMeta
  domains: TrajectoryDomain[]
}

export interface BurstEntry {
  domain: string
  keyword: string
  start: number
  end: number
  /** years, inclusive. No before/after frequencies exist on disk —
   *  strength + duration are the only intensity signals. */
  years: number[]
  duration: number
  strength: number
}

export interface BurstsFile {
  _meta: SnapshotMeta
  feed: BurstEntry[]
}

export interface MatrixFile {
  _meta: SnapshotMeta
  years: number[]
  domains: string[]
  /** domain -> one cell per entry of `years`. */
  cells: Record<string, number[]>
}

export interface Interval68 {
  [year: string]: [number, number]
}

export interface DomainSnapshot {
  _meta: SnapshotMeta
  display_name: string
  /** "2000" -> count, annual. */
  annual: Record<string, number>
  forecast: number[]
  model: string
  /** Forecast horizon years, e.g. [2026, 2027, 2028]. */
  horizon: number[]
  interval_68pct: Interval68
  score: number
  label: LifecycleLabel
  provenance_note: string | null
  sample_stats: Record<string, unknown> | null
  /** May be empty ([] for quantum_computing) — a real empty state. */
  top_keywords: string[]
  caveat: string | null
}

export interface RunsManifest {
  run_id: string
}

/** Map of lifecycle label -> CSS custom property token name. */
export const STAGE_TOKEN: Record<string, string> = {
  Emerging: '--stage-emerging',
  Accelerating: '--stage-accelerating',
  Active: '--stage-active',
  Watch: '--stage-watch',
}

export function stageColor(label: string, style: CSSStyleDeclaration): string {
  const token = STAGE_TOKEN[label] ?? '--stage-watch'
  return style.getPropertyValue(token).trim() || 'var(--stage-watch)'
}

/** Score input display order + labels for ScoreBar decomposition. */
export const SCORE_INPUT_META: Array<{ key: keyof ScoreInputs; label: string }> = [
  { key: 'growth_recent', label: 'Recent growth' },
  { key: 'acceleration', label: 'Acceleration' },
  { key: 'keyword_burst', label: 'Keyword burst' },
  { key: 'volume_scaled', label: 'Volume' },
  { key: 'momentum_intent', label: 'Momentum intent' },
]
