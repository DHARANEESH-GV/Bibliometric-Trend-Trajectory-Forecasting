/**
 * RankBumps — bump chart of domain ranks across 2000-2025, derived from
 * matrix.json cells (per-year works counts ranked within each year).
 * The leaderboard's storyline: fields crossing over 25 years. Inline SVG
 * (hand-rolled, same language as Sparkline), hover highlights a domain's
 * line, click opens the drill-down. Reduced motion: lines draw instantly.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadLeaderboard } from '../lib/snapshots'
import { useQuery } from '../lib/useQuery'
import { fmtInt } from '../lib/format'
import type { MatrixFile } from '../lib/types'

const W = 920
const H = 420
const PAD_L = 64
const PAD_R = 120
const PAD_T = 24
const PAD_B = 32

export function RankBumps({ data }: { data: MatrixFile }) {
  const [hot, setHot] = useState<string | null>(null)
  const { data: lb } = useQuery(loadLeaderboard, [])

  // Display names come from the leaderboard file; slugs are the fallback.
  const labels = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of lb?.leaderboard ?? []) m.set(r.domain, r.display_name)
    for (const d of data.domains) if (!m.has(d)) m.set(d, d.replace(/_/g, ' '))
    return m
  }, [lb, data.domains])

  const { years, ranksByDomain, maxRank } = useMemo(() => {
    const years = data.years
    const ranksByDomain = new Map<string, number[]>()
    let maxRank = 1
    years.forEach((_, yi) => {
      const ordered = data.domains
        .map((d) => ({ d, c: data.cells[d]?.[yi] ?? 0 }))
        .sort((a, b) => b.c - a.c)
      ordered.forEach((row, i) => {
        const arr = ranksByDomain.get(row.d) ?? []
        arr.push(i + 1)
        ranksByDomain.set(row.d, arr)
        if (i + 1 > maxRank) maxRank = i + 1
      })
    })
    return { years, ranksByDomain, maxRank }
  }, [data])

  const x = (yi: number) => PAD_L + (yi / Math.max(1, years.length - 1)) * (W - PAD_L - PAD_R)
  const y = (rank: number) => PAD_T + ((rank - 1) / Math.max(1, maxRank - 1)) * (H - PAD_T - PAD_B)

  return (
    <section className="panel panel--sunk rank-bumps" aria-label="Domain rank crossings, 2000-2025">
      <div className="panel-core">
        <div className="rank-bumps-head">
          <h2>Rank crossings, 2000-2025</h2>
          <p className="rank-bumps-note">
            Each line is a domain's rank by works published that year, derived
            from the matrix cells. Crossings are the story: fields overtaking
            fields.
          </p>
        </div>
        <div className="rank-bumps-scroll">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: 'block', width: '100%', height: 'auto' }}
            role="img"
            aria-label="Bump chart of domain ranks by year. Hover a line to highlight a domain; use the links on the right to open a drill-down."
          >
            {/* Year gridlines + epoch labels */}
            {years.map((yr, yi) =>
              yr % 5 === 0 ? (
                <g key={yr}>
                  <line
                    x1={x(yi)}
                    y1={PAD_T}
                    x2={x(yi)}
                    y2={H - PAD_B}
                    stroke="var(--grid-minor)"
                    strokeWidth={1}
                  />
                  <text
                    x={x(yi)}
                    y={H - PAD_B + 16}
                    textAnchor="middle"
                    fill="var(--ink-3)"
                    fontSize={10}
                    fontFamily="var(--font-mono)"
                  >
                    {yr}
                  </text>
                </g>
              ) : null,
            )}
            {/* Rank gridlines */}
            {[1, 5, 10, 15, 20].filter((r) => r <= maxRank).map((r) => (
              <text
                key={r}
                x={PAD_L - 10}
                y={y(r) + 3}
                textAnchor="end"
                fill="var(--ink-3)"
                fontSize={10}
                fontFamily="var(--font-mono)"
              >
                {r}
              </text>
            ))}
            {/* One polyline per domain */}
            {data.domains.map((d) => {
              const rs = ranksByDomain.get(d) ?? []
              const points = rs.map((r, yi) => `${x(yi)},${y(r)}`).join(' ')
              const isHot = hot === d
              const dim = hot != null && !isHot
              return (
                <g key={d}>
                  <polyline
                    points={points}
                    fill="none"
                    stroke={isHot ? 'var(--accent)' : 'var(--ink-0)'}
                    strokeWidth={isHot ? 2.25 : 1}
                    opacity={dim ? 0.14 : isHot ? 1 : 0.34}
                    className="rank-bumps-line"
                  />
                  {/* End label */}
                  <text
                    x={x(rs.length - 1) + 8}
                    y={y(rs[rs.length - 1] ?? 1) + 3}
                    fill={isHot ? 'var(--accent)' : 'var(--ink-2)'}
                    fontSize={10.5}
                    fontFamily="var(--font-mono)"
                    opacity={dim ? 0.25 : 1}
                  >
                    {labels.get(d)}
                  </text>
                  {/* Wide invisible hit area */}
                  <polyline
                    points={points}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onMouseEnter={() => setHot(d)}
                    onMouseLeave={() => setHot(null)}
                  />
                </g>
              )
            })}
          </svg>
        </div>
        <div className="rank-bumps-links">
          {data.domains.map((d) => (
            <Link
              key={d}
              to={`/domain/${d}`}
              className="hover-surface rank-bumps-link"
              onMouseEnter={() => setHot(d)}
              onMouseLeave={() => setHot(null)}
              onFocus={() => setHot(d)}
              onBlur={() => setHot(null)}
            >
              {labels.get(d)}
              <span className="num rank-bumps-link-rank">
                #{ranksByDomain.get(d)?.slice(-1)[0] ?? '-'}
              </span>
            </Link>
          ))}
        </div>
        <p className="num rank-bumps-foot">
          {fmtInt(data.years.length)} years, {fmtInt(data.domains.length)} domains. Ranks derive
          from annual works counts in the matrix snapshot.
        </p>
      </div>
    </section>
  )
}
