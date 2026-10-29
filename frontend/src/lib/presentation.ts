/**
 * lib/presentation.ts — Presentation Mode.
 *
 * A reading mode for demos and projectors: larger base type, quieter
 * secondary chrome, and the expensive decorations switched off. It is a
 * USER PREFERENCE (persisted), never an automatic behaviour.
 *
 * Storage is wrapped in try/catch: private-mode browsers throw on
 * localStorage access, and a thrown read would crash first paint. Failure
 * degrades to "off for this session", which is the safe default.
 *
 * Presentation mode also implies reduced motion (see lib/motion.ts), which
 * is what disables the WebGL dither shader and chart draw-in animation —
 * those already key off the single motion verdict, so there is exactly one
 * place that decides "is this decoration allowed".
 */

const KEY = 'bt-presentation'

export function isPresentation(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setPresentation(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: session-only */
  }
  applyPresentationAttribute(on)
  notify()
}

/** Mirrors the state onto <html> so CSS can scale type and hide chrome. */
export function applyPresentationAttribute(on: boolean): void {
  const root = document.documentElement
  if (on) root.dataset.presentation = 'on'
  else delete root.dataset.presentation
}

type Listener = () => void
const listeners = new Set<Listener>()
export function onPresentationChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(): void {
  listeners.forEach((fn) => fn())
}

import { useEffect, useState } from 'react'

export function usePresentation(): boolean {
  const [on, setOn] = useState(isPresentation)
  useEffect(() => {
    applyPresentationAttribute(on)
    const sync = () => setOn(isPresentation())
    return onPresentationChange(sync)
  }, [on])
  return on
}
