/**
 * About — methodology and reading guide. Editorial voice; provenance
 * from the snapshot _meta lineage where rendered.
 */
import { loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { useStore } from '../lib/store'
import { ViewHeader } from '../components/ViewHeader'
import { RevealShell } from '../components/RevealShell'
import { fmtInt, fmtPct, snapshotSentence } from '../lib/format'

export function AboutView() {
  const { runId } = useStore()
  const { data, error } = useQuery(loadLeaderboard, [])

  const hw = data?.gate.hw_damped

  return (
    <RevealShell>
      <div className="about" style={{ padding: 'var(--sp-5) 0', maxWidth: '72ch' }}>
      <ViewHeader
        title={
          <>
            About this <span className="serif-accent">observatory</span>
          </>
        }
      />

      {error ? (
        <div className="panel panel--sunk" style={{ marginTop: 'var(--sp-5)' }}>
          <div className="panel-core" style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-1)' }}>
            Snapshot data did not load, so the gate figures below are omitted.
            The methodology text is unaffected. Run <code>npm run build</code> to
            regenerate the snapshots.
          </div>
        </div>
      ) : null}

      <p style={{ marginTop: 'var(--sp-4)', color: 'var(--ink-1)' }}>
        biblio-trend tracks twenty technology domains across scientific
        papers indexed by OpenAlex. It classifies each field's trajectory,
        detects keyword bursts with Kleinberg's 2-state automaton, and
        publishes forecasts that have been backtested against a naive
        baseline. This site presents the snapshot products of that
        pipeline. It is deliberately not an interactive query engine; the
        figures you see are the same artifacts the pipeline persisted.
      </p>

      <section style={{ marginTop: 'var(--sp-6)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)' }}>How to read the scores</h2>
        <p style={{ marginTop: 'var(--sp-3)', color: 'var(--ink-1)' }}>
          Each domain's emergence score blends recent growth, citation
          acceleration, novelty, keyword burst activity, and volume. The
          blend weights are configurable priors, chosen and then
          sensitivity-tested, not fitted. Stage labels describe current
          behavior: a domain is Emerging when activity is starting from a
          low base, Accelerating when it is compounding quickly, Active
          when sustained at high volume, and Watch when the signal is
          currently static or mixed.
        </p>
      </section>

      <section style={{ marginTop: 'var(--sp-6)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)' }}>What is honest here</h2>
        <ul style={{ marginTop: 'var(--sp-3)', paddingLeft: 'var(--sp-5)', color: 'var(--ink-1)' }}>
          <li>
            Forecasts are published only when a model beats the naive
            baseline on a majority of backtest series
            {hw ? (
              <>
                {' '}The current run's Holt-Winters damped forecast won{' '}
                <span className="num">
                  {fmtPct(hw.beats_naive_share, 0).replace('100%', 'all')}
                </span>{' '}
                of {hw.series} series ({hw.wins})
              </>
            ) : null}. Otherwise the naive forecast ships instead.
          </li>
          <li>
            Counts are annual, from OpenAlex works filtered by deterministic
            topic-ID sets, not free-text search. Patent series arrive with
            Phase 3.5.
          </li>
          <li>
            Where a domain's coverage is thin or its series is entangled
            with a sibling domain's, the drill-down says so in a caveat
            rather than burying it in a tooltip.
          </li>
        </ul>
      </section>

      <section style={{ marginTop: 'var(--sp-6)' }}>
        <h2 style={{ fontSize: 'var(--text-xl)' }}>Sources and method</h2>
        <p style={{ marginTop: 'var(--sp-3)', color: 'var(--ink-1)' }}>
          Papers via the OpenAlex API (topic-ID filtered, polite pool).
          Trajectories aggregate works per year, 2000-2025. Burst strength
          comes from in-house Viterbi decoding of a 2-state automaton.
          Forecasts use Holt-Winters damped trend with 68% prediction
          intervals from residual variance. The master plan records every
          locked decision and its rationale.
        </p>
      </section>

      <section className="hairline-top" style={{ marginTop: 'var(--sp-6)', paddingTop: 'var(--sp-4)' }}>
        <p className="num" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
          {snapshotSentence(runId, null)}
          {data ? ` ${fmtInt(data.leaderboard.length)} domains, run ${data._meta.run_id}.` : ''}
        </p>
        {data ? (
          <details style={{ marginTop: 'var(--sp-3)' }}>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
              Snapshot lineage (generated products)
            </summary>
            <dl
              style={{
                marginTop: 'var(--sp-3)',
                display: 'grid',
                gridTemplateColumns: 'max-content 1fr',
                gap: 'var(--sp-2) var(--sp-4)',
                fontSize: 'var(--text-xs)',
                color: 'var(--ink-2)',
              }}
            >
              {Object.entries(data._meta.lineage).map(([k, v]) => (
                <FragmentRow key={k} k={k} v={v} />
              ))}
            </dl>
          </details>
        ) : null}
      </section>
      </div>
    </RevealShell>
  )
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>{k}</dt>
      <dd style={{ margin: 0 }}>{v}</dd>
    </>
  )
}
