/**
 * ViewController — URL-param-driven sort/filter controls for the
 * Leaderboard. All view state lives in the URL so any chart/table is
 * shareable (master plan §8).
 */
import { useSearchParams } from 'react-router-dom'

export type SortKey = 'rank' | 'score' | 'yoy' | 'name'
export type SortDir = 'asc' | 'desc'
export type LabelFilter = 'all' | 'Emerging' | 'Accelerating' | 'Active' | 'Watch'

const SORT_KEYS: SortKey[] = ['rank', 'score', 'yoy', 'name']
const LABELS: LabelFilter[] = ['all', 'Emerging', 'Accelerating', 'Active', 'Watch']

interface ViewControllerProps {
  /** Extra filter surface for views that reuse this (e.g. domain filter). */
  showSort?: boolean
}

export function ViewController({ showSort = true }: ViewControllerProps) {
  const [params, setParams] = useSearchParams()

  const sort = (params.get('sort') as SortKey) ?? 'rank'
  const dir = (params.get('dir') as SortDir) ?? 'asc'
  const label = (params.get('label') as LabelFilter) ?? 'all'

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const selectStyle = {
    font: 'inherit',
    fontSize: 'var(--text-sm)',
    color: 'var(--ink-0)',
    background: 'var(--surface-1)',
    border: 'var(--hairline)',
    borderRadius: 2,
    padding: '4px 8px',
  } as const

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
              style={selectStyle}
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
              borderRadius: 2,
              padding: '4px 10px',
              fontSize: 'var(--text-sm)',
            }}
            aria-label={`Sort direction ${dir === 'asc' ? 'ascending' : 'descending'} — click to flip`}
          >
            {dir === 'asc' ? '↑' : '↓'}
          </button>
        </>
      ) : null}
      <label style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>
        Stage{' '}
        <select
          value={label}
          onChange={(e) => update('label', e.target.value)}
          style={selectStyle}
        >
          {LABELS.map((l) => (
            <option key={l} value={l}>
              {l === 'all' ? 'All stages' : l}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export type { ViewControllerProps }
