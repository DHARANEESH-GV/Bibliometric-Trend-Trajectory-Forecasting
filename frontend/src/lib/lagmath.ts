/**
 * lib/lagmath.ts — the ONE browser-side statistic for the Lag view.
 *
 * The lag.json file stores, per domain:
 *   papers_z   z-scored 4-quarter log-growth of paper counts
 *   patents_z  z-scored 4-quarter log-growth of patent grant counts
 * both on the same quarter axis, plus the stored `curve` (r at k = 0..12),
 * `best_lag`, `best_r` and `perm_p` computed by the Python pipeline.
 *
 * The alignment slider needs r(k) live in the browser, so this module
 * recomputes the same quantity. Two properties make it verifiable rather
 * than decorative:
 *
 *   1. r(k) here must reproduce the stored curve within rounding. The test
 *      suite asserts exactly that for every domain and every k, which pins
 *      the browser maths to the pipeline's definition.
 *   2. Pearson r is symmetric: corr(a, b) === corr(b, a). Shifting the
 *      patent series EARLIER by k against the paper series is therefore the
 *      same number whether you slice the papers or the patents. Both
 *      alignments below are equivalent and the test checks it.
 *
 * No dependency: this is a few lines of arithmetic on arrays that are
 * already in the snapshot.
 */

import type { LagDomain } from './types'

/** Pearson r with a zero-variance guard. Returns 0 for degenerate input. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i] as number
    mb += b[i] as number
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma
    const y = (b[i] as number) - mb
    num += x * y
    da += x * x
    db += y * y
  }
  if (da === 0 || db === 0) return 0
  return num / Math.sqrt(da * db)
}

/**
 * r at lag k: papers at t against patents at t+k.
 *
 * `k` shifts the patent series EARLIER on the shared axis, so the plotted
 * pair for quarter t is (papers[t], patents[t + k]). Negative or oversize k
 * yields 0 rather than throwing, so a slider can never break a panel.
 */
export function rAtLag(papers: number[], patents: number[], k: number): number {
  const n = papers.length
  if (!Number.isFinite(k) || k < 0 || k >= n) return 0
  return pearson(papers.slice(0, n - k), patents.slice(k))
}

/** The full 0..12 curve, matching the `curve` array in lag.json. */
export function curveFromSeries(d: LagDomain, maxLag = 12): number[] {
  const s = d.series
  if (!s) return []
  const out: number[] = []
  for (let k = 0; k <= maxLag; k++) out.push(round4(rAtLag(s.papers_z, s.patents_z, k)))
  return out
}

export function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000
}

/**
 * Patent series shifted by k for PLOTTING: index i becomes patents[i+k].
 *
 * Trailing slots are `null`, not back-filled or wrapped. Inventing values
 * would draw a curve the data does not support, and a wrapped series would
 * imply a cyclic quarter axis.
 */
export function shiftPatentsForPlot(patents: number[], k: number): Array<number | null> {
  const out: Array<number | null> = []
  for (let i = 0; i < patents.length; i++) {
    const src = patents[i + k]
    out.push(src === undefined ? null : src)
  }
  return out
}
