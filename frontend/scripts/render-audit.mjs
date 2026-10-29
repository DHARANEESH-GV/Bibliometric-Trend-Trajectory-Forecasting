/**
 * Headless render + interaction audit: boots vite preview, visits every
 * route in real chromium, and fails on (a) ErrorBoundary text, (b) blank
 * bodies, (c) page errors / console errors, (d) broken interactions.
 * Run: node scripts/render-audit.mjs
 *
 * Interaction checks (UX round):
 *  - Leaderboard pin button focuses the score panel (touch parity)
 *  - CopyLink control present on param-driven views
 *  - Trajectory forecast band series present for a selected domain
 *  - Matrix row-tail nav links exist
 *  - /bursts?domain= pre-filters the feed
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const PORT = 4599
const BASE = `http://localhost:${PORT}`

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
})
server.on('error', (e) => {
  console.error('preview server failed to start:', e.message)
  process.exit(1)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(3500)

const browser = await chromium.launch()
const page = await browser.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(`${page.url()} pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`${page.url()} console error: ${m.text().slice(0, 200)}`)
})

let failed = 0
const report = (name, ok, detail = '') => {
  console.log((ok ? 'OK  ' : 'FAIL'), name.padEnd(34), detail)
  if (!ok) failed++
}

// --- Render pass: every route loads with content and no boundary ---
const ROUTES = [
  '/?film=0',
  '/leaderboard',
  '/trajectory',
  '/bursts',
  '/matrix',
  '/about',
  '/domain/ai_agents',
  '/domain/quantum_computing',
]
for (const route of ROUTES) {
  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 20000 })
  } catch (e) {
    problems.push(`${route} navigation failed: ${e.message.split('\n')[0]}`)
  }
  await sleep(700)
  const boundary = await page.$('text=Something failed while rendering')
  const body = await page.textContent('body').catch(() => '')
  const ok = !boundary && body && body.length > 200
  report(`render ${route}`, !!ok, boundary ? 'ERROR-BOUNDARY' : ok ? '' : 'BLANK')
}

// --- Interaction 1: leaderboard pin ---
await page.goto(BASE + '/leaderboard', { waitUntil: 'networkidle' })
await sleep(600)
const panelBefore = await page.textContent('aside h2').catch(() => null)
const pinButtons = await page.$$('button[aria-label^="Pin "]')
if (pinButtons.length >= 2) {
  // pin the third visible pin button (rank 3)
  await pinButtons[2].click()
  await sleep(300)
  const panelAfter = await page.textContent('aside h2').catch(() => null)
  report('leaderboard pin focuses panel', !!panelAfter && panelAfter !== panelBefore, `panel: ${panelBefore} -> ${panelAfter}`)
  await pinButtons[2].click() // unpin
} else {
  report('leaderboard pin focuses panel', false, `pin buttons: ${pinButtons.length}`)
}

// --- Interaction 2: CopyLink present on param views ---
for (const route of ['/leaderboard', '/trajectory', '/bursts', '/matrix']) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await sleep(400)
  const btn = await page.$('text=Copy link')
  report(`copy-link on ${route}`, !!btn)
}

// --- Interaction 3: forecast band renders on trajectory with selection ---
await page.goto(BASE + '/trajectory?domains=ai_agents', { waitUntil: 'networkidle' })
await sleep(900)
const svgPaths = await page.$$eval('svg path', (ps) => ps.length).catch(() => 0)
report('trajectory renders (band svgs present)', svgPaths > 10, `svg paths: ${svgPaths}`)

// --- Interaction 4: matrix row tails link to drill-downs ---
await page.goto(BASE + '/matrix', { waitUntil: 'networkidle' })
await sleep(700)
const tailLinks = await page.$$eval('nav[aria-label="Domains in this matrix"] a', (as) => as.length).catch(() => 0)
report('matrix row-tail links', tailLinks === 20, `links: ${tailLinks}`)

// --- Interaction 5: bursts deep-link pre-filter ---
await page.goto(BASE + '/bursts?domain=biotechnology', { waitUntil: 'networkidle' })
await sleep(700)
const selectVal = await page.$eval('select', (el) => el.value).catch(() => null)
report('bursts ?domain pre-filter', selectVal === 'biotechnology', `select: ${selectVal}`)

// --- Hero dithering card (shadcn ui/ primitive on the cover) ---
await page.goto(BASE + '/?film=0', { waitUntil: 'networkidle' })
await sleep(1600) // allow lazy shader chunk
const card = await page.$('section[aria-label="Biblio cover card"]')
report('hero card mounts', !!card)
if (card) {
  const cardBg = await page.$eval('.cover-bento-cell-a .plate-core', (el) => getComputedStyle(el).backgroundColor)
  report('card token bridge resolves (opaque, not transparent)', !/rgba\(0, 0, 0, 0\)/.test(cardBg), `bg: ${cardBg}`)
  const cardBorder = await card.$eval('[class*="rounded-[calc(2.75rem-0.375rem)]"]', (el) => getComputedStyle(el).borderTopColor)
  report('card border token resolves (border-border)', !/rgba\(0, 0, 0, 0\)/.test(cardBorder), `border: ${cardBorder}`)
  const headline = await card.$eval('h2', (el) => el.textContent || '')
  report('card headline is Biblio voice', /Every field/.test(headline), headline.slice(0, 34))
  const kicker = (await card.$eval('.mb-8', (el) => el.textContent || '')).trim()
  report('card kicker carries run id', /Issue \d+/.test(kicker), kicker.slice(0, 36))
  const desc = await card.$eval('p.max-w-2xl', (el) => el.textContent || '')
  report('card description honest-prose', /Twenty research fields/.test(desc), desc.slice(0, 60))
  const ctaBtn = await card.$('button.group')
  report('card CTA present', !!ctaBtn)
  // double-bezel: card div nests inside an outer shell with concentric radius
  const bezel = await card.$eval('[class*="rounded-[calc(2.75rem-0.375rem)]"]', (el) => {
    const outer = el.parentElement
    return {
      outerPad: getComputedStyle(outer).padding,
      outerRing: getComputedStyle(outer).boxShadow !== 'none',
      innerRadius: getComputedStyle(el).borderTopLeftRadius,
    }
  }).catch(() => null)
  report('double-bezel architecture', !!bezel && bezel.outerPad.includes('6px') && bezel.innerRadius.includes('30.5'), bezel ? JSON.stringify(bezel) : 'missing')
  // button-in-button: arrow in its own circle
  const arrowWrap = await card.$('button.group span[class*="rounded-full"]')
  report('button-in-button arrow wrapper', !!arrowWrap)
  // bento teases: grid-template-areas with 2fr 1fr
  const bento = await page.$$eval('.cover-teases', (els) => {
    const g = getComputedStyle(els[0])
    return { areas: g.gridTemplateAreas !== 'none', cols: g.gridTemplateColumns }
  }).catch(() => null)
  report('bento teases (asymmetric grid)', !!bento && bento.areas, bento ? bento.cols.slice(0, 30) : 'missing')
}

// Shader visibility + motion (page-level, works under any OS color scheme):
await sleep(1200)
const grab = async () => {
  const png = await page.screenshot()
  return page.evaluate(async (b64) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode()
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(i, 0, 0)
    return Array.from(g.getImageData(0, 0, i.width, i.height).data)
  }, png.toString('base64'))
}
const sc1 = await page.screenshot()
const d1 = await grab()
await sleep(2500)
const sc2 = await page.screenshot()
const d2 = await grab()
const byteDelta = Math.abs(sc2.length - sc1.length)
let warm = 0, moved = 0
for (let j = 0; j < d1.length; j += 4) {
  if (d2[j] > 120 && d2[j] > d2[j + 2] + 25) warm++
  if (Math.abs(d1[j] - d2[j]) + Math.abs(d1[j+1] - d2[j+1]) + Math.abs(d1[j+2] - d2[j+2]) > 4) moved++
}
report('shader dithering visibly painting', warm > 300, `warm px: ${warm}`)
report('shader animating between frames', moved > 1500 || byteDelta > 300, `moved px: ${moved}, png delta: ${byteDelta}`)


// --- Compliance: copy bans, favicon, social meta ---
await page.goto(BASE + '/?film=0', { waitUntil: 'networkidle' })
await sleep(1000)
const renderedText = await page.evaluate(() => document.body.textContent || '')
report('zero em-dashes in rendered copy', !renderedText.includes('\u2014'), `em-dash count: ${(renderedText.match(/\u2014/g) || []).length}`)
report('zero en-dashes in rendered copy', !renderedText.includes('\u2013'), `en-dash count: ${(renderedText.match(/\u2013/g) || []).length}`)
report('zero middle-dots in rendered copy', !renderedText.includes(' \u00b7 '), `mid-dot count: ${(renderedText.match(/ \u00b7 /g) || []).length}`)
const docTitle = await page.title()
report('document title has no em/en dash', !/[\u2013\u2014]/.test(docTitle), `title: ${docTitle}`)
const html = await page.content()
report('favicon wired', html.includes('rel="icon"'))
report('og/twitter meta present', html.includes('og:title') && html.includes('twitter:card'), `og tags: ${(html.match(/og:/g) || []).length}`)
const phosphor = await page.$('section[aria-label="Biblio cover card"] button.group svg')
report('card icon svg rendering (phosphor)', !!phosphor)

// --- Cover: Ink & Paper world, computed plates, curtain entry ---
await page.goto(BASE + '/?film=0', { waitUntil: 'networkidle' })
await sleep(900)
const scope = await page.$('.cover-scope')
report('cover renders its own world', !!scope)
const bg = scope ? await scope.evaluate((el) => getComputedStyle(el).backgroundColor) : ''
report('cover is OLED glass world', /5, 5, 7/.test(bg), `bg: ${bg}`)
// Regression guard: the masked hero lines must settle into view. If the
// entrance tween is ever re-run against a stale inline transform it parks
// them at translateY(~118%) inside their overflow clip (invisible text).
await sleep(1600)
const heroLines = await page.$$eval('.reveal-line > span', (els) =>
  els.map((el) => {
    const c = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const line = el.parentElement.getBoundingClientRect()
    return { transform: c.transform, visible: c.visibility === 'visible' && c.opacity !== '0', inside: r.top < line.bottom - 4 }
  }),
).catch(() => [])
const heroOk = heroLines.length > 0 && heroLines.every((h) => h.visible && h.inside)
report('hero masked lines settle visible', heroOk, heroLines.map((h) => h.transform).join(' | '))
const title = await page.textContent('section[aria-label="Biblio cover card"] h2').catch(() => '')
report('card headline present', /Every field, in plain sight/i.test(title || ''), (title || '').slice(0, 40))
const coverStats = await page.$$eval('.cover-stats .cover-stat', (as) => as.length).catch(() => 0)
report('cover stat plates (4 links)', coverStats === 4, `plates: ${coverStats}`)
const statFig = await page.$eval('.cover-stat .stat-figure', (el) => el.textContent || '').catch(() => '')
report('cover count-up lands on real value', statFig.trim() === '20', `figure: ${statFig}`)
const wireLinks = await page.$$eval('.cover-wire .wire-card', (as) => as.length).catch(() => 0)
report('cover wire cards (2x for loop)', wireLinks === 40, `cards: ${wireLinks}`)
const x1 = await page.$eval('.wire-track', (el) => el.getBoundingClientRect().x)
await sleep(1200)
const x2 = await page.$eval('.wire-track', (el) => el.getBoundingClientRect().x)
report('wire is animating', Math.abs(x2 - x1) > 2, `dx: ${(x2 - x1).toFixed(1)}px`)
const teases = await page.$$eval('.cover-teases .cover-tease', (ts) => ts.length).catch(() => 0)
report('cover teases (i, ii, iii)', teases === 3, `teases: ${teases}`)
const cta = await page.$('section[aria-label="Biblio cover card"] button.group')
report('cover has enter CTA (card button)', !!cta)
// Cover card legibility: the OLED scope pins the dark token set, so the
// card headline must be light ink (a leftover paper pin would render it
// near-black on black — the D5 contrast bug).
const coverCardInk = await page
  .$eval('section[aria-label="Biblio cover card"] h2', (el) => getComputedStyle(el).color)
  .catch(() => '')
const coverInkLight = /rgb\(2[0-9]{2}|rgb\(1[0-9]{2}, 1[0-9]{2}/.test(coverCardInk)
report('cover card headline is light ink', coverInkLight, `color: ${coverCardInk}`)
const coverChrome = await page.$('.island-wrap')
report('island nav hidden on cover', !coverChrome)
// curtain: click CTA -> lands on /leaderboard with the island nav
if (cta) {
  await Promise.all([
    page.waitForURL('**/leaderboard', { timeout: 10000 }),
    cta.click(),
  ])
  await sleep(900)
  const lbTitle = await page.textContent('h1').catch(() => '')
  report('curtain entry lands on leaderboard', /leaderboard/i.test(lbTitle || ''), lbTitle.slice(0, 40))
}

