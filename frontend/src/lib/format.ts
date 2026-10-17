/**
 * Formatting helpers. Meta copy is written as sentences — never
 * middle-dot-joined strings (a banned generated-UI tell, master plan §4.1-4).
 */

const NUM_FMT = new Intl.NumberFormat('en-US')

export function fmtInt(n: number): string {
  return NUM_FMT.format(n)
}

export function fmtScore(n: number): string {
  return n.toFixed(1)
}

/** +0.96 / −0.12 style delta with sign. */
export function fmtDelta(n: number, digits = 2): string {
  const sign = n >= 0 ? '+' : '−'
  return `${sign}${Math.abs(n).toFixed(digits)}`
}

export function fmtPct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

/** Model id -> display name, written as prose. */
export function fmtModel(model: string): string {
  switch (model) {
    case 'hw_damped':
      return 'Holt-Winters damped'
    case 'drift':
      return 'drift'
    case 'pooled':
      return 'pooled'
    case 'naive':
      return 'naive persistence'
    default:
      return model
  }
}

/** Methodology sentence computed from the real gate block — the number is
 *  never hardcoded anywhere in the UI. */
export function gateFootnote(gates: { model: string; wins: number; series: number; passed: boolean }[]): string {
  const parts = gates.map(
    (g) =>
      `${fmtModel(g.model)} passed ${g.wins} of ${g.series} backtest series` +
      (g.passed ? '' : ' and fell the gate'),
  )
  return `Forecasts validated by backtest against a naive baseline: ${parts.join('; ')}.`
}

/** Stale-data footer sentence from the run timestamp. */
export function snapshotSentence(runId: string | null, generatedUtc: string | null): string {
  if (!generatedUtc) {
    if (!runId) return 'No snapshot loaded yet.'
    return `Snapshot run ${runId}.`
  }
  const d = new Date(generatedUtc)
  const date = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return `Snapshot from ${date} (run ${runId ?? 'unknown'}).`
}

/** Label -> adjectival stage sentence fragment, e.g. "Emerging, held 6 quarters"
 *  becomes just the label here; stability wording comes from notes when present. */
export function labelSentence(label: string): string {
  return label
}

/** Direction of a series' shape: last point vs first. This is a within-run
 *  trend read, explicitly NOT a rank change (a second run would be needed
 *  for that). Returns 0 for a flat or too-short series. */
export function seriesTrend(values: number[]): number {
  if (values.length < 2) return 0
  const first = values.find((v) => v > 0) ?? values[0] ?? 0
  const last = values[values.length - 1] ?? 0
  if (first <= 0) return last > 0 ? 1 : 0
  const ratio = last / first
  if (ratio > 1.05) return 1
  if (ratio < 0.95) return -1
  return 0
}

/** Relative age of a timestamp, e.g. "3 days ago". Null when unparseable. */
export function relativeAge(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return null
  const ms = now.getTime() - then.getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}
