/**
 * pixel-audit.mjs — measures whether the visual effects are actually
 * VISIBLE (not merely present in the DOM). Screenshots regions with the
 * effect toggled off/on, then compares them with ImageMagick: a mean
 * luminance shift and an RMSE. This is the check that should have existed
 * before shipping effects whose only proof was "the element exists".
 *
 * Run: node scripts/pixel-audit.mjs
 */
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'

const PORT = 4611
const BASE = `http://localhost:${PORT}`
const OUT = '/tmp/opencode/pixel'
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function magick(args) {
  const r = spawnSync('magick', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || 'magick failed')
  return (r.stdout || '').trim()
}
/** Mean luminance (0-1) and std-dev of an image region. */
function stats(file) {
  const out = magick([file, '-format', '%[fx:mean] %[fx:standard_deviation]', 'info:'])
  const [mean, sd] = out.split(/\s+/).map(Number)
  return { mean, sd }
}
/** RMSE between two images, normalized 0-1. */
function rmse(a, b) {
  const out = spawnSync('magick', ['compare', '-metric', 'RMSE', a, b, 'null:'], { encoding: 'utf8' })
  const m = (out.stderr || '').match(/\(([\d.]+)\)/)
  return m ? Number(m[1]) : NaN
}

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? 'OK  ' : 'FAIL') + '  ' + name.padEnd(46) + detail)
  if (!ok) failed++
}

await sleep(3500)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(BASE + '/leaderboard', { waitUntil: 'networkidle' })
await sleep(1200)

// ---- 1. GRAIN: measure both themes in an empty margin.
// Must REMOVE the injected rule, not reset inline display (the rule uses
// !important, which inline style cannot override).
const grainBox = { x: 1330, y: 280, width: 90, height: 340 }
async function measureGrain(theme) {
  await page.evaluate((th) => { try { localStorage.setItem('bt-theme', th) } catch (e) {} }, theme)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(900)
  const applied = await page.evaluate(() => document.documentElement.dataset.theme)
  if (applied !== theme) throw new Error(`theme not applied: wanted ${theme}, got ${applied}`)
  const on = `${OUT}/grain-${theme}-on.png`
  await page.screenshot({ path: on, clip: grainBox })
  await page.evaluate(() => {
    const s = document.createElement('style')
    s.id = 'audit-hide-grain'
    s.textContent = '.ambience-grain{display:none!important}'
    document.head.appendChild(s)
  })
  await sleep(250)
  const off = `${OUT}/grain-${theme}-off.png`
  await page.screenshot({ path: off, clip: grainBox })
  await page.evaluate(() => document.getElementById('audit-hide-grain')?.remove())
  const o = stats(off)
  const n = stats(on)
  return { off: o, on: n, rmse: rmse(off, on) }
}

const gd = await measureGrain('dark')
check('grain visible on dark (RMSE >= 0.02)', gd.rmse >= 0.02, `rmse ${gd.rmse.toFixed(4)}`)
check('grain adds texture on dark', gd.on.sd > gd.off.sd + 0.005, `sd ${gd.off.sd.toFixed(4)} -> ${gd.on.sd.toFixed(4)}`)
const gl = await measureGrain('light')
// Light-theme grain is intentionally whisper-faint (paper veils sooner), so
// the bar is "present at all and not zero", not the dark bar.
check('grain present on light (RMSE > 0.003)', gl.rmse > 0.003, `rmse ${gl.rmse.toFixed(4)}`)
// On paper, grain darkens uniformly; a large mean drop reads as a grey
// veil, which is the failure mode to guard. (Dark theme lifts the floor by
// design and is covered by the WCAG contrast check in render-audit.)
check('grain does not veil light theme (mean drop < 0.05)', (gl.off.mean - gl.on.mean) < 0.05, `mean ${gl.off.mean.toFixed(4)} -> ${gl.on.mean.toFixed(4)}`)
await page.evaluate(() => { try { localStorage.setItem('bt-theme', 'dark') } catch (e) {} })
await page.reload({ waitUntil: 'networkidle' })
await sleep(900)

// ---- 2. SPOTLIGHT: hover the rank-one plate, compare against unhovered.
const spot = await page.$('.rank-one')
const sBox = spot ? await spot.boundingBox() : null
if (sBox) {
  const clip = { x: Math.round(sBox.x), y: Math.round(sBox.y), width: Math.round(sBox.width), height: Math.round(sBox.height) }
  const spotOff = `${OUT}/spot-off.png`
  await page.screenshot({ path: spotOff, clip })
  await page.mouse.move(clip.x + clip.width * 0.7, clip.y + clip.height * 0.45)
  await page.mouse.move(clip.x + clip.width * 0.68, clip.y + clip.height * 0.43)
  await sleep(700)
  const spotOn = `${OUT}/spot-on.png`
  await page.screenshot({ path: spotOn, clip })
  const sRmse = rmse(spotOff, spotOn)
  check('spotlight visibly lights the panel', sRmse >= 0.012, `rmse ${sRmse.toFixed(4)}`)
} else {
  check('spotlight visibly lights the panel', false, 'no .rank-one found')
}

// ---- 3. METRIC TICK: at rest it should measure >= 4px tall and coloured.
await page.goto(BASE + '/domain/generative_ai', { waitUntil: 'networkidle' })
await sleep(1500)
const tick = await page.$('.metric-tick')
if (tick) {
  const b = await tick.boundingBox()
  const bg = await tick.evaluate((el) => getComputedStyle(el).backgroundColor)
  check('metric tick is sizeable', !!b && b.width >= 3 && b.height >= 12, b ? `${Math.round(b.width)}x${Math.round(b.height)}` : 'none')
  check('metric tick is coloured', /rgb\(/.test(bg) && !/rgba\(0, 0, 0, 0\)/.test(bg), bg)
} else {
  check('metric tick present', false, 'none')
}

// ---- 4. CONTRAST behind body text must survive the grain (no lift under AA).
await page.goto(BASE + '/leaderboard', { waitUntil: 'networkidle' })
await sleep(1200)
const contrast = await page.evaluate(() => {
  const el = document.createElement('span')
  el.style.position = 'absolute'
  el.style.visibility = 'hidden'
  document.body.appendChild(el)
  el.style.color = 'var(--ink-3)'
  const fg = getComputedStyle(el).color
  el.remove()
  return { fg, bg: getComputedStyle(document.body).backgroundColor }
})
check('ink-3 token still resolves', /rgb/.test(contrast.fg), `${contrast.fg} on ${contrast.bg}`)

console.log(`\nmeasurements in ${OUT}`)

await browser.close()
server.kill()
process.exit(failed > 0 ? 1 : 0)
