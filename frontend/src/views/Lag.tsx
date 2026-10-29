/**
 * Lag — "Paper growth and patent grants".
 *
 * Every number on this page is read from snapshots/lag.json, which is a
 * reshape of data/lag/lag_results.json. Nothing is recomputed or hardcoded
 * in the browser.
 *
 * Wording is deliberately careful and enforced by tests:
 *   - never "papers lead patents by N quarters"
 *   - never "research-to-patent lag"
 * Grant dates include examination pendency, so this is an association between
 * two contemporaneous-ish administrative series, not a discovery-to-invention
 * clock.
 */
import { useMemo, useState } from 'react'
import { loadLag } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useTokens } from '../lib/useTokens'
import { baseOption, axes, tooltip, useChart, type ThemeTokens } from '../charts/echarts'
import { ViewHeader } from '../components/ViewHeader'
import { Metric } from '../components/Metric'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { CopyLink } from '../components/CopyLink'
import { RevealShell } from '../components/RevealShell'
import { HowToRead } from '../components/HowToRead'
import { GlossaryTerm } from '../components/GlossaryTerm'
import { rAtLag, shiftPatentsForPlot } from '../lib/lagmath'
import type { LagDomain, LagFile, LagRobustness } from '../lib/types'
import './lag.css'

const fmtR = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(2)
const fmtP = (v: number) => (v < 0.001 ? '<0.001' : v.toFixed(3))

