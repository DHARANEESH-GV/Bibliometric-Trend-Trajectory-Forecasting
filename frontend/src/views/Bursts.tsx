/**
 * Bursts — feed view over bursts.json: keyword, domain, duration,
 * strength, active-year ribbon from years[]. Sortable by
 * strength/duration/start; filterable by domain. No spike-ratio stat is
 * invented — strength + duration are the intensity signals that exist.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadBursts, loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { fmtInt } from '../lib/format'
import { ShimmerAxes } from '../components/ShimmerAxes'
import { ViewHeader } from '../components/ViewHeader'
import { RevealShell } from '../components/RevealShell'
import { CopyLink } from '../components/CopyLink'
import type { BurstEntry } from '../lib/types'

type BurstSort = 'strength' | 'duration' | 'start' | 'keyword'

function ribbon(entry: BurstEntry): { year: number; active: boolean }[] {
  const start = Math.min(entry.start, entry.years[0] ?? entry.start)
  const end = Math.max(entry.end, entry.years[entry.years.length - 1] ?? entry.end)
  const active = new Set(entry.years)
  const out: { year: number; active: boolean }[] = []
  for (let y = Math.min(start, 2000); y <= Math.max(end, 2025); y++) {
    out.push({ year: y, active: active.has(y) })
  }
  return out
}

export function BurstsView() {
  const bursts = useQuery(loadBursts, [])

  const computedLead = useMemo(() => {
    const feedX = bursts.data?.feed ?? []
    if (feedX.length === 0)
      return 'Keyword bursts highlight sudden surges in research activity, tracking terms that appeared far more often than their normal baseline.'
    const oldest = feedX.reduce((a, b) => (b.duration > a.duration ? b : a))
    return `${feedX.length} bursts detected this run. The longest-running, "${oldest.keyword}" in ${oldest.domain.replace(/_/g, ' ')}, has surged for ${oldest.duration} consecutive years.`
  }, [bursts.data])
  const leaderboard = useQuery(loadLeaderboard, [])
  const [sort, setSort] = useState<BurstSort>('strength')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [search] = useSearchParams()
  const [domainFilter, setDomainFilter] = useState<string>('all')
  const [query, setQuery] = useState('')

  // Deep-link support: /bursts?domain=slug pre-filters the feed, and
  // ?q=keyword pre-fills the search box. ?keyword= opens the cross-view
  // lookup panel for that term (shareable, no new route).
  useEffect(() => {
    const d = search.get('domain')
    if (d) setDomainFilter(d)
    const q = search.get('q')
    if (q) setQuery(q)
    const k = search.get('keyword')
    if (k) setOpenKeyword(k)
  }, [search])
  const [limit, setLimit] = useState(60)
  // Cross-view keyword lookup: which domains burst on this term.
  const [openKeyword, setOpenKeyword] = useState<string | null>(null)

  const domainNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of leaderboard.data?.leaderboard ?? []) {
      m.set(r.domain, r.display_name)
    }
    return m
  }, [leaderboard.data])

  const sorted = useMemo(() => {
    const feed = bursts.data?.feed ?? []
    const needle = query.trim().toLowerCase()
    let list =
      domainFilter === 'all' ? feed : feed.filter((b) => b.domain === domainFilter)
    if (needle) {
      list = list.filter(
        (b) =>
          b.keyword.toLowerCase().includes(needle) ||
          (domainNames.get(b.domain) ?? b.domain).toLowerCase().includes(needle),
      )
    }
    const sign = dir === 'asc' ? 1 : -1
    const cmp: Record<BurstSort, (a: BurstEntry, b: BurstEntry) => number> = {
      strength: (a, b) => a.strength - b.strength,
      duration: (a, b) => a.duration - b.duration,
      start: (a, b) => a.start - b.start,
      keyword: (a, b) => a.keyword.localeCompare(b.keyword),
    }
    list = [...list].sort((a, b) => sign * cmp[sort](a, b))
    return list
  }, [bursts.data, sort, dir, domainFilter, query, domainNames])

  const maxStrength = useMemo(
    () => Math.max(...(bursts.data?.feed ?? []).map((b) => b.strength), 1),
    [bursts.data],
  )

  const visible = sorted.slice(0, limit)

  const selectStyle = {
    font: 'inherit',
    fontSize: 'var(--text-sm)',
    color: 'var(--ink-0)',
    background: 'var(--surface-1)',
    border: 'var(--hairline)',
    borderRadius: 'var(--r-control)',
    padding: '4px 8px',
  } as const

  if (bursts.error) {
    return (
      <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-6) 0' }}>
        Live lookups unavailable. Showing cached snapshots. ({bursts.error.message})
      </p>
    )
  }

  if (bursts.loading || !bursts.data) {
    return (
      <div style={{ padding: 'var(--sp-5) 0' }}>
        <ShimmerAxes height={420} label="Loading bursts" />
      </div>
    )
  }

  const feedEmpty = sorted.length === 0

  return (
    <RevealShell rowSelector=".burst-row">
      <div className="bursts-view">
      <ViewHeader
        title={
          <>
            Keyword <span className="serif-accent">bursts</span>
          </>
        }
        lead={computedLead}
      >
        <div className="bursts-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'center' }}>
          <label>
            <span className="visually-hidden">Search keywords</span>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setLimit(60)
              }}
              placeholder="Search keywords…"
              className="bursts-search"
              style={selectStyle}
            />
          </label>
          <label>
            Domain{' '}
            <select
              value={domainFilter}
              onChange={(e) => {
                setDomainFilter(e.target.value)
                setLimit(60)
              }}
              style={selectStyle}
            >
              <option value="all">All domains</option>
              {[...domainNames.entries()].map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort{' '}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as BurstSort)}
              style={selectStyle}
            >
              <option value="strength">Strength</option>
              <option value="duration">Duration</option>
              <option value="start">Start year</option>
              <option value="keyword">Keyword</option>
            </select>
          </label>
          <button
            onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            aria-label={`Sort direction ${dir === 'asc' ? 'ascending' : 'descending'}, click to flip`}
            style={{ border: 'var(--hairline)', borderRadius: 'var(--r-control)', padding: '4px 10px', fontSize: 'var(--text-sm)' }}
          >
            {dir === 'asc' ? '↑' : '↓'}
          </button>
          <CopyLink />
        </div>
      </ViewHeader>

      {feedEmpty ? (
        <div className="bursts-empty" role="status">
          <svg
            width={120}
            height={36}
            aria-hidden
            style={{ display: 'block', marginBottom: 'var(--sp-3)' }}
          >
            <line x1={4} y1={30} x2={30} y2={26} stroke="var(--ink-3)" strokeWidth={1.25} strokeLinecap="round" />
            <line x1={30} y1={26} x2={56} y2={28} stroke="var(--ink-3)" strokeWidth={1.25} strokeLinecap="round" />
            <line x1={56} y1={28} x2={82} y2={22} stroke="var(--ink-3)" strokeWidth={1.25} strokeLinecap="round" />
            <line x1={82} y1={22} x2={108} y2={24} stroke="var(--ink-3)" strokeWidth={1.25} strokeLinecap="round" strokeDasharray="3 3" />
            <circle cx={82} cy={22} r={2.5} fill="var(--ink-3)" />
          </svg>
          <p style={{ margin: 0 }}>
            This filter matches no bursts in the current snapshot. Try all
            domains. No domain carries a zero count across the full series,
            but single keywords come and go.
          </p>
        </div>
      ) : (
        <>
          <p className="bursts-legend">
            <span
              aria-hidden
              className="bursts-legend-swatch"
              style={{ background: 'var(--stage-accelerating)' }}
            />
            short burst (3 yr or less)
            <span
              aria-hidden
              className="bursts-legend-swatch"
              style={{ background: 'var(--stage-active)', marginLeft: 'var(--sp-3)' }}
            />
            mid
            <span
              aria-hidden
              className="bursts-legend-swatch"
              style={{ background: 'var(--stage-emerging)', marginLeft: 'var(--sp-3)' }}
            />
            sustained (12 yr or more)
          </p>
          <ul role="list" className="bursts-feed">
            {visible.map((b) => (
              <li
                key={`${b.domain}-${b.keyword}-${b.start}`}
                className="burst-row hover-surface"
              >
                <span className="burst-keyword">
                  <button
                    type="button"
                    className="keyword-lookup"
                    aria-expanded={openKeyword === b.keyword}
                    aria-controls={openKeyword === b.keyword ? 'keyword-panel' : undefined}
                    onClick={() => setOpenKeyword((cur) => (cur === b.keyword ? null : b.keyword))}
                    title="Which domains burst on this term?"
                  >
                    {b.keyword}
                  </button>
                </span>
                <span className="burst-domain">
                  <Link to={`/domain/${b.domain}`}>
                    {domainNames.get(b.domain) ?? b.domain}
                  </Link>
                </span>
                <span className="num burst-duration">
                  {b.duration} yr
                </span>
                <span className="num" aria-label={`Burst strength ${b.strength.toFixed(1)}, duration ${b.duration} years`}>
                  <span
                    aria-hidden
                    className={`burst-strength-bar ${b.duration <= 3 ? 'burst-strength-bar--short' : b.duration >= 12 ? 'burst-strength-bar--long' : ''}`}
                    style={{ width: `${Math.min(100, (b.strength / maxStrength) * 100)}%`, maxWidth: 70 }}
                  />
                  {b.strength.toFixed(1)}
                </span>
                <YearRibbon entry={b} />
              </li>
            ))}
          </ul>
          {openKeyword ? (
            <KeywordPanel
              keyword={openKeyword}
              feed={bursts.data?.feed ?? []}
              domainNames={domainNames}
              onClose={() => setOpenKeyword(null)}
            />
          ) : null}
          {visible.length < sorted.length ? (
            <div className="bursts-more">
              <button onClick={() => setLimit((l) => l + 60)}>
                Show more ({fmtInt(sorted.length - visible.length)} remain)
              </button>
            </div>
          ) : (
            <p className="num bursts-end">
              End of feed. {fmtInt(sorted.length)} bursts
              {domainFilter !== 'all' ? ` for ${domainNames.get(domainFilter) ?? domainFilter}` : ''}.
            </p>
          )}
        </>
      )}
      </div>
    </RevealShell>
  )
}

function YearRibbon({ entry }: { entry: BurstEntry }) {
  const cells = ribbon(entry)
  const first = cells[0]?.year
  const last = cells[cells.length - 1]?.year
  if (first == null || last == null) return null

  // One element, not 26: the ribbon was previously a span per year, which
  // cost ~1,560 DOM nodes across the 60 visible rows for a purely
  // decorative shape. A repeating gradient draws the same active/inactive
  // run at zero node cost. The exact years remain in the aria-label, so
  // nothing is lost for assistive tech.
  const span = Math.max(last - first + 1, 1)
  const step = 100 / span
  const stops: string[] = []
  cells.forEach((c, i) => {
    const from = (i * step).toFixed(3)
    const to = ((i + 1) * step).toFixed(3)
    const colour = c.active ? 'var(--stage-active)' : 'var(--surface-2)'
    stops.push(`${colour} ${from}%`, `${colour} ${to}%`)
  })

  return (
    <span className="ribbon-wrap">
      <span
        role="img"
        aria-label={`Active ${entry.start} through ${entry.end} (${entry.duration} years)`}
        className="num ribbon-bar"
        style={{
          backgroundImage: `linear-gradient(to right, ${stops.join(', ')})`,
        }}
      />
      <span className="ribbon-axis num" aria-hidden>
        <span>{first}</span>
        <span>{last}</span>
      </span>
    </span>
  )
}

/**
 * KeywordPanel — the cross-view lookup: which domains burst on this term.
 * Inline (not a modal), so the feed stays in place. Every figure comes
 * from the same feed rows; domains link to their drill-downs.
 */
