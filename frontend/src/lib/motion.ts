/**
 * lib/motion.ts — user-controllable motion, layered over the OS setting.
 *
 * Sources of truth, in priority order:
 *   1. Explicit in-app choice (localStorage 'bt-motion' = 'full' | 'reduced')
 *   2. OS prefers-reduced-motion
 *   Default: follow the OS. An in-app toggle writes an explicit override
 *   for people who want the full show on a quiet OS (or vice versa).
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

/** Effective reduced-motion verdict, combining OS + explicit override. */
export function motionReduced(): boolean {
  const choice = getMotionChoice()
  if (choice === 'full') return false
  if (choice === 'reduced') return true
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/* Tiny pub-sub so a toggle click can re-render listeners (charts, hooks). */
type Listener = () => void
const listeners = new Set<Listener>()
export function onMotionChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(): void {
  listeners.forEach((fn) => fn())
}

/** React hook: re-renders when the effective verdict changes. */
import { useEffect, useState } from 'react'
export function useMotionReduced(): boolean {
  const [reduced, setReduced] = useState(motionReduced)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(motionReduced())
    sync()
    const off = onMotionChange(sync)
    mq.addEventListener('change', sync)
    return () => {
      off()
      mq.removeEventListener('change', sync)
    }
  }, [])
  return reduced
}
