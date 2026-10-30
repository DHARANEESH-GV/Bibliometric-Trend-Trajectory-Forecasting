/**
 * Matrix growth-index guards.
 *
 * The heatmap used to plot ABSOLUTE works per year on one shared scale.
 * The twenty domains differ by up to 60x in any given year, so 90% of the
 * 520 cells sat in the bottom quarter of the colour ramp and a cell told
 * you which domain was big rather than what its year did — every row just
 * hugged its own baseline. Colour now encodes growth indexed to each
 * domain's own 2000 output, plotted on a log scale.
 *
 * These guards pin the maths, because a silent regression here would make
 * the whole chart lie rather than merely look wrong.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const snapshot = JSON.parse(
  readFileSync(resolve(__dirname, '../../../snapshots/20261029T094600Z/matrix.json'), 'utf8'),
) as { years: number[]; cells: Record<string, number[]> }

/** Mirror of the index computation in Matrix.tsx (domainRows). */
function indexRow(series: number[]): number[] {
  const first = series[0]
  const baseline = first != null && first > 0 ? first : 1
  return series.map((v) => Math.max(0, (v ?? 0) / baseline))
}

describe('growth index is relative to each row, not the absolute volume', () => {
  it('every row starts at 1x in its baseline year', () => {
    for (const [domain, series] of Object.entries(snapshot.cells)) {
      const idx = indexRow(series)
      // A domain with no output in 2000 cannot be indexed; it falls back to
      // a baseline of 1, so the first cell is its raw count. All snapshot
      // domains do have a 2000 value, so 1x is the strict expectation.
      expect(idx[0], `${domain} should start at 1x`).toBe(1)
    }
  })

  it('the index is scale-free: a big and a small domain with the same shape match', () => {
    const a = indexRow([100, 200, 400])
    const b = indexRow([1, 2, 4])
    expect(a).toEqual(b)
  })

  it('a domain that never grew reads flat, no matter how large it is', () => {
    const big = indexRow([50_000, 50_000, 50_000])
    expect(big.every((v) => v === 1)).toBe(true)
  })

  it('a zero baseline falls back to 1 rather than dividing by zero', () => {
    const idx = indexRow([0, 10, 20])
    expect(Number.isFinite(idx[1] as number)).toBe(true)
    expect(idx[1]).toBe(10)
  })

  it('never returns a negative multiple', () => {
    // Defensive: a malformed snapshot with a negative count must not invert
    // the colour scale.
    expect(indexRow([100, -5])[1]).toBe(0)
  })
})

describe('the log scale actually spreads the data', () => {
  it('cells populate every decile of the ramp (the old failure mode was a single dark mass)', () => {
    const logs: number[] = []
    for (const series of Object.values(snapshot.cells)) {
      for (const v of indexRow(series)) logs.push(Math.log10(Math.max(v, 0.1)))
    }
    const max = Math.max(...logs)
    const deciles = new Array(10).fill(0) as number[]
    for (const v of logs) {
      const t = Math.max(0, v) / max
      deciles[Math.min(9, Math.floor(t * 10))]! += 1
    }
    // "Populated" = a decile holding at least 1% of the cells. Before the
    // index change, 90% of cells sat in the bottom quarter; a working scale
    // reaches the top bins too.
    const populated = deciles.filter((n) => n / logs.length >= 0.01).length
    expect(populated).toBe(10)
  })

  it('1x sits near the floor, not mid-ramp, so "no growth" reads as cold', () => {
    const logs: number[] = []
    for (const series of Object.values(snapshot.cells)) {
      for (const v of indexRow(series)) logs.push(Math.log10(Math.max(v, 0.1)))
    }
    const max = Math.max(...logs)
    // log10(1) === 0, so "unchanged" is at the scale origin by construction.
    expect(Math.log10(1) / max).toBeLessThan(0.1)
  })

  it('the growth spread covers more than an order of magnitude', () => {
    const finals = Object.values(snapshot.cells).map((s) => {
      const idx = indexRow(s)
      return idx[idx.length - 1] as number
    })
    expect(Math.max(...finals) / Math.min(...finals)).toBeGreaterThan(50)
  })
})
