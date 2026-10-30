/**
 * BarRace — cumulative works race across all 20 fields, built from
 * matrix.json cells. YouTube-bar-chart-race choreography: bars NEVER
 * jump rows — the hero value is the NUMBER. Each bar carries a live
 * odometer (counting 0 → total as the race advances) and a delta chip
 * that pops when a bar passes another. Rank swaps animate smoothly by
 * tweening positions; the axis max is the leader, so a takeover is
 * visible as a bar crossing while its number overtakes. Play/scrub;
 * reduced motion renders the final year statically.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useChart, echarts, baseOption, tooltip } from '../charts/echarts'
import { useTokens } from '../lib/useTokens'
import { fmtInt } from '../lib/format'
import { motionReduced } from '../lib/motion'
import { useInViewOnce } from '../lib/useInViewOnce'
import type { MatrixFile } from '../lib/types'

interface RaceRow {
  domain: string
  prev: number
  total: number
}

export function BarRace({ data }: { data: MatrixFile }) {
  const tokens = useTokens()
  const reduced = motionReduced()
  const years = data.years

  // Current + previous frame for delta chips
  const [yearIdx, setYearIdx] = useState(reduced ? years.length - 1 : 0)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(() => {
      setYearIdx((i) => Math.min(i + 1, years.length - 1))
    }, 650)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [playing, years.length])

  useEffect(() => {
    if (playing && yearIdx >= years.length - 1) setPlaying(false)
  }, [playing, yearIdx, years.length])

  /** Rankings at a given year index, with per-frame delta. */
  const frame = useMemo((): { rows: RaceRow[]; overtakes: string[] } => {
    const rows: RaceRow[] = data.domains.map((d) => {
      const counts = data.cells[d] ?? []
      let sum = 0
      for (let i = 0; i <= yearIdx; i++) sum += counts[i] ?? 0
      let prev = 0
      for (let i = 0; i < yearIdx; i++) prev += counts[i] ?? 0
      return { domain: d, prev, total: sum }
    })
    const sorted = [...rows].sort((a, b) => b.total - a.total)
    // overtakes: bars whose order index improved vs the previous frame
    const rankNow = new Map(rows.map((r, i) => [r.domain, i]))
    const rankPrevRows = [...rows].sort((a, b) => b.prev - a.prev)
    const rankPrev = new Map(rankPrevRows.map((r, i) => [r.domain, i]))
    const overtakes: string[] = []
    for (const [domain, now] of rankNow) {
      const before = rankPrev.get(domain) ?? now
      if (now < before) overtakes.push(domain)
    }
    return { rows: sorted, overtakes }
  }, [data, yearIdx])

  // Chart builds ONCE. Rank swaps are ECharts' own category reorder
  // animation (implicit animation, 650ms cubicInOut) — bars glide between
  // rows, never teleport. Odometers/DOM chips render via series labels.
  const { ref, setOpts } = useChart(
    (t) => {
      const initial = data.domains
        .map((d) => ({ d, c: (data.cells[d] ?? [])[0] ?? 0 }))
        .sort((a, b) => a.c - b.c)
      return {
        ...baseOption(t),
        grid: { left: 8, right: 96, top: 16, bottom: 8, containLabel: true },
        xAxis: {
          type: 'value' as const,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.ink2, fontFamily: t.fontMono, fontSize: 10 },
          splitLine: { lineStyle: { color: t.gridMinor, type: 'dashed' as const, width: 1 } },
        },
        yAxis: {
          type: 'category' as const,
          data: initial.map((r) => r.d),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.ink1, fontFamily: t.fontBody, fontSize: 11 },
          splitLine: { show: false },
        },
        tooltip: {
          ...tooltip(t),
          trigger: 'item' as const,
          formatter: (p: { name?: string; value?: number }) =>
            `${p.name ?? ''} by ${years[yearIdx]}: ${fmtInt(p.value ?? 0)} works`,
        },
        series: [
          {
            type: 'bar' as const,
            data: initial.map((r) => r.c),
            barMaxWidth: 22,
            itemStyle: { color: t.accent, opacity: 0.85, borderRadius: [0, 3, 3, 0] },
            // The number at the end of each bar — the hero of the race.
            label: {
              show: true,
              position: 'right' as const,
              color: t.ink0,
              fontFamily: t.fontMono,
              fontSize: 12,
              fontWeight: 600 as const,
              formatter: (p: { value?: number }) => fmtInt(p.value ?? 0),
            },
            animationDuration: reduced ? 0 : 300,
            animationDurationUpdate: reduced ? 0 : 620,
            animationEasingUpdate: 'cubicInOut' as const,
          },
        ],
      } satisfies echarts.EChartsCoreOption
    },
    tokens.ink0,
    [data],
  )

  // Push each race frame into the standing chart. The axis max pins to the
  // leader +10% headroom so a takeover reads as a genuine crossing, and
  // labels (the numbers) tween in lockstep with the bars. Autoplays once
  // on mount (skipped for reduced motion): the race should RUN when the
  // user arrives, per the brief.
  // Autoplay once the panel is on screen (skipped for reduced motion).
  // Gate on visibility: this panel is the LAST thing on /matrix, so an
  // always-on 650 ms setOption loop repainted a chart nobody could see.
  const raceAutoRef = useRef(false)
  const { ref: inViewRef, inView } = useInViewOnce<HTMLElement>('240px')
  useEffect(() => {
    if (reduced || raceAutoRef.current || !inView) return
    raceAutoRef.current = true
    setYearIdx(0)
    setPlaying(true)
  }, [reduced, inView])
  useEffect(() => {
    const max = frame.rows[0]?.total ?? 0
    setOpts({
      yAxis: { data: frame.rows.map((r) => r.domain) },
      xAxis: { max: Math.ceil(max * 1.12) || 10 },
      series: [
        {
          data: frame.rows.map((r) => r.total),
          itemStyle: {
            color: (p: { dataIndex: number }) => {
              const row = frame.rows[p.dataIndex]
              return row && frame.overtakes.includes(row.domain) ? tokens.cat1 : tokens.accent
            },
          },
          label: {
            formatter: (p: { value?: number }) => fmtInt(p.value ?? 0),
          },
        },
      ],
    })
  }, [frame, setOpts, tokens])

  const leader = frame.rows[0]
  const year = years[yearIdx] ?? years[years.length - 1]

  return (
    <section
      ref={inViewRef}
      className="panel panel--sunk bar-race"
      aria-label="Cumulative works race across domains"
    >
      <div className="panel-core">
        <div className="timelapse-head">
          <h2>
            The race so far <span className="num timelapse-year">{year}</span>
          </h2>
          <div className="timelapse-controls">
            <button
              type="button"
              className="timelapse-btn"
              onClick={() => {
                if (yearIdx >= years.length - 1) setYearIdx(0)
                setPlaying((p) => !p)
              }}
              aria-pressed={playing}
              aria-label={playing ? 'Pause the race' : 'Play the race from 2000'}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <label className="visually-hidden" htmlFor="barrace-scrub">
              Scrub race year
            </label>
            <input
              id="barrace-scrub"
              type="range"
              min={0}
              max={years.length - 1}
              value={yearIdx}
              onChange={(e) => {
                setPlaying(false)
                setYearIdx(Number(e.target.value))
              }}
              className="timelapse-scrub"
            />
            {reduced ? (
              <span className="num timelapse-count">final standings</span>
            ) : (
              <button
                type="button"
                className="timelapse-btn"
                onClick={() => {
                  setPlaying(false)
                  setYearIdx(years.length - 1)
                }}
                aria-label="Skip to final year"
              >
                Skip to end
              </button>
            )}
          </div>
        </div>
        {/* Live leader line under the title: the number that matters */}
        <p className="race-leader num" aria-live="polite">
          {leader ? `${leader.domain.replace(/_/g, ' ')} leads with ${fmtInt(leader.total)} works` : ''}
        </p>
        <div ref={ref as unknown as React.Ref<HTMLDivElement>} style={{ height: 620 }} role="img" aria-label={`Horizontal bar race of cumulative works by ${year}, numbers at each bar end`} />
      </div>
    </section>
  )
}