export function LagView() {
  const { data, loading, error } = useQuery<LagFile>(loadLag, [])

  if (error) {
    return (
      <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-6) 0' }}>
        Lag results unavailable in this snapshot. ({error.message})
      </p>
    )
  }
  if (loading || !data) {
    return (
      <div style={{ padding: 'var(--sp-5) 0' }}>
        <ShimmerAxes height={420} label="Loading lag analysis" />
      </div>
    )
  }

  const { pooled, counts } = data
  const lagLo = pooled.best_lag_ci[0]
  const lagHi = pooled.best_lag_ci[1]
  const peakLo = pooled.ci_lo[pooled.best_lag]
  const peakHi = pooled.ci_hi[pooled.best_lag]

  // Count comes from the robustness block, never a literal, so the sentence
  // stays correct if the low-confidence set changes.
  const nLowConfDropped = data.robustness?.drop_low_confidence?.dropped
    ? (Array.isArray(data.robustness.drop_low_confidence.dropped)
        ? data.robustness.drop_low_confidence.dropped.length
        : 1)
    : 0

  return (
    <RevealShell>
      <div style={{ padding: 'var(--sp-5) 0' }}>
        <ViewHeader
          title={
            <>
              Paper growth and <span className="serif-accent">patent grants</span>
            </>
          }
          lead={
            <>
              Across {counts.n_domains} domains, growth in research papers shows
              a weak association with growth in granted patents, with the peak
              roughly {lagLo} to {lagHi} quarters later (pooled correlation{' '}
              {fmtR(pooled.best_r)}). The location of the peak is stable under
              every robustness check, but its statistical significance is
              fragile.
            </>
          }
        >
          <CopyLink />
        </ViewHeader>

        <div className="lag-summary">
          <p className="lag-statement">
            Individually, only {counts.n_significant} of {counts.n_domains}{' '}
            domains is significant, about what chance alone would produce; this
            is a pooled signal.
          </p>
          <p className="lag-statement lag-statement--muted">
            {fmtR(peakLo)} to {fmtR(peakHi)} is the 95% CI when resampling
            domains (assumes domains are independent, which they are not).
          </p>
          {data.robustness ? (
            <p className="lag-statement lag-statement--muted">
              Under a time-block bootstrap the interval (
              {`${fmtR(data.robustness.time_block_bootstrap.ci_at_peak[0])} to ${fmtR(data.robustness.time_block_bootstrap.ci_at_peak[1])}`}
              ) includes zero, and when the{' '}
              {nLowConfDropped} low-confidence domains are dropped the placebo
              test no longer separates the true pairing. Treat this as
              suggestive, not conclusive.
            </p>
          ) : null}
          <p className="lag-statement lag-statement--muted">
            Grant dates include patent examination time, so this is not a
            research-to-invention lag.
          </p>
        </div>

        <div className="lag-strip">
          <Metric
            label="Pooled correlation"
            value={fmtR(pooled.best_r)}
            detail={`at ${pooled.best_lag} quarters`}
            rule
          />
          <Metric
            label="95% CI (domain resampling)"
            value={`${fmtR(peakLo)} to ${fmtR(peakHi)}`}
            detail={
              pooled.peak_excludes_zero
                ? 'excludes zero per domain resampling'
                : 'includes zero'
            }
            rule
          />
          <Metric
            label="Permutation p"
            value={fmtP(pooled.perm_p)}
            detail={`${data.method.permutations as number} circular shifts`}
            rule
          />
          <Metric
            label="Significant domains"
            value={`${counts.n_significant} / ${counts.n_domains}`}
            detail="about chance"
            rule
          />
        </div>

        <HowToRead variant="lag" />

        <PooledChart data={data} />

        <Robustness robust={data.robustness} />

        <section className="lag-section" aria-labelledby="lag-domains-title">
          <h2 id="lag-domains-title" className="lag-section-title">
            Exploratory (low statistical power)
          </h2>
          <p className="lag-section-lead">
            One panel per domain: paper growth and patent growth on a shared
            normalized timeline. Best lag and permutation p are the per-domain
            values from the same scan as the pooled curve. A single domain
            carries too few independent quarters to settle the question, so
            these are exploratory rather than confirmatory.
          </p>
          <div className="lag-panel-grid">
            {data.domains.map((d) => (
              <DomainPanel key={d.domain} d={d} />
            ))}
          </div>
        </section>

        <p className="lag-footnote">
          Paper counts come from a single OpenAlex API snapshot; quantum
          computing totals here differ about 12% from the leaderboard because
          OpenAlex reassigned topics after the September crawl.
        </p>

        <details className="lag-section">
          <summary className="lag-section-title" style={{ cursor: 'pointer' }}>
            Method and caveats
          </summary>
          <ul style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)', lineHeight: 'var(--leading-body)', paddingLeft: '1.1em' }}>
            {data.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="lag-note">
            Windows: papers {data.windows.papers}, patents {data.windows.patents}{' '}
            ({data.windows.date_type} dates). Rolling 4-quarter sums, then
            year-over-year log growth.
          </p>
        </details>
      </div>
    </RevealShell>
  )
}

