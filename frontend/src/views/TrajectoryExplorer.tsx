/**
 * Trajectory Explorer — multi-select overlay of annual works series per
 * domain, with forecast tails where present. Annual is the contract of
 * record (no quarters exist; none are interpolated). Log/linear switch,
 * synced crosshair, inline forecast labels, caveats surfaced.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { loadTrajectories } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useTokens } from '../lib/useTokens'
import { useChart, echarts, axes, baseOption, tooltip } from '../charts/echarts'
import { fmtInt, fmtModel } from '../lib/format'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CaveatBanner } from '../components/CaveatBanner'
import type { TrajectoriesFile } from '../lib/types'

const COLOR_POOL = ['--ink-0', '--stage-accelerating', '--stage-emerging', '--stage-active', '--stage-watch']

function colorFor(i: number, tokens: ReturnType<typeof useTokens>): string {
  const name = COLOR_POOL[i % COLOR_POOL.length] ?? '--ink-0'
  return (tokens as unknown as Record<string, string>)[name] ?? tokens.ink0
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

  const domains = data?.domains ?? []
  const selectedRows = useMemo(() => {
    if (selected.length === 0) return domains.slice(0, 1)
    return domains.filter((d) => selected.includes(d.domain))
  }, [domains, selected])

  const xYears = domains[0]?.series.map((p) => String(p.year)) ?? []

  const { ref } = useChart((t) => {
    const series = selectedRows.map((row, i) => {
      const actual = row.series.filter((p) => p.works != null)
      const forecastPts = row.series.filter((p) => p.forecast != null)
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
          data: actual.map((p) => p.works),
          lineStyle: { width: 1.5, color },
          itemStyle: { color },
          showSymbol: false,
          emphasis: { focus: 'series' as const },
        },
        ...(forecastPts.length > 0
          ? [
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
                // Band labeled inline at band start (§8) via endLabel on
                // the last point; markPoint kept minimal.
                endLabel: {
                  show: true,
                  formatter: `${fmtModel('hw_damped')} forecast`,
                  color: t.ink2,
                  fontFamily: t.fontBody,
                  fontSize: 10,
                  distance: 8,
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
  }, tokens.ink0)

  void setParams

  if (error) {
    return (
      <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-6) 0' }}>
        Live lookups unavailable — showing cached snapshots. ({error.message})
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
    <div style={{ padding: 'var(--sp-5) 0' }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--sp-4)',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Trajectory explorer</h1>
          <p style={{ color: 'var(--ink-2)', marginTop: 'var(--sp-1)', fontSize: 'var(--text-sm)' }}>
            Annual counts of published works, 2000–2025. Dashed tails are
            Holt-Winters damped forecasts. Solid counts are actual; no
            patent series exists yet.
          </p>
        </div>
        <button
          onClick={toggleLog}
          aria-pressed={log}
          style={{
            border: 'var(--hairline-strong)',
            borderRadius: 2,
            padding: '4px 12px',
            fontSize: 'var(--text-sm)',
            background: log ? 'var(--surface-2)' : 'transparent',
          }}
        >
          {log ? 'Log scale' : 'Linear scale'}
        </button>
      </header>

      <div
        role="group"
        aria-label="Domain selection — up to five"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
          margin: 'var(--sp-4) 0',
        }}
      >
        {domains.map((d) => {
          const active = selected.length === 0 ? d === domains[0] : selected.includes(d.domain)
          return (
            <button
              key={d.domain}
              onClick={() => toggleDomain(d.domain)}
              aria-pressed={active}
              style={{
                border: 'var(--hairline)',
                borderRadius: 2,
                padding: '3px 10px',
                fontSize: 'var(--text-sm)',
                color: active ? 'var(--accent-ink)' : 'var(--ink-1)',
                background: active ? 'var(--ink-0)' : 'transparent',
              }}
            >
              {d.display_name}
            </button>
          )
        })}
      </div>

      <div ref={ref as unknown as React.Ref<HTMLDivElement>} style={{ height: 460 }} />

      <div style={{ marginTop: 'var(--sp-4)' }}>
        <p className="num" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
          {selectedRows.length === 1 && selectedRows[0]
            ? `Peak year ${fmtInt(Math.max(...selectedRows[0].series.filter((p) => p.works != null).map((p) => p.works as number)))}`
            : `${selectedRows.length} domains overlaid, synced crosshair.`}
          {' '}Quarterly resolution arrives with Phase 5 data; counts are annual today.
        </p>
      </div>

      {qcCaveat && selected.includes('quantum_error_correction') ? (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <CaveatBanner>
            Quantum error correction is measured by a twin-series of quantum
            computing — do not rank the two independently.
          </CaveatBanner>
        </div>
      ) : null}
    </div>
  )
}
