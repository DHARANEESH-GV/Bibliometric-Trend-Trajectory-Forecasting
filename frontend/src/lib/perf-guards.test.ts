/**
 * Guards for the two performance fixes on this pass.
 *
 * 1. The in-app Motion toggle only ever reached JS (`motionReduced()`), so
 *    every CSS animation ignored it — including the ambient orb drift on
 *    the cover. The verdict is now mirrored onto <html data-motion>.
 *
 * 2. Charts that auto-play must not animate while off screen. The time
 *    lapse and bar race used to run a setOption loop from mount, which
 *    repainted two charts the user could not see (measured: 43fps while
 *    scrolling /matrix).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (...p: string[]) => readFileSync(resolve(__dirname, ...p), 'utf8')

describe('motion verdict reaches CSS, not just JS', () => {
  const motion = read('motion.ts')

  it('mirrors the verdict onto the document element', () => {
    expect(motion).toMatch(/documentElement\.dataset\.motion\s*=\s*'reduced'/)
  })

  it('clears the attribute when motion is restored', () => {
    expect(motion).toMatch(/delete\s+document\.documentElement\.dataset\.motion/)
  })

  it('syncs on every notify so a toggle takes effect immediately', () => {
    const notify = motion.match(/function notify\(\)[\s\S]*?\n}/)?.[0] ?? ''
    expect(notify).toContain('syncDocumentAttribute()')
  })

  it('the cover defers its orb drift to the same verdict', () => {
    const cover = read('..', 'views', 'cover.css')
    // CSS animations must opt out for BOTH the in-app toggle and the OS.
    expect(cover).toMatch(/\[data-motion='reduced'\]\s*\.orb\s*\{[^}]*animation:\s*none/)
    expect(cover).toMatch(/prefers-reduced-motion[\s\S]{0,120}\.orb\s*\{[^}]*animation:\s*none/)
  })
})

describe('auto-playing charts wait until they are on screen', () => {
  for (const name of ['TimeLapse.tsx', 'BarRace.tsx']) {
    it(`${name} gates autoplay on visibility`, () => {
      const src = read('..', 'components', name)
      expect(src).toContain("from '../lib/useInViewOnce'")
      // The autoplay effect must depend on inView and bail out when false.
      const effect = src.match(/useEffect\(\(\) => \{[\s\S]*?raceAutoRef[\s\S]*?\n  \}/)?.[0]
        ?? src.match(/useEffect\(\(\) => \{[\s\S]*?autoRef[\s\S]*?\n  \}/)?.[0]
        ?? ''
      expect(effect).toMatch(/!inView/)
    })
  }

  it('useInViewOnce reports visible when IntersectionObserver is absent', () => {
    const hook = read('useInViewOnce.ts')
    // A missing observer must not silently disable autoplay forever.
    expect(hook).toMatch(/typeof IntersectionObserver === 'undefined'/)
    expect(hook).toMatch(/setInView\(true\)/)
  })
})

describe('StagePill does not force layout during render', () => {
  it('resolves its stage ink via a CSS variable, not getComputedStyle', () => {
    // Strip comments first: the doc comment explains the old bug by name,
    // and matching prose is not the same as matching code.
    const raw = read('..', 'components', 'StagePill.tsx')
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // A getComputedStyle() during render is a forced synchronous layout; on
    // /matrix this ran 20x per render and measured 300ms of script per 3s.
    expect(code).not.toContain('getComputedStyle')
    expect(code).toMatch(/var\(\$\{token\}\)/)
  })
})

describe('the cover shader is removed', () => {
  const card = read('..', 'components', 'ui', 'hero-dithering-card.tsx')

  it('no longer mounts the heavy WebGL shader', () => {
    expect(card).not.toContain('@paper-design/shaders-react')
    expect(card).not.toContain('<Dithering')
  })
})

describe('the intro film is removed', () => {
  it('no longer loads or renders the intro video overlay', () => {
    const cover = read('..', 'views', 'Cover.tsx')
    expect(cover).not.toContain('biblio-explainer.mp4')
    expect(cover).not.toContain('cover-film')
  })
})