/** Pooled correlation-by-lag curve with the CI band and the placebo p95. */
function PooledChart({ data }: { data: LagFile }) {
  const tokens = useTokens()
  const { pooled, placebo } = data

  const { ref } = useChart(
    (t: ThemeTokens) => ({
      ...baseOption(t),
      grid: { left: 8, right: 20, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        ...tooltip(t),
        formatter: (params: unknown) => {
          const arr = params as Array<{ dataIndex: number }>
          const i = arr[0]?.dataIndex ?? 0
          return [
            `<strong>${i} quarters</strong>`,
            `pooled r ${fmtR(pooled.curve[i])}`,
            `95% CI ${fmtR(pooled.ci_lo[i])} to ${fmtR(pooled.ci_hi[i])}`,
            `placebo p95 ${fmtR(placebo.placebo_p95_peak)}`,
          ].join('<br/>')
        },
      },
      xAxis: {
        ...axes(t).xAxis,
        type: 'category' as const,
        data: pooled.curve.map((_, i) => String(i)),
        name: 'quarters',
        nameLocation: 'middle' as const,
        nameGap: 26,
        nameTextStyle: { color: t.ink2, fontFamily: t.fontMono, fontSize: 11 },
      },
      yAxis: {
        ...axes(t).yAxis,
        min: -0.25,
        max: 0.45,
        name: 'correlation',
        nameTextStyle: { color: t.ink2, fontFamily: t.fontMono, fontSize: 11 },
      },
      series: [
        // CI band: lower bound, invisible, stacked with the difference.
        {
          name: 'ci-lower',
          type: 'line',
          data: pooled.ci_lo,
          lineStyle: { opacity: 0 },
          stack: 'ci',
          symbol: 'none',
          silent: true,
          z: 1,
        },
        {
          name: '95% CI',
          type: 'line',
          data: pooled.ci_hi.map((hi, i) => Number((hi - (pooled.ci_lo[i] ?? hi)).toFixed(4))),
          lineStyle: { opacity: 0 },
          areaStyle: { color: t.forecastBand },
          stack: 'ci',
          symbol: 'none',
          silent: true,
          z: 1,
        },
        {
          name: 'Placebo 95th percentile',
          type: 'line',
          data: pooled.curve.map(() => placebo.placebo_p95_peak),
          lineStyle: { color: t.ink3, type: 'dashed', width: 1 },
          symbol: 'none',
          silent: true,
          z: 2,
        },
        {
          name: 'Pooled correlation',
          type: 'line',
          data: pooled.curve.map((v) => Number(v.toFixed(4))),
          lineStyle: { color: t.accent, width: 2 },
          itemStyle: { color: t.accent },
          symbol: 'circle',
          symbolSize: 5,
          z: 3,
          markLine: {
            silent: true,
            symbol: 'none',
            label: {
              formatter: `peak ${pooled.best_lag}q`,
              color: t.ink2,
              fontFamily: t.fontMono,
              fontSize: 10,
              position: 'insideEndTop',
            },
            lineStyle: { color: t.ink3, type: 'dashed', width: 1 },
            data: [{ xAxis: String(pooled.best_lag) }],
          },
        },
        {
          name: 'zero',
          type: 'line',
          data: pooled.curve.map(() => 0),
          lineStyle: { color: t.gridMajor, width: 1 },
          symbol: 'none',
          silent: true,
          z: 1,
        },
      ],
    }),
    tokens.ink0,
    [data],
  )

  return (
    <section className="lag-chart" aria-labelledby="lag-chart-title">
      <div className="lag-chart-head">
        <h2 id="lag-chart-title" className="lag-chart-title">
          Correlation by lag
        </h2>
        <div className="lag-chart-legend">
          <span className="lag-legend-item">
            <span className="lag-legend-swatch" style={{ borderTopColor: 'var(--accent)' }} aria-hidden />
            pooled correlation
          </span>
          <span className="lag-legend-item">
            <span className="lag-legend-swatch lag-legend-swatch--band" aria-hidden />
            95% CI (domain bootstrap)
          </span>
          <span className="lag-legend-item">
            <span className="lag-legend-swatch lag-legend-swatch--dashed" aria-hidden />
            placebo 95th percentile
          </span>
        </div>
      </div>
      <div
        ref={ref as unknown as React.Ref<HTMLDivElement>}
        style={{ width: '100%', height: 320 }}
        role="img"
        aria-label={`Pooled correlation by lag, peak ${fmtR(pooled.best_r)} at ${pooled.best_lag} quarters, placebo 95th percentile ${fmtR(placebo.placebo_p95_peak)}`}
      />
    </section>
  )
}

