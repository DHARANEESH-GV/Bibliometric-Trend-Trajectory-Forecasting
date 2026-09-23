import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gateFootnote, fmtDelta } from './format'
import type { LeaderboardFile } from './types'

const fixture = resolve(__dirname, '../../public/snapshots/leaderboard.json')

function loadFixture(): LeaderboardFile {
  return JSON.parse(readFileSync(fixture, 'utf-8')) as LeaderboardFile
}

describe('gate footnote binds to real backtest output', () => {
  it('computes 16/20 from the fixture, hardcoded nowhere', () => {
    const lb = loadFixture()
    const gates = Object.entries(lb.gate).map(([model, g]) => ({
      model,
      wins: g.wins,
      series: g.series,
      passed: g.gate_passed,
    }))
    const text = gateFootnote(gates)
    expect(text).toContain('Holt-Winters damped passed 16 of 20 backtest series')
    expect(text).toMatch(/drift passed 16 of 20/)
    expect(text).toMatch(/pooled passed 1 of 20 backtest series and fell the gate/)
  })
})

describe('delta formatting', () => {
  it('signs deltas with a real minus, not a hyphen', () => {
    expect(fmtDelta(0.9587)).toBe('+0.96')
    expect(fmtDelta(-0.2)).toBe('−0.20')
  })
})

describe('leaderboard shape sanity', () => {
  const lb = loadFixture()
  it('has 20 rows and the observed label taxonomy', () => {
    expect(lb.leaderboard).toHaveLength(20)
    const labels = new Set(lb.leaderboard.map((r) => r.label))
    expect(labels.has('Emerging')).toBe(true)
    expect(labels.has('Accelerating')).toBe(true)
    expect(labels.has('Active')).toBe(true)
    expect(labels.has('Watch')).toBe(true)
  })
  it('sparklines are 24 quarterly-derived points, 2020–2025', () => {
    for (const row of lb.leaderboard) {
      expect(row.sparkline).toHaveLength(24)
      expect(row.sparkline_years).toEqual([2020, 2025])
    }
  })
})
