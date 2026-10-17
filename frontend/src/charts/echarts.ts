/**
 * The ONE themed ECharts factory. Every chart in the app routes through
 * here — no ad hoc chart configs inside views. Reads design tokens from
 * computed CSS once per theme change; craft rules (zero baseline, mono
 * axis ticks, low-opacity grids, inline forecast bands) are applied here
 * so they cannot drift per-view.
 */
import * as echarts from 'echarts/core'
import { LineChart, HeatmapChart, CustomChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DatasetComponent,
  VisualMapComponent,
  LegendComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

echarts.use([
  LineChart,
  HeatmapChart,
  CustomChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DatasetComponent,
  VisualMapComponent,
  LegendComponent,
  SVGRenderer,
])

/** Motion verdict follows the user's explicit choice (lib/motion). */
import { motionReduced } from '../lib/motion'
function prefersReducedMotion(): boolean {
  return motionReduced()
}

export interface ThemeTokens {
  ink0: string
  ink1: string
  ink2: string
  ink3: string
  surface1: string
  gridMinor: string
  gridMajor: string
  crosshair: string
  accent: string
  forecastBand: string
  forecastBandStroke: string
  stageEmerging: string
  stageAccelerating: string
  stageActive: string
  stageWatch: string
  cat1: string
  cat2: string
  cat3: string
  cat4: string
  cat5: string
  matrixMid: string
  matrixHigh: string
  fontMono: string
  fontBody: string
}

function readTokens(): ThemeTokens {
  const style = getComputedStyle(document.documentElement)
  const v = (name: string): string => style.getPropertyValue(name).trim()
  return {
    ink0: v('--ink-0'),
    ink1: v('--ink-1'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    surface1: v('--surface-1'),
    gridMinor: v('--grid-minor'),
    gridMajor: v('--grid-major'),
    crosshair: v('--crosshair'),
    accent: v('--accent'),
    forecastBand: v('--forecast-band'),
    forecastBandStroke: v('--forecast-band-stroke'),
    stageEmerging: v('--stage-emerging'),
    stageAccelerating: v('--stage-accelerating'),
    stageActive: v('--stage-active'),
    stageWatch: v('--stage-watch'),
    cat1: v('--cat-1'),
    cat2: v('--cat-2'),
    cat3: v('--cat-3'),
    cat4: v('--cat-4'),
    cat5: v('--cat-5'),
    matrixMid: v('--matrix-mid'),
    matrixHigh: v('--matrix-high'),
    fontMono: v('--font-mono'),
    fontBody: v('--font-body'),
  }
}

/** Data preparation (d3-viz): filter null/NaN before plotting, so a
 *  malformed snapshot cannot produce a broken chart. */
export function cleanSeries(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v))
}

/** Shared craft-rule fragments every view composes. */
export function baseOption(t: ThemeTokens) {
  return {
    // Draw-in motion with purpose (§8); fully silenced when the user
    // prefers reduced motion (CSS rules cannot reach canvas/SVG JS anims).
    animationDuration: prefersReducedMotion() ? 0 : 600,
    animationDurationUpdate: prefersReducedMotion() ? 0 : 150,
    textStyle: {
      color: t.ink2,
      fontFamily: t.fontBody,
      fontSize: 12,
    },
    grid: {
      left: 8,
      right: 16,
      top: 16,
      bottom: 8,
      containLabel: true,
    },
    axisPointer: {
      lineStyle: { color: t.crosshair, width: 1 },
      crossStyle: { color: t.crosshair, width: 1 },
      // Crosshair readout: a hairline label on the surface, no drop shadow.
      label: {
        backgroundColor: t.surface1,
        borderColor: 'transparent',
        color: t.ink0,
        fontFamily: t.fontMono,
        fontSize: 11,
        padding: [4, 6],
      },
    },
  }
}

/** Category/value axis pair with editorial grid discipline. */
export function axes(t: ThemeTokens, xExtra = {}, yExtra = {}) {
  return {
    xAxis: {
      type: 'category' as const,
      axisLine: { lineStyle: { color: t.gridMajor } },
      axisTick: { show: false },
      axisLabel: {
        color: t.ink2,
        fontFamily: t.fontMono, // axis ticks in mono (§8)
        fontSize: 11,
        hideOverlap: true,
      },
      splitLine: { show: false },
      ...xExtra,
    },
    yAxis: {
      type: 'value' as const,
      // Zero baseline always shown for count data (§8 chart craft rules)
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: t.ink2,
        fontFamily: t.fontMono,
        fontSize: 11,
      },
      splitLine: {
        // Subtle grid discipline (d3-viz styling): minor gridlines are
        // dashed hairlines; the axis line above stays solid.
        lineStyle: { color: t.gridMinor, type: 'dashed' as const, width: 1 },
      },
      ...yExtra,
    },
  }
}

/** Tooltip chrome shared across charts. */
export function tooltip(t: ThemeTokens) {
  return {
    trigger: 'axis' as const,
    backgroundColor: t.surface1,
    borderColor: 'transparent',
    textStyle: { color: t.ink0, fontFamily: t.fontBody, fontSize: 12 },
    extraCssText: 'box-shadow: none; border-radius: 2px; padding: 8px 10px;',
    axisPointer: {
      type: 'line' as const,
      lineStyle: { color: t.crosshair, width: 1 },
    },
  }
}

/** React wrapper: one instance per chart, theme-aware, resize-aware.
 *  `deps` must include the data the chart plots: the chart div mounts
 *  only after loading states clear, so init must re-run when data
 *  arrives, not just when the theme flips. */
export function useChart(
  buildOption: (tokens: ThemeTokens) => echarts.EChartsCoreOption,
  theme: string,
  deps: unknown[] = [],
): { ref: React.RefObject<HTMLDivElement | null>; setOpts: (opts: echarts.EChartsCoreOption) => void } {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' })
    chartRef.current = chart
    chart.setOption(buildOption(readTokens()))
    // Debounced resize (d3-viz perf): a window drag fires the observer on
    // every frame; resizing an SVG chart that often is wasted work.
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => chart.resize())
    })
    ro.observe(ref.current)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, ...deps])

  const setOpts = (opts: echarts.EChartsCoreOption) => {
    chartRef.current?.setOption(opts)
  }

  return { ref, setOpts }
}

export { echarts, readTokens }
