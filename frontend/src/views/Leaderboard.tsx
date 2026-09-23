/**
 * Leaderboard — the landing view. Rank rows: StagePill, emergence score,
 * ScoreBar decomposition, YoY delta, sparkline, forecast peek. Sort/filter
 * lives in the URL. Hover focuses the score decomposition panel.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import type { LeaderboardEntry } from '../lib/types'
import { fmtDelta, fmtInt, fmtModel, fmtScore } from '../lib/format'
import { StagePill } from '../components/StagePill'
import { Sparkline } from '../components/Sparkline'
import { ScoreBar } from '../components/ScoreBar'
import { Metric } from '../components/Metric'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CaveatBanner } from '../components/CaveatBanner'
import { ViewController, type LabelFilter, type SortDir, type SortKey } from '../components/ViewController'

function sortRows(
  rows: LeaderboardEntry[],
  sort: SortKey,
  dir: SortDir,
): LeaderboardEntry[] {
  const sign = dir === 'asc' ? 1 : -1
  const cmp: Record<SortKey, (a: LeaderboardEntry, b: LeaderboardEntry) => number> = {
    rank: (a, b) => a.rank - b.rank,
    score: (a, b) => a.emergence_score - b.emergence_score,
    yoy: (a, b) => a.yoy_delta - b.yoy_delta,
    name: (a, b) => a.display_name.localeCompare(b.display_name),
  }
  return [...rows].sort((a, b) => sign * cmp[sort](a, b))
}

export function LeaderboardView() {
  const { data, loading, error } = useQuery(loadLeaderboard, [])
  const [params] = useSearchParams()
  const [hovered, setHovered] = useState<string | null>(null)

  const sort = (params.get('sort') as SortKey) ?? 'rank'
  const dir = (params.get('dir') as SortDir) ?? 'asc'
  const labelFilter = (params.get('label') as LabelFilter) ?? 'all'

  const rows = useMemo(() => {
    if (!data) return []
    let list = data.leaderboard
    if (labelFilter !== 'all') list = list.filter((r) => r.label === labelFilter)
    const ordered = sortRows(list, sort, dir)
    // Keep the canonical rank number visible regardless of sort order.
    return ordered
  }, [data, sort, dir, labelFilter])

  const focused = useMemo(
    () => data?.leaderboard.find((r) => r.domain === hovered) ?? rows[0] ?? null,
    [data, hovered, rows],
  )

  if (error) {
    return (
      <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-6) 0' }}>
        Live lookups unavailable — showing cached snapshots. ({error.message})
      </p>
    )
  }

  if (loading || !data) {
    return (
      <div style={{ padding: 'var(--sp-6) 0' }}>
        <ShimmerAxes height={420} label="Loading leaderboard" />
      </div>
    )
  }

  const filteredEmpty = rows.length === 0

  return (
    <div style={{ padding: 'var(--sp-5) 0' }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--sp-4)',
          marginBottom: 'var(--sp-5)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Emergence leaderboard</h1>
          <p style={{ color: 'var(--ink-2)', marginTop: 'var(--sp-1)', fontSize: 'var(--text-sm)' }}>
            Twenty technology domains scored on recent growth, citation
            acceleration, novelty, and keyword bursts. Higher scores signal
            fields that are heating up across papers.
          </p>
        </div>
        <ViewController />
      </header>

      {filteredEmpty ? (
        <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-7) 0' }}>
          No domains are labeled “{labelFilter}” in this snapshot.
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)',
            gap: 'var(--sp-6)',
            alignItems: 'start',
          }}
          className="leaderboard-grid"
        >
          {/* Left ⅔: rank rows */}
          <div role="table" aria-label="Emergence leaderboard">
            <div
              role="row"
              className="leaderboard-header hairline-bottom"
              style={{
                display: 'grid',
                gridTemplateColumns: '2.5rem minmax(0,1fr) 7rem 8.5rem 7rem 6rem',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                padding: '0 var(--sp-2) var(--sp-2)',
                fontSize: 'var(--text-xs)',
                color: 'var(--ink-3)',
              }}
            >
              <span>RANK</span>
              <span>DOMAIN</span>
              <span>STAGE</span>
              <span>SCORE</span>
              <span>PAPERS 2020–2025</span>
              <span className="num">YoY</span>
            </div>
            {rows.map((row, i) => (
              <Link
                key={row.domain}
                to={`/domain/${row.domain}`}
                role="row"
                onMouseEnter={() => setHovered(row.domain)}
                onFocus={() => setHovered(row.domain)}
                onClick={(e) => e.stopPropagation()}
                className="leaderboard-row hairline-bottom"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2.5rem minmax(0,1fr) 7rem 8.5rem 7rem 6rem',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  padding: 'var(--sp-3) var(--sp-2)',
                  textDecoration: 'none',
                  color: 'inherit',
                  background: hovered === row.domain ? 'var(--surface-1)' : 'transparent',
                  transition: 'background var(--motion-fast)',
                  animationDelay: `${i * 40}ms`,
                }}
              >
                <span className="num" style={{ color: 'var(--ink-2)' }}>{row.rank}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.display_name}
                  {row.caveat ? (
                    <span
                      aria-label="Has a caveat"
                      title={row.caveat}
                      style={{ color: 'var(--stage-active)', marginLeft: 'var(--sp-2)' }}
                    >
                      •
                    </span>
                  ) : null}
                </span>
                <span><StagePill label={row.label} /></span>
                <span className="num" style={{ fontSize: 'var(--text-lg)', fontWeight: 500 }}>
                  {fmtScore(row.emergence_score)}
                </span>
                <span>
                  <Sparkline
                    values={row.sparkline}
                    forecast={row.forecast_next3.length === row.sparkline.length ? undefined : undefined}
                    width={90}
                    height={28}
                    ariaLabel={`${row.display_name}, ${fmtInt(row.sparkline[0] ?? 0)} to ${fmtInt(row.sparkline[row.sparkline.length - 1] ?? 0)} papers`}
                  />
                </span>
                <span className="num" style={{ color: row.yoy_delta >= 0 ? 'var(--stage-emerging)' : 'var(--stage-active)' }}>
                  {fmtDelta(row.yoy_delta)}
                </span>
              </Link>
            ))}
          </div>

          {/* Right ⅓: score decomposition for the hovered row */}
          <aside
            aria-live="polite"
            style={{
              border: 'var(--hairline)',
              borderRadius: 3,
              padding: 'var(--sp-5)',
              background: 'var(--surface-1)',
              position: 'sticky',
              top: 'var(--sp-5)',
            }}
          >
            {focused ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
                  <h2 style={{ fontSize: 'var(--text-lg)' }}>{focused.display_name}</h2>
                  <StagePill label={focused.label} />
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--sp-4)',
                    margin: 'var(--sp-4) 0',
                  }}
                >
                  <Metric label="Emergence score" value={fmtScore(focused.emergence_score)} />
                  <Metric label="YoY change" value={fmtDelta(focused.yoy_delta)} />
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)', marginBottom: 'var(--sp-2)' }}>
                  Score decomposition (normalized inputs)
                </div>
                <ScoreBar inputs={focused.score_inputs} />
                <div
                  className="hairline-top"
                  style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)' }}
                >
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-2)' }}>
                    Forecast peek ({fmtModel(focused.forecast_model)})
                  </div>
                  <div className="num" style={{ marginTop: 'var(--sp-1)' }}>
                    {focused.forecast_next3.map((f) => fmtInt(f)).join('  ')}
                    {" "}
                    <span style={{ color: 'var(--ink-3)', fontSize: 'var(--text-xs)' }}>
                      next 3 years
                    </span>
                  </div>
                  {focused.caveat ? (
                    <div style={{ marginTop: 'var(--sp-3)' }}>
                      <CaveatBanner>{focused.caveat}</CaveatBanner>
                    </div>
                  ) : null}
                  {focused.notes.map((n) => (
                    <p key={n} style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', marginTop: 'var(--sp-2)' }}>
                      {n}
                    </p>
                  ))}
                  <p style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--sp-3)' }}>
                    <Link to={`/domain/${focused.domain}`}>Open full domain view</Link>
                  </p>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  )
}
