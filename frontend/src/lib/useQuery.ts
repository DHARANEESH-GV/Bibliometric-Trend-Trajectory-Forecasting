/**
 * useQuery — the app's one data-fetching hook: async loader + state,
 * with stable identity so effects don't thrash.
 */
import { useEffect, useState, type DependencyList } from 'react'

export interface QueryResult<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

export function useQuery<T>(
  loader: (...args: unknown[]) => Promise<T>,
  deps: DependencyList,
): QueryResult<T> {
  const [state, setState] = useState<QueryResult<T>>({
    data: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    loader()
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null })
      })
      .catch((err: Error) => {
        if (alive) setState({ data: null, loading: false, error: err })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
