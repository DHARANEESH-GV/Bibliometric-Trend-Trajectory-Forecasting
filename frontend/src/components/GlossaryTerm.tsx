/**
 * GlossaryTerm — inline term with a definition on hover/focus.
 *
 * Native `title` alone is mouse-only and not announced consistently, so the
 * term is a focusable button with `aria-describedby` pointing at an
 * always-present (visually hidden until opened) description. Keyboard users
 * reach it by Tab; touch users get it on tap via the focus handler. No
 * library, no portal, no layout shift.
 */
import { useId, useState } from 'react'

export interface GlossaryEntry {
  term: string
  definition: string
}

/** The project's shared glossary. One source for every tooltip. */
export const GLOSSARY: Record<string, string> = {
  cpc:
    'Cooperative Patent Classification. The patent-office scheme that maps a patent to a technology area. Domain counts depend on this mapping, which is approximate.',
  burst:
    'A burst is a stretch of years when a keyword appeared far more often in a domain than its own long-run baseline rate.',
  'emergence score':
    'A 0-100 weighted blend of recent growth, acceleration, keyword bursts and volume, with configurable weights. It ranks domains; it is not an absolute measure of importance.',
  'placebo test':
    'A control that pairs each domain\u2019s papers with a different domain\u2019s patents. If the real pairing scores no better than these deliberate mismatches, the result is not specific to the real pair.',
}

interface GlossaryTermProps {
  term: string
  /** Override the displayed label when it differs from the glossary key. */
  label?: string
  children?: React.ReactNode
}

export function GlossaryTerm({ term, label, children }: GlossaryTermProps) {
  const key = term.toLowerCase()
  const definition = GLOSSARY[key]
  const id = useId()
  const [open, setOpen] = useState(false)

  if (!definition) return <>{children ?? label ?? term}</>

  return (
    <span className="glossary-wrap">
      <button
        type="button"
        className="glossary-term"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children ?? label ?? term}
        <span aria-hidden className="glossary-dot">
          ?
        </span>
      </button>
      <span
        id={id}
        role="tooltip"
        className={`glossary-tip${open ? ' glossary-tip--open' : ''}`}
      >
        {definition}
      </span>
    </span>
  )
}