function KeywordPanel({
  keyword,
  feed,
  domainNames,
  onClose,
}: {
  keyword: string
  feed: BurstEntry[]
  domainNames: Map<string, string>
  onClose: () => void
}) {
  const matches = useMemo(
    () =>
      feed
        .filter((b) => b.keyword.toLowerCase() === keyword.toLowerCase())
        .sort((a, b) => b.strength - a.strength),
    [feed, keyword],
  )

  return (
    <section
      id="keyword-panel"
      className="panel keyword-panel"
      aria-label={`Domains bursting on ${keyword}`}
    >
      <div className="panel-core">
        <div className="keyword-panel-head">
          <h3>
            Domains bursting on <em>{keyword}</em>
          </h3>
          <button type="button" className="island-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {matches.length === 0 ? (
          <p className="keyword-panel-empty">
            No burst on this term in the current snapshot.
          </p>
        ) : (
          <ul className="keyword-panel-list">
            {matches.map((m) => (
              <li key={`${m.domain}-${m.start}`} className="keyword-panel-row">
                <Link to={`/domain/${m.domain}`} className="keyword-panel-domain">
                  {domainNames.get(m.domain) ?? m.domain}
                </Link>
                <span className="num keyword-panel-meta">
                  {m.start}-{m.end}, {m.duration} yr, strength {m.strength.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