// --- Phase D: workbench island nav, lazy views, route canvas ---
const island = await page.$('.island-wrap')
report('island nav present on workbench', !!island)
const islandLinks = await page.$$eval('.island-nav a', (as) => as.length).catch(() => 0)
// Count-independent: assert a full primary nav exists and the Lag view is
// reachable from it, rather than freezing the exact link count.
const islandHrefs = await page.$$eval('.island-nav a', (as) => as.map((a) => a.getAttribute('href'))).catch(() => [])
report('island nav has 6+ links', islandLinks >= 6, `links: ${islandLinks}`)
report('island nav exposes the lag view', islandHrefs.includes('/lag'), islandHrefs.join(' '))

// --- d3-viz craft: chart accessibility + data-table alternatives ---
await page.goto(BASE + '/trajectory', { waitUntil: 'networkidle' })
await sleep(1200)
report('trajectory chart has aria description', !!(await page.$('div[role="img"][aria-label*="Heatmap"], div[aria-label]')), '')
const tableToggle = await page.$('button[aria-controls="trajectory-table"]')
report('trajectory has View-as-table toggle', !!tableToggle)
if (tableToggle) {
  await tableToggle.click()
  await sleep(400)
  const rows = await page.$$eval('#trajectory-table .forecast-row', (els) => els.length).catch(() => 0)
  report('trajectory table renders series rows', rows > 1, `rows: ${rows}`)
  await tableToggle.click()
  await sleep(300)
}
await page.goto(BASE + '/matrix', { waitUntil: 'networkidle' })
await sleep(1300)
const srTable = await page.$$('table.visually-hidden tbody tr').catch(() => [])
report('matrix has hidden data table', srTable.length >= 20, `rows: ${srTable.length}`)
const matrixAria = await page.$eval('.matrix-scroll div', (el) => el.getAttribute('aria-label') || '').catch(() => '')
report('matrix chart documents keyboard path', /links below/i.test(matrixAria), matrixAria.slice(0, 60))
await page.goto(BASE + '/overview', { waitUntil: 'networkidle' })
await sleep(1200)
const cells = await page.$$eval('.overview-cell', (els) => els.length).catch(() => 0)
report('overview renders 20 small multiples', cells === 20, `cells: ${cells}`)
const stages = await page.$$eval('.overview-stage', (els) => els.length).catch(() => 0)
report('overview groups by stage', stages >= 1, `stages: ${stages}`)
const current = await page.$$eval('.island-link[aria-current="page"]', (as) => as.length).catch(() => 0)
report('island active link marked', current === 1, `active: ${current}`)
report('route canvas present', !!(await page.$('.route-canvas')))

