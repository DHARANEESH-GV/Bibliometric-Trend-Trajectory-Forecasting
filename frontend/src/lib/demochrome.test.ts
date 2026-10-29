/**
 * Guards for the demo-chrome copy: the banned-phrase rule must survive the
 * new "How to read this" panel, and the new controls must not smuggle
 * hardcoded figures into the UI.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..')
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8')

const HOWTO = read('components', 'HowToRead.tsx')
const GLOSSARY = read('components', 'GlossaryTerm.tsx')
const PROVENANCE = read('components', 'ProvenanceFooter.tsx')
const TOUR = read('components', 'TourStrip.tsx')
const NAV = read('components', 'IslandNav.tsx')
const LAG = read('views', 'Lag.tsx')

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const BANNED = [
  /papers?\s+lead\s+patents?\s+by/i,
  /research[\s-]*to[\s-]*patent\s+lag/i,
]

describe('banned phrasing stays banned in new copy', () => {
  const files: Array<[string, string]> = [
    ['HowToRead.tsx', HOWTO],
    ['GlossaryTerm.tsx', GLOSSARY],
    ['ProvenanceFooter.tsx', PROVENANCE],
    ['TourStrip.tsx', TOUR],
  ]

  for (const [name, src] of files) {
    it(`${name} avoids both banned phrases`, () => {
      const body = code(src)
      for (const p of BANNED) expect(body).not.toMatch(p)
    })
  }
})

describe('the new explainer covers what it must', () => {
  it('explains that grant dates include examination time', () => {
    expect(HOWTO).toMatch(/examination time/i)
  })

  it('defines Reliable, Exploratory and Low confidence', () => {
    expect(HOWTO).toMatch(/Reliable/)
    expect(HOWTO).toMatch(/Exploratory/)
    expect(HOWTO).toMatch(/Low confidence/)
  })

  it('glosses CPC, burst, emergence score and placebo test', () => {
    for (const term of ['cpc', 'burst', 'emergence score', 'placebo test']) {
      expect(GLOSSARY.toLowerCase()).toContain(term)
    }
  })
})

describe('presentation mode is persisted safely', () => {
  it('wraps localStorage access in try/catch', () => {
    const presentation = read('lib', 'presentation.ts')
    expect(presentation).toMatch(/try\s*{/)
    expect(presentation).toMatch(/catch\s*{/)
    expect(presentation).toMatch(/localStorage/)
  })

  it('is wired to a keyboard-reachable nav button with aria-pressed', () => {
    expect(NAV).toMatch(/aria-pressed={presentation}/)
    expect(NAV).toMatch(/usePresentation/)
  })
})

describe('numbers are read, not typed', () => {
  it('provenance footer reads windows from the snapshot', () => {
    expect(PROVENANCE).toMatch(/lag\.data\?\.windows/)
    expect(PROVENANCE).toMatch(/_meta/)
    // No literal year ranges baked into the footer.
    expect(PROVENANCE).not.toMatch(/20\d\dQ\d/)
  })

  it('tour takes its domain step from the leaderboard snapshot', () => {
    expect(TOUR).toMatch(/loadLeaderboard/)
    expect(TOUR).toMatch(/leaderboard\[0\]/)
  })

  it('lag slider correlation comes from the series, not a constant', () => {
    expect(LAG).toMatch(/rAtLag\(papers, patents, k\)/)
    expect(LAG).not.toMatch(/r=\{0\.\d/)
  })
})

describe('tour is off by default', () => {
  it('only activates when the start button sets sessionStorage', () => {
    expect(TOUR).toMatch(/sessionStorage/)
    expect(TOUR).toMatch(/getItem\(KEY\) === 'active'/)
  })
})
