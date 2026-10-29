/**
 * CompareView - Head-to-Head Duel Mode.
 * Side-by-side analysis contrasting two technology domains:
 * emergence score decomposition, trajectory forecasts, paper-to-patent lag,
 * and keyword burst frontiers.
 */
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowsLeftRight } from '@phosphor-icons/react/dist/csr/ArrowsLeftRight'
import { Lightning } from '@phosphor-icons/react/dist/csr/Lightning'
import { FileText } from '@phosphor-icons/react/dist/csr/FileText'
import { Sparkle } from '@phosphor-icons/react/dist/csr/Sparkle'

import { useQuery } from '../lib/useQuery'
import { loadLeaderboard, loadTrajectories, loadLag, loadBursts } from '../lib/snapshots'
import { useTokens } from '../lib/useTokens'
import { useChart, baseOption, axes, tooltip, cleanSeries } from '../charts/echarts'
import { ViewHeader } from '../components/ViewHeader'
import { StagePill } from '../components/StagePill'
import { ScoreBar } from '../components/ScoreBar'
import { ScoreRadar } from '../components/ScoreRadar'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { RevealShell } from '../components/RevealShell'
import { CopyLink } from '../components/CopyLink'
import { fmtInt, fmtScore, fmtDelta } from '../lib/format'
import type { LeaderboardEntry, TrajectoryDomain, TrajectoriesFile, BurstsFile, LagFile, LeaderboardFile } from '../lib/types'

const POPULAR_MATCHUPS = [
  { label: 'Frontier AI', a: 'generative_ai', b: 'ai_agents' },
  { label: 'Quantum Frontier', a: 'quantum_computing', b: 'quantum_error_correction' },
  { label: 'Bio Engineering', a: 'synthetic_biology', b: 'biotechnology' },
  { label: 'Energy Transition', a: 'clean_hydrogen', b: 'carbon_capture' },
  { label: 'Distributed Systems', a: 'edge_computing', b: 'internet_of_things' },
] as const

