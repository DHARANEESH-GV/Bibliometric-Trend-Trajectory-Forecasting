/**
 * Comparison Matrix — years × domains heatmap from matrix.json cells.
 * Default full 26-year range with a compact last-8-years toggle
 * (spec open item resolved: both, deliberate distinction from the
 * full trajectory charts). Cell = annual works count; row tail = domain
 * + latest count. Single sequential scale in accent ink — no decorative
 * gradients, no pie-chart-style hue noise.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { loadMatrix, loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useTokens } from '../lib/useTokens'
import { useChart, echarts, axes, baseOption, tooltip } from '../charts/echarts'
import { fmtInt, fmtScore } from '../lib/format'
import { StagePill } from '../components/StagePill'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { ViewHeader } from '../components/ViewHeader'
import { CopyLink } from '../components/CopyLink'
import { YearSpine } from '../components/YearSpine'
import { TimeLapse } from '../components/TimeLapse'
import { RankBumps } from '../components/RankBumps'
import { BarRace } from '../components/BarRace'
import { RevealShell } from '../components/RevealShell'
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
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

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

  // Busiest single year across all domains, computed from the visible window.
  const busiestYear = useMemo(() => {
    if (years.length === 0) return null
    const totals = years.map((y, yi) => {
      let sum = 0
      for (const row of domainRows) sum += row.counts[yi] ?? 0
      return { y, sum }
    })
    let best = totals[0]
    for (const t of totals) if (t.sum > (best?.sum ?? 0)) best = t
    return best ?? null
  }, [years, domainRows])

  const xLabels = years.map(String)

  const legendMax = useMemo(() => {
    let max = 0
    for (const row of domainRows) for (const c of row.counts) if (c > max) max = c
    return max
  }, [domainRows])

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
        // Sequential single-hue ramp: surface (low) -> accent gold (high).
        // The old ink ramp read backwards on OLED — a white cell meant
        // "most works" but white also read as "empty/highlighted". Amber
        // intensity cannot be misread: brighter = more work.
        inRange: { color: [t.surface1, t.matrixMid, t.matrixHigh] },
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
            borderRadius: 'var(--r-control)',
          },
          emphasis: {
            itemStyle: { borderColor: t.crosshair, borderWidth: 1 },
          },
          label: {
            show: years.length <= 8, // compact window: read counts inline
            fontFamily: t.fontMono,
            fontSize: 9,
            // Dark ink reads on both ends of the amber ramp (gold cells are
            // light enough for ink-0's near-black in dark theme; the light
            // theme's deep-amber top carries white ink via ink0).
            color: t.ink0,
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

  // Click a heatmap cell -> open that domain's drill-down. Hover a cell ->
  // highlight the matching row-tail link, and hovering a row-tail highlights
  // the chart row (both directions). Bound on the chart instance; handlers
  // read current domainRows via a ref so the effect need not re-run.
  const rowsRef = useRef(domainRows)
  rowsRef.current = domainRows
  const hoverDomainRef = useRef<string | null>(null)
  const setHoverDomain = (domain: string | null) => {
    if (hoverDomainRef.current === domain) return
    hoverDomainRef.current = domain
    setHoveredRow(domain)
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const chart = echarts.getInstanceByDom(el)
    if (!chart) return
    const domainAt = (p: { value?: unknown }) => {
      const v = p.value as [number, number, number] | undefined
      const di = v?.[1]
      return di == null ? null : rowsRef.current[di]?.domain ?? null
    }
    const onClick = (p: { value?: unknown }) => {
      const domain = domainAt(p)
      if (domain) navigate(`/domain/${domain}`)
    }
    // rAF-debounced so a fast pointer sweep does not dispatch per pixel.
    let raf = 0
    const pending = { current: null as string | null }
    const onOver = (p: { value?: unknown }) => {
      pending.current = domainAt(p)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setHoverDomain(pending.current))
    }
    const onLeave = () => {
      pending.current = null
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setHoverDomain(null))
    }
    chart.on('click', onClick)
    chart.on('mouseover', onOver)
    chart.on('globalout', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      chart.off('click', onClick)
      chart.off('mouseover', onOver)
      chart.off('globalout', onLeave)
    }
  }, [ref, navigate, domainRows, years, recent])

  // Chart -> row-tail highlight: dispatch on the chart when the pointer
  // enters a row-tail link (the reverse direction of the hover link).
  const tailEnter = (domain: string) => {
    setHoverDomain(domain)
    const el = ref.current
    const chart = el ? echarts.getInstanceByDom(el) : null
    if (!chart) return
    const di = rowsRef.current.findIndex((r) => r.domain === domain)
    if (di < 0) return
    chart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: di * Math.max(1, years.length) })
  }
  const tailLeave = () => {
    setHoverDomain(null)
    const el = ref.current
    const chart = el ? echarts.getInstanceByDom(el) : null
    if (!chart) return
    chart.dispatchAction({ type: 'downplay', seriesIndex: 0 })
  }

  // Keyboard cell navigation (d3-viz accessibility): the chart is
  // focusable; arrows move a visible focus cell, Enter opens the domain.
  const [focusCell, setFocusCell] = useState<[number, number] | null>(null)
  const onChartKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = ref.current
    const chart = el ? echarts.getInstanceByDom(el) : null
    if (!chart) return
    const maxDi = Math.max(0, domainRows.length - 1)
    const maxYi = Math.max(0, years.length - 1)
    let next = focusCell
    if (e.key === 'ArrowRight') next = [Math.min(maxYi, (focusCell?.[0] ?? -1) + 1), focusCell?.[1] ?? 0]
    else if (e.key === 'ArrowLeft') next = [Math.max(0, (focusCell?.[0] ?? 1) - 1), focusCell?.[1] ?? 0]
    else if (e.key === 'ArrowDown') next = [focusCell?.[0] ?? 0, Math.min(maxDi, (focusCell?.[1] ?? -1) + 1)]
    else if (e.key === 'ArrowUp') next = [focusCell?.[0] ?? 0, Math.max(0, (focusCell?.[1] ?? 1) - 1)]
    else if (e.key === 'Enter' && focusCell) {
      const domain = rowsRef.current[focusCell[1]]?.domain
      if (domain) navigate(`/domain/${domain}`)
      return
    } else if (e.key === 'Escape') {
      setFocusCell(null)
      chart.dispatchAction({ type: 'hideTip' })
      return
    } else {
      return
    }
    e.preventDefault()
    setFocusCell(next)
    const [yi, di] = next
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: di * Math.max(1, years.length) + yi })
  }

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
    <RevealShell>
      <div style={{ padding: 'var(--sp-5) 0' }}>
      <YearSpine />
      <ViewHeader
        title={
          <>
            Comparison <span className="serif-accent">matrix</span>
          </>
        }
        lead={
          <>
            Works per year across all twenty domains; brighter amber means
            more published work. {busiestLine}
            {busiestYear ? ` Busiest year on screen: ${busiestYear.y} with ${fmtInt(busiestYear.sum)} works.` : ''}
            {' '}Click any cell to open that domain.
          </>
        }
      >
        <CopyLink />
        <button
          onClick={toggleWindow}
          aria-pressed={recent}
          style={{
            border: 'var(--hairline-strong)',
            borderRadius: 'var(--r-control)',
            padding: '4px 12px',
            fontSize: 'var(--text-sm)',
            background: recent ? 'var(--surface-2)' : 'transparent',
          }}
        >
          {recent ? 'Last 8 years' : 'Full 2000-2025'}
        </button>
      </ViewHeader>

      <div className="matrix-scroll">
        <div
          ref={ref as unknown as React.Ref<HTMLDivElement>}
          style={{ height: 560 }}
          role="img"
          aria-label="Heatmap of works per year for all twenty domains. Focus the chart and use arrow keys to move between cells; Enter opens a domain. The domain links below also navigate."
          tabIndex={0}
          onKeyDown={onChartKeyDown}
          onBlur={() => {
            setFocusCell(null)
            const el = ref.current
            const chart = el ? echarts.getInstanceByDom(el) : null
            chart?.dispatchAction({ type: 'hideTip' })
          }}
        />
      </div>

      {/* Data-table alternative (d3-viz accessibility): the full domain x
          year counts, visually hidden so screen readers get the numbers the
          heatmap encodes. The row-tail links below are the keyboard path. */}
      <table className="visually-hidden">
        <caption>Works per year by domain</caption>
        <thead>
          <tr>
            <th scope="col">Domain</th>
            {years.map((y) => (
              <th scope="col" key={y}>{y}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {domainRows.map((row) => (
            <tr key={row.domain}>
              <th scope="row">{labels.get(row.domain) ?? row.domain}</th>
              {row.counts.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Sequential-scale legend. The chart's visualMap stays show:false so
          ECharts does not reclaim grid space; this states the ramp in ink so
          cell darkness is not left unexplained. */}
      <div className="matrix-legend" aria-label="Colour scale: works per year per domain">
        <span className="matrix-legend-cap" aria-hidden />
        <span className="matrix-legend-end">
          works per year per domain, low to high ({fmtInt(0)} to {fmtInt(legendMax)}), brighter amber = more works
        </span>      </div>

      <TimeLapse data={data} />
      <RankBumps data={data} />
      <BarRace data={data} />

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
                onMouseEnter={() => tailEnter(row.domain)}
                onMouseLeave={tailLeave}
                onFocus={() => tailEnter(row.domain)}
                onBlur={tailLeave}
                data-hovered={hoveredRow === row.domain}
                className={`matrix-tail hover-surface${hoveredRow === row.domain ? ' matrix-tail--hot' : ''}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                  border: 'var(--hairline)',
                  borderRadius: 'var(--r-control)',
                  padding: '3px 10px',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--ink-1)',
                  textDecoration: 'none',
                }}
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
    </RevealShell>
  )
}
