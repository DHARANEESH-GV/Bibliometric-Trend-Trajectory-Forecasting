import { useMemo, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'

import { StoreProvider, useStore } from './lib/store'
import { loadLeaderboard } from './lib/snapshots'
import { useQuery } from './lib/useQuery'
import { snapshotSentence } from './lib/format'
import { MethodologyNote } from './components/MethodologyNote'
import { SearchPalette, useCommandK, type SearchItem } from './components/SearchPalette'
import { CoverView } from './views/Cover'
import { LeaderboardView } from './views/Leaderboard'
import { TrajectoryExplorerView } from './views/TrajectoryExplorer'
import { DomainDrilldownView } from './views/DomainDrilldown'
import { BurstsView } from './views/Bursts'
import { MatrixView } from './views/Matrix'
import { AboutView } from './views/About'
import { ErrorBoundary } from './components/ErrorBoundary'

const NAV = [
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/trajectory', label: 'Trajectories' },
  { to: '/bursts', label: 'Bursts' },
  { to: '/matrix', label: 'Matrix' },
  { to: '/about', label: 'About' },
]

function Shell() {
  const { runId, generatedUtc, theme, toggleTheme } = useStore()
  const location = useLocation()
  const isCover = location.pathname === '/'
  const { data } = useQuery(loadLeaderboard, [])
  const [paletteOpen, setPaletteOpen] = useState(false)
  useCommandK(setPaletteOpen)

  const items = useMemo<SearchItem[]>(
    () =>
      (data?.leaderboard ?? []).map((r) => ({
        domain: r.domain,
        display_name: r.display_name,
        hint: `rank ${r.rank}`,
      })),
    [data],
  )


  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {!isCover && <a href="#main" className="visually-hidden">Skip to content</a>}
      {!isCover && <header
        className="hairline-bottom"
        style={{ position: 'sticky', top: 0, background: 'var(--surface-0)', zIndex: 40 }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 'var(--sp-5)',
            paddingBlock: 'var(--sp-3)',
          }}
        >
          <NavLink
            to="/"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              color: 'var(--ink-0)',
              textDecoration: 'none',
              fontSize: 'var(--text-lg)',
            }}
          >
            Biblio
          </NavLink>
          <nav aria-label="Primary">
            <ul
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--sp-4)',
                listStyle: 'none',
                margin: 0,
                padding: 0,
                fontSize: 'var(--text-sm)',
              }}
            >
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.to === '/leaderboard'}
                    style={({ isActive }) => ({
                      color: isActive ? 'var(--ink-0)' : 'var(--ink-2)',
                      textDecoration: 'none',
                      borderBottom: isActive ? '2px solid var(--ink-0)' : '2px solid transparent',
                      paddingBlock: 2,
                    })}
                  >
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Search domains (Command K)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                border: 'var(--hairline)',
                borderRadius: 2,
                padding: '4px 10px',
                fontSize: 'var(--text-sm)',
                color: 'var(--ink-2)',
              }}
            >
              Search <kbd style={{ fontSize: 'var(--text-xs)' }}>⌘K</kbd>
            </button>
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              style={{
                border: 'var(--hairline)',
                borderRadius: 2,
                padding: '4px 10px',
                fontSize: 'var(--text-sm)',
              }}
            >
              {theme === 'dark' ? '☾' : '☀'}
            </button>
          </div>
        </div>
      </header>}

      {isCover ? (
        <main id="main" style={{ flex: 1 }}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<CoverView />} />
            </Routes>
          </ErrorBoundary>
        </main>
      ) : (
        <>
      <main id="main" className="container" style={{ flex: 1 }}>
        <ErrorBoundary>
        <Routes>
          <Route path="/cover" element={<CoverView />} />
          <Route path="/leaderboard" element={<LeaderboardView />} />
          <Route path="/trajectory" element={<TrajectoryExplorerView />} />
          <Route path="/domain/:slug" element={<DomainDrilldownView />} />
          <Route path="/bursts" element={<BurstsView />} />
          <Route path="/matrix" element={<MatrixView />} />
          <Route path="/about" element={<AboutView />} />
          <Route
            path="*"
            element={
              <div style={{ padding: 'var(--sp-7) 0' }}>
                <h1 style={{ fontSize: 'var(--text-xl)' }}>Page not found</h1>
                <p style={{ color: 'var(--ink-2)', marginTop: 'var(--sp-3)' }}>
                  The address does not match any snapshot view.
                </p>
                <p style={{ marginTop: 'var(--sp-3)' }}>
                  <NavLink to="/leaderboard">Return to the leaderboard</NavLink>
                </p>
              </div>
            }
          />
        </Routes>
        </ErrorBoundary>
      </main>

      <footer
        className="hairline-top"
        style={{ paddingBlock: 'var(--sp-5)', marginTop: 'var(--sp-7)' }}
      >
        <div className="container" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
          <MethodologyNote />
          <p
            className="num"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-3)',
              width: '100%',
            }}
          >
            {snapshotSentence(runId, generatedUtc)}
            {data ? ` Data: OpenAlex works, 2000–2025.` : ''}
          </p>
        </div>
      </footer>

      <SearchPalette
        items={items}
        to={(domain) => `/domain/${domain}`}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
        </>
      )}
    </div>
  )
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
