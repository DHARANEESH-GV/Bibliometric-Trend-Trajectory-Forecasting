/**
 * MethodologyNote — the site-wide footnote bound to the real backtest
 * gate output. Computes from leaderboard.json's gate block; the win/series
 * counts are never hardcoded (enforced by format.test.ts).
 */
import { useQuery } from '../lib/useQuery'
import { loadLeaderboard } from '../lib/snapshots'
import { gateFootnote } from '../lib/format'
import type { GateBlock } from '../lib/types'

const FALLBACK =
  'Backtest results were not reachable when this footnote rendered.'

function gatesFromBlock(gate: GateBlock) {
  return Object.entries(gate).map(([model, g]) => ({
    model,
    wins: g.wins,
    series: g.series,
    passed: g.gate_passed,
  }))
}

export function MethodologyNote() {
  const { data, error } = useQuery(loadLeaderboard, [])

  if (error) {
    return (
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>{FALLBACK}</p>
    )
  }
  if (!data) return null

  return (
    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', maxWidth: '80ch' }}>
      {gateFootnote(gatesFromBlock(data.gate))}
    </p>
  )
}