// Lazy views: navigating to a chart route pulls its chunk and renders
await page.goto(BASE + '/matrix', { waitUntil: 'networkidle' })
await sleep(1100)
report('lazy matrix view renders', !!(await page.$('.matrix-scroll')), '')
await page.goto(BASE + '/bursts', { waitUntil: 'networkidle' })
await sleep(900)
const burstRows = await page.$$eval('.burst-row', (as) => as.length).catch(() => 0)
report('lazy bursts view renders rows', burstRows > 0, `rows: ${burstRows}`)
const cv = await page.$eval('.burst-row', (el) => getComputedStyle(el).contentVisibility).catch(() => '')
report('burst rows defer off-screen paint', cv === 'auto', `content-visibility: ${cv}`)
// route transition canvas survives navigation (stable wrapper)
const canvasAfter = await page.$('.route-canvas')
report('route canvas stable across routes', !!canvasAfter)

// --- Reduced-motion pass: content must still be complete (static) ---
await page.goto(BASE + '/?film=0', { waitUntil: 'networkidle' })
await page.evaluate(() => { try { localStorage.setItem('bt-motion', 'reduced') } catch (e) {} })
await page.reload({ waitUntil: 'networkidle' })
await sleep(1200)
const rmTitle = await page.textContent('section[aria-label="Biblio cover card"] h2').catch(() => '')
report('reduced-motion cover renders copy', /Every field, in plain sight/i.test(rmTitle || ''), (rmTitle || '').slice(0, 30))
const rmWire = await page.$$eval('.cover-wire .wire-card', (as) => as.length).catch(() => 0)
report('reduced-motion wire intact (no loop)', rmWire === 40, `cards: ${rmWire}`)
await page.evaluate(() => { try { localStorage.removeItem('bt-motion') } catch (e) {} })

