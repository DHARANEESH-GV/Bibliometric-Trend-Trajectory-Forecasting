/**
 * ViewHeader — one header build for every workbench view. Six views used
 * to repeat the same inline `<header>` (h1 + lead + controls) with their
 * own sizing; this owns the display scale, the under-rule, and the gap to
 * content so the views share a rhythm (taste-skill §11.D lever 1/2).
 *
 * The eyebrow is optional and rationed: at most one per three sections.
 * H1 text passed in by each view is its SEO string and must not change.
 */
import type { ReactNode } from 'react'

interface ViewHeaderProps {
  title: ReactNode
  lead?: ReactNode
  eyebrow?: ReactNode
  /** Controls (sort/filter selects, copy link) rendered under the lead. */
  children?: ReactNode
}

export function ViewHeader({ title, lead, eyebrow, children }: ViewHeaderProps) {
  return (
    <header className="view-header">
      {eyebrow ? <span className="view-eyebrow">{eyebrow}</span> : null}
      <h1>{title}</h1>
      {lead ? <p className="view-header-lead">{lead}</p> : null}
      {children ? <div className="view-header-controls">{children}</div> : null}
    </header>
  )
}
