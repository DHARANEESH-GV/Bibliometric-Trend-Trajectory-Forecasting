/**
 * SearchPalette — ⌘K palette over the 20 static domains. The only
 * "search API call needed" is none: domains come from the leaderboard
 * snapshot, no search index (master plan §8).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

export interface SearchItem {
  domain: string
  display_name: string
  hint?: string
}

interface SearchPaletteProps {
  items: SearchItem[]
  /** Route generator, e.g. (domain) => `/domain/${domain}` */
  to: (domain: string) => string
  open: boolean
  onClose: () => void
}

export function SearchPalette({ items, to, open, onClose }: SearchPaletteProps) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
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

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      inputRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const commit = (i: number) => {
    const item = results[i]
    if (!item) return
    navigate(to(item.domain))
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search domains"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--surface-0) 70%, transparent)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '12vh',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, calc(100vw - 48px))',
          background: 'var(--surface-1)',
          border: 'var(--hairline-strong)',
          borderRadius: 3,
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
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, results.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            }
            if (e.key === 'Enter') commit(active)
          }}
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
        <ul role="listbox" style={{ listStyle: 'none', margin: 0, padding: 'var(--sp-2)', maxHeight: '50vh', overflowY: 'auto' }}>
          {results.length === 0 ? (
            <li style={{ padding: 'var(--sp-3) var(--sp-4)', color: 'var(--ink-2)' }}>
              No domain matches “{q}”.
            </li>
          ) : (
            results.map((item, i) => (
              <li key={item.domain} role="option" aria-selected={i === active}>
                <button
                  onClick={() => commit(i)}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 'var(--sp-4)',
                    padding: 'var(--sp-2) var(--sp-4)',
                    background: i === active ? 'var(--surface-2)' : 'transparent',
                    borderRadius: 2,
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
