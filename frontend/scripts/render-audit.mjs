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
  '/',
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
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await sleep(1600) // allow lazy shader chunk
const card = await page.$('section[aria-label="Biblio cover card"]')
report('hero card mounts', !!card)
if (card) {
  const cardBg = await card.$eval('.bg-card', (el) => getComputedStyle(el).backgroundColor)
  report('card token bridge resolves (bg-card = paper)', !/rgba\(0, 0, 0, 0\)/.test(cardBg), `bg: ${cardBg}`)
  const cardBorder = await card.$eval('[class*="rounded-[48px]"]', (el) => getComputedStyle(el).borderTopColor)
  report('card border token resolves (border-border)', !/rgba\(0, 0, 0, 0\)/.test(cardBorder), `border: ${cardBorder}`)
  const headline = await card.$eval('h2', (el) => el.textContent || '')
  report('card headline is Biblio voice', /Twenty fields/.test(headline), headline.slice(0, 34))
  const kicker = (await card.$eval('.mb-8', (el) => el.textContent || '')).trim()
  report('card kicker carries run id', /Issue \d+/.test(kicker), kicker.slice(0, 36))
  const desc = await card.$eval('p.max-w-2xl', (el) => el.textContent || '')
  report('card description computed (burst count)', /\d+ bursts, 20 fields/.test(desc), desc.slice(0, 60))
  const ctaBtn = await card.$('button.group')
  report('card CTA present', !!ctaBtn)
}

// --- Cover: Ink & Paper world, computed plates, curtain entry ---
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await sleep(900)
const scope = await page.$('.cover-scope')
report('cover renders its own world', !!scope)
const bg = scope ? await scope.evaluate((el) => getComputedStyle(el).backgroundColor) : ''
report('cover is paper (cream), not app dark', /244|245|f4/i.test(bg), `bg: ${bg}`)
const title = await page.textContent('section[aria-label="Biblio cover card"] h2').catch(() => '')
report('cover hero headline (card serif)', /Twenty fields/i.test(title || ''), (title || '').slice(0, 40))
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
const appHidden = await page.$('header[style*="sticky"]')
report('app chrome hidden on cover', !appHidden)
// curtain: click CTA -> lands on /leaderboard with app chrome
if (cta) {
  await Promise.all([
    page.waitForURL('**/leaderboard', { timeout: 10000 }),
    cta.click(),
  ])
  await sleep(700)
  const lbTitle = await page.textContent('h1').catch(() => '')
  report('curtain entry lands on leaderboard', /leaderboard/i.test(lbTitle || ''), lbTitle.slice(0, 40))
}

console.log('---')
console.log(`checks failed: ${failed}, collected problems: ${problems.length}`)
for (const p of problems.slice(0, 10)) console.log('  ' + p)

await browser.close()
server.kill()
process.exit(failed > 0 || problems.length > 0 ? 1 : 0)
