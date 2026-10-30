/**
 * ShortcutsModal — Keyboard Command & Navigation Cheatsheet.
 * Double-bezel glass modal displaying all observatory hotkeys.
 * Also hooks global number-key navigation (1-8) and shortcuts.
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from '@phosphor-icons/react/dist/csr/X'
import { Command } from '@phosphor-icons/react/dist/csr/Command'
import { useDialogTransition } from '../lib/useDialogTransition'

interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
  onToggleMotion?: () => void
  onOpenSearch?: () => void
}

const VIEW_SHORTCUTS = [
  { key: '1', label: 'Leaderboard', route: '/leaderboard' },
  { key: '2', label: 'Head-to-Head Compare', route: '/compare' },
  { key: '3', label: 'Trajectories', route: '/trajectory' },
  { key: '4', label: 'Keyword Bursts', route: '/bursts' },
  { key: '5', label: 'Matrix & Bar Race', route: '/matrix' },
  { key: '6', label: 'Science vs Patent Lag', route: '/lag' },
  { key: '7', label: 'Overview Multiples', route: '/overview' },
  { key: '8', label: 'About & Methodology', route: '/about' },
]

const CONTROL_SHORTCUTS = [
  { key: '⌘K', desc: 'Omnibar domain search & quick actions' },
  { key: '?', desc: 'Toggle keyboard shortcuts cheatsheet' },
  { key: 'M', desc: 'Toggle fluid vs reduced motion' },
  { key: 'Esc', desc: 'Close open dialogs, drawers, or search' },
]

export function ShortcutsModal({
  open,
  onClose,
  onToggleMotion,
  onOpenSearch,
}: ShortcutsModalProps) {
  const navigate = useNavigate()
  // Fluid exit: hold the HUD for one beat so the close animation can play
  // (see useDialogTransition) instead of frame-cutting on unmount.
  const { shouldRender, closing } = useDialogTransition(open)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger hotkeys if user is focused inside an input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        if (open) onClose()
        else {
          // Open via parent
          const event = new CustomEvent('open-shortcuts-modal')
          window.dispatchEvent(event)
        }
        return
      }

      if (e.key === 'Escape') {
        if (open) {
          e.preventDefault()
          onClose()
        }
        return
      }

      // Hotkeys 1-8 for rapid view navigation
      const num = parseInt(e.key, 10)
      if (!isNaN(num) && num >= 1 && num <= 8) {
        const item = VIEW_SHORTCUTS[num - 1]
        if (item) {
          e.preventDefault()
          navigate(item.route)
          if (open) onClose()
        }
        return
      }

      // Single-letter controls (without meta/ctrl)
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key.toLowerCase() === 'm') {
          e.preventDefault()
          onToggleMotion?.()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, navigate, onToggleMotion])

  if (!shouldRender) return null

  return (
    <div
      className={`shortcuts-overlay${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={closing || undefined}
      aria-label="Keyboard shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="shortcuts-dialog panel-shell">
        <div className="panel-core shortcuts-core">
          <header className="shortcuts-head hairline-bottom">
            <div className="shortcuts-title-group">
              <span className="section-eyebrow">Quick Navigation</span>
              <h2 className="shortcuts-title">
                Keyboard <span className="serif-accent">Shortcuts</span>
              </h2>
            </div>
            <button
              type="button"
              className="island-btn"
              onClick={onClose}
              aria-label="Close shortcuts dialog"
            >
              <X size={16} weight="light" aria-hidden />
            </button>
          </header>

          <div className="shortcuts-content">
            {/* View Navigation Hotkeys */}
            <section className="shortcuts-group">
              <span className="shortcuts-group-title">
                <Command size={13} weight="light" aria-hidden />
                <span>Jump to View (Keys 1-8)</span>
              </span>
              <div className="shortcuts-grid">
                {VIEW_SHORTCUTS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="shortcut-row shortcut-row--interactive"
                    onClick={() => {
                      navigate(item.route)
                      onClose()
                    }}
                  >
                    <span className="shortcut-label">{item.label}</span>
                    <kbd className="shortcut-key font-mono">{item.key}</kbd>
                  </button>
                ))}
              </div>
            </section>

            {/* Workbench Controls Hotkeys */}
            <section className="shortcuts-group">
              <span className="shortcuts-group-title">
                <span>Actions & Display</span>
              </span>
              <div className="shortcuts-grid">
                {CONTROL_SHORTCUTS.map((ctrl) => {
                  const isSearch = ctrl.key === '⌘K' && onOpenSearch
                  return (
                    <div
                      key={ctrl.key}
                      className={`shortcut-row ${isSearch ? 'shortcut-row--interactive' : ''}`}
                      onClick={isSearch ? onOpenSearch : undefined}
                      role={isSearch ? 'button' : undefined}
                      tabIndex={isSearch ? 0 : undefined}
                    >
                      <span className="shortcut-label">{ctrl.desc}</span>
                      <kbd className="shortcut-key font-mono">{ctrl.key}</kbd>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          <footer className="shortcuts-foot hairline-top">
            <span className="shortcuts-hint">
              Press <kbd className="shortcut-key font-mono">?</kbd> anywhere to toggle this HUD
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}
