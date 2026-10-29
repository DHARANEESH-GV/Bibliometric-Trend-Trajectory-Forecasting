/**
 * Domain Drill-down — single-domain deep view: full annual series +
 * forecast with 68% interval band, score decomposition, top keywords
 * (with a real empty state), provenance and caveat as first-class prose.
 */
import { useMemo, useState } from 'react'
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
import { Printer } from '@phosphor-icons/react/dist/csr/Printer'
import { Copy } from '@phosphor-icons/react/dist/csr/Copy'
import { Check } from '@phosphor-icons/react/dist/csr/Check'
import { DownloadSimple } from '@phosphor-icons/react/dist/csr/DownloadSimple'
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { ArrowsLeftRight } from '@phosphor-icons/react/dist/csr/ArrowsLeftRight'
import type { DomainSnapshot } from '../lib/types'
import { STAGE_TOKEN } from '../lib/types'

const DOMAIN_RELATIONS: Record<string, string[]> = {
  quantum_error_correction: ['quantum_computing', 'advanced_semiconductors'],
  quantum_computing: ['quantum_error_correction', 'advanced_semiconductors', 'artificial_intelligence'],
  ai_agents: ['generative_ai', 'artificial_intelligence', 'cybersecurity'],
  generative_ai: ['ai_agents', 'artificial_intelligence', 'digital_twins'],
  artificial_intelligence: ['generative_ai', 'ai_agents', 'brain_computer_interfaces'],
  synthetic_biology: ['biotechnology', 'clean_hydrogen'],
  biotechnology: ['synthetic_biology', 'brain_computer_interfaces'],
  clean_hydrogen: ['carbon_capture', 'solid_state_batteries'],
  carbon_capture: ['clean_hydrogen', 'smart_manufacturing'],
  edge_computing: ['internet_of_things', 'cybersecurity', 'smart_manufacturing'],
  internet_of_things: ['edge_computing', 'smart_manufacturing', 'cybersecurity'],
  solid_state_batteries: ['autonomous_vehicles', 'clean_hydrogen', 'advanced_semiconductors'],
  autonomous_vehicles: ['artificial_intelligence', 'edge_computing', 'solid_state_batteries'],
  advanced_semiconductors: ['quantum_computing', 'edge_computing', 'solid_state_batteries'],
  brain_computer_interfaces: ['artificial_intelligence', 'biotechnology'],
  blockchain: ['cybersecurity', 'internet_of_things'],
  cybersecurity: ['blockchain', 'edge_computing', 'ai_agents'],
  digital_twins: ['smart_manufacturing', 'internet_of_things', 'generative_ai'],
  smart_manufacturing: ['digital_twins', 'internet_of_things', 'edge_computing'],
  space_technologies: ['autonomous_vehicles', 'advanced_semiconductors'],
}

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

  const [copied, setCopied] = useState(false)
  const domainList = useMemo(() => leaderboard.data?.leaderboard ?? [], [leaderboard.data])
  const domainIdx = useMemo(() => domainList.findIndex((r) => r.domain === slug), [domainList, slug])
  const prevDomain = domainIdx > 0 ? domainList[domainIdx - 1] : null
  const nextDomain = domainIdx >= 0 && domainIdx < domainList.length - 1 ? domainList[domainIdx + 1] : null

  const relatedSlugs = useMemo(() => (slug ? DOMAIN_RELATIONS[slug] ?? [] : []), [slug])
  const relatedFields = useMemo(() => {
    return relatedSlugs
      .map((s) => {
        const found = domainList.find((d) => d.domain === s)
        return found ? { slug: s, name: found.display_name } : null
      })
      .filter((r): r is { slug: string; name: string } => r != null)
  }, [relatedSlugs, domainList])

  const years = useMemo<number[]>(
    () => (data ? Object.keys(data.annual).map(Number).sort((a, b) => a - b) : []),
    [data],
  )
  const works = years.map((y) => data?.annual[String(y)] ?? 0)
  const patents = years.map((y) => data?.patents?.annual[String(y)] ?? null)
  const hasPatents = data?.patents != null
  const coveredYears = data?.patents?.covered_years
  const patentsTotal = data?.patents?.total ?? 0
  const patentsPeak = data?.patents?.peak_year
  const lag = data?.patents?.lag ?? null
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

  const copyMarkdownDossier = () => {
    if (!data) return
    const md = [
      `# Technology Dossier: ${data.display_name}`,
      `* Lifecycle Stage: ${data.label}`,
      `* Observatory Rank: #${rankOf ?? 'n/a'} of ${totalDomains ?? 20}`,
      `* Emergence Score: ${data.score.toFixed(1)} / 100`,
      `* Latest Works Volume: ${lastWorks != null ? lastWorks.toLocaleString() : 'n/a'} (${lastYear})`,
      `* YoY Growth: ${yoy != null ? (yoy * 100).toFixed(1) + '%' : 'n/a'}`,
      `* Forecasting Model: ${data.model ?? lbEntry?.forecast_model ?? 'n/a'}`,
      `* Patent Grants: ${hasPatents ? patentsTotal.toLocaleString() : 'None indexed'}`,
      data.caveat ? `\n> Caveat: ${data.caveat}` : '',
      `\nGenerated from Biblio-Trend Technology Observatory (${new Date().toISOString().slice(0, 10)})`,
    ].filter(Boolean).join('\n')
    navigator.clipboard.writeText(md).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const downloadJSON = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}-snapshot.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

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
    // Patent grants overlay (Phase 3.5): a second, thinner line on the
    // same year axis. Scales differ by orders of magnitude, so patents
    // render on their own hidden y-axis (proportional, not shared).
    const patentsLine = hasPatents ? patents : []

    return {
      ...baseOption(t),
      ...axes(t, { data: xLabels, boundaryGap: false }, {}),
      ...(hasPatents
        ? {
            yAxis: [
              axes(t, { data: xLabels, boundaryGap: false }, {}).yAxis,
              {
                type: 'value' as const,
                min: 0,
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { show: false },
                splitLine: { show: false },
              },
            ],
          }
        : {}),
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
        ...(hasPatents
          ? [
              {
                type: 'line' as const,
                name: 'Patent grants',
                data: patentsLine,
                yAxisIndex: 1,
                lineStyle: { width: 1.25, color: t.cat3, opacity: 0.9 },
                itemStyle: { color: t.cat3 },
                showSymbol: false,
                emphasis: { focus: 'series' as const },
              },
            ]
          : []),
      ],
    } satisfies echarts.EChartsCoreOption
  }, tokens.ink0, [data, works, forecast, intervals, hasPatents, patents])

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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <span>{data.display_name}</span>
            <StagePill label={data.label} />
          </span>
        }
        lead={
          rankOf != null && totalDomains != null ? (
            <>
              Ranks <span className="num">#{rankOf}</span> of{' '}
              <span className="num">{totalDomains}</span> domains this run.
            </>
          ) : undefined
        }
      >
        <div className="domain-actions-bar" role="toolbar" aria-label="Domain actions">
          <Link
            to={`/compare?a=${slug}&b=${prevDomain ? prevDomain.domain : 'generative_ai'}`}
            className="domain-action-btn"
            title="Compare with another domain"
          >
            <ArrowsLeftRight size={14} weight="light" aria-hidden />
            <span>Compare</span>
          </Link>
          <button
            type="button"
            className="domain-action-btn"
            onClick={copyMarkdownDossier}
            title="Copy Markdown briefing dossier"
          >
            {copied ? <Check size={14} weight="bold" aria-hidden /> : <Copy size={14} weight="light" aria-hidden />}
            <span>{copied ? 'Copied' : 'Copy Memo'}</span>
          </button>
          <button
            type="button"
            className="domain-action-btn"
            onClick={() => window.print()}
            title="Print or save PDF report"
          >
            <Printer size={14} weight="light" aria-hidden />
            <span>Print PDF</span>
          </button>
          <button
            type="button"
            className="domain-action-btn"
            onClick={downloadJSON}
            title="Download JSON snapshot data"
          >
            <DownloadSimple size={14} weight="light" aria-hidden />
            <span>JSON</span>
          </button>
        </div>

        <div className="domain-pager" aria-label="Navigate between domains">
          {prevDomain ? (
            <Link to={`/domain/${prevDomain.domain}`} className="domain-pager-btn" title={`Previous: ${prevDomain.display_name}`}>
              <ArrowLeft size={13} weight="light" aria-hidden />
              <span>{prevDomain.display_name}</span>
            </Link>
          ) : null}
          {nextDomain ? (
            <Link to={`/domain/${nextDomain.domain}`} className="domain-pager-btn" title={`Next: ${nextDomain.display_name}`}>
              <span>{nextDomain.display_name}</span>
              <ArrowRight size={13} weight="light" aria-hidden />
            </Link>
          ) : null}
        </div>

        {relatedFields.length > 0 ? (
          <div className="domain-related-bar" aria-label="Related technology domains">
            <span className="section-eyebrow">Related Fields:</span>
            <div className="domain-related-chips">
              {relatedFields.map((rel) => (
                <div key={rel.slug} className="domain-related-chip-group">
                  <Link to={`/domain/${rel.slug}`} className="domain-related-link">
                    {rel.name}
                  </Link>
                  <Link
                    to={`/compare?a=${slug}&b=${rel.slug}`}
                    className="domain-related-duel"
                    title={`Compare ${data.display_name} vs ${rel.name}`}
                  >
                    VS
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </ViewHeader>

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
          {hasPatents ? (
            <Metric
              rule
              label="Patent grants"
              value={fmtInt(patentsTotal)}
              detail={patentsPeak != null ? `peak ${fmtInt(patentsPeak)}` : undefined}
            />
          ) : null}
          <Metric rule label="Forecast model" value={fmtModel(data.model)} detail={`horizon ${horizonYears[0]}-${horizonYears[horizonYears.length - 1]}`} />
        </div>
      </div>

      <div ref={ref as unknown as React.Ref<HTMLDivElement>} className="domain-chart" />

      <p className="domain-chart-note">
        Forecast extended with {fmtModel(data.model)}; shaded band is the 68%
        prediction interval. Trained on {years[0]}-{lastYear} annual counts;
        backtest gate results are cited in the footer of every page.
        {hasPatents && coveredYears
          ? ` The second line is CPC-matched US patent grants by grant year, plotted ${coveredYears[0]}-${coveredYears[1]} only: the source has no usable classification before ${coveredYears[0]}.`
          : ''}
      </p>

      {hasPatents && data?.patents?.caveat ? (
        <div className="domain-caveat">
          <CaveatBanner kind="provenance">Patent series: {data.patents.caveat}</CaveatBanner>
        </div>
      ) : null}

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
        <h2>Score breakdown</h2>
        <p className="domain-section-intro">
          The emergence score blends five key growth signals: recent publication growth speed,
          acceleration, keyword surges, overall paper volume, and commercial patent momentum.
          It ranks how rapidly this field is developing relative to others.
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

      {hasPatents && lag ? (
        <section className="domain-section">
          <h2>Papers to patents</h2>
          <p className="domain-section-intro">
            Do patent filings follow paper output in this field? Compared on
            year-over-year growth over {lag.lag_window[0]}-{lag.lag_window[1]},
            the window where grants are complete. Correlating raw levels would
            be misleading, since both series rise steadily.
          </p>

          {lag.underpowered ? (
            <p className="domain-lag-verdict domain-lag-verdict--null">
              There are too few overlapping years to test this domain. A
              correlation on {lag.min_pairs_required - 1} or fewer points would
              need a near-perfect fit to mean anything, so none is reported.
            </p>
          ) : lag.significant && lag.best_lag_years != null && lag.best_lag_years > 0 ? (
            <p className="domain-lag-verdict">
              Papers lead patents here by about{' '}
              <span className="num">{lag.best_lag_years}</span>{' '}
              year{lag.best_lag_years === 1 ? '' : 's'}: when paper output
              accelerates, patent grants in this domain accelerate{' '}
              {lag.best_lag_years} year{lag.best_lag_years === 1 ? '' : 's'} later,
              with growth-rate correlation r ={' '}
              <span className="num">{lag.best_lag_r?.toFixed(2)}</span>. Shuffling
              the patent series reproduces an alignment that strong only{' '}
              <span className="num">{((lag.permutation_p ?? 1) * 100).toFixed(1)}%</span>{' '}
              of the time.
            </p>
          ) : lag.significant ? (
            <p className="domain-lag-verdict">
              Patents move <em>ahead</em> of papers here, by about{' '}
              <span className="num">{Math.abs(lag.best_lag_years ?? 0)}</span>{' '}
              year{Math.abs(lag.best_lag_years ?? 0) === 1 ? '' : 's'} (r ={' '}
              <span className="num">{lag.best_lag_r?.toFixed(2)}</span>, shuffle
              p ={' '}
              <span className="num">{(lag.permutation_p ?? 1).toFixed(3)}</span>).
              Filings anticipating publication is unusual and worth a second
              look before citing.
            </p>
          ) : (
            <p className="domain-lag-verdict domain-lag-verdict--null">
              {lag.best_lag_years == null || lag.best_lag_r == null ? (
                <>
                  No lead or lag is established for this domain: there is not
                  enough overlapping variation to fit a shift at all.
                </>
              ) : (
                <>
                  No lead or lag is established for this domain. The strongest
                  shift is{' '}
                  <span className="num">{lag.best_lag_years}</span>{' '}
                  year{Math.abs(lag.best_lag_years) === 1 ? '' : 's'} at r ={' '}
                  <span className="num">{lag.best_lag_r.toFixed(2)}</span>, and
                  shuffling the patent series produces an alignment at least
                  that strong{' '}
                  <span className="num">
                    {((lag.permutation_p ?? 1) * 100).toFixed(0)}%
                  </span>{' '}
                  of the time
                  {lag.at_scan_boundary
                    ? ', with the optimum sitting at the edge of the scanned range, so the true value is not identified'
                    : ''}
                  . Reporting that as a lag would be reading noise.
                </>
              )}
            </p>
          )}

          {data.patents?.lag_panel ? (
            <p className="domain-lag-note">
              Across all {data.patents.lag_panel.domains_tested} domains,{' '}
              {data.patents.lag_panel.domains_significant} clear a per-domain
              threshold of {data.patents.lag_panel.alpha_per_domain.toFixed(2)}.
              Testing that many domains would flag about{' '}
              {data.patents.lag_panel.expected_false_positives} by chance alone.
              After Bonferroni correction,{' '}
              {data.patents.lag_panel.survive_bonferroni.length === 0
                ? 'no domain survives'
                : `${data.patents.lag_panel.survive_bonferroni.join(', ')} ${
                    data.patents.lag_panel.survive_bonferroni.length === 1 ? 'survives' : 'survive'
                  }`}
              . {data.patents.lag_panel.verdict}
            </p>
          ) : null}

          <p className="domain-lag-note">
            Papers peak in {lag.papers_peak_year}
            {lag.patents_peak_year ? `, patents in ${lag.patents_peak_year}` : ''}.
            Peak years are shown for reference only; patent grants lag filings by
            1-3 years, and the final grant years are incomplete.
          </p>
        </section>
      ) : null}

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
