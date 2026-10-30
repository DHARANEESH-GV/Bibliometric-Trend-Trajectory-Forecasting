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

describe('the cover shader does not animate while idle', () => {
  // The shader redraws every frame while its speed is non-zero. Measured
  // 2026-10-30 under 4x CPU throttle: an always-moving shader cost 896ms of
  // main-thread task time per second (vs 161ms frozen) and held the cover at
  // 40.5fps instead of 56.9. `speed: 0` makes @paper-design stop its rAF loop
  // outright (shader-mount.js only calls requestRender when speed !== 0), so
  // it must be the idle value — not a low non-zero one.
  const card = read('..', 'components', 'ui', 'hero-dithering-card.tsx')

  it('freezes the shader when the card is not hovered', () => {
    expect(card).toMatch(/speed=\{[^}]*isHovered[^}]*:\s*0\s*\}/)
  })

  it('never ships a non-zero idle speed', () => {
    // Guards the specific regression: `isHovered ? 0.6 : 0.2` is always-on.
    expect(card).not.toMatch(/isHovered\s*\?\s*[\d.]+\s*:\s*0\.\d+/)
  })
})

describe('the intro film does not buffer on load', () => {
  it('uses preload="none" so the 9.9MB file waits for play()', () => {
    const cover = read('..', 'views', 'Cover.tsx')
    expect(cover).toMatch(/preload="none"/)
    expect(cover).not.toMatch(/preload="metadata"/)
  })
})
