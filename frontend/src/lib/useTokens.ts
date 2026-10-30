/**
 * useTokens — the current ThemeTokens.
 *
 * Biblio is dark only, so the palette is read once per mount and never
 * changes. Kept as a hook (rather than a constant) so chart components did
 * not all have to change shape when the light theme was removed, and so a
 * future palette swap has exactly one place to hook into.
 */
import { useMemo } from 'react'
import { readTokens, type ThemeTokens } from '../charts/echarts'

export function useTokens(): ThemeTokens {
  return useMemo(() => readTokens(), [])
}
