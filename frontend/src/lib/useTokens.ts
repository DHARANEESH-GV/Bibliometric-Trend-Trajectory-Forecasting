/**
 * useTokens — hook exposing the current ThemeTokens; re-renders consumers
 * when the theme attribute flips on <html>.
 */
import { useEffect, useState } from 'react'
import { readTokens, type ThemeTokens } from '../charts/echarts'

export function useTokens(): ThemeTokens {
  const [tokens, setTokens] = useState<ThemeTokens>(() => readTokens())

  useEffect(() => {
    const observer = new MutationObserver(() => setTokens(readTokens()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return tokens
}
