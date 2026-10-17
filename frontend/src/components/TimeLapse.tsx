/**
 * TimeLapse — the archive as film: a play/scrub control that steps the
 * matrix heatmap through 2000-2025. Each frame re-renders the heatmap
 * with only that year's cells (ECharts setOption, animated), so cells
 * bloom and collapse as the years advance. Data comes from matrix.json
 * cells (per-year counts) — nothing interpolated. Scrubber + play/pause,
 * reduced-motion renders the final year statically.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useChart, echarts, baseOption, tooltip } from '../charts/echarts'
import { useTokens } from '../lib/useTokens'
import { fmtInt } from '../lib/format'
import { motionReduced } from '../lib/motion'
import type { MatrixFile } from '../lib/types'

export function TimeLapse({ data }: { data: MatrixFile }) {
  const tokens = useTokens()
  const reduced = motionReduced()
  const [yearIdx, setYearIdx] = useState(data.years.length - 1)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)

  const years = data.years
  const year = years[yearIdx] ?? years[years.length - 1]

  // Play: step one year per 420ms; stop at the horizon. The stop check
  // lives outside the state updater (updaters must stay pure — StrictMode
  // double-invokes them, which would double-fire setPlaying).
  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(() => {
      setYearIdx((i) => Math.min(i + 1, years.length - 1))
    }, 420)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [playing, years.length])

  useEffect(() => {
    if (playing && yearIdx >= years.length - 1) setPlaying(false)
  }, [playing, yearIdx, years.length])

  const cellsUpTo = useMemo(() => {
    const rows = data.domains.map((domain) => {
      const counts = data.cells[domain] ?? []
      return { domain, count: counts[yearIdx] ?? 0 }
    })
    return rows
  }, [data, yearIdx])

  // Chart builds ONCE (deps: theme + data presence); each year step is a
  // setOption update so cells animate instead of the instance being
  // disposed and re-created on every frame.
  const { ref, setOpts } = useChart(
    (t) => {
      const first = data.domains.map((d) => (data.cells[d] ?? [])[0] ?? 0)
      return {
        ...baseOption(t),
        grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
        xAxis: {
          type: 'category' as const,
          data: data.domains,
          axisLine: { lineStyle: { color: t.gridMajor } },
          axisTick: { show: false },
          axisLabel: {
            color: t.ink2,
            fontFamily: t.fontMono,
            fontSize: 10,
            rotate: 38,
            hideOverlap: false,
          },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'log' as const,
          min: 1,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: t.ink2, fontFamily: t.fontMono, fontSize: 10 },
          splitLine: {
            lineStyle: { color: t.gridMinor, type: 'dashed' as const, width: 1 },
          },
        },
        tooltip: {
          ...tooltip(t),
          formatter: (p: { name?: string; value?: number }) =>
            `${p.name ?? ''} ${year}: ${fmtInt(p.value ?? 0)} works`,
        },
        series: [
          {
            type: 'bar' as const,
            data: first,
            barMaxWidth: 26,
            itemStyle: {
              color: t.accent,
              opacity: 0.85,
              borderRadius: [2, 2, 0, 0],
            },
            // Inline numbers on each bar: the film is watchable without
            // hovering — you see the counts grow and shrink per year.
            label: {
              show: true,
              position: 'top' as const,
              color: t.ink0,
              fontFamily: t.fontMono,
              fontSize: 10,
              formatter: (p: { value?: number }) =>
                (p.value ?? 0) > 0 ? fmtInt(p.value ?? 0) : '',
            },
            animationDuration: reduced ? 0 : 300,
            animationEasingUpdate: 'cubicOut' as const,
          },
        ],
      } satisfies echarts.EChartsCoreOption
    },
    tokens.ink0,
    [data],
  )

  // Push the current year's frame into the standing chart on each step.
  useEffect(() => {
    setOpts({ series: [{ data: cellsUpTo.map((r) => r.count) }] })
  }, [cellsUpTo, setOpts])

  // Autoplay once on mount (skipped for reduced motion): the user asked
  // for the film to PLAY, not to wait behind a click. Starts from 2000.
  const autoRef = useRef(false)
  useEffect(() => {
    if (reduced || autoRef.current) return
    autoRef.current = true
    setYearIdx(0)
    setPlaying(true)
  }, [reduced])

  return (
    <section className="panel panel--sunk timelapse" aria-label="Year time-lapse of works per domain">
      <div className="panel-core">
        <div className="timelapse-head">
          <h2>
            The archive as film <span className="num timelapse-year">{year}</span>
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
              aria-label={playing ? 'Pause time-lapse' : 'Play time-lapse from 2000'}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <label className="visually-hidden" htmlFor="timelapse-scrub">
              Scrub year
            </label>
            <input
              id="timelapse-scrub"
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
            <span className="num timelapse-count">
              {fmtInt(cellsUpTo.reduce((s, r) => s + r.count, 0))} works on screen
            </span>
          </div>
        </div>
        <div ref={ref as unknown as React.Ref<HTMLDivElement>} style={{ height: 380 }} role="img" aria-label={`Bar chart of works per domain in ${year}`} />
      </div>
    </section>
  )
}
