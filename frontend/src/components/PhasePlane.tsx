/**
 * PhasePlane - Science-to-Patent Phase Space (TRL Quadrant Scatter).
 * 2D phase portrait mapping normalized paper growth velocity (X) vs
 * patent grant acceleration (Y) over time, with an interactive quarter scrubber.
 * Honesty: values are read directly from lag.json quarterly z-scores.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Play } from '@phosphor-icons/react/dist/csr/Play'
import { Pause } from '@phosphor-icons/react/dist/csr/Pause'
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise'

import { useChart, baseOption, axes, tooltip } from '../charts/echarts'
import { useTokens } from '../lib/useTokens'
import type { LagDomain, LeaderboardEntry } from '../lib/types'
import { useMotionReduced } from '../lib/motion'

interface PhasePlaneProps {
  domains: LagDomain[]
  leaderboard?: LeaderboardEntry[]
}

export function PhasePlane({ domains, leaderboard = [] }: PhasePlaneProps) {
  const motionReduced = useMotionReduced()
  const tokens = useTokens()

  // Collect common quarters across domains that have full series
  const sampleDomain = domains.find((d) => d.series?.quarters?.length)
  const quarters = useMemo(() => sampleDomain?.series?.quarters ?? [], [sampleDomain])

  const [activeQuarterIdx, setActiveQuarterIdx] = useState<number>(() =>
    quarters.length > 0 ? quarters.length - 1 : 0,
  )
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const timerRef = useRef<number | null>(null)

  const activeQuarter = quarters[activeQuarterIdx] ?? ''

  // Stage lookup
  const stageMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const lb of leaderboard) {
      map.set(lb.domain, lb.label)
    }
    return map
  }, [leaderboard])

  // Playback timer
  useEffect(() => {
    if (isPlaying && !motionReduced) {
      timerRef.current = window.setInterval(() => {
        setActiveQuarterIdx((prev) => {
          if (prev >= quarters.length - 1) {
            setIsPlaying(false)
            return prev
          }
          return prev + 1
        })
      }, 750)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isPlaying, motionReduced, quarters.length])

  // Compute quadrant counts for active quarter
  const quadrantBreakdown = useMemo(() => {
    let academic = 0
    let dual = 0
    let patent = 0
    let stable = 0

    for (const d of domains) {
      if (!d.series) continue
      const qIdx = d.series.quarters?.indexOf(activeQuarter) ?? -1
      if (qIdx === -1) continue
      const px = d.series.papers_z[qIdx] ?? 0
      const py = d.series.patents_z[qIdx] ?? 0

      if (px >= 0 && py >= 0) dual++
      else if (px >= 0 && py < 0) academic++
      else if (px < 0 && py >= 0) patent++
      else stable++
    }

    return { academic, dual, patent, stable }
  }, [domains, activeQuarter])

  const { ref: chartRef } = useChart((t) => {
    if (!activeQuarter) return {}

    const scatterData = domains
      .map((d) => {
        if (!d.series) return null
        const qIdx = d.series.quarters?.indexOf(activeQuarter) ?? -1
        if (qIdx === -1) return null
        const px = d.series.papers_z[qIdx]
        const py = d.series.patents_z[qIdx]
        if (px == null || py == null || !Number.isFinite(px) || !Number.isFinite(py)) return null

        const stage = stageMap.get(d.domain) ?? 'Active'
        return {
          name: d.display_name,
          value: [px, py],
          domain: d.domain,
          stage,
          itemStyle: {
            color: stage === 'Emerging' ? t.stageEmerging : stage === 'Accelerating' ? t.stageAccelerating : t.accent,
            borderColor: t.surface1,
            borderWidth: 1.5,
          },
        }
      })
      .filter(Boolean)

    return {
      ...baseOption(t),
      grid: { top: 40, right: 40, bottom: 50, left: 55 },
      tooltip: {
        ...tooltip(t),
        trigger: 'item' as const,
        formatter: (params: any) => {
          const item = params.data
          if (!item) return ''
          const [px, py] = item.value
          let html = `<div style="font-family:${t.fontBody};font-size:12px;padding:4px 6px;">`
          html += `<div style="font-weight:600;color:${t.ink0};margin-bottom:4px;">${item.name}</div>`
          html += `<div style="color:${t.ink2};font-size:11px;margin-bottom:6px;">Stage: ${item.stage} (${activeQuarter})</div>`
          html += `<div style="display:flex;justify-content:space-between;gap:12px;">`
          html += `<span style="color:${t.ink2}">Research Papers:</span>`
          html += `<span style="font-family:${t.fontMono};color:${t.ink0}">${px >= 0 ? '+' : ''}${px.toFixed(2)} std dev</span>`
          html += `</div>`
          html += `<div style="display:flex;justify-content:space-between;gap:12px;">`
          html += `<span style="color:${t.ink2}">Patent Grants:</span>`
          html += `<span style="font-family:${t.fontMono};color:${t.ink0}">${py >= 0 ? '+' : ''}${py.toFixed(2)} std dev</span>`
          html += `</div>`
          html += `</div>`
          return html
        },
      },
      xAxis: {
        ...axes(t).xAxis,
        name: 'Research Paper Growth (relative to average)',
        nameLocation: 'middle' as const,
        nameGap: 30,
        nameTextStyle: { color: t.ink2, fontSize: 11 },
        type: 'value' as const,
        splitLine: { show: true, lineStyle: { color: t.gridMinor, type: 'dashed' as const } },
        axisLine: { onZero: true, lineStyle: { color: t.gridMajor } },
      },
      yAxis: {
        ...axes(t).yAxis,
        name: 'Patent Grant Growth (relative to average)',
        nameLocation: 'middle' as const,
        nameGap: 36,
        nameTextStyle: { color: t.ink2, fontSize: 11 },
        type: 'value' as const,
        splitLine: { show: true, lineStyle: { color: t.gridMinor, type: 'dashed' as const } },
        axisLine: { onZero: true, lineStyle: { color: t.gridMajor } },
      },
      series: [
        {
          type: 'scatter' as const,
          data: scatterData,
          symbolSize: 14,
          label: {
            show: true,
            formatter: '{b}',
            position: 'top',
            fontSize: 10,
            fontFamily: t.fontBody,
            color: t.ink2,
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: t.ink3, type: 'dashed' as const, width: 1 },
            data: [{ xAxis: 0 }, { yAxis: 0 }],
          },
        },
      ],
    }
  }, tokens.ink0, [activeQuarter, domains, stageMap])

  return (
    <div className="phase-plane-wrap panel-shell">
      <div className="panel-core phase-plane-core">
        <header className="phase-plane-head">
          <div>
            <span className="section-eyebrow">Lab to Market Journey</span>
            <h3 className="phase-plane-title">
              Research Papers vs <span className="serif-accent">Commercial Patents</span>
            </h3>
            <p className="phase-plane-desc">
              Compare quarterly growth of research papers (horizontal axis) with granted patents (vertical axis).
              Play or slide the quarter scrubber to see fields shift from lab discovery into market patents over time.
            </p>
          </div>

          <div className="phase-plane-controls">
            <button
              type="button"
              className="phase-plane-btn"
              onClick={() => setIsPlaying(!isPlaying)}
              aria-label={isPlaying ? 'Pause timeline animation' : 'Play timeline animation'}
            >
              {isPlaying ? (
                <Pause size={14} weight="bold" aria-hidden />
              ) : (
                <Play size={14} weight="fill" aria-hidden />
              )}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              className="phase-plane-btn phase-plane-btn--ghost"
              onClick={() => {
                setIsPlaying(false)
                setActiveQuarterIdx(0)
              }}
              aria-label="Reset to beginning"
            >
              <ArrowCounterClockwise size={14} weight="light" aria-hidden />
            </button>
          </div>
        </header>

        {/* Timeline Scrubber */}
        <div className="phase-plane-scrubber">
          <div className="phase-plane-scrubber-labels">
            <span className="phase-plane-quarter-pill num font-mono">
              Quarter: {activeQuarter}
            </span>
            <span className="phase-plane-scrubber-range num">
              {quarters[0]} - {quarters[quarters.length - 1]}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max={quarters.length - 1}
            value={activeQuarterIdx}
            onChange={(e) => {
              setIsPlaying(false)
              setActiveQuarterIdx(parseInt(e.target.value, 10))
            }}
            aria-label="Quarter timeline scrubber"
            className="phase-plane-slider"
          />
        </div>

        {/* Quadrant HUD stats */}
        <div className="phase-quadrant-hud">
          <div className="phase-hud-cell">
            <span className="phase-hud-label">Both Booming (Above Average)</span>
            <span className="phase-hud-val num font-mono">{quadrantBreakdown.dual}</span>
          </div>
          <div className="phase-hud-cell">
            <span className="phase-hud-label">Lab Frontier (Papers Rising Faster)</span>
            <span className="phase-hud-val num font-mono">{quadrantBreakdown.academic}</span>
          </div>
          <div className="phase-hud-cell">
            <span className="phase-hud-label">Market Crest (Patents Rising Faster)</span>
            <span className="phase-hud-val num font-mono">{quadrantBreakdown.patent}</span>
          </div>
          <div className="phase-hud-cell">
            <span className="phase-hud-label">Steady / Mature (Below Average)</span>
            <span className="phase-hud-val num font-mono">{quadrantBreakdown.stable}</span>
          </div>
        </div>

        {/* Chart Canvas */}
        <div ref={chartRef as unknown as React.RefObject<HTMLDivElement>} className="phase-plane-canvas" style={{ width: '100%', height: 440 }} />
      </div>
    </div>
  )
}
