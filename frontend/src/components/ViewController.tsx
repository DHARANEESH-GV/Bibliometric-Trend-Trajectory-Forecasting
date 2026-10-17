/**
 * ViewController — URL-param-driven sort/filter controls for the
 * Leaderboard. All view state lives in the URL so any chart/table is
 * shareable (master plan §8).
 *
 * Stage is a chip row rather than a select: it shows the per-stage counts
 * computed from the loaded snapshot, so the filter doubles as a legend.
 */
import { useSearchParams } from 'react-router-dom'
import { STAGE_TOKEN } from '../lib/types'

export type SortKey = 'rank' | 'score' | 'yoy' | 'name'
export type SortDir = 'asc' | 'desc'
export type LabelFilter = 'all' | 'Emerging' | 'Accelerating' | 'Active' | 'Watch'

const SORT_KEYS: SortKey[] = ['rank', 'score', 'yoy', 'name']
const LABELS: LabelFilter[] = ['all', 'Emerging', 'Accelerating', 'Active', 'Watch']

interface ViewControllerProps {
  /** Extra filter surface for views that reuse this (e.g. domain filter). */
  showSort?: boolean
  /** Per-stage counts from the loaded snapshot, keyed by label. */
  stageCounts?: Record<string, number>
  /** Total row count, for the "All" chip. */
  total?: number
}

export const SELECT_STYLE = {
  font: 'inherit',
  fontSize: 'var(--text-sm)',
  color: 'var(--ink-0)',
  background: 'var(--surface-1)',
  border: 'var(--hairline)',
  borderRadius: 'var(--r-control)',
  padding: '4px 8px',
} as const

export function ViewController({ showSort = true, stageCounts, total }: ViewControllerProps) {
  const [params, setParams] = useSearchParams()

  const sort = (params.get('sort') as SortKey) ?? 'rank'
  const dir = (params.get('dir') as SortDir) ?? 'asc'
  const label = (params.get('label') as LabelFilter) ?? 'all'

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--sp-3)',
        alignItems: 'center',
      }}
      role="group"
      aria-label="View controls"
    >
      {showSort ? (
        <>
          <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
            Sort{' '}
            <select
              value={sort}
              onChange={(e) => update('sort', e.target.value)}
              style={SELECT_STYLE}
            >
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k === 'rank' ? 'Rank' : k === 'score' ? 'Emergence score' : k === 'yoy' ? 'YoY change' : 'Name'}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => update('dir', dir === 'asc' ? 'desc' : 'asc')}
            style={{
              border: 'var(--hairline)',
              borderRadius: 'var(--r-control)',
              padding: '4px 10px',
              fontSize: 'var(--text-sm)',
            }}
            aria-label={`Sort direction ${dir === 'asc' ? 'ascending' : 'descending'}, click to flip`}
          >
            {dir === 'asc' ? '↑' : '↓'}
          </button>
        </>
      ) : null}

      <div className="stage-chips" role="group" aria-label="Filter by stage">
        {LABELS.map((l) => {
          const count = l === 'all' ? total : stageCounts?.[l] ?? 0
          const token = l === 'all' ? undefined : STAGE_TOKEN[l]
          const on = label === l
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              className={`stage-chip${on ? ' stage-chip--on' : ''}`}
              onClick={() => update('label', l)}
              style={token ? ({ '--chip-token': `var(${token})` } as React.CSSProperties) : undefined}
            >
              {token ? <span className="stage-chip-dot" aria-hidden /> : null}
              <span>{l === 'all' ? 'All' : l}</span>
              {typeof count === 'number' ? <span className="stage-chip-count num">{count}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type { ViewControllerProps }
