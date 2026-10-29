/**
 * Pins the browser-side lag maths to the Python pipeline's stored values.
 *
 * The alignment slider recomputes r(k) client-side. If that computation
 * drifts from `lag_results.json`, the slider would display a correlation
 * that disagrees with the headline number — a silent honesty failure. So
 * the contract is asserted, not assumed:
 *
 *   for every domain, curveFromSeries(domain) === domain.curve  (within 1e-4)
 *   for every domain, rAtLag(papers, patents, domain.best_lag) === domain.best_r
 *
 * The fixture is the real snapshot on disk when present, so this fails
 * loudly against real data, not just a toy.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { curveFromSeries, pearson, rAtLag, shiftPatentsForPlot } from './lagmath'
import type { LagDomain, LagFile } from './types'

const SNAPSHOT = join(__dirname, '..', '..', 'public', 'snapshots', 'lag.json')

function loadDomains(): LagDomain[] {
  if (!existsSync(SNAPSHOT)) return []
  const raw = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as LagFile
  return raw.domains.filter((d) => d.series)
}

const DOMAINS = loadDomains()

describe('pearson', () => {
  it('is 1 for a perfectly proportional pair', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10)
  })

  it('is -1 for an inverted pair', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10)
  })

  it('is 0 for a constant series (no NaN)', () => {
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0)
    expect(Number.isNaN(pearson([5, 5, 5, 5], [1, 2, 3, 4]))).toBe(false)
  })

  it('is symmetric', () => {
    const a = [0.2, -1.1, 0.7, 2.0, 0.4, -0.3]
    const b = [-0.5, 1.4, -0.2, 0.9, 1.1, -1.3]
    expect(pearson(a, b)).toBeCloseTo(pearson(b, a), 12)
  })
})

describe('slider maths matches the stored pipeline output', () => {
  it('has domains with series to test', () => {
    // Guard: a missing public/snapshots copy should not silently pass.
    expect(DOMAINS.length).toBeGreaterThan(0)
  })

  it('r(k) reproduces the stored curve for every domain and every lag', () => {
    const failures: string[] = []
    for (const d of DOMAINS) {
      const computed = curveFromSeries(d)
      d.curve.forEach((stored, k) => {
        if (stored == null) return
        if (Math.abs(computed[k]! - stored) > 1e-4) {
          failures.push(`${d.domain} k=${k}: computed ${computed[k]} vs stored ${stored}`)
        }
      })
    }
    expect(failures).toEqual([])
  })

  it('r at each domain stored best k reproduces its stored best_r', () => {
    const failures: string[] = []
    for (const d of DOMAINS) {
      if (d.best_lag == null || d.best_r == null) continue
      const r = rAtLag(d.series!.papers_z, d.series!.patents_z, d.best_lag)
      if (Math.abs(r - d.best_r) > 1e-4) {
        failures.push(`${d.domain}: k=${d.best_lag} computed ${r} vs stored ${d.best_r}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('the argmax of the computed curve equals the stored best lag', () => {
    const failures: string[] = []
    for (const d of DOMAINS) {
      if (d.best_lag == null) continue
      const curve = curveFromSeries(d)
      let best = 0
      for (let k = 1; k < curve.length; k++) if (curve[k]! > curve[best]!) best = k
      if (best !== d.best_lag) failures.push(`${d.domain}: argmax ${best} vs stored ${d.best_lag}`)
    }
    expect(failures).toEqual([])
  })

  it('shifted-plot alignment is equivalent to the sliced correlation', () => {
    for (const d of DOMAINS.slice(0, 5)) {
      const { papers_z: p, patents_z: q } = d.series!
      for (const k of [0, 3, 5, 12]) {
        const shifted = shiftPatentsForPlot(q, k)
        const pairs: Array<[number, number]> = []
        p.forEach((pv, i) => {
          const qv = shifted[i]
          if (qv != null) pairs.push([pv, qv])
        })
        const viaShift = pearson(pairs.map((x) => x[0]), pairs.map((x) => x[1]))
        expect(viaShift).toBeCloseTo(rAtLag(p, q, k), 10)
      }
    }
  })
})

describe('shiftPatentsForPlot', () => {
  it('drops shifted-out points as null instead of wrapping or inventing', () => {
    const out = shiftPatentsForPlot([1, 2, 3, 4], 2)
    expect(out).toEqual([3, 4, null, null])
  })

  it('is identity at k=0', () => {
    expect(shiftPatentsForPlot([1, 2, 3], 0)).toEqual([1, 2, 3])
  })
})
