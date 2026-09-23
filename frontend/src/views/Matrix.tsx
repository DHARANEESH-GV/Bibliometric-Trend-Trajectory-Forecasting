/**
 * Comparison Matrix — years × domains heatmap from matrix.json cells.
 * Default full 26-year range with a compact last-8-years toggle
 * (spec open item resolved: both, deliberate distinction from the
 * full trajectory charts). Cell = annual works count; row tail = domain
 * + latest count. Single sequential scale in accent ink — no decorative
 * gradients, no pie-chart-style hue noise.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { loadMatrix, loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useTokens } from '../lib/useTokens'
import { useChart, echarts, axes, baseOption, tooltip } from '../charts/echarts'
import { fmtInt } from '../lib/format'
import { ShimmerAxes } from '../components/ShimmerAxes'
import type { MatrixFile } from '../lib/types'

export function MatrixView() {
  const { data, loading, error } = useQuery<MatrixFile>(loadMatrix, [])
  const leaderboard = useQuery(loadLeaderboard, [])
  const tokens = useTokens()
  const [params, setParams] = useSearchParams()

  const window = params.get('window') === '8' ? 8 : 'full'
  const recent = window === 8

  const years = useMemo(() => {
    const all = data?.years ?? []
    return recent ? all.slice(-8) : all
  }, [data, recent])

  const labels = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of leaderboard.data?.leaderboard ?? []) m.set(r.domain, r.display_name)
    return m
  }, [leaderboard.data])

  const stageByDomain = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of leaderboard.data?.leaderboard ?? []) m.set(r.domain, r.label)
    return m
  }, [leaderboard.data])

  // cells aligned to the visible window, ordered by leaderboard rank
  const domainRows = useMemo(() => {
    const cells = data?.cells ?? {}
    const order = (leaderboard.data?.leaderboard ?? []).map((r) => r.domain)
    const extra = Object.keys(cells).filter((d) => !order.includes(d))
    return [...order, ...extra].map((domain) => ({
      domain,
      counts: years.map((y) => cells[domain]?.[data?.years.indexOf(y) ?? -1] ?? 0),
    }))
  }, [data, leaderboard.data, years])

  const xLabels = years.map(String)

  const { ref } = useChart((t) => {
    const heatData: [number, number, number][] = []
    domainRows.forEach((row, di) => {
      row.counts.forEach((count, yi) => {
        heatData.push([yi, di, count])
      })
    })

    return {
      ...baseOption(t),
      ...axes(
        t,
        {
          data: xLabels,
          position: 'top' as const,
          axisLabel: { color: t.ink3, fontFamily: t.fontMono, fontSize: 10, hideOverlap: true },
          splitLine: { show: false },
        },
        {
          type: 'category' as const,
          data: domainRows.map((r) => labels.get(r.domain) ?? r.domain),
          position: 'left' as const,
          axisLabel: { color: t.ink1, fontFamily: t.fontBody, fontSize: 11 },
          splitLine: { show: false },
          min: 0,
        } as never,
      ),
      tooltip: {
        ...tooltip(t),
        trigger: 'item' as const,
        formatter: (p: never) => {
          const { value } = p as { value: [number, number, number] }
          const [yi, di, count] = value
          const domain = domainRows[di]?.domain ?? ''
          return `${domain}<br/>${years[yi]}: ${fmtInt(count)} works`
        },
      },
      visualMap: {
        show: false,
        min: 0,
        max: Math.max(...heatData.map((h) => h[2] ?? 0), 1),
        inRange: { color: [t.surface1, t.ink0] },
        calculable: false,
      },
      grid: { left: 8, right: 24, top: 40, bottom: 8, containLabel: true },
      series: [
        {
          type: 'heatmap' as const,
          data: heatData,
          itemStyle: {
            borderWidth: 1,
            borderColor: 'transparent',
            borderRadius: 1,
          },
          emphasis: {
            itemStyle: { borderColor: t.crosshair, borderWidth: 1 },
          },
          label: {
            show: years.length <= 8, // compact window: read counts inline
            fontFamily: t.fontMono,
            fontSize: 9,
            color: t.ink2,
            formatter: (p: never) => {
              const v = (p as { value: [number, number, number] }).value[2]
              return v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
            },
          },
          // Row tail markline: year domain separation is implicit in data;
          // markArea kept off (would be chart junk).
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: t.gridMajor, width: 1 },
            data:
              recent
                ? []
                : [{ xAxis: '2010' }, { xAxis: '2018' } as never].slice(0, 1),
          },
        },
      ],
    } satisfies echarts.EChartsCoreOption
  }, tokens.ink0)

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
        <ShimmerAxes xLabels={['2000', '2025']} height={520} label="Loading comparison matrix" />
      </div>
    )
  }

  const toggleWindow = () => {
    const next = new URLSearchParams(params)
    if (recent) next.delete('window')
    else next.set('window', '8')
    setParams(next, { replace: true })
  }

  void stageByDomain

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
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Comparison matrix</h1>
          <p style={{ color: 'var(--ink-2)', marginTop: 'var(--sp-1)', fontSize: 'var(--text-sm)', maxWidth: '72ch' }}>
            Works per year across all twenty domains. Darker cells mean more
            published work, scaled to the panel maximum. The state of
            technology at a glance; the trajectory explorer is where detail
            lives.
          </p>
        </div>
        <button
          onClick={toggleWindow}
          aria-pressed={recent}
          style={{
            border: 'var(--hairline-strong)',
            borderRadius: 2,
            padding: '4px 12px',
            fontSize: 'var(--text-sm)',
            background: recent ? 'var(--surface-2)' : 'transparent',
          }}
        >
          {recent ? 'Last 8 years' : 'Full 2000–2025'}
        </button>
      </header>

      <div ref={ref as unknown as React.Ref<HTMLDivElement>} style={{ height: 560 }} />

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', marginTop: 'var(--sp-2)' }}>
        {recent
          ? 'Compact window shows inline counts; hover any cell for the exact value.'
          : 'Hover any cell for the exact value. Stage labels per domain are on the leaderboard.'}
        {' '}Counts are annual (no quarters exist in the contract of record).
      </p>
    </div>
  )
}
