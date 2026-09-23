#!/usr/bin/env node
/**
 * Copies the latest snapshots/<run_id>/ directory from the repo root into
 * public/snapshots/ so the app can fetch them as static assets in dev and
 * build. public/snapshots is generated content — never committed.
 */
import { existsSync, readdirSync, cpSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(fileURLToPath(import.meta.url), '../..')
const repoRoot = resolve(frontendDir, '..')
const snapshotsRoot = join(repoRoot, 'snapshots')
const dest = join(frontendDir, 'public', 'snapshots')

function latestRun(root) {
  const runs = readdirSync(root)
    .filter((name) => {
      const p = join(root, name)
      return /^\d{8}T\d{6}Z$/.test(name) && statSync(p).isDirectory()
    })
    .sort()
  if (runs.length === 0) return null
  return runs[runs.length - 1]
}

const run = latestRun(snapshotsRoot)
if (!run) {
  console.error(
    '[copy-snapshots] No snapshot runs found in ' + snapshotsRoot +
    '. Generate one first: make snapshots',
  )
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
cpSync(join(snapshotsRoot, run), dest, { recursive: true })
writeFileSync(
  join(frontendDir, 'public', 'snapshots-run.json'),
  JSON.stringify({ run_id: run }) + '\n',
)

const files = readdirSync(dest, { recursive: true }).length
console.log(`[copy-snapshots] Copied ${run} → public/snapshots (${files} entries)`)
