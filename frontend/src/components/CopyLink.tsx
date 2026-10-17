/**
 * CopyLink — makes the URL-param view state discoverably shareable.
 * Copies the current location.href; inline confirmation, no alerts.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

export function CopyLink() {
  const location = useLocation()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = async () => {
    const url = `${window.location.origin}${location.pathname}${location.search}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard API can be denied (http, permissions). Fall back to a
      // transient textarea so the affordance still works.
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } finally {
        ta.remove()
      }
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1800)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        border: 'var(--hairline)',
        borderRadius: 'var(--r-control)',
        padding: '4px 10px',
        fontSize: 'var(--text-sm)',
        color: copied ? 'var(--stage-emerging)' : 'var(--ink-2)',
        transition: 'color var(--motion-fast), transform var(--motion-fast) cubic-bezier(0.32, 0.72, 0, 1)',
      }}
      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.98)' }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
    >
      {copied ? '✓ Copied' : 'Copy link'}
    </button>
  )
}
