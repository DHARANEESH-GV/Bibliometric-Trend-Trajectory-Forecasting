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
import { CopyLink } from '../components/CopyLink'

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

  const computedLead = useMemo(() => {
    const rowsX = data?.leaderboard ?? []
    const lead = rowsX[0]
    if (rowsX.length === 0 || !lead)
      return 'Twenty technology domains scored on recent growth, citation acceleration, novelty, and keyword bursts.'
    const pct = Math.round((lead.yoy_delta ?? 0) * 100)
    return `${lead.display_name} holds first place this run, up ${pct}% on the year. Scores below blend recent growth, citation acceleration, novelty, and keyword bursts.`
  }, [data])
  const [params] = useSearchParams()
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)

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

  const focusedDomain = pinned ?? hovered
  const focused = useMemo(
    () =>
      (focusedDomain && data?.leaderboard.find((r) => r.domain === focusedDomain)) ||
      rows[0] ||
      null,
    [data, focusedDomain, rows],
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
            {computedLead}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
          <ViewController />
          <CopyLink />
        </div>
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
                gridTemplateColumns: '1.6rem 2.5rem minmax(0,1fr) 7rem 8.5rem 7rem 6rem',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                padding: '0 var(--sp-2) var(--sp-2)',
                fontSize: 'var(--text-xs)',
                color: 'var(--ink-3)',
              }}
            >
              <span aria-hidden />
              <span>RANK</span>
              <span>DOMAIN</span>
              <span>STAGE</span>
              <span>SCORE</span>
              <span>PAPERS 2020–2025</span>
              <span className="num">YoY</span>
            </div>
            {rows.map((row) => (
              <div
                key={row.domain}
                role="row"
                className="leaderboard-row hairline-bottom"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.6rem 2.5rem minmax(0,1fr) 7rem 8.5rem 7rem 6rem',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  padding: 'var(--sp-3) var(--sp-2)',
                  position: 'relative',
                  background:
                    pinned === row.domain || hovered === row.domain
                      ? 'var(--surface-1)'
                      : 'transparent',
                  transition: 'background var(--motion-fast)',
                }}
                onMouseEnter={() => setHovered(row.domain)}
                onMouseLeave={() => setHovered(null)}
              >
                <button
                  type="button"
                  aria-pressed={pinned === row.domain}
                  aria-label={
                    pinned === row.domain
                      ? `Unpin ${row.display_name}`
                      : `Pin ${row.display_name} to the score panel`
                  }
                  title={pinned === row.domain ? 'Unpin' : 'Pin to panel'}
                  onClick={() => setPinned((cur) => (cur === row.domain ? null : row.domain))}
                  style={{
                    width: 22,
                    height: 22,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 2,
                    fontSize: 'var(--text-xs)',
                    color: pinned === row.domain ? 'var(--accent-ink)' : 'var(--ink-3)',
                    background: pinned === row.domain ? 'var(--ink-0)' : 'transparent',
                    border: 'var(--hairline)',
                    position: 'relative',
                    zIndex: 3,
                  }}
                >
                  ⚿
                </button>
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 0,
                  }}
                />
                <Link
                  to={`/domain/${row.domain}`}
                  aria-label={`Open ${row.display_name}`}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 1,
                    borderRadius: 2,
                    outlineOffset: -2,
                  }}
                  onFocus={() => setHovered(row.domain)}
                />
                <span className="num" style={{ color: 'var(--ink-2)', position: 'relative', zIndex: 2, pointerEvents: 'none' }}>{row.rank}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', position: 'relative', zIndex: 2, pointerEvents: 'none' }}>
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
                <span style={{ position: 'relative', zIndex: 2, pointerEvents: 'none' }}><StagePill label={row.label} /></span>
                <span className="num" style={{ fontSize: 'var(--text-lg)', fontWeight: 500, position: 'relative', zIndex: 2, pointerEvents: 'none' }}>
                  {fmtScore(row.emergence_score)}
                </span>
                <span style={{ position: 'relative', zIndex: 2, pointerEvents: 'none' }}>
                  <Sparkline
                    values={row.sparkline}
                    forecast={row.forecast_next3.length === row.sparkline.length ? undefined : undefined}
                    width={90}
                    height={28}
                    ariaLabel={`${row.display_name}, ${fmtInt(row.sparkline[0] ?? 0)} to ${fmtInt(row.sparkline[row.sparkline.length - 1] ?? 0)} papers`}
                  />
                </span>
                <span className="num" style={{ color: row.yoy_delta >= 0 ? 'var(--stage-emerging)' : 'var(--stage-active)', position: 'relative', zIndex: 2, pointerEvents: 'none' }}>
                  {fmtDelta(row.yoy_delta)}
                </span>
              </div>
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
