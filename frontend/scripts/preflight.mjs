/**
 * preflight.mjs — the 4-layer pre-flight gate for the Biblio frontend.
 * Encodes the loaded skill checklists (high-end visual design, design-taste,
 * redesign audit, vercel-react perf, web-interface guidelines) as mechanical
 * checks that fail the build. Run: node scripts/preflight.mjs
 *
 *   Layer 1  typecheck  (tsc --noEmit)
 *   Layer 2  unit tests (vitest run)
 *   Layer 3  render + interaction + triple-mode audit (render-audit.mjs)
 *   Layer 4  static craft/a11y/perf guardrails (this file, below)
 *
 * Layers 1-3 are composed here; layer 4 scans source with ripgrep.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

let failed = 0
const stage = (name, ok, detail = '') => {
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name.padEnd(40), detail)
  if (!ok) failed++
}
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (label, cmd, args, cwd) =>
  stage(
    label,
    spawnSync(cmd === 'npm' ? npmCmd : cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    }).status === 0,
  )

const FE = resolve(fileURLToPath(import.meta.url), '../..')
const ROOT = resolve(FE, '..')
const rg = (pattern, globs) => {
  // -e is required: patterns like --grid-rank-row would otherwise parse
  // as rg flags.
  const args = ['-n', '--no-heading', '-e', pattern, ...globs.flatMap((g) => ['-g', g]), '.']
  let r = spawnSync('rg', args, { cwd: ROOT, encoding: 'utf8' })
  if (r.error || r.status === 127 || (!r.stdout && r.stderr)) {
    // rg not installed in PATH, fall back to git grep
    const gitGlobs = globs.map((g) => (g.includes('*') ? `:(glob)${g}` : g))
    let gitArgs = ['grep', '-n', '-P', '-e', pattern, '--', ...gitGlobs]
    r = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' })
    if (r.error || (r.status !== 0 && !r.stdout)) {
      gitArgs = ['grep', '-n', '-E', '-e', pattern, '--', ...gitGlobs]
      r = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' })
    }
  }
  return (r.stdout || '').trim()
}

console.log('\n=== Biblio pre-flight ===\n')
run('L1 typecheck', 'npm', ['run', 'typecheck'], FE)
run('L2 unit tests', 'npm', ['test'], FE)

console.log('\n--- L4 static craft / a11y / perf guardrails ---')

const bannedHex = rg(
  '#0b0e14|#11151c|#f4efe6|#faf7f0|#e8eaed|#171512|#0b0e14',
  ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx', 'frontend/src/**/*.css'],
)
stage('no stale pre-Phase-B hex tokens', bannedHex === '', bannedHex.split('\n')[0] || '')

const pureBlack = rg('(background|color|fill|stroke)[^;{]*:\\s*#000000\\b', ['frontend/src/**/*.css'])
stage('no pure #000000 surfaces (skill 9.A)', pureBlack === '', pureBlack.split('\n')[0] || '')

const lazyViews = rg('React\\.lazy|lazy\\(', ['frontend/src/App.tsx'])
stage('workbench views are code-split', lazyViews !== '', lazyViews.split('\n')[0] || '')

const deepIcons = rg("@phosphor-icons/react/dist/csr/", ['frontend/src/**/*.tsx'])
stage('phosphor imported via deep paths', deepIcons !== '', `${deepIcons.split('\n').length} sites`)

const barrelIcon = rg("from '@phosphor-icons/react'", ['frontend/src/**/*.tsx', 'frontend/src/**/*.ts'])
stage('no barrel phosphor imports', barrelIcon === '', barrelIcon.split('\n')[0] || '')

