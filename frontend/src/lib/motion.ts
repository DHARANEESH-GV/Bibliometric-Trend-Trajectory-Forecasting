/**
 * lib/motion.ts — user-controllable motion.
 *
 * Verdict: FULL MOTION by default. The only way motion is silenced is an
 * explicit user choice (in-app Motion toggle) or accessibility tooling that
 * sets the stored preference: localStorage 'bt-motion' = 'full' | 'reduced'.
 * The OS prefers-reduced-motion signal is surfaced through the toggle's
 * initial state but does NOT auto-mute the site — the show runs unless the
 * user leans still. (Product decision: an invisible OS mute read as a
 * broken, static site.)
 */

const KEY = 'bt-motion'

export type MotionChoice = 'full' | 'reduced' | null

export function getMotionChoice(): MotionChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'full' || v === 'reduced' ? v : null
  } catch {
    return null
  }
}

export function setMotionChoice(choice: 'full' | 'reduced' | null): void {
  try {
    if (choice === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, KEY_VALUES[choice])
  } catch {
    /* private mode: session-only */
  }
  notify()
}

const KEY_VALUES = { full: 'full', reduced: 'reduced' } as const

/** Effective verdict: reduced only on an explicit user choice. */
export function motionReduced(): boolean {
  return getMotionChoice() === 'reduced'
}

/**
 * Mirror the motion verdict onto the document so CSS can honour it.
 *
 * The in-app toggle historically only reached JS (`motionReduced()`), so
 * every CSS animation on the site ignored it — including the ambient orb
 * drift on the cover. Pushing `data-motion` onto <html> lets stylesheets
 * opt out with `[data-motion='reduced']`, keeping one verdict for JS and
 * CSS instead of two that can disagree.
 */
function syncDocumentAttribute(): void {
  if (typeof document === 'undefined') return
  const reduced = motionReduced()
  if (reduced) document.documentElement.dataset.motion = 'reduced'
  else delete document.documentElement.dataset.motion
}

syncDocumentAttribute()

/* Tiny pub-sub so a toggle click can re-render listeners (charts, hooks). */
type Listener = () => void
const listeners = new Set<Listener>()
export function onMotionChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(): void {
  syncDocumentAttribute()
  listeners.forEach((fn) => fn())
}

/** React hook: re-renders when the effective verdict changes. */
import { useEffect, useState } from 'react'
export function useMotionReduced(): boolean {
  const [reduced, setReduced] = useState(motionReduced)
  useEffect(() => {
    const sync = () => setReduced(motionReduced())
    sync()
    return onMotionChange(sync)
  }, [])
  return reduced
}
