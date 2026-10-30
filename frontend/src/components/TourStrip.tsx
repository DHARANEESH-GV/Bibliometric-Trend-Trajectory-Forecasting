/**
 * TourStrip — a slim, dismissible 4-step guided path.
 *
 * Off by default. It only appears once the user presses "Start tour" on the
 * Cover, which sets sessionStorage. Dismissing hides it for the session but
 * keeps the "Start tour" entry point available, so the tour is always
 * re-enterable without a page reload.
 *
 * The domain-drilldown step needs a concrete slug. It is read from the
 * leaderboard snapshot (rank 1), never typed, and falls back to skipping
 * that step if no leaderboard is available.
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '../lib/useQuery'
import { loadLeaderboard } from '../lib/snapshots'

const KEY = 'bt-tour'
/** One-time flag: the guided tour auto-opens for a first-time visitor,
 *  then never again. localStorage (not sessionStorage) because "have they
 *  seen this before" must survive closing the tab. */
const SEEN_KEY = 'bt-tour-seen'

export function tourActive(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'active'
  } catch {
    return false
  }
}

/** Has this browser ever been shown the tour (auto or manually)? */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // private mode: never auto-open, rather than on every load
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* private mode: the tour simply may re-appear next session */
  }
}

/**
 * First-visit entry ramp: open the guided tour once, automatically.
 *
 * The tour used to be opt-in behind a "Start tour" button, which nobody
 * pressed — so the people who most needed the orientation never saw it.
 * Returns true when it opened, so the caller can react if it needs to.
 */
export function maybeAutoStartTour(): boolean {
  if (tourSeen()) return false
  markSeen()
  startTour()
  return true
}

export function startTour(): void {
  try {
    sessionStorage.setItem(KEY, 'active')
  } catch {
    /* private mode: the strip simply will not persist across reloads */
  }
  notify()
}

export function dismissTour(): void {
  markSeen()
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  notify()
}

type Listener = () => void
const listeners = new Set<Listener>()
function notify(): void {
  listeners.forEach((fn) => fn())
}
export function onTourChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useTourActive(): boolean {
  const [on, setOn] = useState(tourActive)
  useEffect(() => onTourChange(() => setOn(tourActive())), [])
  return on
}

interface Step {
  key: string
  label: string
  blurb: string
  path: (slug: string) => string
  match: (pathname: string) => boolean
}

const STEPS: Step[] = [
  {
    key: 'leaderboard',
    label: 'Leaderboard',
    blurb:
      'All twenty fields ranked, with the score explained in one line at the top.',
    path: () => '/leaderboard',
    match: (p) => p.startsWith('/leaderboard'),
  },
  {
    key: 'domain',
    label: 'One field',
    blurb: 'A single technology in depth: its trajectory, keywords and patents.',
    path: (slug) => `/domain/${slug}`,
    match: (p) => p.startsWith('/domain/'),
  },
  {
    key: 'lag',
    label: 'Lag',
    blurb:
      'Do busier fields patent sooner? A slider you can drag, and an honest look at how strong the answer is.',
    path: () => '/lag',
    match: (p) => p.startsWith('/lag'),
  },
  {
    key: 'about',
    label: 'Limits',
    blurb: 'What the data cannot support, stated plainly.',
    path: () => '/about',
    match: (p) => p.startsWith('/about'),
  },
]

export function TourStrip() {
  const active = useTourActive()
  const navigate = useNavigate()
  const location = useLocation()
  const leaderboard = useQuery(loadLeaderboard, [])
  const slug = leaderboard.data?.leaderboard[0]?.domain ?? ''

  if (!active) return null

  // Current step: exact match first, else the first step whose route matches.
  const current = STEPS.findIndex((s) => s.match(location.pathname))
  const step = current >= 0 ? STEPS[current]! : STEPS[0]!
  const index = current >= 0 ? current : 0
  const prev = STEPS[index - 1]
  const next = STEPS[index + 1]

  return (
    <nav className="tour" aria-label="Guided tour">
      <div className="tour-steps" role="list">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="listitem"
            className={`tour-step${i === index ? ' tour-step--current' : ''}`}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => {
              if (s.key === 'domain' && !slug) return
              navigate(s.path(slug))
            }}
            disabled={s.key === 'domain' && !slug}
            title={s.blurb}
          >
            <span className="tour-step-num num">{i + 1}</span>
            {s.label}
          </button>
        ))}
      </div>
      <p className="tour-blurb">{step.blurb}</p>
      <div className="tour-actions">
        <button
          type="button"
          className="tour-btn"
          disabled={!prev}
          onClick={() => prev && navigate(prev.path(slug))}
        >
          Back
        </button>
        <button
          type="button"
          className="tour-btn tour-btn--primary"
          disabled={!next}
          onClick={() => next && navigate(next.path(slug))}
        >
          Next
        </button>
        <button type="button" className="tour-btn tour-btn--ghost" onClick={dismissTour}>
          Dismiss
        </button>
      </div>
    </nav>
  )
}
