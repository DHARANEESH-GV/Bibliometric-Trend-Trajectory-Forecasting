/**
 * matrix-probe — measures the heatmap's actual rendered cell colors on /matrix.
 * Boots vite dev on :5181 (or reuses :5180), screenshots the chart region,
 * and reports: % of chart-area pixels that are near-black (luma < 0.06),
 * mean cell luminance, and distinct color clusters. Run twice (before/after).
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PORT = process.env.PROBE_PORT || '5180'
const BASE = `http://localhost:${PORT}`
const OUT = process.env.PROBE_OUT || '/tmp/opencode/matrix-cells.png'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await page.goto(BASE + '/matrix', { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForSelector('.matrix-scroll div', { timeout: 15000 })
await page.waitForTimeout(1800) // draw-in animation settles

const box = await (await page.$('.matrix-scroll div')).boundingBox()
await page.screenshot({ path: OUT, clip: box })

const stats = await page.evaluate(async (b64) => {
  const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode()
  const c = document.createElement('canvas'); c.width = i.width; c.height = i.height
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(i, 0, 0)
  const d = g.getImageData(0, 0, i.width, i.height).data
  let n = 0, nearBlack = 0, amber = 0, sumL = 0
  const clusters = new Map()
  for (let p = 0; p < d.length; p += 4) {
    const r = d[p] / 255, gg = d[p + 1] / 255, b = d[p + 2] / 255
    n++
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b
    sumL += l
    if (l < 0.06) nearBlack++
    if (r > 0.55 && r > b + 0.2 && gg > b + 0.1) amber++
    // quantize to 16-level buckets to count distinct rendered tones
    const key = `${d[p] >> 4},${d[p + 1] >> 4},${d[p + 2] >> 4}`
    clusters.set(key, (clusters.get(key) || 0) + 1)
  }
  const top = [...clusters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => `rgb(${k.split(',').map(x => x * 16 + 8).join(',')}) ${(v / n * 100).toFixed(1)}%`)
  return {
    meanLuma: +(sumL / n).toFixed(4),
    nearBlackPct: +(nearBlack / n * 100).toFixed(1),
    amberPct: +(amber / n * 100).toFixed(1),
    distinctTones: clusters.size,
    topTones: top,
  }
}, (await page.screenshot({ clip: box })).toString('base64'))

console.log(JSON.stringify(stats, null, 2))
writeFileSync(OUT.replace('.png', '-stats.json'), JSON.stringify(stats, null, 2))
await browser.close()
