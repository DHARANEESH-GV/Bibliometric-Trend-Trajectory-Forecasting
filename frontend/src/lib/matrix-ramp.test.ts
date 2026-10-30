/**
 * Matrix ramp regression guards.
 *
 * The heatmap once rendered as a black void: its ramp tokens were
 * color-mix() strings, and zrender (ECharts' renderer) parses colors in
 * JS with no color-mix branch — an unparsable color silently falls back
 * to #000000 (VisualMapping.js: `return color || [0, 0, 0, 1]`). The CSS
 * legend looked correct because the browser DOES parse color-mix, which
 * made the failure invisible to every DOM-based check.
 *
 * These guards keep the ramp tokens zrender-parseable and keep the ramp's
 * dark floor visibly above the OLED page black, so low cells can never
 * dissolve into the background again.
 */
import { describe, expect, it } from 'vitest'
import { parse } from 'zrender/lib/tool/color.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tokensCss = readFileSync(
  resolve(__dirname, '../styles/tokens.css'),
  'utf8',
)

/** Pull a custom-property value out of :root (single-declaration form). */
function tokenValue(name: string): string | null {
  const re = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm')
  let value = tokensCss.match(re)?.[1]?.trim() ?? null
  // Resolve one level of var() reference — what the browser does before
  // the value ever reaches zrender.
  if (value?.startsWith('var(')) {
    const ref = value.match(/var\(\s*(--[\w-]+)\s*\)/)?.[1]
    if (ref) value = tokenValue(ref)
  }
  return value
}

describe('matrix ramp tokens are zrender-parseable', () => {
  const rampVars = ['--matrix-low', '--matrix-mid', '--matrix-high']

  for (const name of rampVars) {
    it(`${name} parses with the same parser zrender uses at render time`, () => {
      const value = tokenValue(name)
      expect(value, `${name} must be declared in tokens.css`).toBeTruthy()
      // zrender's own parse(): returns undefined for color-mix() and any
      // other syntax it cannot handle, which downstream becomes #000000.
      expect(parse(value as string), `${name} = ${value} is not zrender-parseable`).toBeDefined()
    })

    it(`${name} is not a color-mix() (zrender falls back to black on it)`, () => {
      const value = tokenValue(name) ?? ''
      expect(value.startsWith('color-mix')).toBe(false)
    })
  }
})

describe('matrix ramp floor clears the OLED page black', () => {
  it('--matrix-low is visibly lighter than --surface-0', () => {
    const low = parse(tokenValue('--matrix-low') as string)
    const surface0 = parse('#050507')
    expect(low).toBeDefined()
    expect(surface0).toBeDefined()
    // Luminance gap between the ramp floor and the page black must be a
    // visible step (>= 0.02 in 0-1 luma), not a hair.
    const luma = (c: number[]) =>
      0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number)
    const gap = (luma(low as number[]) - luma(surface0 as number[])) / 255
    expect(gap).toBeGreaterThanOrEqual(0.02)
  })
})

describe('matrix legend mirrors the chart ramp', () => {
  it('legend gradient uses the same literal stops as the tokens', () => {
    const css = readFileSync(resolve(__dirname, '../views/matrix.css'), 'utf8')
    const cap = css.match(/\.matrix-legend-cap\s*{[\s\S]*?}/)?.[0] ?? ''
    for (const hex of ['#26272e', '#8a6a34', '#f5b84c']) {
      expect(cap.includes(hex), `legend cap missing ${hex}`).toBe(true)
    }
    // The old ramp started at surface-1; its presence would mean drift.
    expect(cap.includes('var(--surface-1)')).toBe(false)
  })
})
