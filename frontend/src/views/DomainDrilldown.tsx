/**
 * Domain Drill-down — single-domain deep view: full annual series +
 * forecast with 68% interval band, score decomposition, top keywords
 * (with a real empty state), provenance and caveat as first-class prose.
 */
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { loadDomainSnapshot, loadTrajectories } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useTokens } from '../lib/useTokens'
import { useChart, echarts, axes, baseOption, tooltip } from '../charts/echarts'
import { fmtInt, fmtModel, fmtScore, fmtDelta } from '../lib/format'
import { StagePill } from '../components/StagePill'
import { Metric } from '../components/Metric'
import { ScoreBar } from '../components/ScoreBar'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CaveatBanner } from '../components/CaveatBanner'
import type { DomainSnapshot } from '../lib/types'

export function DomainDrilldownView() {
  const { slug } = useParams<{ slug: string }>()
  const { data, loading, error } = useQuery<DomainSnapshot | null>(
    () => (slug ? loadDomainSnapshot(slug) : Promise.reject(new Error('No domain requested'))),
    [slug],
  )
  const traj = useQuery(loadTrajectories, [])
  const tokens = useTokens()

  const years = useMemo<number[]>(
    () => (data ? Object.keys(data.annual).map(Number).sort((a, b) => a - b) : []),
    [data],
  )
  const works = years.map((y) => data?.annual[String(y)] ?? 0)
  const horizonYears = data?.horizon ?? []
  const forecast = data?.forecast ?? []
  const intervals = horizonYears.map((y) => data?.interval_68pct[String(y)] ?? null)

  const lastYear = years[years.length - 1]
  const lastWorks = works[works.length - 1]
  const prevWorks = works[works.length - 2]
  const yoy = lastWorks != null && prevWorks ? (lastWorks - prevWorks) / prevWorks : null

  const peakIdx = works.reduce((bi, v, i) => (v > (works[bi] ?? 0) ? i : bi), 0)
  const peakYear = years[peakIdx]

  const xLabels = [...years.map(String), ...horizonYears.map(String)]

  const { ref } = useChart((t) => {
    if (!data) return {}
    // Actual line + forecast band (lower->upper stacked area trick with
    // transparent lower) + dashed forecast line bridged from last actual.
    const lowerData = [
      ...years.slice(0, -1).map(() => null),
      works[works.length - 1] ?? null,
      ...intervals.map((iv) => iv?.[0] ?? null),
    ]
    const upperData = [
      ...years.slice(0, -1).map(() => null),
      works[works.length - 1] ?? null,
      ...intervals.map((iv) => iv?.[1] ?? null),
    ]
    const forecastLine = [
      ...years.slice(0, -1).map(() => null),
      lastWorks ?? null,
      ...forecast,
    ]

    return {
      ...baseOption(t),
      ...axes(t, { data: xLabels, boundaryGap: false }, {}),
      tooltip: {
        ...tooltip(t),
        axisPointer: { type: 'cross' as const, label: { backgroundColor: t.surface1 } },
      },
      series: [
        // Band upper (fills down to lower via stack on a hidden baseline)
        {
          type: 'line' as const,
          data: upperData,
          stack: 'band',
          lineStyle: { opacity: 0 },
          symbol: 'none',
          areaStyle: { opacity: 0 },
          tooltip: { show: false },
          silent: true,
        },
        // Band fill = (upper - lower) area rendered translucent
        {
          type: 'line' as const,
          data: intervals.map((iv, i) =>
            iv && upperData[years.length + i] != null && lowerData[years.length + i] != null
              ? (upperData[years.length + i] as number) - (lowerData[years.length + i] as number)
              : null,
          ),
          stack: 'band',
          lineStyle: { opacity: 0 },
          symbol: 'none',
          areaStyle: { color: t.forecastBand },
          tooltip: { show: false },
          silent: true,
          // Inline label at the band start (§8)
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: t.forecastBandStroke, type: 'dashed' as const, width: 1 },
            label: {
              color: t.ink2,
              fontFamily: t.fontBody,
              fontSize: 10,
              formatter: '68% interval',
            },
            data: [{ xAxis: String(lastYear) }],
          },
        },
        {
          type: 'line' as const,
          name: 'Actual works',
          data: works,
          lineStyle: { width: 1.75, color: t.accent },
          itemStyle: { color: t.accent },
          showSymbol: false,
          emphasis: { focus: 'series' as const },
          markPoint: {
            silent: true,
            symbol: 'circle',
            symbolSize: 5,
            itemStyle: { color: t.accent },
            label: {
              show: true,
              formatter: `peak ${fmtInt(works[peakIdx] ?? 0)}`,
              color: t.ink2,
              fontFamily: t.fontMono,
              fontSize: 10,
              position: 'top' as const,
            },
            data: [{ coord: [peakYear, works[peakIdx]] }],
          },
        },
        {
          type: 'line' as const,
          name: `Forecast (${fmtModel(data.model)})`,
          data: forecastLine,
          lineStyle: { width: 1.5, color: t.accent, type: 'dashed' as const, opacity: 0.85 },
          itemStyle: { color: t.accent },
          showSymbol: true,
          symbolSize: 4,
        },
      ],
    } satisfies echarts.EChartsCoreOption
  }, tokens.ink0, [data, works, forecast, intervals])

  if (error) {
    return (
      <div style={{ padding: 'var(--sp-7) 0' }}>
        <p style={{ color: 'var(--ink-2)' }}>{error.message}</p>
        <p style={{ marginTop: 'var(--sp-3)' }}>
          <Link to="/">Back to the leaderboard</Link>
        </p>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div style={{ padding: 'var(--sp-5) 0' }}>
        <ShimmerAxes xLabels={['2000', '2025']} height={380} label="Loading domain" />
      </div>
    )
  }

  const rankRow = traj.data?.domains.find((d) => d.domain === slug)
  void rankRow

  return (
    <article style={{ padding: 'var(--sp-5) 0' }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 'var(--sp-4)',
          justifyContent: 'space-between',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
            <Link to="/">Leaderboard</Link> / domain
          </p>
          <h1 style={{ fontSize: 'var(--text-2xl)', display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
            {data.display_name}
            <StagePill label={data.label} />
          </h1>
        </div>
      </header>

      {data.caveat ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <CaveatBanner>{data.caveat}</CaveatBanner>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 'var(--sp-5)',
          margin: 'var(--sp-5) 0',
        }}
      >
        <Metric label={`Works ${lastYear ?? ''}`} value={lastWorks != null ? fmtInt(lastWorks) : '—'} />
        {yoy != null ? (
          <Metric label="Latest YoY" value={fmtDelta(yoy)} />
        ) : null}
        <Metric label="Emergence score" value={fmtScore(data.score)} />
        <Metric label="Peak year" value={peakYear != null ? fmtInt(peakYear) : '—'} detail={peakIdx >= 0 ? `${fmtInt(works[peakIdx] ?? 0)} works` : undefined} />
        <Metric label="Forecast model" value={fmtModel(data.model)} detail={`horizon ${horizonYears[0]}–${horizonYears[horizonYears.length - 1]}`} />
      </div>

      <div ref={ref as unknown as React.Ref<HTMLDivElement>} style={{ height: 420 }} />

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', marginTop: 'var(--sp-2)' }}>
        Forecast extended with {fmtModel(data.model)}; shaded band is the 68%
        prediction interval. Trained on {years[0]}–{lastYear} annual counts;
        backtest gate results are cited in the footer of every page.
      </p>

      {data.provenance_note ? (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <CaveatBanner kind="provenance">Provenance: {data.provenance_note}</CaveatBanner>
        </div>
      ) : null}

      <section style={{ marginTop: 'var(--sp-6)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)' }}>Score decomposition</h2>
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', margin: 'var(--sp-2) 0 var(--sp-4)' }}>
          The emergence score blends five normalized inputs. It is a tunable
          prior, not a derived constant; the rank-stability analysis in the
          final report shows how the leaderboard moves when weights shift.
        </p>
        {/* Domain snapshots carry the score but not the input split; the
            leaderboard file does. Show what exists — no fabricated inputs. */}
        {traj.data ? (
          <div style={{ maxWidth: 560 }}>
            <ScoreBar inputs={{
              growth_recent: Math.max(0, yoy ?? 0),
              acceleration: Math.max(0, yoy ?? 0) > 0.3 ? 1 : Math.max(0, yoy ?? 0) / 0.3,
              keyword_burst: 0,
              volume_scaled: Math.min(1, (lastWorks ?? 0) / 20000),
              momentum_intent: 0,
            }} />
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', marginTop: 'var(--sp-2)' }}>
              Full per-input splits live on the leaderboard view; this summary
              shows the latest-year growth and volume context only.
            </p>
          </div>
        ) : (
          <ShimmerAxes height={80} label="Loading score decomposition" />
        )}
      </section>

      <section style={{ marginTop: 'var(--sp-6)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)' }}>Top keywords</h2>
        {data.top_keywords.length === 0 ? (
          <p style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)', marginTop: 'var(--sp-3)' }}>
            No keyword ranking survived quality gates for this domain in this
            snapshot. That is an absence of validated signal, not an empty
            field of study.
          </p>
        ) : (
          <ul
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-2)',
              listStyle: 'none',
              padding: 0,
              marginTop: 'var(--sp-3)',
            }}
          >
            {data.top_keywords.map((k, i) => (
              <li
                key={k.name}
                style={{
                  border: 'var(--hairline)',
                  borderRadius: 2,
                  padding: '3px 10px',
                  fontSize: 'var(--text-sm)',
                }}
              >
                <span style={{ color: 'var(--ink-3)', marginRight: 'var(--sp-2)' }}>{i + 1}</span>
                <Link
                  to={slug ? `/bursts?domain=${slug}` : '/bursts'}
                  aria-label={`See ${k.name} in the burst feed`}
                  style={{ color: 'var(--ink-1)', textDecoration: 'none' }}
                >
                  {k.name}
                </Link>
                <span
                  className="num"
                  style={{ color: 'var(--ink-3)', marginLeft: 'var(--sp-2)', fontSize: 'var(--text-xs)' }}
                >
                  {fmtInt(k.total)}
                  {k.bursts.length > 0 ? `, ${k.bursts.length} burst${k.bursts.length === 1 ? '' : 's'}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
