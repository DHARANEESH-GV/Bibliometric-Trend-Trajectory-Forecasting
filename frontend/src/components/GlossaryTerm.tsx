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
    'Cooperative Patent Classification: the standard patent-office system that categorizes patents by technology area.',
  burst:
    'A period when a keyword or topic surged rapidly in published research papers compared to its normal baseline frequency.',
  'emergence score':
    'A 0 to 100 score measuring how fast a field is growing and gaining momentum based on paper volume, growth speed, and surging keywords. It ranks fields relative to one another.',
  'score decomposition':
    'How the overall score breaks down across five core signals: recent growth speed, acceleration, keyword surges, publication volume, and commercial momentum.',
  'placebo test':
    'A verification test that pairs each field\'s papers with a completely different field\'s patents to confirm the pattern is real rather than an accidental coincidence.',
  'patent offset':
    'The time difference between academic research publication and granted commercial patents.',
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