// --- Theme pass: both explicit themes must render legible workbench UI ---
for (const theme of ['dark', 'light']) {
  await page.evaluate((th) => { try { localStorage.setItem('bt-theme', th) } catch (e) {} }, theme)
  await page.goto(BASE + '/leaderboard', { waitUntil: 'networkidle' })
  await sleep(900)
  const islandBg = await page.$eval('.island', (el) => getComputedStyle(el).backgroundColor).catch(() => '')
  const h1Ink = await page.$eval('h1', (el) => getComputedStyle(el).color).catch(() => '')
  const bg = await page.$eval('body', (el) => getComputedStyle(el).backgroundColor).catch(() => '')
  report(`${theme} theme: workbench island resolves`, !/rgba\(0, 0, 0, 0\)/.test(islandBg), `island: ${islandBg}`)
  report(`${theme} theme: heading ink resolves`, !/rgba\(0, 0, 0, 0\)/.test(h1Ink), `h1: ${h1Ink}, bg: ${bg}`)
}
await page.evaluate(() => { try { localStorage.setItem('bt-theme', 'dark') } catch (e) {} })

// --- Contrast pass: ink ladder must clear WCAG AA (4.5:1) on its surface ---
// Chromium reports color-mix() as `color(srgb r g b / a)` with 0-1 channels,
// legacy colors as `rgb[a](r g b / a)` with 0-255. Parse both, composite the
// foreground alpha over the background, then compute WCAG contrast.
const parseColor = (str) => {
  if (!str) return null
  const srgb = str.startsWith('color(srgb')
  const nums = (str.match(/[\d.]+(?:e-?\d+)?/gi) || []).map(Number)
  if (nums.length < 3) return null
  const scale = srgb ? 1 : 1
  let [r, g, b, a = 1] = nums
  if (!srgb) { r /= 255; g /= 255; b /= 255 }
  else { r *= scale; g *= scale; b *= scale }
  return { r, g, b, a }
}
const composite = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
})
const lumOf = ({ r, g, b }) => {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const CONTRAST = (fgStr, bgStr) => {
  const fg = parseColor(fgStr)
  const bg = parseColor(bgStr)
  if (!fg || !bg) return null
  const solid = composite(fg, bg)
  const a = lumOf(solid), b = lumOf(bg)
  const hi = Math.max(a, b), lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}
// Resolve the ink tokens directly: mount a probe element, point its color
// at the token var, and read the computed color back. Compare to body bg.
for (const theme of ['dark', 'light']) {
  await page.evaluate((th) => { try { localStorage.setItem('bt-theme', th) } catch (e) {} }, theme)
  await page.goto(BASE + '/leaderboard', { waitUntil: 'networkidle' })
  await sleep(800)
  const probe = await page.evaluate(() => {
    const el = document.createElement('span')
    el.style.position = 'absolute'
    el.style.visibility = 'hidden'
    document.body.appendChild(el)
    const read = (token) => {
      el.style.color = `var(${token})`
      return getComputedStyle(el).color
    }
    const out = {
      bg: getComputedStyle(document.body).backgroundColor,
      ink2: read('--ink-2'),
      ink3: read('--ink-3'),
    }
    el.remove()
    return out
  })
  for (const [name, fg] of [['ink-2', probe.ink2], ['ink-3', probe.ink3]]) {
    const r = CONTRAST(fg, probe.bg)
    report(`${theme} ${name} >= 4.5:1`, r != null && r >= 4.5, r ? `${r.toFixed(2)}:1` : 'unresolved')
  }
}
// Cover world faint ink on its OLED field
await page.evaluate(() => { try { localStorage.removeItem('bt-theme') } catch (e) {} })
await page.goto(BASE + '/?film=0', { waitUntil: 'networkidle' })
await sleep(1800)
const coverContrast = await page.evaluate(() => {
  const scope = document.querySelector('.cover-scope')
  if (!scope) return { fg: null, bg: null }
  const el = document.createElement('span')
  el.style.position = 'absolute'
  el.style.visibility = 'hidden'
  scope.appendChild(el)
  el.style.color = 'var(--ink-faint)'
  const fg = getComputedStyle(el).color
  el.remove()
  return { fg, bg: getComputedStyle(scope).backgroundColor }
})
{
  const r = CONTRAST(coverContrast.fg, coverContrast.bg)
  report('cover faint ink >= 4.5:1', r != null && r >= 4.5, r ? `${r.toFixed(2)}:1` : 'unresolved')
}

// --- P2: search palette focus trap + return ---
await page.evaluate(() => { try { localStorage.setItem('bt-theme', 'dark') } catch (e) {} })
await page.goto(BASE + '/leaderboard', { waitUntil: 'networkidle' })
await sleep(900)
const triggerId = await page.evaluate(() => {
  const btn = document.querySelector('.island-btn')
  if (!btn) return null
  btn.setAttribute('data-audit-trigger', '1')
  return 'data-audit-trigger'
})
if (triggerId) {
  await page.click('[data-audit-trigger]')
  await sleep(300)
  const opened = !!(await page.$('[role="dialog"][aria-label="Search domains"]'))
  report('palette opens on trigger', opened)
  const inputFocused = await page.evaluate(() => document.activeElement?.tagName === 'INPUT')
  report('palette focuses input', inputFocused)
  const activedesc = await page.$eval('input[role="combobox"]', (el) => el.getAttribute('aria-activedescendant')).catch(() => null)
  report('palette wires aria-activedescendant', !!activedesc, activedesc || '')
  // Tab should not escape the dialog
  await page.keyboard.press('Tab')
  await sleep(150)
  const trapped = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
  report('palette traps Tab in dialog', trapped)
  // Escape closes and returns focus to the trigger
  await page.keyboard.press('Escape')
  await sleep(250)
  const closed = !(await page.$('[role="dialog"][aria-label="Search domains"]'))
  const returned = await page.evaluate(() => document.activeElement?.getAttribute('data-audit-trigger') === '1')
  report('palette Escape closes + restores focus', closed && returned, `closed:${closed} returned:${returned}`)
}
// Pin targets meet the 24px minimum
const pinSize = await page.evaluate(() => {
  const b = document.querySelector('.leaderboard-row button[aria-pressed]')
  if (!b) return null
  const r = b.getBoundingClientRect()
  return { w: Math.round(r.width), h: Math.round(r.height) }
})
report('pin target >= 24px', pinSize != null && pinSize.w >= 24 && pinSize.h >= 24, pinSize ? `${pinSize.w}x${pinSize.h}` : 'none')

// --- Craft pass: view header + double-bezel panel + radius tokens ---
report('leaderboard uses ViewHeader', !!(await page.$('.view-header h1')), '')
const headerRule = await page.$eval('.view-header', (el) => getComputedStyle(el).borderBottomWidth).catch(() => '')
report('view header has under-rule', headerRule === '1px', `border-bottom: ${headerRule}`)
const panel = await page.$('.panel .panel-core')
report('double-bezel panel renders', !!panel)
const panelRadius = await page.$eval('.panel-core', (el) => getComputedStyle(el).borderRadius).catch(() => '')
report('panel core uses concentric radius', panelRadius !== '' && panelRadius !== '0px', `radius: ${panelRadius}`)
const rControl = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--r-control').trim(),
)
report('radius system token defined', rControl !== '', `--r-control: ${rControl}`)
const zOverlay = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue('--z-overlay').trim(),
)
report('z-index scale token defined', zOverlay !== '', `--z-overlay: ${zOverlay}`)
const pingDots = await page.$$eval('.animate-ping', (els) => els.length).catch(() => 0)
report('no decorative ping dots', pingDots === 0, `ping: ${pingDots}`)