const newsreader = rg('newsreader', ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx'])
stage('no unused webfont imports', newsreader === '', newsreader.split('\n')[0] || '')

const looseWillChange = rg('\\.route-canvas[\\s\\S]{0,80}will-change', ['frontend/src/styles/workbench.css'])
stage('no standing will-change on route canvas', looseWillChange === '', looseWillChange.split('\n')[0] || '')

const deadCountUp = rg('\\bCountUp\\b', ['frontend/src/components/CountUp.tsx'])
stage('no orphan count-up component', deadCountUp === '', deadCountUp.split('\n')[0] || '')

const newsreaderImport = rg('@fontsource/newsreader', ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx', 'frontend/package.json'])
stage('newsreader fully removed', newsreaderImport === '', newsreaderImport.split('\n')[0] || '')

const unusedEchartsReact = rg('echarts-for-react', ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx', 'frontend/package.json'])
stage('unused echarts-for-react removed', unusedEchartsReact === '', unusedEchartsReact.split('\n')[0] || '')

const inlinePing = rg('animate-ping', ['frontend/src/**/*.tsx'])
stage('no decorative ping dots', inlinePing === '', inlinePing.split('\n')[0] || '')

const enDash = rg('\u2013|\u2014', ['frontend/src/views/**/*.tsx', 'frontend/src/components/**/*.tsx', 'frontend/index.html'])
// Only flag dashes in visible copy. Strip the trailing `// ...` comment and
// drop JSDoc / line / JSX comment lines, then keep only lines whose code
// portion still contains a dash character (comments are not user-visible).
const enDashVisible = enDash
  .split('\n')
  .map((line) => line.replace(/^[^:]*:\d+:/, '').split(' // ')[0] ?? '')
  .filter((text) => {
    const t = text.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false
    if (t.includes('*/') || t.includes('{/*')) return false
    return /[\u2013\u2014]/.test(t)
  })
  .join('\n')
  .trim()
stage('no em/en dashes in visible strings', enDashVisible === '', enDashVisible.split('\n')[0] || '')

const viewHeader = rg('<ViewHeader', ['frontend/src/views/**/*.tsx'])
stage('views use shared ViewHeader', viewHeader !== '', `${viewHeader.split('\n').length} views`)

const panelPrimitive = rg('panel-core', ['frontend/src/**/*.tsx'])
stage('double-bezel panel primitive used', panelPrimitive !== '', `${panelPrimitive.split('\n').length} sites`)

const zIndexLiteral = rg('zIndex:\\s*(4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9]|1[0-9]{2})', ['frontend/src/**/*.tsx'])
stage('no literal systemic z-index', zIndexLiteral === '', zIndexLiteral.split('\n')[0] || '')

const numericRadius = rg('borderRadius:\\s*[0-9]', ['frontend/src/**/*.tsx'])
stage('no numeric borderRadius literals', numericRadius === '', numericRadius.split('\n')[0] || '')

const importantInViews = rg('!important', ['frontend/src/views/**/*.css'])
stage('no !important in view CSS', importantInViews === '', importantInViews.split('\n')[0] || '')

const legacyRadius = rg('radius-shell|radius-core|radius-ui', ['frontend/src/**/*.css', 'frontend/src/**/*.tsx'])
stage('legacy radius aliases removed', legacyRadius === '', legacyRadius.split('\n')[0] || '')

const gridToken = rg('--grid-rank-row', ['frontend/src/styles/tokens.css', 'frontend/src/styles/workbench.css'])
stage('rank-row grid is one shared token', gridToken !== '', `${gridToken.split('\n').length} refs`)

const cleanSeriesUsed = rg('cleanSeries', ['frontend/src/views/**/*.tsx'])
stage('chart data-prep guard used by views', cleanSeriesUsed !== '', `${cleanSeriesUsed.split('\n').length} views`)

const scrollListeners = rg("addEventListener\\('scroll'|addEventListener\\(\"scroll\"", ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx'])
stage('no window scroll listeners (vercel 5.D)', scrollListeners === '', scrollListeners.split('\n')[0] || '')

const mouseListeners = rg("addEventListener\\('(mousemove|touchstart|touchmove|wheel)'\\)", ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx'])
stage('pointer/touch listeners are passive', mouseListeners === '', mouseListeners.split('\n')[0] || '')

const reduced = rg('prefersReducedMotion\\(\\)|prefers-reduced-motion', ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx', 'frontend/src/**/*.css'])
stage('reduced-motion honored', reduced !== '', `${reduced.split('\n').length} sites`)

const island = rg('island-wrap|island-nav', ['frontend/src/styles/workbench.css'])
stage('island nav styles present', island !== '', '')

const contentVis = rg('content-visibility:\\s*auto', ['frontend/src/**/*.css'])
stage('long-list content-visibility rule', contentVis !== '', contentVis.split('\n')[0] || '')

const stash = rg('TODO|FIXME|console\\.log\\(', ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx'])
stage('no TODO / stray console.log', stash === '', stash.split('\n')[0] || '')

console.log(`\nL4 ${failed === 0 ? 'clean' : failed + ' issue(s)'}`)
console.log('=== pre-flight layers 1-2 + 4 complete; run render-audit for layer 3 ===\n')
process.exit(failed > 0 ? 1 : 0)
