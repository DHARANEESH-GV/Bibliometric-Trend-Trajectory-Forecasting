/**
 * Overview — all twenty fields at a glance. Small multiples of the
 * leaderboard sparklines (d3-viz Pattern B: declarative rendering with
 * existing parts, no chart library), grouped by lifecycle stage. Every
 * cell links to its drill-down; every figure comes from the snapshot.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { fmtDelta, fmtInt, fmtScore, seriesTrend } from '../lib/format'
import { STAGE_TOKEN, type LeaderboardEntry } from '../lib/types'
import { Sparkline } from '../components/Sparkline'
import { ViewHeader } from '../components/ViewHeader'
import { RevealShell } from '../components/RevealShell'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CopyLink } from '../components/CopyLink'

const STAGES = ['Emerging', 'Accelerating', 'Active', 'Watch'] as const

export function OverviewView() {
  const { data, loading, error } = useQuery(loadLeaderboard, [])

  const groups = useMemo(() => {
    const rows = data?.leaderboard ?? []
    return STAGES.map((stage) => ({
      stage,
      rows: rows.filter((r) => r.label === stage),
    })).filter((g) => g.rows.length > 0)
  }, [data])

  if (error) {
    return (
      <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-6) 0' }}>
        Live lookups unavailable. Showing cached snapshots. ({error.message})
      </p>
    )
  }

  if (loading || !data) {
    return (
      <div style={{ padding: 'var(--sp-6) 0' }}>
        <ShimmerAxes height={420} label="Loading overview" />
      </div>
    )
  }

  return (
    <RevealShell rowSelector=".overview-stage">
      <div style={{ padding: 'var(--sp-5) 0' }}>
      <ViewHeader
        title={
          <>
            All fields at a <span className="serif-accent">glance</span>
          </>
        }
        lead={
          <>
            Twenty technology domains as small multiples, grouped by lifecycle
            stage. Each panel is the same shape: papers published per year,
            2020-2025, with the emergence score beneath.
          </>
        }
      >
        <CopyLink />
      </ViewHeader>

      {groups.map((g, gi) => (
        <section key={g.stage} className="overview-stage" aria-label={`${g.stage} domains`}>
          <div className="overview-stage-head">
            <span
              className="stage-dot"
              aria-hidden
              style={{ background: `var(${STAGE_TOKEN[g.stage] ?? '--stage-watch'})` }}
            />
            <h2>{g.stage}</h2>
            <span className="num overview-stage-count">{g.rows.length}</span>
            <span className="ghost-index" aria-hidden>
              {String(gi + 1).padStart(2, '0')}
            </span>
          </div>
          <div className="overview-grid">
            {g.rows.map((row) => (
              <OverviewCell key={row.domain} row={row} />
            ))}
          </div>
        </section>
      ))}
      </div>
    </RevealShell>
  )
}

function OverviewCell({ row }: { row: LeaderboardEntry }) {
  const trend = seriesTrend(row.sparkline)
  return (
    <Link
      to={`/domain/${row.domain}`}
      className="overview-cell"
      aria-label={`${row.display_name}, stage ${row.label}, emergence score ${fmtScore(row.emergence_score)}`}
    >
      <span className="overview-cell-name">
        <span
          className="stage-dot"
          aria-hidden
          style={{ background: `var(${STAGE_TOKEN[row.label] ?? '--stage-watch'})` }}
        />
        {row.display_name}
      </span>
      <Sparkline
        values={row.sparkline}
        width={200}
        height={44}
        ariaLabel={`${row.display_name}, ${fmtInt(row.sparkline[0] ?? 0)} to ${fmtInt(row.sparkline[row.sparkline.length - 1] ?? 0)} papers`}
      />
      <span className="overview-cell-meta">
        <span className="num overview-cell-score">{fmtScore(row.emergence_score)}</span>
        <span
          className="num"
          style={{ color: row.yoy_delta >= 0 ? 'var(--stage-emerging)' : 'var(--stage-active)' }}
        >
          {trend !== 0 ? (trend > 0 ? '▲' : '▼') : ''} {fmtDelta(row.yoy_delta)}
        </span>
      </span>
    </Link>
  )
}
