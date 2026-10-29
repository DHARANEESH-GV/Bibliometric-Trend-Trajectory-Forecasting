import { describe, it, expect } from 'vitest'
import {
  CANONICAL_WEIGHTS,
  computeEmergenceScore,
  simulateLeaderboard,
  computeSpearmanRho,
} from './weights'
import type { ScoreInputs, LeaderboardEntry } from './types'

describe('weights math', () => {
  const dummyInputs: ScoreInputs = {
    growth_recent: 0.5,
    acceleration: 0.25,
    keyword_burst: 0.3,
    volume_scaled: 0.8,
    momentum_intent: 0.5,
  }

  it('computes emergence score with canonical weights', () => {
    const score = computeEmergenceScore(dummyInputs, CANONICAL_WEIGHTS)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(100)
    // growth: 0.5 / 1.0 = 0.5 * 0.30 = 0.15
    // accel: 0.25 / 0.5 = 0.5 * 0.20 = 0.10
    // burst: 0.3 / 0.6 = 0.5 * 0.20 = 0.10
    // vol: 0.8 / 1.0 = 0.8 * 0.15 = 0.12
    // intent: 0.5 / 1.0 = 0.5 * 0.15 = 0.075
    // sum = 0.545 -> 54.5
    expect(score).toBe(54.5)
  })

  it('handles edge case weights of zero gracefully', () => {
    const score = computeEmergenceScore(dummyInputs, {
      growth_recent: 0,
      acceleration: 0,
      keyword_burst: 0,
      volume_scaled: 0,
      momentum_intent: 0,
    })
    expect(score).toBe(0)
  })

  it('correctly simulates leaderboard and computes spearman rho', () => {
    const entries: LeaderboardEntry[] = [
      {
        rank: 1,
        domain: 'domain_a',
        display_name: 'Domain A',
        label: 'Emerging',
        emergence_score: 90,
        score_inputs: {
          growth_recent: 1.0,
          acceleration: 0.5,
          keyword_burst: 0.6,
          volume_scaled: 0.5,
          momentum_intent: 0.5,
        },
        yoy_delta: 0.5,
        sparkline: [1, 2, 3],
        sparkline_years: [2020, 2025],
        forecast_next3: [4, 5, 6],
        forecast_model: 'holt_winters',
        caveat: null,
        notes: [],
      },
      {
        rank: 2,
        domain: 'domain_b',
        display_name: 'Domain B',
        label: 'Active',
        emergence_score: 60,
        score_inputs: {
          growth_recent: 0.1,
          acceleration: 0.1,
          keyword_burst: 0.1,
          volume_scaled: 0.9,
          momentum_intent: 0.5,
        },
        yoy_delta: 0.1,
        sparkline: [1, 2, 3],
        sparkline_years: [2020, 2025],
        forecast_next3: [4, 5, 6],
        forecast_model: 'holt_winters',
        caveat: null,
        notes: [],
      },
    ]

    const simulated = simulateLeaderboard(entries, CANONICAL_WEIGHTS)
    expect(simulated[0]?.domain).toBe('domain_a')
    expect(simulated[1]?.domain).toBe('domain_b')
    expect(simulated[0]?.rank_delta).toBe(0)

    const rho = computeSpearmanRho(simulated)
    expect(rho).toBe(1.0)
  })
})

