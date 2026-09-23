/**
 * ErrorBoundary — SITE error state (§8: API down -> cached-snapshots
 * message; render crash -> explicit sentence, no blank page).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Render errors are user-visible problems, not data problems; keep a
    // breadcrumb in the console for development without crashing the shell.
    console.error('Render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 'var(--sp-7) 0', maxWidth: '60ch' }}>
          <h1 style={{ fontSize: 'var(--text-xl)' }}>Something failed while rendering.</h1>
          <p style={{ color: 'var(--ink-2)', marginTop: 'var(--sp-3)' }}>
            The rest of the site may still work. If this persists, try
            returning to the leaderboard.
          </p>
          <p className="num" style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)', marginTop: 'var(--sp-3)' }}>
            {this.state.error.message}
          </p>
          <p style={{ marginTop: 'var(--sp-4)' }}>
            <a href="/">Return to the leaderboard</a>
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
