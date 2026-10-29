/**
 * Emergence score re-weighting engine.
 * Matches stats/emergence.py: score = 100 * sum(w_i * min(1, s_i / cap_i)).
 * Pure, deterministic, client-side calculator for the 'What-If' simulator.
 */
import type { ScoreInputs, LeaderboardEntry } from './types'

export interface EmergenceWeights {
  growth_recent: number
  acceleration: number
  keyword_burst: number
  volume_scaled: number
  momentum_intent: number
}

export const CANONICAL_WEIGHTS: EmergenceWeights = {
  growth_recent: 0.30,
  acceleration: 0.20,
  keyword_burst: 0.20,
  volume_scaled: 0.15,
  momentum_intent: 0.15,
}

export const INPUT_CAPS: Record<keyof ScoreInputs, number> = {
  growth_recent: 1.0,
  acceleration: 0.5,
  keyword_burst: 0.6,
  volume_scaled: 1.0,
  momentum_intent: 1.0,
}

export const WEIGHT_LABELS: Record<keyof EmergenceWeights, { name: string; desc: string }> = {
  growth_recent: {
    name: 'Recent Growth',
    desc: 'Speed of publication growth over the last 2 years',
  },
  acceleration: {
    name: 'Acceleration',
    desc: 'Whether research output is speeding up or leveling off',
  },
  keyword_burst: {
    name: 'Keyword Surges',
    desc: 'Share of topics showing rapid terminology bursts',
  },
  volume_scaled: {
    name: 'Publication Volume',
    desc: 'Total research papers published in this field',
  },
  momentum_intent: {
    name: 'Patent Intent',
    desc: 'Commercial application and patent filing momentum',
  },
}

export function computeEmergenceScore(
  inputs: ScoreInputs,
  weights: EmergenceWeights,
): number {
  let weightedSum = 0
  let totalWeight = 0

  const keys = Object.keys(weights) as (keyof EmergenceWeights)[]
  for (const k of keys) {
    const w = weights[k] ?? 0
    totalWeight += w
    const cap = INPUT_CAPS[k] ?? 1.0
    const raw = inputs[k] ?? 0
    const clampedRatio = Math.max(0, Math.min(1, raw / cap))
    weightedSum += w * clampedRatio
  }

  if (totalWeight <= 0) return 0
  const normalized = (weightedSum / totalWeight) * 100
  return Math.round(normalized * 10) / 10
}

export interface SimulatedEntry extends LeaderboardEntry {
  simulated_score: number
  simulated_rank: number
  rank_delta: number // baseline rank - simulated rank (positive = moved up)
}

/**
 * Re-ranks leaderboard entries under perturbed weights.
 */
export function simulateLeaderboard(
  entries: LeaderboardEntry[],
  weights: EmergenceWeights,
): SimulatedEntry[] {
  const withScores = entries.map((e) => ({
    ...e,
    simulated_score: computeEmergenceScore(e.score_inputs, weights),
    simulated_rank: 0,
    rank_delta: 0,
  }))

  // Sort descending by simulated score, ties broken by display name
  withScores.sort((a, b) => {
    if (b.simulated_score !== a.simulated_score) {
      return b.simulated_score - a.simulated_score
    }
    return a.display_name.localeCompare(b.display_name)
  })

  return withScores.map((item, idx) => {
    const newRank = idx + 1
    return {
      ...item,
      simulated_rank: newRank,
      rank_delta: item.rank - newRank,
    }
  })
}

/**
 * Computes Spearman rank correlation rho between baseline ranks and simulated ranks.
 * Returns 1.0 for identical rankings, down to -1.0 for inverse.
 */
export function computeSpearmanRho(simulated: SimulatedEntry[]): number {
  const n = simulated.length
  if (n <= 1) return 1.0

  let sumD2 = 0
  for (const s of simulated) {
    const d = s.rank - s.simulated_rank
    sumD2 += d * d
  }

  return 1 - (6 * sumD2) / (n * (n * n - 1))
}

