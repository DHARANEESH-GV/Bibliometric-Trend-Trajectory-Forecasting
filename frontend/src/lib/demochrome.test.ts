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

describe('there is no theme or presentation mode', () => {
  it('never reads a stored theme preference', () => {
    // Biblio is dark only. A `bt-theme` read would mean a light variant
    // survived somewhere, and those blocks were dead, half-maintained code.
    const presentation = read('lib', 'store.tsx')
    expect(presentation).not.toMatch(/bt-theme/)
    expect(presentation).not.toMatch(/data-theme/)
  })

  it('has no presentation-mode module', () => {
    // Removed outright: the reading mode duplicated what the motion toggle
    // and the browser's own zoom already do.
    expect(() => read('lib', 'presentation.ts')).toThrow()
  })

  it('ships no presentation-mode CSS hooks', () => {
    const demo = read('styles', 'demo.css')
    expect(demo).not.toMatch(/data-presentation/)
  })

  it('still offers a keyboard-reachable motion toggle', () => {
    expect(NAV).toMatch(/setMotionChoice/)
    expect(NAV).toMatch(/useMotionReduced/)
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

describe('tour is a first-visit entry ramp', () => {
  it('auto-opens exactly once, then never again', () => {
    // The tour is no longer opt-in behind a button nobody pressed: it opens
    // itself on the first workbench visit and records that it was seen, so a
    // returning visitor is never interrupted a second time.
    expect(TOUR).toMatch(/maybeAutoStartTour/)
    expect(TOUR).toMatch(/localStorage\.getItem\(SEEN_KEY\)/)
    expect(TOUR).toMatch(/localStorage\.setItem\(SEEN_KEY, '1'\)/)
  })

  it('still activates its strip through sessionStorage', () => {
    expect(TOUR).toMatch(/sessionStorage/)
    expect(TOUR).toMatch(/getItem\(KEY\) === 'active'/)
  })

  it('closes via a dismiss control that also marks it seen', () => {
    expect(TOUR).toMatch(/dismissTour/)
    expect(TOUR).toMatch(/markSeen/)
  })

  it('every step is reachable from inside the workbench', () => {
    // The strip only mounts on non-cover routes, so a "/" step could never
    // be the highlighted one. Guards against reintroducing a dead step.
    const steps = TOUR.slice(TOUR.indexOf('const STEPS'))
    expect(steps).not.toMatch(/path: \(\) => '\/'/)
  })
})
