/**
 * IslandNav — the workbench's floating glass pill (Ethereal Glass world).
 * Brand, primary links, and controls share one detached island; it clears
 * the content and collapses to two rows on narrow viewports. Active link
 * state is CSS-driven via aria-current, so it never re-renders on route
 * change. Icons come from Phosphor deep paths (bundle-size rule 2.1).
 */
import { NavLink } from 'react-router-dom'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { Waveform } from '@phosphor-icons/react/dist/csr/Waveform'
import { Sun } from '@phosphor-icons/react/dist/csr/Sun'
import { Moon } from '@phosphor-icons/react/dist/csr/Moon'
import { useStore } from '../lib/store'
import { useMotionReduced, setMotionChoice } from '../lib/motion'

const NAV = [
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/trajectory', label: 'Trajectories' },
  { to: '/bursts', label: 'Bursts' },
  { to: '/matrix', label: 'Matrix' },
  { to: '/overview', label: 'Overview' },
  { to: '/about', label: 'About' },
]

interface IslandNavProps {
  onOpenSearch: () => void
}

export function IslandNav({ onOpenSearch }: IslandNavProps) {
  const { theme, toggleThemeWipe } = useStore()
  const motionReduced = useMotionReduced()

  return (
    <header className="island-wrap">
      <div className="island">
        <NavLink to="/" className="island-brand" aria-label="Biblio cover">
          Biblio<em>.</em>
        </NavLink>

        <nav className="island-nav" aria-label="Primary">
          <ul>
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.to === '/leaderboard'} className="island-link">
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="island-controls">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search domains (Command K)"
            title="Search domains (⌘K)"
            className="island-btn"
          >
            <MagnifyingGlass size={16} weight="light" aria-hidden />
          </button>

          <button
            type="button"
            onClick={() => setMotionChoice(motionReduced ? 'full' : 'reduced')}
            aria-pressed={!motionReduced}
            aria-label={motionReduced ? 'Motion is reduced. Enable full motion.' : 'Full motion is on. Reduce it.'}
            title={motionReduced ? 'Motion is reduced' : 'Full motion is on'}
            className="island-btn"
          >
            <Waveform size={16} weight={motionReduced ? 'light' : 'bold'} aria-hidden />
          </button>

          <button
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              toggleThemeWipe({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
            }}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="island-btn"
          >
            {theme === 'dark' ? (
              <Moon size={16} weight="light" aria-hidden />
            ) : (
              <Sun size={16} weight="light" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