// --- Track B craft: spotlight, matrix legend, segmented control, metric rule ---
await page.goto(BASE + '/leaderboard', { waitUntil: 'networkidle' })
await sleep(1100)
const spotlight = await page.$('.rank-one .panel-core')
report('rank-one spotlight renders', !!spotlight)
const spotName = await page.textContent('.rank-one h3').catch(() => '')
const topName = await page.textContent('.leaderboard-row .num').catch(() => '')
report('spotlight names a domain', !!spotName && spotName.trim().length > 1, spotName.trim())
report('spotlight title is not an h1/h2 clash', !(await page.$('.rank-one h1')) && !(await page.$('.rank-one h2')))
const spotLink = await page.getAttribute('.rank-one-link', 'href').catch(() => '')
report('spotlight links to drill-down', /^\/domain\//.test(spotLink || ''), spotLink || '')
void topName

await page.goto(BASE + '/matrix', { waitUntil: 'networkidle' })
await sleep(1300)
report('matrix legend present', !!(await page.$('.matrix-legend')), '')
const legendText = await page.textContent('.matrix-legend-end').catch(() => '')
report('matrix legend states the scale', /works per year/i.test(legendText || ''), (legendText || '').slice(0, 48))
const legendRamp = await page.$eval('.matrix-legend-cap', (el) => getComputedStyle(el).backgroundImage).catch(() => '')
report('matrix legend renders a ramp', /gradient/.test(legendRamp), '')

await page.goto(BASE + '/trajectory', { waitUntil: 'networkidle' })
await sleep(1300)
report('trajectory segmented control present', !!(await page.$('.seg-control')), '')
const segRadius = await page.$eval('.seg', (el) => getComputedStyle(el).borderRadius).catch(() => '')
report('segmented control uses token radius', segRadius !== '' && segRadius !== '0px', `radius: ${segRadius}`)
const segActive = await page.$$eval('.seg--on', (els) => els.length).catch(() => 0)
report('segmented control marks selection', segActive >= 1, `active: ${segActive}`)

const someDomain = await page.getAttribute('.seg-link', 'href').catch(() => '')
await page.goto(BASE + (someDomain || '/domain/generative_ai'), { waitUntil: 'networkidle' })
await sleep(1400)
const ruleMetrics = await page.$$eval('.metric--rule', (els) => els.length).catch(() => 0)
report('domain metrics use the rule variant', ruleMetrics >= 1, `rule metrics: ${ruleMetrics}`)
const tick = await page.$('.metric-tick')
report('domain score metric carries a stage tick', !!tick)

// --- Visual pass: grain + spotlight + hover surfaces ---
await page.goto(BASE + '/leaderboard', { waitUntil: 'networkidle' })
await sleep(1000)
const grain = await page.$eval('.ambience-grain', (el) => {
  const c = getComputedStyle(el)
  return { position: c.position, pe: c.pointerEvents, opacity: c.opacity, z: c.zIndex, hasImage: c.backgroundImage.includes('url') }
}).catch(() => null)
report('film grain fixed + non-interactive', !!grain && grain.position === 'fixed' && grain.pe === 'none', grain ? JSON.stringify(grain) : 'none')
report('grain has a noise texture', !!grain && grain.hasImage, grain ? `image: ${grain.hasImage}` : '')
const grainLow = grain ? parseFloat(grain.opacity) <= 0.12 : false
report('grain stays subtle', grainLow, grain ? `opacity: ${grain.opacity}` : '')
report('no blob wash (removed)', (await page.$$('.ambience-blob')).length === 0, '')
report('spotlight ring present', !!(await page.$('.spotlight-ring')), '')
const ringEdge = await page.$eval('.spotlight-ring', (el) => {
  const before = getComputedStyle(el, '::before')
  const after = getComputedStyle(el, '::after')
  return { edge: before.webkitMaskImage || before.maskImage || '', pool: after.backgroundImage || '' }
}).catch(() => ({ edge: '', pool: '' }))
report('spotlight has a lit edge (masked)', /gradient/.test(ringEdge.edge), '')
report('spotlight has a light pool', /gradient/.test(ringEdge.pool), '')
const ringOpacity = await page.$eval('.spotlight-ring', (el) => getComputedStyle(el).opacity).catch(() => '')
report('spotlight ring hidden until hover', ringOpacity === '0', `opacity: ${ringOpacity}`)
await page.goto(BASE + '/bursts', { waitUntil: 'networkidle' })
await sleep(900)
const hoverSurfaces = await page.$$eval('.hover-surface', (els) => els.length).catch(() => 0)
report('hover-surface class applied (bursts)', hoverSurfaces > 0, `surfaces: ${hoverSurfaces}`)

console.log('---')
console.log(`checks failed: ${failed}, collected problems: ${problems.length}`)
for (const p of problems.slice(0, 10)) console.log('  ' + p)

await browser.close()
server.kill()
process.exit(failed > 0 || problems.length > 0 ? 1 : 0)
