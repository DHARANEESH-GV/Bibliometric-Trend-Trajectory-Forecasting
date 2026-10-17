/**
 * Domain Drill-down — single-domain deep view: full annual series +
 * forecast with 68% interval band, score decomposition, top keywords
 * (with a real empty state), provenance and caveat as first-class prose.
 */
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { loadDomainSnapshot, loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useTokens } from '../lib/useTokens'
import { useChart, echarts, axes, baseOption, tooltip } from '../charts/echarts'
import { fmtInt, fmtModel, fmtScore, fmtDelta } from '../lib/format'
import { StagePill } from '../components/StagePill'
import { Metric } from '../components/Metric'
import { ScoreBar } from '../components/ScoreBar'
import { ScorePetal } from '../components/ScorePetal'
import { RevealShell } from '../components/RevealShell'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CaveatBanner } from '../components/CaveatBanner'
import { ViewHeader } from '../components/ViewHeader'
import { useSpotlight, SpotlightRing } from '../components/SpotlightWrap'
import type { DomainSnapshot } from '../lib/types'
import { STAGE_TOKEN } from '../lib/types'

export function DomainDrilldownView() {
  const { slug } = useParams<{ slug: string }>()
  const { data, loading, error } = useQuery<DomainSnapshot | null>(
    () => (slug ? loadDomainSnapshot(slug) : Promise.reject(new Error('No domain requested'))),
    [slug],
  )
  const leaderboard = useQuery(loadLeaderboard, [])
  const tokens = useTokens()
  const metricSpot = useSpotlight<HTMLDivElement>()

  // The real per-input score split and the run rank live on the leaderboard
  // file, not the domain snapshot. Look the row up by slug so the
  // decomposition below is honest instead of approximated.
  const lbEntry = useMemo(
    () => leaderboard.data?.leaderboard.find((r) => r.domain === slug) ?? null,
    [leaderboard.data, slug],
  )
  const rankOf = lbEntry ? lbEntry.rank : null
  const totalDomains = leaderboard.data?.leaderboard.length ?? null

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
        // Band fill = (upper - lower) area rendered as an uncertainty fan:
        // gradient cone (dense at the anchor, dissolving at the horizon)
        // plus a dashed outer edge on the upper bound.
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
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: t.forecastBandStroke },
                { offset: 0.35, color: t.forecastBand },
                { offset: 1, color: 'transparent' },
              ],
            },
          },
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
        // Fan outer edge: dashed stroke riding the upper bound — the
        // backtest-error horizon the cone dissolves toward.
        {
          type: 'line' as const,
          data: upperData,
          lineStyle: {
            width: 1,
            color: t.forecastBandStroke,
            type: 'dashed' as const,
            opacity: 0.7,
          },
          symbol: 'none',
          tooltip: { show: false },
          silent: true,
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
      <div className="domain-view">
        <ShimmerAxes xLabels={['2000', '2025']} height={380} label="Loading domain" />
      </div>
    )
  }

  return (
    <RevealShell>
      <article className="domain-view">
      <ViewHeader
        eyebrow={
          <>
            <Link to="/">Leaderboard</Link> / domain
          </>
        }
        title={
          <>
            {data.display_name}
            <span className="serif-accent" aria-hidden>
              {' '}
              ·
            </span>
            <StagePill label={data.label} />
          </>
        }
        lead={
          rankOf != null && totalDomains != null ? (
            <>
              Ranks <span className="num">#{rankOf}</span> of{' '}
              <span className="num">{totalDomains}</span> domains this run.
            </>
          ) : undefined
        }
      />

      {data.caveat ? (
        <div className="domain-caveat">
          <CaveatBanner>{data.caveat}</CaveatBanner>
        </div>
      ) : null}

      <div
        ref={metricSpot.ref}
        onMouseMove={metricSpot.onMouseMove}
        className="panel spotlight-host domain-metrics"
      >
        <SpotlightRing />
        <div className="panel-core">
          <Metric rule label={`Works ${lastYear ?? ''}`} value={lastWorks != null ? fmtInt(lastWorks) : 'No data'} />
          {yoy != null ? (
            <Metric rule label="Latest YoY" value={fmtDelta(yoy)} />
          ) : null}
          <Metric rule tick={`var(${STAGE_TOKEN[data.label] ?? '--stage-watch'})`} label="Emergence score" value={fmtScore(data.score)} />
          <Metric rule label="Peak year" value={peakYear != null ? fmtInt(peakYear) : 'No data'} detail={peakIdx >= 0 ? `${fmtInt(works[peakIdx] ?? 0)} works` : undefined} />
          <Metric rule label="Forecast model" value={fmtModel(data.model)} detail={`horizon ${horizonYears[0]}-${horizonYears[horizonYears.length - 1]}`} />
        </div>
      </div>

      <div ref={ref as unknown as React.Ref<HTMLDivElement>} className="domain-chart" />

      <p className="domain-chart-note">
        Forecast extended with {fmtModel(data.model)}; shaded band is the 68%
        prediction interval. Trained on {years[0]}-{lastYear} annual counts;
        backtest gate results are cited in the footer of every page.
      </p>

      {horizonYears.length > 0 ? (
        <div className="forecast-table" role="table" aria-label="Forecast values with 68% interval">
          <div className="forecast-row forecast-row--head" role="row">
            <span role="columnheader">Year</span>
            <span role="columnheader" className="num">Forecast</span>
            <span role="columnheader" className="num">68% interval</span>
          </div>
          {horizonYears.map((y, i) => {
            const iv = data.interval_68pct[String(y)]
            return (
              <div className="forecast-row" role="row" key={y}>
                <span className="num" role="cell">{y}</span>
                <span className="num" role="cell">{fmtInt(Math.round(forecast[i] ?? 0))}</span>
                <span className="num" role="cell" style={{ color: 'var(--ink-2)' }}>
                  {iv ? `${fmtInt(Math.round(iv[0]))} to ${fmtInt(Math.round(iv[1]))}` : 'n/a'}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      {data.provenance_note ? (
        <div className="domain-provenance">
          <CaveatBanner kind="provenance">Provenance: {data.provenance_note}</CaveatBanner>
        </div>
      ) : null}

      <section className="domain-section">
        <h2>Score decomposition</h2>
        <p className="domain-section-intro">
          The emergence score blends five normalized inputs. It is a tunable
          prior, not a derived constant; the rank-stability analysis in the
          final report shows how the leaderboard moves when weights shift.
        </p>
        {/* Domain snapshots carry the score but not the input split; the
            leaderboard file carries the real score_inputs. Render those,
            never an approximation. */}
        {lbEntry ? (
          <div className="domain-petal-wrap">
            <ScoreBar inputs={lbEntry.score_inputs} />
            <ScorePetal inputs={lbEntry.score_inputs} />
          </div>
        ) : leaderboard.loading ? (
          <ShimmerAxes height={80} label="Loading score decomposition" />
        ) : (
          <p className="domain-unavailable">
            This domain is not present in the current run's leaderboard, so the
            per-input split is unavailable for it.
          </p>
        )}
      </section>

      <section className="domain-section">
        <h2>Top keywords</h2>
        {data.top_keywords.length === 0 ? (
          <p className="domain-empty">
            No keyword ranking survived quality gates for this domain in this
            snapshot. That is an absence of validated signal, not an empty
            field of study.
          </p>
        ) : (
          <ul className="domain-keywords">
            {data.top_keywords.map((k, i) => (
              <li key={k.name} className="domain-keyword">
                <span className="domain-keyword-rank">{i + 1}</span>
                <Link
                  to={slug ? `/bursts?domain=${slug}` : '/bursts'}
                  aria-label={`See ${k.name} in the burst feed`}
                  className="domain-keyword-link"
                >
                  {k.name}
                </Link>
                <span className="num domain-keyword-count">
                  {fmtInt(k.total)}
                  {k.bursts.length > 0 ? `, ${k.bursts.length} burst${k.bursts.length === 1 ? '' : 's'}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      </article>
    </RevealShell>
  )
}
