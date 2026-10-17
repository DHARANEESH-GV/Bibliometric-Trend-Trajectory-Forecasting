/**
 * WireTicker — the Wire: a fixed mono ticker under the island nav,
 * scrolling the run's Kleinberg burst keywords with stage-colored dots.
 * The cover's wire marquee (cover.css) promoted into the app chrome.
 * Pure CSS animation (transform only), pauses on hover, every item
 * deep-links to /bursts. Hidden <760px and under reduced motion (CSS).
 */
import { useQuery } from '../lib/useQuery'
import { loadBursts, loadLeaderboard } from '../lib/snapshots'
import { Link } from 'react-router-dom'
import { STAGE_TOKEN } from '../lib/types'

export function WireTicker() {
  const { data } = useQuery(loadBursts, [])
  const { data: lb } = useQuery(loadLeaderboard, [])
  const feed = data?.feed ?? []
  if (feed.length === 0) return null

  // Burst entries carry no lifecycle label; the leaderboard maps domain
  // -> label, so dots color by the domain's actual stage token.
  const labelOf = new Map((lb?.leaderboard ?? []).map((r) => [r.domain, r.label]))

  // Strongest bursts first, capped so the track stays a ribbon, not a wall.
  const items = [...feed]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 14)

  // Track renders twice for a seamless -50% translateX loop.
  const half = (key: string, ariaHidden: boolean) => (
    <div className="wire-track-half" style={{ display: 'flex' }} aria-hidden={ariaHidden}>
      {items.map((b) => (
        <Link
          key={key + b.domain + b.keyword}
          to={`/bursts?domain=${b.domain}`}
          className="wire-item"
          tabIndex={ariaHidden ? -1 : undefined}
        >
          <span
            className="wire-dot"
            aria-hidden
            style={{ background: `var(${STAGE_TOKEN[labelOf.get(b.domain) ?? ''] ?? '--stage-watch'})` }}
          />
          {b.keyword}
          <span className="wire-year">{b.start}</span>
        </Link>
      ))}
    </div>
  )

  return (
    <aside className="wire-ticker" aria-label="Bursting keywords across the run">
      <div className="wire-track">
        {half('a-', false)}
        {half('b-', true)}
      </div>
    </aside>
  )
}
