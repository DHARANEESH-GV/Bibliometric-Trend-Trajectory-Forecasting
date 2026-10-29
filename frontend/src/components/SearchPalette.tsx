/**
 * SearchPalette — ⌘K palette over the 20 static domains. The only
 * "search API call needed" is none: domains come from the leaderboard
 * snapshot, no search index (master plan §8).
 *
 * Accessibility: focus is trapped inside the dialog, returned to the
 * invoking control on close, and the active option is announced via
 * aria-activedescendant (the input keeps DOM focus while arrows move).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

export interface SearchItem {
  domain: string
  display_name: string
  hint?: string
  route?: string
  isAction?: boolean
}

interface SearchPaletteProps {
  items: SearchItem[]
  /** Route generator, e.g. (domain) => `/domain/${domain}` */
  to: (domain: string) => string
  open: boolean
  onClose: () => void
}

const optionId = (domain: string) => `sp-opt-${domain.replace(/[^a-z0-9_-]/gi, '-')}`

export function SearchPalette({ items, to, open, onClose }: SearchPaletteProps) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (i) =>
        i.display_name.toLowerCase().includes(needle) ||
        i.domain.includes(needle),
    )
  }, [q, items])

  // Open: reset, focus the input, trap Tab within the dialog, and restore
  // focus to whatever opened the palette when it closes.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    setQ('')
    setActive(0)
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      cancelAnimationFrame(raf)
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  const commit = (i: number) => {
    const item = results[i]
    if (!item) return
    if (item.route) {
      navigate(item.route)
    } else {
      navigate(to(item.domain))
    }
    onClose()
  }

  // Keep DOM focus on the input; arrows move the active descendant.
  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(active)
    }
  }

  // Trap Tab inside the dialog. Options use roving focus (aria-activedescendant
  // via the input), so the input is the only tabbable element; Tab simply
  // stays on it rather than escaping to the page behind the overlay.
  const onDialogKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('input, button, [tabindex]'),
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0)
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    const current = document.activeElement
    if (e.shiftKey && (current === first || !root.contains(current))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && current === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const activeItem = results[active]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search domains"
      onClick={onClose}
      onKeyDown={onDialogKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--surface-0) 70%, transparent)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '12vh',
        zIndex: 'var(--z-overlay)',
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, calc(100vw - 48px))',
          background: 'var(--surface-1)',
          border: 'var(--hairline-strong)',
          borderRadius: 'var(--r-control)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={onInputKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="search-palette-listbox"
          aria-activedescendant={activeItem ? optionId(activeItem.domain) : undefined}
          aria-autocomplete="list"
          placeholder="Jump to a domain…"
          aria-label="Search domains"
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderBottom: 'var(--hairline)',
            padding: 'var(--sp-4) var(--sp-5)',
            color: 'var(--ink-0)',
            outline: 'none',
          }}
        />
        <ul
          id="search-palette-listbox"
          role="listbox"
          aria-label="Matching domains"
          style={{ listStyle: 'none', margin: 0, padding: 'var(--sp-2)', maxHeight: '50vh', overflowY: 'auto' }}
        >
          {results.length === 0 ? (
            <li style={{ padding: 'var(--sp-3) var(--sp-4)', color: 'var(--ink-2)' }}>
              No domain matches “{q}”.
            </li>
          ) : (
            results.map((item, i) => (
              <li
                key={item.domain}
                id={optionId(item.domain)}
                role="option"
                aria-selected={i === active}
              >
                <button
                  onClick={() => commit(i)}
                  onMouseEnter={() => setActive(i)}
                  tabIndex={-1}
                  style={{
                    display: 'flex',
                    width: '100%',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 'var(--sp-4)',
                    padding: 'var(--sp-2) var(--sp-4)',
                    background: i === active ? 'var(--surface-2)' : 'transparent',
                    borderRadius: 'var(--r-control)',
                    textAlign: 'left',
                  }}
                >
                  <span>{item.display_name}</span>
                  <span className="num" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                    {item.hint}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}

/** Global ⌘K / Ctrl+K listener. */
export function useCommandK(setOpen: (open: boolean) => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setOpen])
}
