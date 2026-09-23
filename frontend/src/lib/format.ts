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
