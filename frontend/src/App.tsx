import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'

import { StoreProvider, useStore } from './lib/store'
import { loadLeaderboard } from './lib/snapshots'
import { useQuery } from './lib/useQuery'
import { snapshotSentence, relativeAge } from './lib/format'
import { MethodologyNote } from './components/MethodologyNote'
import { SearchPalette, useCommandK, type SearchItem } from './components/SearchPalette'
import { IslandNav } from './components/IslandNav'
import { RouteTransition } from './components/RouteTransition'
import { WorkbenchAmbience } from './components/WorkbenchAmbience'
import { WorkbenchChrome } from './components/WorkbenchChrome'
import { WireTicker } from './components/WireTicker'
import { TourStrip } from './components/TourStrip'
import { ProvenanceFooter } from './components/ProvenanceFooter'
import { usePresentation } from './lib/presentation'
import './styles/demo.css'
import { CoverView } from './views/Cover'
import { ErrorBoundary } from './components/ErrorBoundary'

// Workbench views are code-split: echarts + its chart modules land only in
// the analytical chunks, never in the initial bundle (bundle rule 2.4).
// Cover stays eager — it is the landing LCP surface.
const LeaderboardView = lazy(() =>
  import('./views/Leaderboard').then((m) => ({ default: m.LeaderboardView })),
)
const TrajectoryExplorerView = lazy(() =>
  import('./views/TrajectoryExplorer').then((m) => ({ default: m.TrajectoryExplorerView })),
)
const DomainDrilldownView = lazy(() =>
  import('./views/DomainDrilldown').then((m) => ({ default: m.DomainDrilldownView })),
)
const BurstsView = lazy(() =>
  import('./views/Bursts').then((m) => ({ default: m.BurstsView })),
)
const MatrixView = lazy(() =>
  import('./views/Matrix').then((m) => ({ default: m.MatrixView })),
)
const LagView = lazy(() =>
  import('./views/Lag').then((m) => ({ default: m.LagView })),
)
const AboutView = lazy(() =>
  import('./views/About').then((m) => ({ default: m.AboutView })),
)
const OverviewView = lazy(() =>
  import('./views/Overview').then((m) => ({ default: m.OverviewView })),
)

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span className="visually-hidden">Loading view</span>
      <div className="route-fallback-bar w-1" />
      <div className="route-fallback-bar w-2" />
      <div className="route-fallback-bar w-3" />
    </div>
  )
}

function Shell() {
  const { runId, generatedUtc } = useStore()
  // Apply the persisted presentation preference on EVERY route, including
  // the cover (which has no island nav to host the toggle).
  usePresentation()
  const location = useLocation()
  const isCover = location.pathname === '/' || location.pathname === '/cover'
  const { data } = useQuery(loadLeaderboard, [])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  useCommandK(setPaletteOpen)

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const gatePassed = useMemo(() => {
    const gate = data?.gate
    if (!gate) return null
    return Object.values(gate).some((g) => g.gate_passed)
  }, [data])

  const items = useMemo<SearchItem[]>(
    () =>
      (data?.leaderboard ?? []).map((r) => ({
        domain: r.domain,
        display_name: r.display_name,
        hint: `rank ${r.rank}`,
      })),
    [data],
  )

  if (isCover) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <main id="main" style={{ flex: 1 }}>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<CoverView />} />
              <Route path="/cover" element={<CoverView />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a href="#main" className="visually-hidden">
        Skip to content
      </a>
      <WorkbenchAmbience />
      <WorkbenchChrome />
      <IslandNav onOpenSearch={() => setPaletteOpen(true)} />
      <WireTicker />

      <main id="main" className="container workbench-main" style={{ flex: 1, position: 'relative', zIndex: 1 }}>
        <TourStrip />
        <div className="status-bar" role="status" aria-label="Run status">
          <span>
            run <strong>{runId}</strong>
          </span>
          <span>
            generated{' '}
            <strong>{data?._meta.generated_utc ?? generatedUtc ?? 'pending'}</strong>
          </span>
          {gatePassed != null ? (
            <span className={gatePassed ? 'status-pass' : 'status-fail'}>
              forecast gate {gatePassed ? 'passed' : 'failed'}
            </span>
          ) : null}
          <span>
            utc <strong>{clock.toISOString().slice(11, 16)}</strong>
          </span>
        </div>
        <ErrorBoundary>
          <RouteTransition routeKey={location.pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/leaderboard" element={<LeaderboardView />} />
                <Route path="/trajectory" element={<TrajectoryExplorerView />} />
                <Route path="/domain/:slug" element={<DomainDrilldownView />} />
                <Route path="/bursts" element={<BurstsView />} />
                <Route path="/matrix" element={<MatrixView />} />
                <Route path="/lag" element={<LagView />} />
                <Route path="/overview" element={<OverviewView />} />
                <Route path="/about" element={<AboutView />} />
                <Route
                  path="*"
                  element={
                    <div className="catalog-404" role="status">
                      <span className="catalog-404-code num" aria-hidden>
                        404
                      </span>
                      <h1 className="catalog-404-title">
                        This address is <span className="serif-accent">not in the index</span>
                      </h1>
                      <p className="catalog-404-lead">
                        The catalog has no card for this address. Search the
                        domains or return to the leaderboard.
                      </p>
                      <div className="catalog-404-actions">
                        <NavLink to="/leaderboard" className="catalog-404-cta">
                          Return to the leaderboard
                        </NavLink>
                        <button
                          type="button"
                          className="catalog-404-cta catalog-404-cta--ghost"
                          onClick={() => setPaletteOpen(true)}
                        >
                          Search domains
                        </button>
                      </div>
                    </div>
                  }
                />
              </Routes>
            </Suspense>
          </RouteTransition>
        </ErrorBoundary>
      </main>

      <div className="container">
        <ProvenanceFooter />
      </div>

      <footer className="site-footer hairline-top">
        <div className="container">
          <div className="site-footer-wordmark" aria-hidden>
            BIBLIO
          </div>
          <div className="site-footer-row">
            <MethodologyNote />
            <nav className="site-footer-legal" aria-label="Legal">
              <a href="#main">Privacy</a>
              <a href="#main">Terms</a>
              <button
                type="button"
                className="site-footer-top"
                onClick={() => {
                  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
                  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
                }}
              >
                Back to top ↑
              </button>
            </nav>
          </div>
          <p className="num site-footer-meta">
            {snapshotSentence(runId, data?._meta.generated_utc ?? generatedUtc)}
            {data
              ? ` Data: OpenAlex works, 2000-2025. Generated ${relativeAge(data._meta.generated_utc) ?? 'recently'}.`
              : ''}
          </p>
        </div>
      </footer>

      <SearchPalette
        items={items}
        to={(domain) => `/domain/${domain}`}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
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
