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
      return 'Kleinberg burst detection marks stretches of years when a keyword appeared far more often in a domain\u2019s papers than its baseline rate.'
    const oldest = feedX.reduce((a, b) => (b.duration > a.duration ? b : a))
    return `${feedX.length} bursts detected this run. The oldest \u2014 \u201c${oldest.keyword}\u201d in ${oldest.domain.replace(/_/g, ' ')} \u2014 has burned for ${oldest.duration} straight years.`
  }, [bursts.data])
  const leaderboard = useQuery(loadLeaderboard, [])
  const [sort, setSort] = useState<BurstSort>('strength')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [search] = useSearchParams()
  const [domainFilter, setDomainFilter] = useState<string>('all')

  // Deep-link support: /bursts?domain=slug pre-filters the feed.
  useEffect(() => {
    const d = search.get('domain')
    if (d) setDomainFilter(d)
  }, [search])
  const [limit, setLimit] = useState(60)

  const domainNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of leaderboard.data?.leaderboard ?? []) {
      m.set(r.domain, r.display_name)
    }
    return m
  }, [leaderboard.data])

  const sorted = useMemo(() => {
    const feed = bursts.data?.feed ?? []
    let list =
      domainFilter === 'all' ? feed : feed.filter((b) => b.domain === domainFilter)
    const sign = dir === 'asc' ? 1 : -1
    const cmp: Record<BurstSort, (a: BurstEntry, b: BurstEntry) => number> = {
      strength: (a, b) => a.strength - b.strength,
      duration: (a, b) => a.duration - b.duration,
      start: (a, b) => a.start - b.start,
      keyword: (a, b) => a.keyword.localeCompare(b.keyword),
    }
    list = [...list].sort((a, b) => sign * cmp[sort](a, b))
    return list
  }, [bursts.data, sort, dir, domainFilter])

  const visible = sorted.slice(0, limit)

  const selectStyle = {
    font: 'inherit',
    fontSize: 'var(--text-sm)',
    color: 'var(--ink-0)',
    background: 'var(--surface-1)',
    border: 'var(--hairline)',
    borderRadius: 2,
    padding: '4px 8px',
  } as const

  if (bursts.error) {
    return (
      <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-6) 0' }}>
        Live lookups unavailable — showing cached snapshots. ({bursts.error.message})
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
    <div style={{ padding: 'var(--sp-5) 0' }}>
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--sp-4)',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Keyword bursts</h1>
          <p style={{ color: 'var(--ink-2)', marginTop: 'var(--sp-1)', fontSize: 'var(--text-sm)', maxWidth: '72ch' }}>
{computedLead}
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'center' }}>
          <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
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
          <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
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
            aria-label={`Sort direction ${dir === 'asc' ? 'ascending' : 'descending'} — click to flip`}
            style={{ border: 'var(--hairline)', borderRadius: 2, padding: '4px 10px', fontSize: 'var(--text-sm)' }}
          >
            {dir === 'asc' ? '↑' : '↓'}
          </button>
          <CopyLink />
        </div>
      </header>

      {feedEmpty ? (
        <p style={{ color: 'var(--ink-2)', padding: 'var(--sp-7) 0' }}>
          This filter matches no bursts in the current snapshot. Try all
          domains — no domain carries a zero count across the full series,
          but single keywords come and go.
        </p>
      ) : (
        <>
          <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visible.map((b) => (
              <li
                key={`${b.domain}-${b.keyword}-${b.start}`}
                className="hairline-bottom"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) 5.5rem 6rem minmax(160px, 1.2fr)',
                  gap: 'var(--sp-4)',
                  alignItems: 'center',
                  padding: 'var(--sp-3) var(--sp-2)',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <strong style={{ fontWeight: 500 }}>{b.keyword}</strong>
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink-2)', fontSize: 'var(--text-sm)' }}>
                  <Link to={`/domain/${b.domain}`} style={{ color: 'inherit' }}>
                    {domainNames.get(b.domain) ?? b.domain}
                  </Link>
                </span>
                <span className="num" style={{ color: 'var(--ink-1)' }}>
                  {b.duration} yr
                </span>
                <span className="num" aria-label={`Burst strength ${b.strength.toFixed(1)}`}>
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-block',
                      width: `${Math.min(100, (b.strength / 26) * 100)}%`,
                      maxWidth: 70,
                      height: 3,
                      verticalAlign: 'middle',
                      background: 'var(--stage-active)',
                      marginRight: 6,
                    }}
                  />
                  {b.strength.toFixed(1)}
                </span>
                <YearRibbon entry={b} />
              </li>
            ))}
          </ul>
          {visible.length < sorted.length ? (
            <div style={{ marginTop: 'var(--sp-5)', textAlign: 'center' }}>
              <button
                onClick={() => setLimit((l) => l + 60)}
                style={{
                  border: 'var(--hairline-strong)',
                  borderRadius: 2,
                  padding: '6px 18px',
                  fontSize: 'var(--text-sm)',
                }}
              >
                Show more ({fmtInt(sorted.length - visible.length)} remain)
              </button>
            </div>
          ) : (
            <p className="num" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', marginTop: 'var(--sp-4)' }}>
              End of feed. {fmtInt(sorted.length)} bursts
              {domainFilter !== 'all' ? ` for ${domainNames.get(domainFilter) ?? domainFilter}` : ''}.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function YearRibbon({ entry }: { entry: BurstEntry }) {
  const cells = ribbon(entry)
  return (
    <span
      role="img"
      aria-label={`Active ${entry.start} through ${entry.end} (${entry.duration} years)`}
      className="num"
      style={{
        display: 'flex',
        gap: 1,
        height: 12,
        alignItems: 'stretch',
      }}
    >
      {cells.map((c) => (
        <span
          key={c.year}
          title={`${c.year}${c.active ? ' (burst)' : ''}`}
          style={{
            flex: 1,
            background: c.active ? 'var(--stage-active)' : 'var(--surface-2)',
          }}
        />
      ))}
    </span>
  )
}
