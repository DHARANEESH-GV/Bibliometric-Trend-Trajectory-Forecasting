/**
 * Headless render-audit: boots vite preview, visits every route in real
 * chromium, and fails on (a) ErrorBoundary text, (b) blank bodies,
 * (c) page errors / console errors. This exists because a type-clean
 * build shipped an object-as-child crash (top_keywords) that only
 * manifests at render time. Run: node scripts/render-audit.mjs
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const PORT = 4599
const ROUTES = [
  '/',
  '/trajectory',
  '/bursts',
  '/matrix',
  '/about',
  '/domain/ai_agents',
  '/domain/quantum_computing', // real empty-keywords state
]

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

let crashedRoutes = 0
for (const route of ROUTES) {
  try {
    await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 20000 })
  } catch (e) {
    problems.push(`${route} navigation failed: ${e.message.split('\n')[0]}`)
  }
  await sleep(800)
  const boundary = await page.$('text=Something failed while rendering')
  const body = await page.textContent('body').catch(() => '')
  const status = boundary ? 'ERROR-BOUNDARY' : body && body.length > 200 ? 'OK' : 'BLANK'
  if (status !== 'OK') crashedRoutes++
  console.log(status.padEnd(15), route)
}

console.log('---')
console.log(`routes: ${ROUTES.length}, failed: ${crashedRoutes}, collected problems: ${problems.length}`)
for (const p of problems.slice(0, 10)) console.log('  ' + p)

await browser.close()
server.kill()
process.exit(crashedRoutes > 0 || problems.length > 0 ? 1 : 0)
