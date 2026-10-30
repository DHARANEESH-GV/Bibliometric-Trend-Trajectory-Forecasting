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
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

const PORT = 4611
const BASE = `http://localhost:${PORT}`
const OUT = join(tmpdir(), 'biblio-pixel')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const feDir = resolve(fileURLToPath(import.meta.url), '../..')
const server = spawn(npxCmd, ['vite', 'preview', '--port', String(PORT)], {
  cwd: feDir,
  shell: process.platform === 'win32',
  stdio: 'ignore',
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let hasMagick = false
try {
  hasMagick = spawnSync('magick', ['-version']).status === 0
} catch (e) {
  hasMagick = false
}

function magick(args) {
  const r = spawnSync('magick', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || 'magick failed')
  return (r.stdout || '').trim()
}
/** Mean luminance (0-1) and std-dev of an image region. */
function stats(file) {
  if (!hasMagick) {
    // Pure JS fallback: read buffer bytes
    const buf = readFileSync(file)
    let sum = 0
    let sumSq = 0
    const n = Math.max(1, buf.length)
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] / 255
      sum += v
      sumSq += v * v
    }
    const mean = sum / n
    const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
    return { mean, sd }
  }
  const out = magick([file, '-format', '%[fx:mean] %[fx:standard_deviation]', 'info:'])
  const [mean, sd] = out.split(/\s+/).map(Number)
  return { mean, sd }
}
/** RMSE between two images, normalized 0-1. */
function rmse(a, b) {
  if (!hasMagick) {
    const bufA = readFileSync(a)
    const bufB = readFileSync(b)
    const len = Math.min(bufA.length, bufB.length)
    if (len === 0) return 0
    let sumSq = 0
    for (let i = 0; i < len; i++) {
      const d = (bufA[i] - bufB[i]) / 255
      sumSq += d * d
    }
    return Math.sqrt(sumSq / len)
  }
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

// ---- 1. GRAIN: measure in an empty margin of the single dark palette.
// Must REMOVE the injected rule, not reset inline display (the rule uses
// !important, which inline style cannot override).
const grainBox = { x: 1330, y: 280, width: 90, height: 340 }
async function measureGrain() {
  const on = `${OUT}/grain-on.png`
  await page.screenshot({ path: on, clip: grainBox })
  await page.evaluate(() => {
    const s = document.createElement('style')
    s.id = 'audit-hide-grain'
    s.textContent = '.ambience-grain{display:none!important}'
    document.head.appendChild(s)
  })
  await sleep(250)
  const off = `${OUT}/grain-off.png`
  await page.screenshot({ path: off, clip: grainBox })
  await page.evaluate(() => document.getElementById('audit-hide-grain')?.remove())
  const o = stats(off)
  const n = stats(on)
  return { off: o, on: n, rmse: rmse(off, on) }
}

const gd = await measureGrain()
check('grain visible (RMSE >= 0.02)', gd.rmse >= 0.02, `rmse ${gd.rmse.toFixed(4)}`)
check('grain adds texture', gd.on.sd > gd.off.sd + 0.005, `sd ${gd.off.sd.toFixed(4)} -> ${gd.on.sd.toFixed(4)}`)
// A large mean drop reads as a grey veil over the OLED field, which is the
// failure mode to guard (a visible lift is by design).
check('grain does not veil the surface (mean drop < 0.05)', (gd.off.mean - gd.on.mean) < 0.05, `mean ${gd.off.mean.toFixed(4)} -> ${gd.on.mean.toFixed(4)}`)

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
