/**
 * Leaderboard — the landing view. Rank rows: StagePill, emergence score,
 * ScoreBar decomposition, YoY delta, sparkline, forecast peek. Sort/filter
 * lives in the URL. Hover focuses the score decomposition panel.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { STAGE_TOKEN, type LeaderboardEntry } from '../lib/types'
import { fmtDelta, fmtInt, fmtModel, fmtScore, seriesTrend } from '../lib/format'
import { StagePill } from '../components/StagePill'
import { Sparkline } from '../components/Sparkline'
import { ScoreBar } from '../components/ScoreBar'
import { Metric } from '../components/Metric'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CaveatBanner } from '../components/CaveatBanner'
import { ViewController, type LabelFilter, type SortDir, type SortKey } from '../components/ViewController'
import { ViewHeader } from '../components/ViewHeader'
import { SpotlightWrap, useSpotlight, SpotlightRing } from '../components/SpotlightWrap'
import { CopyLink } from '../components/CopyLink'
import { RevealShell } from '../components/RevealShell'
import { HowToRead } from '../components/HowToRead'
import { GlossaryTerm } from '../components/GlossaryTerm'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/csr/SlidersHorizontal'
import { DownloadSimple } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { WeightSimulator } from '../components/WeightSimulator'
import {
  CANONICAL_WEIGHTS,
  computeSpearmanRho,
  type EmergenceWeights,
  type SimulatedEntry,
} from '../lib/weights'

function sortRows(
  rows: (LeaderboardEntry | SimulatedEntry)[],
  sort: SortKey,
  dir: SortDir,
): (LeaderboardEntry | SimulatedEntry)[] {
  const sign = dir === 'asc' ? 1 : -1
  const cmp: Record<SortKey, (a: any, b: any) => number> = {
    rank: (a, b) => (a.simulated_rank ?? a.rank) - (b.simulated_rank ?? b.rank),
    score: (a, b) => (a.simulated_score ?? a.emergence_score) - (b.simulated_score ?? b.emergence_score),
    yoy: (a, b) => a.yoy_delta - b.yoy_delta,
    name: (a, b) => a.display_name.localeCompare(b.display_name),
  }
  return [...rows].sort((a, b) => sign * cmp[sort](a, b))
}

export function LeaderboardView() {
  const { data, loading, error } = useQuery(loadLeaderboard, [])
  const [simulatedEntries, setSimulatedEntries] = useState<SimulatedEntry[] | null>(null)
  const [currentWeights, setCurrentWeights] = useState<EmergenceWeights>(CANONICAL_WEIGHTS)
  const [simulatorOpen, setSimulatorOpen] = useState(false)

  const computedLead = useMemo(() => {
    const rowsX = data?.leaderboard ?? []
    const lead = rowsX[0]
    if (rowsX.length === 0 || !lead)
      return 'Twenty technology fields ranked by growth speed, publication momentum, and surging topics.'
    const pct = Math.round((lead.yoy_delta ?? 0) * 100)
    return `${lead.display_name} holds first place this run, up ${pct}% on the year. Growth scores below blend publication growth speed, keyword surges, and research volume.`
  }, [data])
  const [params, setParams] = useSearchParams()
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const asideSpot = useSpotlight<HTMLElement>()

  const sort = (params.get('sort') as SortKey) ?? 'rank'
  const dir = (params.get('dir') as SortDir) ?? 'asc'
  const labelFilter = (params.get('label') as LabelFilter) ?? 'all'
  const compare = (params.get('compare') ?? '').split(',').filter(Boolean)

  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of data?.leaderboard ?? []) m[r.label] = (m[r.label] ?? 0) + 1
    return m
  }, [data])

  const caveatCount = useMemo(
    () => (data?.leaderboard ?? []).filter((r) => r.caveat).length,
    [data],
  )

  const setSort = (next: SortKey) => {
    const p = new URLSearchParams(params)
    if (next === sort) {
      p.set('dir', dir === 'asc' ? 'desc' : 'asc')
    } else {
      p.set('sort', next)
      // Rank reads ascending by default; score/yoy read descending.
      p.set('dir', next === 'rank' || next === 'name' ? 'asc' : 'desc')
    }
    setParams(p, { replace: true })
  }

  const toggleCompare = (domain: string) => {
    const p = new URLSearchParams(params)
    const cur = (p.get('compare') ?? '').split(',').filter(Boolean)
    const next = cur.includes(domain)
      ? cur.filter((d) => d !== domain)
      : [...cur, domain].slice(-2)
    if (next.length) p.set('compare', next.join(','))
    else p.delete('compare')
    setParams(p, { replace: true })
  }

  const rows = useMemo(() => {
    if (!data) return []
    let list: (LeaderboardEntry | SimulatedEntry)[] = simulatedEntries ?? data.leaderboard
    if (labelFilter !== 'all') list = list.filter((r) => r.label === labelFilter)
    const ordered = sortRows(list, sort, dir)
    // Keep the canonical rank number visible regardless of sort order.
    return ordered
  }, [data, simulatedEntries, sort, dir, labelFilter])

  const exportCSV = () => {
    if (!data) return
    const exportList = simulatedEntries ?? data.leaderboard
    const headers = ['Rank', 'Domain', 'Display Name', 'Stage', 'Emergence Score', 'YoY Delta', 'Forecast Model']
    const csvLines = [headers.join(',')]
    for (const r of exportList as (LeaderboardEntry & { simulated_rank?: number; simulated_score?: number })[]) {
      const rank = r.simulated_rank ?? r.rank
      const score = (r.simulated_score ?? r.emergence_score).toFixed(1)
      const yoy = (r.yoy_delta * 100).toFixed(1) + '%'
      csvLines.push([rank, r.domain, `"${r.display_name.replace(/"/g, '""')}"`, r.label, score, yoy, r.forecast_model].join(','))
    }
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `biblio-leaderboard-${data._meta.run_id}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const compareRows = useMemo(
    () => compare.map((d) => data?.leaderboard.find((r) => r.domain === d)).filter(Boolean) as LeaderboardEntry[],
    [compare, data],
  )

  const focusedDomain = pinned ?? hovered
  const focused = useMemo(
    () =>
      (focusedDomain && data?.leaderboard.find((r) => r.domain === focusedDomain)) ||
      rows[0] ||
      null,
    [data, focusedDomain, rows],
  )

  const riser = useMemo(
    () =>
      [...(data?.leaderboard ?? [])].sort(
        (a, b) => (b.yoy_delta ?? 0) - (a.yoy_delta ?? 0),
      )[0] ?? null,
    [data],
  )

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
        <ShimmerAxes height={420} label="Loading leaderboard" />
      </div>
    )
  }

  const filteredEmpty = rows.length === 0

  return (
    <LbShell>
      <div style={{ padding: 'var(--sp-5) 0' }}>
      <ViewHeader
        title={
          <>
            Emergence <span className="serif-accent">leaderboard</span>
          </>
        }
        lead={computedLead}
      >
        {riser ? (
          <p className="insight-line">
            Fastest riser this run: <strong>{riser.display_name}</strong>{' '}
            <span className="num" style={{ color: 'var(--stage-emerging)' }}>
              {fmtDelta(riser.yoy_delta)}
            </span>{' '}
            year over year.
          </p>
        ) : null}
        {data.rank_stability ? (
          <p className="view-note" title={data.rank_stability.perturbation}>
            {data.rank_stability.summary_line}
          </p>
        ) : null}
        <ViewController stageCounts={stageCounts} total={data.leaderboard.length} />
        <button
          type="button"
          className="lb-action-btn"
          onClick={() => setSimulatorOpen(true)}
          title="Customize ranking priorities and simulate order"
        >
          <SlidersHorizontal size={14} weight="light" aria-hidden />
          <span>Adjust Priorities</span>
        </button>
        <button
          type="button"
          className="lb-action-btn"
          onClick={exportCSV}
          title="Export CSV of current ranking"
        >
          <DownloadSimple size={14} weight="light" aria-hidden />
          <span>Export CSV</span>
        </button>
        <CopyLink />
        {caveatCount > 0 ? (
          <span
            className="view-note"
            title="Domains carrying a published caveat this run"
          >
            {caveatCount} caveat{caveatCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </ViewHeader>

      {simulatedEntries ? (
        <section className="panel-shell sim-banner" aria-label="Simulation status">
          <div className="panel-core sim-banner-inner">
            <span className="sim-banner-text">
              <strong>Custom Priorities Active:</strong> Ranking Match = {computeSpearmanRho(simulatedEntries).toFixed(3)} (1.0 = match with baseline)
            </span>
            <div className="sim-banner-actions">
              <button
                type="button"
                className="island-btn"
                onClick={() => setSimulatorOpen(true)}
              >
                Adjust Dials
              </button>
              <button
                type="button"
                className="island-btn"
                onClick={() => {
                  setSimulatedEntries(null)
                  setCurrentWeights(CANONICAL_WEIGHTS)
                }}
              >
                Reset to Baseline
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {compareRows.length > 0 ? (
        <CompareStrip rows={compareRows} onClear={() => {
          const p = new URLSearchParams(params)
          p.delete('compare')
          setParams(p, { replace: true })
        }} />
      ) : null}

      <HowToRead variant="leaderboard" />

      {filteredEmpty ? (
        <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-7) 0' }}>
          No domains are labeled “{labelFilter}” in this snapshot.
        </p>
      ) : (
        <>
        {data.leaderboard[0] ? (
          <RankOneSpotlight row={data.leaderboard[0]} />
        ) : null}
        <div className="leaderboard-grid">
          {/* Left ⅔: rank rows */}
          <div role="table" aria-label="Emergence leaderboard">
            <div role="row" className="leaderboard-header hairline-bottom">
              <span aria-hidden />
              <span>RANK</span>
              <SortHeader label="DOMAIN" col="name" sort={sort} dir={dir} onSort={setSort} align="left" />
              <span>STAGE</span>
              <SortHeader label="SCORE" col="score" sort={sort} dir={dir} onSort={setSort} />
              <span>
                PAPERS 2020-2025
              </span>
              <SortHeader label="YoY" col="yoy" sort={sort} dir={dir} onSort={setSort} numeric />
            </div>
            {rows.map((row) => (
              <div
                key={row.domain}
                role="row"
                className="leaderboard-row hairline-bottom"
                data-active={pinned === row.domain || hovered === row.domain}
                onMouseEnter={() => setHovered(row.domain)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="row-actions">
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
                    className={`row-icon-btn${pinned === row.domain ? ' row-icon-btn--on' : ''}`}
                  >
                    ⚿
                  </button>
                  <button
                    type="button"
                    aria-pressed={compare.includes(row.domain)}
                    aria-label={
                      compare.includes(row.domain)
                        ? `Remove ${row.display_name} from comparison`
                        : `Compare ${row.display_name}`
                    }
                    title={compare.includes(row.domain) ? 'Remove from comparison' : 'Add to comparison'}
                    onClick={() => toggleCompare(row.domain)}
                    className={`row-icon-btn row-icon-btn--compare${compare.includes(row.domain) ? ' row-icon-btn--on' : ''}`}
                  >
                    ±
                  </button>
                </span>
                <span aria-hidden className="row-backdrop" />
                <Link
                  to={`/domain/${row.domain}`}
                  aria-label={`Open ${row.display_name}`}
                  className="row-link"
                  onFocus={() => setHovered(row.domain)}
                />
                <span className="cell rank-cell">
                  <span className="ghost-rank" aria-hidden>
                    {String((row as any).simulated_rank ?? row.rank).padStart(2, '0')}
                  </span>
                  <span className="num rank-cell-value" style={{ color: 'var(--ink-2)' }}>
                    {(row as any).simulated_rank ?? row.rank}
                    {(row as any).rank_delta != null && (row as any).rank_delta !== 0 ? (
                      <span
                        className="sim-delta-badge"
                        style={{
                          color:
                            (row as any).rank_delta > 0
                              ? 'var(--stage-emerging)'
                              : 'var(--stage-active)',
                        }}
                      >
                        {(row as any).rank_delta > 0
                          ? `▲${(row as any).rank_delta}`
                          : `▼${Math.abs((row as any).rank_delta)}`}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="cell domain-cell">
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
                <span className="cell"><StagePill label={row.label} /></span>
                <span className="cell score-cell">
                  <span className="score-rail" aria-hidden>
                    <span
                      className="score-rail-fill"
                      data-stage={row.label}
                      style={{
                        width: `${Math.max(0, Math.min(100, (row as any).simulated_score ?? row.emergence_score))}%`,
                        background: `var(${STAGE_TOKEN[row.label] ?? '--stage-watch'})`,
                      }}
                    />
                  </span>
                  <span className="num score-value">
                    {fmtScore((row as any).simulated_score ?? row.emergence_score)}
                  </span>
                </span>
                <span className="cell">
                  <Sparkline
                    values={row.sparkline}
                    width={90}
                    height={28}
                    ariaLabel={`${row.display_name}, ${fmtInt(row.sparkline[0] ?? 0)} to ${fmtInt(row.sparkline[row.sparkline.length - 1] ?? 0)} papers`}
                  />
                </span>
                <span
                  className="num cell yoy-cell"
                  style={{ color: row.yoy_delta >= 0 ? 'var(--stage-emerging)' : 'var(--stage-active)' }}
                >
                  <TrendArrow delta={seriesTrend(row.sparkline)} />
                  {fmtDelta(row.yoy_delta)}
                </span>
              </div>
            ))}
          </div>

          {/* Right ⅓: score decomposition for the hovered row */}
          <aside
            ref={asideSpot.ref}
            onMouseMove={asideSpot.onMouseMove}
            aria-live="polite"
            className="panel panel--float spotlight-host leaderboard-aside"
          >
            <SpotlightRing />
            <div className="panel-core">
              {focused ? (
                <>
                  <div className="aside-head">
                    <h2>{focused.display_name}</h2>
                    <StagePill label={focused.label} />
                  </div>
                  <div className="aside-metrics">
                    <Metric label="Growth score" value={fmtScore(focused.emergence_score)} />
                    <Metric label="1-year change" value={fmtDelta(focused.yoy_delta)} />
                  </div>
                  <div className="aside-caption">
                    <GlossaryTerm term="score decomposition">
                      Score breakdown
                    </GlossaryTerm>{' '}
                    (key growth signals)
                  </div>
                  <ScoreBar inputs={focused.score_inputs} />
                  <div className="aside-forecast hairline-top">
                    <div className="aside-caption">Projected growth ({fmtModel(focused.forecast_model)})</div>
                    <div className="num aside-forecast-values">
                      {focused.forecast_next3.map((f) => fmtInt(f)).join('  ')}
                      {" "}
                      <span className="aside-forecast-note">next 3 years</span>
                    </div>
                    {focused.caveat ? (
                      <div className="aside-caveat">
                        <CaveatBanner>{focused.caveat}</CaveatBanner>
                      </div>
                    ) : null}
                    {focused.notes.map((n) => (
                      <p key={n} className="aside-note">{n}</p>
                    ))}
                    <p className="aside-open">
                      <Link to={`/domain/${focused.domain}`}>Open full domain view</Link>
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          </aside>
        </div>
        </>
      )}
    </div>
    <WeightSimulator
      open={simulatorOpen}
      onClose={() => setSimulatorOpen(false)}
      entries={data.leaderboard}
      currentWeights={currentWeights}
      onWeightsChange={(sim, weights) => {
        setSimulatedEntries(sim)
        setCurrentWeights(weights)
      }}
    />
    </LbShell>
  )
}

/**
 * RankOneSpotlight — the run's first-place domain, promoted into a
 * double-bezel plate above the table (hierarchy: the ranking's headline
 * result should not look identical to row 19). Reads the canonical
 * rank-1 row (data.leaderboard[0], rank order), independent of sort.
 * Uses an h3 and carries no aria-pressed control, so the pin/focus
 * audit against the table and aside is untouched.
 */
function RankOneSpotlight({ row }: { row: LeaderboardEntry }) {
  const glow = Math.max(0, Math.min(100, row.emergence_score)) / 100
  return (
    <SpotlightWrap className="rank-one">
      <section
        className="panel panel--float"
        aria-label={`First place: ${row.display_name}`}
        style={{
          ['--rank-glow' as string]: String(glow),
          ['--rank-stage' as string]: `var(${STAGE_TOKEN[row.label] ?? '--stage-watch'})`,
        }}
      >
        <div className="panel-core rank-one-core">
          <span className="rank-one-edge" aria-hidden />
          <div className="rank-one-head">
            <span className="view-eyebrow">First place this run</span>
            <div className="rank-one-title">
              <h3>{row.display_name}</h3>
              <StagePill label={row.label} />
            </div>
          </div>
          <div className="rank-one-score" aria-hidden={false}>
            <span className="num rank-one-score-value">{fmtScore(row.emergence_score)}</span>
            <span className="rank-one-score-label">growth score</span>
          </div>
          <div className="rank-one-metrics">
            <Metric label="1-year change" value={fmtDelta(row.yoy_delta)} />
            <div className="rank-one-spark">
              <span className="rank-one-spark-label">6-Year Trend (2020-2025)</span>
              <Sparkline
                values={row.sparkline}
                forecast={row.forecast_next3}
                width={180}
                height={34}
                ariaLabel={`${row.display_name}, ${fmtInt(row.sparkline[0] ?? 0)} to ${fmtInt(row.sparkline[row.sparkline.length - 1] ?? 0)} papers, forecast to ${fmtInt(row.forecast_next3[row.forecast_next3.length - 1] ?? 0)}`}
              />
            </div>
          </div>
          <Link to={`/domain/${row.domain}`} className="rank-one-link">
            Open {row.display_name} drill-down
          </Link>
        </div>
      </section>
    </SpotlightWrap>
  )
}

/** SortHeader — a column label that is itself the sort control. Clicking
 *  the active column flips direction; a new column starts at the sensible
 *  default (rank/name ascending, score/yoy descending). */
function SortHeader({
  label,
  col,
  sort,
  dir,
  onSort,
  align = 'left',
  numeric = false,
}: {
  label: string
  col: SortKey
  sort: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
  numeric?: boolean
}) {
  const active = sort === col
  return (
    <button
      type="button"
      className={`sort-header${numeric ? ' num' : ''}${active ? ' sort-header--on' : ''}`}
      style={{ justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      onClick={() => onSort(col)}
    >
      {label}
      <span className="sort-caret" aria-hidden>
        {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </button>
  )
}

/** TrendArrow — within-run shape read from the sparkline, not a rank move. */
function TrendArrow({ delta }: { delta: number }) {
  if (delta === 0) return <span aria-hidden style={{ width: '0.7em' }} />
  const up = delta > 0
  return (
    <span
      aria-label={up ? 'series trending up within the run' : 'series trending down within the run'}
      title={up ? 'Series trending up (within-run shape)' : 'Series trending down (within-run shape)'}
      style={{ color: up ? 'var(--stage-emerging)' : 'var(--stage-active)', fontSize: '0.8em' }}
    >
      {up ? '▲' : '▼'}
    </span>
  )
}

/** CompareStrip — side-by-side diff of up to two compared domains. Every
 *  figure comes from the same snapshot rows; no derived constants. */
function CompareStrip({ rows, onClear }: { rows: LeaderboardEntry[]; onClear: () => void }) {
  const a = rows[0]
  const b = rows[1]
  if (!a) return null
  const cells: Array<{ label: string; a: string; b: string }> = [
    { label: 'Rank', a: `#${a.rank}`, b: b ? `#${b.rank}` : '' },
    { label: 'Emergence score', a: fmtScore(a.emergence_score), b: b ? fmtScore(b.emergence_score) : '' },
    { label: 'YoY change', a: fmtDelta(a.yoy_delta), b: b ? fmtDelta(b.yoy_delta) : '' },
    { label: 'Stage', a: a.label, b: b ? b.label : '' },
  ]
  return (
    <section className="panel compare-strip" aria-label="Comparison">
      <div className="panel-core">
        <div className="compare-head">
          <span className="view-eyebrow">Compare</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link
              to={`/compare?a=${a.domain}${b ? `&b=${b.domain}` : ''}`}
              className="island-btn"
              style={{ textDecoration: 'none', color: 'var(--accent)' }}
            >
              Open Full Compare Duel →
            </Link>
            <button type="button" className="island-btn" onClick={onClear}>
              Clear
            </button>
          </div>
        </div>
        <div className="compare-grid">
          <div />
          <div className="compare-name">{a.display_name}</div>
          <div className="compare-name">{b ? b.display_name : 'add a second'}</div>
          {cells.map((c) => (
            <CompareRow key={c.label} label={c.label} a={c.a} b={c.b} />
          ))}
        </div>
      </div>
    </section>
  )
}

function CompareRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <>
      <div className="compare-label">{label}</div>
      <div className="num compare-val">{a}</div>
      <div className="num compare-val">{b}</div>
    </>
  )
}

/** LbShell — wraps the view, plays the arrival beat when mounted from a
 *  curtain entry (cover -> observatory): header and rows rise in softly
 *  with a stagger. Skipped entirely under reduced motion. */
function LbShell({ children }: { children: React.ReactNode }) {
  return (
    <RevealShell rowSelector=".leaderboard-row">{children}</RevealShell>
  )
}
