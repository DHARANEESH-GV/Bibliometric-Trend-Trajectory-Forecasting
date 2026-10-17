/**
 * Trajectory Explorer — multi-select overlay of annual works series per
 * domain, with forecast tails where present. Annual is the contract of
 * record (no quarters exist; none are interpolated). Log/linear switch,
 * synced crosshair, inline forecast labels, caveats surfaced.
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadTrajectories } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useTokens } from '../lib/useTokens'
import { useChart, echarts, axes, baseOption, tooltip, cleanSeries } from '../charts/echarts'
import { fmtInt, fmtModel } from '../lib/format'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CaveatBanner } from '../components/CaveatBanner'
import { ViewHeader } from '../components/ViewHeader'
import { CopyLink } from '../components/CopyLink'
import { YearSpine } from '../components/YearSpine'
import { RevealShell } from '../components/RevealShell'
import type { TrajectoriesFile } from '../lib/types'

const COLOR_POOL = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'] as const

function colorFor(i: number, tokens: ReturnType<typeof useTokens>): string {
  // Categorical tokens (theme-aware in tokens.css): five mutually
  // distinguishable hues. Never --ink-0 — in dark mode that is near-white
  // and five white lines cannot be told apart.
  const name = COLOR_POOL[i % COLOR_POOL.length] ?? 'cat1'
  return (tokens as unknown as Record<string, string>)[name] ?? tokens.cat1
}

function useParamList(key: string): string[] {
  const [params] = useSearchParams()
  return useMemo(
    () => (params.get(key) ?? '').split(',').filter(Boolean),
    [params, key],
  )
}

export function TrajectoryExplorerView() {
  const { data, loading, error } = useQuery<TrajectoriesFile>(loadTrajectories, [])
  const tokens = useTokens()
  const [params, setParams] = useSearchParams()

  const selected = useParamList('domains')
  const log = params.get('log') === '1'
  // Data-table alternative (d3-viz accessibility): the plotted series as
  // exact numbers, for readers who want them rather than the curve.
  // Declared with the other hooks, before any early return.
  const [tableOpen, setTableOpen] = useState(false)

  const domains = data?.domains ?? []
  const selectedRows = useMemo(() => {
    if (selected.length === 0) return domains.slice(0, 1)
    return domains.filter((d) => selected.includes(d.domain))
  }, [domains, selected])

  const computedLead = !data
    ? null
    : (() => {
        const row = selectedRows[0]
        if (!row) return null
        const last = [...row.series].reverse().find((p) => p.forecast != null)
        return last && last.forecast != null
          ? `For ${row.display_name}, the model lands ${last.forecast.toLocaleString('en-US')} works by ${last.year}.`
          : null
      })()

  const xYears = domains[0]?.series.map((p) => String(p.year)) ?? []

  const { ref } = useChart((t) => {
    const series = selectedRows.map((row, i) => {
      const actual = row.series.filter((p) => p.works != null)
      const forecastPts = row.series.filter((p) => p.forecast != null)
      // Data prep (d3-viz): drop null/NaN from the plotted values so a
      // malformed snapshot cannot render a broken line.
      const actualWorks = cleanSeries(actual.map((p) => p.works))
      const color = colorFor(i, t)

      // Bridge the actual line into the forecast tail so the band reads
      // as a continuation, with the first forecast point labeled inline.
      const bridge = actual.length > 0 && forecastPts.length > 0
        ? [{ year: actual[actual.length - 1]?.year, forecast: actual[actual.length - 1]?.works }]
        : []

      return [
        {
          type: 'line' as const,
          name: row.display_name,
          data: actualWorks,
          lineStyle: { width: 2.5, color },
          itemStyle: { color },
          showSymbol: false,
          emphasis: { focus: 'series' as const },
          endLabel: {
            show: true,
            formatter: row.display_name,
            color,
            fontFamily: t.fontBody,
            fontSize: 11,
            fontWeight: 600 as const,
            distance: 10,
          },
        },
        ...(forecastPts.length > 0
          ? [
              // 68% interval band, rendered as stacked translucent fill
              // over a shared 'band-{i}' stack key. Lower carries no line
              // and no fill of its own; upper fills down onto it.
              {
                type: 'line' as const,
                name: `${row.display_name} band lower`,
                stack: `band-${i}`,
                data: [...bridge.map(() => null), ...forecastPts.map((p) => p.lower ?? null)],
                lineStyle: { opacity: 0 },
                symbol: 'none' as const,
                areaStyle: { opacity: 0 },
                silent: true,
                tooltip: { show: false },
              },
              {
                type: 'line' as const,
                name: `${row.display_name} band width`,
                stack: `band-${i}`,
                data: [
                  ...bridge.map(() => null),
                  ...forecastPts.map((p) =>
                    p.lower != null && p.upper != null ? p.upper - p.lower : null,
                  ),
                ],
                lineStyle: { opacity: 0 },
                symbol: 'none' as const,
                areaStyle: { color: t.forecastBand },
                silent: true,
                tooltip: { show: false },
              },
              {
                type: 'line' as const,
                name: `${row.display_name} (forecast)`,
                // One category before the first forecast point = bridge
                data: [
                  ...bridge.map((b) => b.forecast),
                  ...forecastPts.map((p) => p.forecast),
                ],
                lineStyle: { width: 1.5, color, type: 'dashed' as const, opacity: 0.7 },
                itemStyle: { color },
                showSymbol: true,
                symbolSize: 3,
                // Band labeled inline at band start (§8)
                endLabel: {
                  show: true,
                  formatter: `${fmtModel(forecastPts[forecastPts.length - 1]?.model ?? 'hw_damped')} forecast, 68% interval`,
                  color: t.ink2,
                  fontFamily: t.fontBody,
                  fontSize: 10,
                  distance: 8,
                },
                tooltip: {
                  // surfaced by the shared axis tooltip; per-point value
                  // comes from data since we keep default formatting
                },
              },
            ]
          : []),
      ]
    })

    return {
      ...baseOption(t),
      ...axes(t, { data: xYears, boundaryGap: false }, log ? { type: 'log' as const, logBase: 10, min: 1, max: (value: { max: number }) => Math.ceil(value.max * 1.5) } : {}),
      tooltip: tooltip(t),
      legend: {
        show: true,
        textStyle: { color: t.ink1, fontFamily: t.fontBody, fontSize: 11 },
        top: 0,
        icon: 'rect',
        itemWidth: 12,
        itemHeight: 2,
      },
      series: series.flat(),
    } satisfies echarts.EChartsCoreOption
  }, tokens.ink0, [selectedRows, xYears, log])

  void setParams

  if (error) {
    return (
      <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-6) 0' }}>
        Live lookups unavailable. Showing cached snapshots. ({error.message})
      </p>
    )
  }

  if (loading || !data) {
    return (
      <div style={{ padding: 'var(--sp-5) 0' }}>
        <ShimmerAxes xLabels={['2000', '2025']} height={420} label="Loading trajectories" />
      </div>
    )
  }

  const toggleDomain = (domain: string) => {
    const next = new URLSearchParams(params)
    const set = new Set(selected)
    if (set.has(domain)) set.delete(domain)
    else if (set.size < 5) set.add(domain)
    next.set('domains', [...set].join(','))
    setParams(next, { replace: true })
  }

  const toggleLog = () => {
    const next = new URLSearchParams(params)
    if (log) next.delete('log')
    else next.set('log', '1')
    setParams(next, { replace: true })
  }

  const qcCaveat = domains.find((d) => d.domain === 'quantum_error_correction')

  return (
    <RevealShell>
      <div style={{ padding: 'var(--sp-5) 0' }}>
      <YearSpine />
      <ViewHeader
        title={
          <>
            Trajectory <span className="serif-accent">explorer</span>
          </>
        }
        lead={
          <>
            Annual counts of published works, 2000-2025, with backtested
            forecast tails. {computedLead}
          </>
        }
      >
        <CopyLink />
        <button
          onClick={toggleLog}
          aria-pressed={log}
          style={{
            border: 'var(--hairline-strong)',
            borderRadius: 'var(--r-control)',
            padding: '4px 12px',
            fontSize: 'var(--text-sm)',
            background: log ? 'var(--surface-2)' : 'transparent',
          }}
        >
          {log ? 'Log scale' : 'Linear scale'}
        </button>
        <button
          onClick={() => setTableOpen((o) => !o)}
          aria-expanded={tableOpen}
          aria-controls="trajectory-table"
          style={{
            border: 'var(--hairline-strong)',
            borderRadius: 'var(--r-control)',
            padding: '4px 12px',
            fontSize: 'var(--text-sm)',
            background: tableOpen ? 'var(--surface-2)' : 'transparent',
          }}
        >
          {tableOpen ? 'Hide table' : 'View as table'}
        </button>
      </ViewHeader>

      <div
        role="group"
        aria-label="Domain selection, up to five"
        className="seg-control"
      >
        {domains.map((d) => {
          const active = selected.length === 0 ? d === domains[0] : selected.includes(d.domain)
          // The chip carries its series color: chip → line identity at a
          // glance, no hover needed.
          const seriesIdx = selectedRows.findIndex((r) => r.domain === d.domain)
          const chipColor = active && seriesIdx >= 0 ? colorFor(seriesIdx, tokens) : null
          return (
            <span
              key={d.domain}
              className={`seg ${active ? 'seg--on' : ''}`}
              style={
                chipColor
                  ? { borderColor: chipColor, boxShadow: `inset 0 0 0 1px ${chipColor}` }
                  : undefined
              }
            >
              <button
                onClick={() => toggleDomain(d.domain)}
                aria-pressed={active}
                className="seg-btn"
                style={
                  chipColor
                    ? { color: chipColor, background: 'transparent', fontWeight: 600 }
                    : undefined
                }
              >
                {d.display_name}
              </button>
              {active ? (
                <Link
                  to={`/domain/${d.domain}`}
                  aria-label={`Open ${d.display_name} drill-down`}
                  title="Open drill-down"
                  className="seg-link"
                >
                  ↗
                </Link>
              ) : null}
            </span>
          )
        })}
      </div>

      <div ref={ref as unknown as React.Ref<HTMLDivElement>} style={{ height: 460 }} />

      {tableOpen ? (
        <div className="series-table" id="trajectory-table" role="table" aria-label="Plotted series as numbers">
          <div className="forecast-row forecast-row--head" role="row">
            <span role="columnheader">Domain</span>
            <span role="columnheader">Year</span>
            <span role="columnheader" className="num">Works</span>
            <span role="columnheader" className="num">Forecast</span>
            <span role="columnheader" className="num">68% interval</span>
          </div>
          {selectedRows.map((row) =>
            row.series
              .filter((p) => p.works != null || p.forecast != null)
              .map((pt) => (
                <div className="forecast-row" role="row" key={`${row.domain}-${pt.year}`}>
                  <span role="cell" style={{ color: 'var(--ink-2)' }}>{row.display_name}</span>
                  <span className="num" role="cell">{pt.year}</span>
                  <span className="num" role="cell">{pt.works != null ? fmtInt(pt.works) : ''}</span>
                  <span className="num" role="cell">{pt.forecast != null ? fmtInt(pt.forecast) : ''}</span>
                  <span className="num" role="cell" style={{ color: 'var(--ink-2)' }}>
                    {pt.lower != null && pt.upper != null ? `${fmtInt(pt.lower)} to ${fmtInt(pt.upper)}` : ''}
                  </span>
                </div>
              )),
          )}
        </div>
      ) : null}

      <div style={{ marginTop: 'var(--sp-4)' }}>
        <p className="num" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
          {selectedRows.length === 1 && selectedRows[0]
            ? `Peak year ${fmtInt(Math.max(...cleanSeries(selectedRows[0].series.map((p) => p.works))))}`
            : `${selectedRows.length} domains overlaid, synced crosshair.`}
          {' '}Quarterly resolution arrives with Phase 5 data; counts are annual today.
        </p>
      </div>

      {qcCaveat && selected.includes('quantum_error_correction') ? (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <CaveatBanner>
            Quantum error correction is measured by a twin-series of quantum
            computing, so do not rank the two independently.
          </CaveatBanner>
        </div>
      ) : null}
      </div>
    </RevealShell>
  )
}
