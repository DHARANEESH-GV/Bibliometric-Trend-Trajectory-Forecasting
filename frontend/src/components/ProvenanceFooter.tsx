/**
 * ProvenanceFooter — data sources, snapshot date, analysis windows.
 *
 * Every value is read, never typed:
 *   sources  — fixed by the pipeline (OpenAlex + BigQuery public patents)
 *   snapshot — the loaded snapshot's _meta.generated_utc / run_id
 *   windows  — lag.json.windows (papers + patents), when that file exists
 *
 * The lag windows are optional: on a snapshot without lag.json the footer
 * still renders the sources and date rather than inventing a window.
 */
import { useQuery } from '../lib/useQuery'
import { loadLag, loadLeaderboard } from '../lib/snapshots'
import { GlossaryTerm } from './GlossaryTerm'

export function ProvenanceFooter() {
  const leaderboard = useQuery(loadLeaderboard, [])
  const lag = useQuery(loadLag, [])

  const meta = leaderboard.data?._meta
  const runId = meta?.run_id ?? null
  const generated = meta?.generated_utc ?? null
  const windows = lag.data?.windows

  return (
    <aside className="provenance" aria-label="Data provenance">
      <span className="provenance-item">
        <span className="provenance-key">Data</span>
        <span>
          OpenAlex API (research papers); Google BigQuery public patent data (
          <GlossaryTerm term="cpc">CPC</GlossaryTerm>-mapped US grants)
        </span>
      </span>
      <span className="provenance-item">
        <span className="provenance-key">Snapshot</span>
        <span className="num">
          {generated ? generated.slice(0, 19).replace('T', ' ') : 'unavailable'}
          {runId ? ` \u00b7 run ${runId}` : ''}
        </span>
      </span>
      {windows ? (
        <span className="provenance-item">
          <span className="provenance-key">Windows</span>
          <span className="num">
            papers {windows.papers}; patents {windows.patents} ({windows.date_type}{' '}
            dates)
          </span>
        </span>
      ) : null}
    </aside>
  )
}