/** One domain's two growth series on a shared normalized axis. */
function DomainPanel({ d }: { d: LagDomain }) {
  const tokens = useTokens()
  const series = d.series
  const sig = d.significant_05
  // Slider position starts at the pipeline's stored best lag so the panel
  // opens on the published alignment; the user can then explore any k.
  const [k, setK] = useState<number>(d.best_lag ?? 0)

  const papers = series?.papers_z ?? []
  const patents = series?.patents_z ?? []
  // Live r(k) in the browser, from the same series the pipeline used. The
  // test suite pins this to the stored curve.
  const liveR = useMemo(
    () => (series ? rAtLag(papers, patents, k) : 0),
    [series, papers, patents, k],
  )
  const shiftedPatents = useMemo(
    () => (series ? shiftPatentsForPlot(patents, k) : []),
    [series, patents, k],
  )

  const { ref } = useChart(
    (t: ThemeTokens) => {
      const quarters = series?.quarters ?? []
      return {
        ...baseOption(t),
        animation: false,
        grid: { left: 4, right: 8, top: 10, bottom: 4, containLabel: false },
        tooltip: { ...tooltip(t), show: true },
        xAxis: {
          type: 'category' as const,
          data: quarters,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        yAxis: {
          type: 'value' as const,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        series: [
          {
            name: 'papers',
            type: 'line',
            data: papers,
            lineStyle: { color: t.accent, width: 1.5 },
            itemStyle: { color: t.accent },
            symbol: 'none',
            smooth: false,
          },
          {
            name: 'patents',
            type: 'line',
            // nulls (not zeros) where the shift pushes points off the axis
            data: shiftedPatents,
            connectNulls: false,
            lineStyle: { color: t.cat2, width: 1.5, type: 'dashed' },
            itemStyle: { color: t.cat2 },
            symbol: 'none',
            smooth: false,
          },
        ],
      }
    },
    tokens.ink0,
    [d.domain, series, k],
  )

  return (
    <article className={`lag-domain${d.low_confidence ? ' lag-domain--lowconf' : ''}`}>
      <div className="lag-domain-head">
        <span className="lag-domain-name" title={d.display_name}>
          {d.display_name}
        </span>
        {sig ? (
          <span className="lag-badge lag-badge--sig">significant</span>
        ) : (
          <span className="lag-badge">not significant</span>
        )}
      </div>
      {series ? (
        <div
          ref={ref as unknown as React.Ref<HTMLDivElement>}
          style={{ width: '100%', height: 68 }}
          role="img"
          aria-label={`${d.display_name}: paper growth and patent growth, ${series.quarters.length} quarters, patent series shifted ${k} quarters earlier. Correlation ${fmtR(liveR)}. Stored best lag ${d.best_lag} quarters at r ${fmtR(d.best_r)}, p ${fmtP(d.perm_p)}.`}
        />
      ) : (
        <p className="lag-note">Series unavailable for this domain.</p>
      )}
      {series ? (
        <div className="lag-slider">
          <label htmlFor={`k-${d.domain}`}>shift</label>
          <input
            id={`k-${d.domain}`}
            type="range"
            min={0}
            max={12}
            step={1}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
            aria-valuetext={`${k} quarters earlier`}
            aria-describedby={`kval-${d.domain}`}
          />
          <span className="lag-slider-r" id={`kval-${d.domain}`}>
            k={k} r={fmtR(liveR)}
          </span>
        </div>
      ) : null}
      <div className="lag-domain-stats">
        <span className="num">lag {d.best_lag ?? 'n/a'}q</span>
        <span className="num">r {fmtR(d.best_r)}</span>
        <span className="num">p {fmtP(d.perm_p)}</span>
        <span className="num">{d.n_points} pts</span>
        {k === d.best_lag ? (
          <span className="lag-badge lag-best">best k</span>
        ) : (
          <button
            type="button"
            className="lag-badge"
            onClick={() => setK(d.best_lag ?? 0)}
          >
            reset to best
          </button>
        )}
        {d.low_confidence ? (
          <span className="lag-badge lag-badge--lowconf">low confidence</span>
        ) : null}
      </div>
    </article>
  )
}

/** Step 1 robustness results, read verbatim from the JSON. */
function Robustness({ robust }: { robust: LagRobustness | null }) {
  if (!robust) return null
  const { leave_one_domain_out: lodo } = robust
  const s = lodo.summary

  const yes = (b: boolean) => (
    <span className={b ? 'lag-robust-yes' : 'lag-robust-no'}>{b ? 'yes' : 'no'}</span>
  )

  const rows = [
    {
      label: 'Baseline (all domains)',
      n: robust.baseline.n_domains,
      lag: robust.baseline.best_lag,
      r: robust.baseline.peak_r,
      ci: robust.baseline.ci_at_peak,
      zero: robust.baseline.ci_excludes_zero,
      band: robust.baseline.peak_in_3_6,
    },
    {
      label: 'Drop nested domains',
      n: robust.drop_nested.n_domains,
      lag: robust.drop_nested.best_lag,
      r: robust.drop_nested.peak_r,
      ci: robust.drop_nested.ci_at_peak,
      zero: robust.drop_nested.ci_excludes_zero,
      band: robust.drop_nested.peak_in_3_6,
    },
    {
      label: 'Drop low-confidence domains',
      n: robust.drop_low_confidence.n_domains,
      lag: robust.drop_low_confidence.best_lag,
      r: robust.drop_low_confidence.peak_r,
      ci: robust.drop_low_confidence.ci_at_peak,
      zero: robust.drop_low_confidence.ci_excludes_zero,
      band: robust.drop_low_confidence.peak_in_3_6,
    },
  ]

  const tb = robust.time_block_bootstrap

  return (
    <section className="lag-section" aria-labelledby="lag-robust-title">
      <h2 id="lag-robust-title" className="lag-section-title">
        Robustness
      </h2>
      <p className="lag-section-lead">
        The peak is checked against four perturbations, including a{' '}
        <GlossaryTerm term="placebo test" /> that re-pairs each domain&rsquo;s
        papers with another domain&rsquo;s patents. A result that survives only
        the baseline would not be worth showing.
      </p>
      <div className="lag-robust-scroll">
        <table className="lag-robust">
          <thead>
            <tr>
              <th scope="col">Perturbation</th>
              <th scope="col">Domains</th>
              <th scope="col">Peak lag</th>
              <th scope="col">Peak r</th>
              <th scope="col">95% CI</th>
              <th scope="col">CI excludes 0</th>
              <th scope="col">Peak in 3-6</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.n}</td>
                <td className="num">{r.lag}</td>
                <td className="num">{fmtR(r.r)}</td>
                <td className="num">
                  {fmtR(r.ci[0])} to {fmtR(r.ci[1])}
                </td>
                <td>{yes(r.zero)}</td>
                <td>{yes(r.band)}</td>
              </tr>
            ))}
            <tr>
              <td>Leave one domain out (range)</td>
              <td className="num">{robust.baseline.n_domains} refits</td>
              <td className="num">
                {s.best_lag_min} to {s.best_lag_max}
              </td>
              <td className="num">
                {fmtR(s.peak_r_min)} to {fmtR(s.peak_r_max)}
              </td>
              <td className="num">all refits</td>
              <td>{yes(s.all_ci_exclude_zero)}</td>
              <td>{yes(s.all_peaks_in_3_6)}</td>
            </tr>
            <tr>
              <td>Time-block bootstrap ({tb.block_quarters}-quarter blocks)</td>
              <td className="num">{tb.n_draws} draws</td>
              <td className="num">{tb.lag_used}</td>
              <td className="num">{fmtR(tb.mean_r)}</td>
              <td className="num">
                {fmtR(tb.ci_at_peak[0])} to {fmtR(tb.ci_at_peak[1])}
              </td>
              <td>{yes(tb.ci_excludes_zero)}</td>
              <td>{yes(tb.peak_in_3_6)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="lag-note">
        The peak stays in the 3 to 6 quarter band under every perturbation. The
        resampling CI excludes zero for the domain-level checks; the
        time-block bootstrap, which perturbs the time axis rather than the
        domain set, does not ({fmtR(tb.ci_at_peak[0])} to{' '}
        {fmtR(tb.ci_at_peak[1])}), so the strength of the association depends on
        which dependence structure you assume.
      </p>
    </section>
  )
}
