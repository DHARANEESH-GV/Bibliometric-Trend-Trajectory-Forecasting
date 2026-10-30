/**
 * lib/useDialogTransition — shared mount/unmount choreography for overlays
 * (⌘K palette, shortcuts HUD, weight simulator).
 *
 * Problem it solves: every dialog used `if (!open) return null`, so closing
 * was a hard unmount — entrance animations existed but the exit was a
 * frame-cut, which reads as a glitch rather than fluid UI. This hook keeps
 * the dialog mounted for one short exit beat and tags it so CSS can play
 * the second half of the choreography:
 *
 *   const { shouldRender, closing } = useDialogTransition(open)
 *   if (!shouldRender) return null
 *   <div className={`my-overlay${closing ? ' is-closing' : ''}`}>
 *
 * The CSS owns both halves (entrance keyframes + `.is-closing` selectors);
 * this hook only decides whether the node exists. Re-opening mid-exit
 * cancels the pending unmount, so rapid open/close/open never flickers.
 *
 * Timing note: the phase is derived DURING RENDER (React's recommended
 * pattern for prop-derived state), not in an effect. An effect-derived
 * phase lags one render behind `open`, which used to mount the dialog a
 * frame late — enough for the palette's rAF autofocus to miss the input
 * and leave focus stranded on the trigger (Escape then never closed it).
 */
import { useEffect, useState } from 'react'

export interface DialogTransition {
  /** True while the dialog should be in the DOM (open, or exiting). */
  shouldRender: boolean
  /** True during the exit beat; pair with the `.is-closing` CSS class. */
  closing: boolean
}

/** Long enough to read as motion, short enough to never lag a click. */
const EXIT_MS = 170

type Phase = 'closed' | 'open' | 'closing'

export function useDialogTransition(open: boolean): DialogTransition {
  const [phase, setPhase] = useState<Phase>('closed')
  const [prevOpen, setPrevOpen] = useState(open)

  // Render-phase derivation: both the mount edge (open → mounted on the
  // same commit, so refs/autofocus work immediately) and the close edge
  // (open → is-closing on the same commit, so the exit beat actually
  // plays) are lag-free.
  if (prevOpen !== open) {
    setPrevOpen(open)
    setPhase(open ? 'open' : phase === 'open' ? 'closing' : phase)
  }

  useEffect(() => {
    if (phase !== 'closing') return
    const t = window.setTimeout(() => setPhase('closed'), EXIT_MS)
    return () => window.clearTimeout(t)
  }, [phase])

  return { shouldRender: phase !== 'closed', closing: phase === 'closing' }
}
