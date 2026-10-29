/**
 * Guards for the Lag view's two hard wording rules, and for the contract that
 * it reads every figure from the snapshot rather than inventing one.
 *
 * These are source-level checks on purpose: the banned phrases are a product
 * decision about how the result may be described, and a rendering test would
 * not catch a phrase reintroduced in a comment-free string elsewhere.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8')

const LAG_VIEW = read('views', 'Lag.tsx')
const NAV = read('components', 'IslandNav.tsx')
const APP = read('App.tsx')

/** Strip comments so rationale in prose cannot trip the ban. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('lag wording rules', () => {
  const banned = [
    /papers?\s+lead\s+patents?\s+by/i,
    /research[\s-]*to[\s-]*patent\s+lag/i,
    /patents?\s+lag\s+papers?/i,
  ]

  it('never uses a causal lead/lag phrase in rendered copy', () => {
    const body = code(LAG_VIEW)
    for (const pattern of banned) {
      expect(body).not.toMatch(pattern)
    }
  })

  it('never uses a causal phrase anywhere in the app', () => {
    for (const file of ['views/Lag.tsx', 'views/Leaderboard.tsx', 'components/IslandNav.tsx']) {
      const body = code(read(...file.split('/')))
      for (const pattern of banned) {
        expect(body).not.toMatch(pattern)
      }
    }
  })

  it('states the association carefully and the pendency caveat', () => {
    expect(LAG_VIEW).toMatch(/shows\s+a weak association with/i)
    expect(LAG_VIEW).toMatch(/not a\s+research-to-invention lag/i)
  })

  it('qualifies both the domain-bootstrap CI and the significance', () => {
    // The interval must be labelled as assuming independence it does not have.
    expect(LAG_VIEW).toMatch(/resampling\s+domains \(assumes domains are independent, which they are not\)/)
    // The fragility sentence must be built from the robustness block.
    expect(LAG_VIEW).toMatch(/time_block_bootstrap\.ci_at_peak/)
    expect(LAG_VIEW).toMatch(/suggestive, not conclusive/)
  })

  it('labels the per-domain panel as exploratory', () => {
    expect(LAG_VIEW).toMatch(/Exploratory \(low statistical power\)/)
  })
})

describe('lag view is wired in', () => {
  it('has a nav entry', () => {
    expect(NAV).toMatch(/to:\s*'\/lag'/)
  })

  it('has a lazy route', () => {
    expect(APP).toMatch(/import\('\.\/views\/Lag'\)/)
    expect(APP).toMatch(/path="\/lag"/)
  })
})

describe('lag snapshot contract', () => {
  it('reads pooled numbers from the file, not literals in the JSX copy', () => {
    // The headline sentence must interpolate the values.
    expect(LAG_VIEW).toMatch(/pooled\.best_r/)
    expect(LAG_VIEW).toMatch(/pooled\.best_lag_ci\[0\]/)
    expect(LAG_VIEW).toMatch(/counts\.n_significant/)
  })

  it('renders the robustness table from the JSON block', () => {
    expect(LAG_VIEW).toMatch(/robust\.baseline/)
    expect(LAG_VIEW).toMatch(/leave_one_domain_out/)
    expect(LAG_VIEW).toMatch(/time_block_bootstrap/)
  })
})
