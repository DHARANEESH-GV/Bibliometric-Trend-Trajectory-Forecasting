/**
 * Comparison Matrix — years × domains heatmap from matrix.json cells.
 * Default full 26-year range with a compact last-8-years toggle
 * (spec open item resolved: both, deliberate distinction from the
 * full trajectory charts). Cell = annual works count; row tail = domain
 * + latest count. Single sequential scale in accent ink — no decorative
 * gradients, no pie-chart-style hue noise.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { loadMatrix, loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useTokens } from '../lib/useTokens'
import { useChart, echarts, axes, baseOption, tooltip } from '../charts/echarts'
import { fmtInt, fmtScore } from '../lib/format'
import { StagePill } from '../components/StagePill'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CopyLink } from '../components/CopyLink'
import type { MatrixFile } from '../lib/types'


function busiestRef(
  totals: Array<{ domain: string; total: number }>,
  labels: Map<string, string>,
): { display: string; total: number } | null {
  const t = totals[0]
  if (!t) return null
  return { display: labels.get(t.domain) ?? t.domain.replace(/_/g, ' '), total: t.total }
}

export function MatrixView() {
  const navigate = useNavigate()
  const { data, loading, error } = useQuery<MatrixFile>(loadMatrix, [])
  const leaderboard = useQuery(loadLeaderboard, [])
  const tokens = useTokens()
  const [params, setParams] = useSearchParams()

  // Explicit ?window always wins; on narrow viewports the compact
  // last-8-years window is the default so 26 columns never squeeze.
  const windowParam = params.get('window')
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const recent = windowParam ? windowParam === '8' : narrow

  const years = useMemo(() => {
    const all = data?.years ?? []
    return recent ? all.slice(-8) : all
  }, [data, recent])

  const labels = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of leaderboard.data?.leaderboard ?? []) m.set(r.domain, r.display_name)
    return m
  }, [leaderboard.data])

  // cells aligned to the visible window, ordered by leaderboard rank
  const domainRows = useMemo(() => {
    const cells = data?.cells ?? {}
    const order = (leaderboard.data?.leaderboard ?? []).map((r) => r.domain)
    const extra = Object.keys(cells).filter((d) => !order.includes(d))
    const tails = data?.tail ?? {}
    return [...order, ...extra].map((domain) => ({
      domain,
      counts: years.map((y) => cells[domain]?.[data?.years.indexOf(y) ?? -1] ?? 0),
      tail: tails[domain] ?? null,
    }))
  }, [data, leaderboard.data, years])

  const busiestLine = useMemo(() => {
    const cells = data?.cells ?? {}
    const totals = Object.entries(cells)
      .map(([domain, series]) => ({
        domain,
        total: (series as number[]).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total)
    const top = busiestRef(totals, labels)
    if (!top) return null
    return `${top.display} carries the heaviest output, ${top.total.toLocaleString('en-US')} works since 2000.`
  }, [data, labels])

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
  }, tokens.ink0, [domainRows, years, recent])

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
            Works per year across all twenty domains; darker cells mean more
            published work. {busiestLine}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
        <CopyLink />
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
        </div>
      </header>

      <div className="matrix-scroll">
        <div ref={ref as unknown as React.Ref<HTMLDivElement>} style={{ height: 560 }} />
      </div>

      {/* Row tails: stage + score per the spec's matrix row-tail, each row
          navigates to its drill-down. Doubles as the chart's accessible
          table equivalent. */}
      <nav aria-label="Domains in this matrix">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          {domainRows.map((row) => (
            <li key={row.domain}>
              <a
                href={`/domain/${row.domain}`}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`/domain/${row.domain}`)
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                  border: 'var(--hairline)',
                  borderRadius: 2,
                  padding: '3px 10px',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--ink-1)',
                  textDecoration: 'none',
                  transition: 'background var(--motion-fast) cubic-bezier(0.32, 0.72, 0, 1), color var(--motion-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-1)'; e.currentTarget.style.color = 'var(--ink-0)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-1)' }}
              >
                {labels.get(row.domain) ?? row.domain}
                {row.tail ? (
                  <>
                    <StagePill label={row.tail.label} />
                    <span className="num" style={{ color: 'var(--ink-2)' }}>
                      {fmtScore(row.tail.score)}
                    </span>
                  </>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', marginTop: 'var(--sp-3)' }}>
        {recent
          ? 'Compact window shows inline counts; hover any cell for the exact value.'
          : 'Hover any cell for the exact value. Row tails carry each domain\'s stage and score; select one for the full picture.'}
        {' '}Counts are annual (no quarters exist in the contract of record).
      </p>
    </div>
  )
}
