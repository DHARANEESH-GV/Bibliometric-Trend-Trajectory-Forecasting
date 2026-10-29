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
  /** Annual year 2000–2025 actuals; 2026–2028 forecast tail. */
  year: number
  works: number | null
  /** CPC-matched US patent grants for this year. Present only when the
   *  run carries a patent series (BigQuery workaround, Phase 3.5); null
   *  on forecast-tail points and when no patent data exists. */
  patents?: number | null
  /** Set only on forecast horizon years (e.g. 2026–2028). */
  forecast: number | null
  /** 68% interval bounds — present on every forecast point on disk. */
  lower?: number
  upper?: number
  /** Model id per forecast point (e.g. hw_damped). */
  model?: string
}

export interface TrajectoryDomain {
  domain: string
  display_name: string
  series: TrajectoryPoint[]
  /** Present only when the run carries a patent series. */
  patents_total?: number
  patents_caveat?: string
  /** [first, last] year with real patent coverage (null patches before). */
  patents_covered_years?: [number, number]
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
  /** Row tails per domain: lifecycle label + score at run time. */
  tail: Record<string, { label: string; score: number }>
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
  /** Real on-disk shape: {name, total, bursts[]}, ranked by volume.
   *  May be empty ([] for quantum_computing) — a real empty state. */
  top_keywords: TopKeyword[]
  caveat: string | null
  /** CPC-matched US patent grants (Phase 3.5 BigQuery workaround).
   *  null when the run carries no patent series.
   *  `annual` is null before covered_years[0]: the source has no usable
   *  CPC classification there, which is "no data", not "zero patents". */
  patents: {
    annual: Record<string, number | null>
    total: number
    peak_year: number | null
    covered_years: [number, number]
    caveat: string
    coverage: string
    lag: PatentLag | null
    /** Present on every domain file: the full crosswalk entry, which is
     *  what the lag panel is rendered from. */
    lag_panel?: PatentLagPanel
  } | null
}

/** Paper-vs-patent lead/lag over the complete-grant window.
 *  best_lag_years > 0 means patents trail papers (papers lead).
 *  permutation_p gates the reading: with 9 lags scanned on ~8 growth
 *  points, an unadjusted max-r is easily inflated, so `significant`
 *  is the only field safe to quote. `panel` carries the correction that
 *  matters most — 20 tests at alpha=0.10 yield ~2 false positives. */
export interface PatentLag {
  papers_peak_year: number
  patents_peak_year: number | null
  best_lag_years: number | null
  best_lag_r: number | null
  permutation_p: number | null
  at_scan_boundary: boolean
  underpowered: boolean
  significant: boolean
  lag_window: [number, number]
  min_pairs_required: number
  lag_basis: string
  lag_scan: Array<{ lag: number; r: number | null; n: number; powered: boolean }>
}

/** Panel-level correction across all 20 domain tests. */
export interface PatentLagPanel {
  domains_tested: number
  domains_significant: number
  alpha_per_domain: number
  expected_false_positives: number
  binomial_p_at_least_k: number | null
  bonferroni_alpha: number
  survive_bonferroni: string[]
  verdict: string
}

/** Keyword ranking row as persisted by the aggregate stage. */
export interface TopKeyword {
  name: string
  /** Occurrences across the domain's corpus. */
  total: number
  /** Kleinberg bursts for this keyword, same shape as bursts.json feed. */
  bursts: Array<{
    start: number
    end: number
    duration: number
    strength: number
    years: number[]
  }>
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
