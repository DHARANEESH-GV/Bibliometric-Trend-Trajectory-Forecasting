/**
 * Tiny app store — run manifest + theme only. All view state is URL
 * search params (shareable, per master plan §8). Deliberately ~30 lines,
 * no external state library.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { loadManifest } from './snapshots'

interface StoreValue {
  runId: string | null
  generatedUtc: string | null
  theme: 'dark' | 'light'
  toggleTheme: () => void
  toggleThemeWipe: (origin?: { x: number; y: number }) => void
}

const StoreContext = createContext<StoreValue | null>(null)

function initialTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<{ run_id: string; generated_utc: string | null } | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>(initialTheme)

  useEffect(() => {
    let alive = true
    loadManifest()
      .then((m) => {
        if (alive) setRun({ run_id: m.run_id, generated_utc: null })
      })
      .catch(() => {
        /* error boundary / per-view states handle offline */
      })
    return () => {
      alive = false
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      try {
        localStorage.setItem('bt-theme', next)
      } catch {
        /* private mode: session-only theme */
      }
      return next
    })
  }, [])

  /** Theme clip-wipe: dark<->light toggles via a circular clip-path wipe
   *  expanding from the toggle button (or viewport center as fallback).
   *  Uses the View Transitions API when present; instant swap otherwise.
   *  Skipped under reduced motion. */
  const toggleThemeWipe = useCallback(
    (origin?: { x: number; y: number }) => {
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => { ready: Promise<void> }
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!doc.startViewTransition || reduced) {
        toggleTheme()
        return
      }
      const x = origin?.x ?? window.innerWidth / 2
      const y = origin?.y ?? 40
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      )
      const transition = doc.startViewTransition(() => toggleTheme())
      transition.ready.then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 550, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
    },
    [toggleTheme],
  )

  const value = useMemo<StoreValue>(
    () => ({
      runId: run?.run_id ?? null,
      generatedUtc: run?.generated_utc ?? null,
      theme,
      toggleTheme,
      toggleThemeWipe,
    }),
    [run, theme, toggleTheme, toggleThemeWipe],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext)
  if (!v) throw new Error('useStore outside StoreProvider')
  return v
}