export function CompareView() {
  const [params, setParams] = useSearchParams()
  const tokens = useTokens()

  const { data: lbData, loading: lbLoading } = useQuery<LeaderboardFile>(loadLeaderboard, [])
  const { data: trajData, loading: trajLoading } = useQuery<TrajectoriesFile>(loadTrajectories, [])
  const { data: lagData } = useQuery<LagFile>(loadLag, [])
  const { data: burstsData } = useQuery<BurstsFile>(loadBursts, [])

  const leaderboard = lbData?.leaderboard ?? []
  const domainsList = useMemo(() => {
    return leaderboard.map((r) => ({ domain: r.domain, display_name: r.display_name }))
  }, [leaderboard])

  const domainAKey = params.get('a') || (domainsList[0]?.domain ?? 'quantum_computing')
  const domainBKey = params.get('b') || (domainsList[1]?.domain ?? 'generative_ai')

  const entryA = useMemo<LeaderboardEntry | undefined>(
    () => leaderboard.find((r) => r.domain === domainAKey),
    [leaderboard, domainAKey],
  )
  const entryB = useMemo<LeaderboardEntry | undefined>(
    () => leaderboard.find((r) => r.domain === domainBKey),
    [leaderboard, domainBKey],
  )

  const trajA = useMemo<TrajectoryDomain | undefined>(
    () => trajData?.domains.find((d) => d.domain === domainAKey),
    [trajData, domainAKey],
  )
  const trajB = useMemo<TrajectoryDomain | undefined>(
    () => trajData?.domains.find((d) => d.domain === domainBKey),
    [trajData, domainBKey],
  )

  const lagA = useMemo(
    () => lagData?.domains.find((d) => d.domain === domainAKey),
    [lagData, domainAKey],
  )
  const lagB = useMemo(
    () => lagData?.domains.find((d) => d.domain === domainBKey),
    [lagData, domainBKey],
  )

  const burstsA = useMemo(() => {
    return (burstsData?.feed ?? [])
      .filter((b) => b.domain === domainAKey)
      .slice(0, 6)
      .map((b) => b.keyword)
  }, [burstsData, domainAKey])

  const burstsB = useMemo(() => {
    return (burstsData?.feed ?? [])
      .filter((b) => b.domain === domainBKey)
      .slice(0, 6)
      .map((b) => b.keyword)
  }, [burstsData, domainBKey])

  const swapDomains = () => {
    const p = new URLSearchParams(params)
    p.set('a', domainBKey)
    p.set('b', domainAKey)
    setParams(p, { replace: true })
  }

  const setDomainA = (slug: string) => {
    const p = new URLSearchParams(params)
    p.set('a', slug)
    setParams(p, { replace: true })
  }

  const setDomainB = (slug: string) => {
    const p = new URLSearchParams(params)
    p.set('b', slug)
    setParams(p, { replace: true })
  }

  // Trajectory dual overlay chart
  const { ref: chartRef } = useChart((t) => {
    if (!trajA || !trajB) return {}

    const allYears = Array.from(
      new Set([
        ...trajA.series.map((p: { year: number }) => p.year),
        ...trajB.series.map((p: { year: number }) => p.year),
      ]),
    ).sort((a: number, b: number) => a - b)

    const colorA = t.cat1
    const colorB = t.cat2

    const actualA = trajA.series.filter((p: { works: number | null }) => p.works != null)
    const actualB = trajB.series.filter((p: { works: number | null }) => p.works != null)

    const cleanActualA = cleanSeries(
      allYears.map((y) => {
        const pt = actualA.find((p: { year: number }) => p.year === y)
        return pt ? pt.works : null
      }),
    )

    const cleanActualB = cleanSeries(
      allYears.map((y) => {
        const pt = actualB.find((p: { year: number }) => p.year === y)
        return pt ? pt.works : null
      }),
    )

    return {
      ...baseOption(t),
      grid: { top: 32, right: 36, bottom: 40, left: 60, containLabel: false },
      legend: {
        show: true,
        top: 0,
        right: 0,
        textStyle: { color: t.ink1, fontFamily: t.fontBody, fontSize: 11 },
        itemGap: 16,
      },
      tooltip: {
        ...tooltip(t),
        trigger: 'axis' as const,
        formatter: (items: any) => {
          if (!Array.isArray(items) || items.length === 0) return ''
          const year = items[0]?.axisValueLabel
          let html = `<div style="font-family:${t.fontBody};font-size:12px;padding:4px 6px;">`
          html += `<div style="color:${t.ink2};font-size:11px;margin-bottom:6px;">Year ${year}</div>`
          for (const it of items) {
            const val = typeof it.value === 'number' ? fmtInt(it.value) : 'n/a'
            html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:2px 0;">`
            html += `<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${it.color};margin-right:6px;"></span>${it.seriesName}</span>`
            html += `<strong style="font-family:${t.fontMono}">${val}</strong>`
            html += `</div>`
          }
          html += `</div>`
          return html
        },
      },
      xAxis: {
        ...axes(t).xAxis,
        type: 'category' as const,
        data: allYears.map(String),
      },
      yAxis: {
        ...axes(t).yAxis,
        type: 'value' as const,
        axisLabel: {
          color: t.ink2,
          fontFamily: t.fontMono,
          fontSize: 10,
          formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)),
        },
      },
      series: [
        {
          name: trajA.display_name,
          type: 'line' as const,
          data: cleanActualA,
          lineStyle: { width: 2.5, color: colorA },
          itemStyle: { color: colorA },
          showSymbol: false,
          emphasis: { focus: 'series' as const },
        },
        {
          name: trajB.display_name,
          type: 'line' as const,
          data: cleanActualB,
          lineStyle: { width: 2.5, color: colorB },
          itemStyle: { color: colorB },
          showSymbol: false,
          emphasis: { focus: 'series' as const },
        },
      ],
    }
  }, tokens.ink0, [trajA, trajB])

  if (lbLoading || trajLoading || !entryA || !entryB) {
    return (
      <div style={{ padding: 'var(--sp-6) 0' }}>
        <ShimmerAxes height={420} label="Loading head-to-head comparison" />
      </div>
    )
  }

  const scoreDelta = Math.round((entryA.emergence_score - entryB.emergence_score) * 10) / 10
  const yoyDeltaA = entryA.yoy_delta
  const yoyDeltaB = entryB.yoy_delta

  return (
    <RevealShell>
      <div style={{ padding: 'var(--sp-5) 0' }}>
        <ViewHeader
          title={
            <>
              Head-to-Head <span className="serif-accent">Comparison</span>
            </>
          }
          lead={
            <>
              Benchmark two technology fields side by side: compare growth scores,
              publication curves, lab-to-market patent timing, and fast-rising keywords.
            </>
          }
        >
          <CopyLink />
        </ViewHeader>

        {/* Domain Selectors Bar */}
        <section className="compare-bar panel-shell" aria-label="Select domains to compare">
          <div className="panel-core compare-bar-core">
            <div className="compare-selector-col">
              <span className="compare-dot" style={{ background: tokens.cat1 }} aria-hidden />
              <label htmlFor="domain-a-select" className="visually-hidden">
                Domain A
              </label>
              <select
                id="domain-a-select"
                value={domainAKey}
                onChange={(e) => setDomainA(e.target.value)}
                className="compare-select"
              >
                {domainsList.map((d) => (
                  <option key={d.domain} value={d.domain} disabled={d.domain === domainBKey}>
                    {d.display_name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={swapDomains}
              className="compare-swap-btn"
              title="Swap domains"
              aria-label="Swap domain A and domain B"
            >
              <ArrowsLeftRight size={16} weight="light" aria-hidden />
            </button>

            <div className="compare-selector-col">
              <span className="compare-dot" style={{ background: tokens.cat2 }} aria-hidden />
              <label htmlFor="domain-b-select" className="visually-hidden">
                Domain B
              </label>
              <select
                id="domain-b-select"
                value={domainBKey}
                onChange={(e) => setDomainB(e.target.value)}
                className="compare-select"
              >
                {domainsList.map((d) => (
                  <option key={d.domain} value={d.domain} disabled={d.domain === domainAKey}>
                    {d.display_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Curated Matchups Bar */}
        <div className="compare-presets-wrap" role="group" aria-label="Curated matchups">
          <span className="section-eyebrow">Curated Matchups</span>
          <div className="compare-preset-chips">
            {POPULAR_MATCHUPS.map((m) => {
              const active =
                (domainAKey === m.a && domainBKey === m.b) ||
                (domainAKey === m.b && domainBKey === m.a)
              return (
                <button
                  key={m.label}
                  type="button"
                  className={`compare-preset-chip ${active ? 'compare-preset-chip--active' : ''}`}
                  onClick={() => setParams({ a: m.a, b: m.b })}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Duel Scoreboard */}
        <section className="compare-scoreboard-grid" aria-label="Scoreboard comparison">
          {/* Card A */}
          <article className="compare-domain-card panel-shell">
            <div className="panel-core compare-card-inner">
              <header className="compare-card-head">
                <div className="compare-card-title-row">
                  <span className="compare-badge" style={{ color: tokens.cat1 }}>
                    Domain A
                  </span>
                  <StagePill label={entryA.label} />
                </div>
                <h3 className="compare-card-name">
                  <Link to={`/domain/${entryA.domain}`}>{entryA.display_name}</Link>
                </h3>
              </header>

              <div className="compare-metric-row">
                <div className="compare-metric-box">
                  <span className="compare-metric-lbl">Overall Rank</span>
                  <span className="compare-metric-val num font-mono">#{entryA.rank}</span>
                </div>
                <div className="compare-metric-box">
                  <span className="compare-metric-lbl">Growth Score</span>
                  <span className="compare-metric-val num font-mono" style={{ color: tokens.cat1 }}>
                    {fmtScore(entryA.emergence_score)}
                  </span>
                </div>
                <div className="compare-metric-box">
                  <span className="compare-metric-lbl">1-Yr Change</span>
                  <span className="compare-metric-val num font-mono">{fmtDelta(yoyDeltaA)}</span>
                </div>
              </div>

              <div className="compare-scorebar-wrap">
                <span className="compare-section-title">Score Breakdown</span>
                <ScoreBar inputs={entryA.score_inputs} />
              </div>

              <div className="compare-meta-pills">
                <div className="compare-meta-pill">
                  <FileText size={13} weight="light" aria-hidden />
                  <span>Patent Offset: {lagA?.best_lag != null ? `${lagA.best_lag}Q` : 'n/a'}</span>
                </div>
                <div className="compare-meta-pill">
                  <Lightning size={13} weight="light" aria-hidden />
                  <span>Model: {entryA.forecast_model.replace(/_/g, ' ')}</span>
                </div>
              </div>
            </div>
          </article>

          {/* Center Versus Delta Pillar */}
          <div className="compare-vs-pillar panel-shell">
            <div className="panel-core compare-vs-inner">
              <span className="compare-vs-badge">VS</span>
              <div className="compare-vs-diff">
                <span className="compare-vs-diff-label">Score Difference</span>
                <span
                  className="compare-vs-diff-val num font-mono"
                  style={{ color: scoreDelta >= 0 ? tokens.cat1 : tokens.cat2 }}
                >
                  {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta}
                </span>
                <span className="compare-vs-diff-sub">
                  {scoreDelta > 0
                    ? `${entryA.display_name} ahead`
                    : scoreDelta < 0
                    ? `${entryB.display_name} ahead`
                    : 'Tied score'}
                </span>
              </div>
            </div>
          </div>

          {/* Card B */}
          <article className="compare-domain-card panel-shell">
            <div className="panel-core compare-card-inner">
              <header className="compare-card-head">
                <div className="compare-card-title-row">
                  <span className="compare-badge" style={{ color: tokens.cat2 }}>
                    Domain B
                  </span>
                  <StagePill label={entryB.label} />
                </div>
                <h3 className="compare-card-name">
                  <Link to={`/domain/${entryB.domain}`}>{entryB.display_name}</Link>
                </h3>
              </header>

              <div className="compare-metric-row">
                <div className="compare-metric-box">
                  <span className="compare-metric-lbl">Overall Rank</span>
                  <span className="compare-metric-val num font-mono">#{entryB.rank}</span>
                </div>
                <div className="compare-metric-box">
                  <span className="compare-metric-lbl">Growth Score</span>
                  <span className="compare-metric-val num font-mono" style={{ color: tokens.cat2 }}>
                    {fmtScore(entryB.emergence_score)}
                  </span>
                </div>
                <div className="compare-metric-box">
                  <span className="compare-metric-lbl">1-Yr Change</span>
                  <span className="compare-metric-val num font-mono">{fmtDelta(yoyDeltaB)}</span>
                </div>
              </div>

              <div className="compare-scorebar-wrap">
                <span className="compare-section-title">Score Breakdown</span>
                <ScoreBar inputs={entryB.score_inputs} />
              </div>

              <div className="compare-meta-pills">
                <div className="compare-meta-pill">
                  <FileText size={13} weight="light" aria-hidden />
                  <span>Patent Offset: {lagB?.best_lag != null ? `${lagB.best_lag}Q` : 'n/a'}</span>
                </div>
                <div className="compare-meta-pill">
                  <Lightning size={13} weight="light" aria-hidden />
                  <span>Model: {entryB.forecast_model.replace(/_/g, ' ')}</span>
                </div>
              </div>
            </div>
          </article>
        </section>

        {/* Emergence Profile Spider Radar */}
        <section className="compare-radar-section panel-shell" aria-label="Emergence profile spider radar">
          <div className="panel-core compare-radar-inner">
            <header className="compare-radar-head">
              <span className="section-eyebrow">Head-to-Head Strength Profile</span>
              <h3 className="compare-chart-title">
                Radar Comparison <span className="serif-accent">(5 Growth Signals)</span>
              </h3>
              <p className="compare-chart-sub">
                Comparing both fields across 5 core growth signals: Recent Growth, Acceleration, Surging Topics, Publication Volume, and Commercial Momentum.
              </p>
            </header>
            <div style={{ padding: 'var(--sp-4) 0 var(--sp-6)' }}>
              <ScoreRadar
                inputsA={entryA.score_inputs}
                inputsB={entryB.score_inputs}
                nameA={entryA.display_name}
                nameB={entryB.display_name}
                colorA={tokens.cat1}
                colorB={tokens.cat2}
                size={300}
              />
            </div>
          </div>
        </section>

        {/* Superimposed Trajectory Chart */}
        <section className="compare-chart-section panel-shell" aria-label="Comparative trajectory curves">
          <div className="panel-core compare-chart-inner">
            <div className="compare-chart-header">
              <span className="section-eyebrow">Temporal Velocity</span>
              <h3 className="compare-chart-title">
                Annual Publication <span className="serif-accent">Trajectories</span>
              </h3>
              <p className="compare-chart-sub">
                Historical annual papers (2000-2025) comparing publication volume and momentum.
              </p>
            </div>
            <div ref={chartRef as unknown as React.RefObject<HTMLDivElement>} className="compare-chart-canvas" style={{ width: '100%', height: 380 }} />
          </div>
        </section>

        {/* Keyword Frontiers Side-by-Side */}
        <section className="compare-keywords-grid" aria-label="Emergent keywords comparison">
          <div className="compare-kw-col panel-shell">
            <div className="panel-core compare-kw-inner">
              <div className="compare-kw-head">
                <Sparkle size={14} weight="light" aria-hidden />
                <span>{entryA.display_name} Bursting Frontiers</span>
              </div>
              <div className="compare-kw-tags">
                {burstsA.length > 0 ? (
                  burstsA.map((kw) => (
                    <span key={kw} className="compare-kw-tag">
                      {kw}
                    </span>
                  ))
                ) : (
                  <span className="compare-kw-empty">No active bursts recorded</span>
                )}
              </div>
            </div>
          </div>

          <div className="compare-kw-col panel-shell">
            <div className="panel-core compare-kw-inner">
              <div className="compare-kw-head">
                <Sparkle size={14} weight="light" aria-hidden />
                <span>{entryB.display_name} Bursting Frontiers</span>
              </div>
              <div className="compare-kw-tags">
                {burstsB.length > 0 ? (
                  burstsB.map((kw) => (
                    <span key={kw} className="compare-kw-tag">
                      {kw}
                    </span>
                  ))
                ) : (
                  <span className="compare-kw-empty">No active bursts recorded</span>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </RevealShell>
  )
}
