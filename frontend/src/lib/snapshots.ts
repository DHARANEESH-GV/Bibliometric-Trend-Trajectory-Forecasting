/**
 * Snapshot loading — the ONLY module that knows where snapshot files live.
 * Static files under /snapshots/ (copied from repo-root snapshots/<run>/
 * by scripts/copy-snapshots.mjs). When read_api exists, swap fetches here
 * and nothing else changes.
 */
import type {
  BurstsFile,
  DomainSnapshot,
  LagFile,
  LeaderboardFile,
  MatrixFile,
  RunsManifest,
  TrajectoriesFile,
} from './types'

const BASE = '/snapshots'

let manifestPromise: Promise<RunsManifest> | null = null

/** Reads snapshots-run.json (written by the copy script at dev/build time). */
export function loadManifest(): Promise<RunsManifest> {
  manifestPromise ??= fetch('/snapshots-run.json').then((r) => {
    if (!r.ok) throw new Error(`Manifest unavailable (${r.status})`)
    return r.json() as Promise<RunsManifest>
  })
  return manifestPromise
}

const cache = new Map<string, Promise<unknown>>()

/**
 * Reads a snapshot response, failing loudly when the host's SPA fallback
 * served index.html (text/html, 200) for a missing asset — otherwise
 * `.json()` throws a bare "JSON.parse: unexpected character" that hides
 * the real cause (generated snapshots never copied). Exported for tests.
 */
export async function readJsonResponse<T>(r: Response, path: string): Promise<T> {
  if (!r.ok) throw new Error(`${path} unavailable (${r.status})`)
  const ct = r.headers.get('content-type') ?? ''
  if (!ct.includes('json')) {
    throw new Error(
      `Snapshot not found at ${path} (server returned ${ct || 'non-JSON'}). ` +
        'Run `npm run dev`/`npm run build` so copy-snapshots.mjs populates public/snapshots.',
    )
  }
  try {
    return (await r.json()) as T
  } catch {
    throw new Error(`Snapshot at ${path} is not valid JSON.`)
  }
}

function getJson<T>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(path).then((r) => readJsonResponse<T>(r, path))
    cache.set(path, p)
  }
  return p as Promise<T>
}

export function loadLeaderboard(): Promise<LeaderboardFile> {
  return getJson(`${BASE}/leaderboard.json`)
}

export function loadTrajectories(): Promise<TrajectoriesFile> {
  return getJson(`${BASE}/trajectories.json`)
}

export function loadBursts(): Promise<BurstsFile> {
  return getJson(`${BASE}/bursts.json`)
}

export function loadMatrix(): Promise<MatrixFile> {
  return getJson(`${BASE}/matrix.json`)
}

export function loadLag(): Promise<LagFile> {
  return getJson(`${BASE}/lag.json`)
}

export function loadDomainSnapshot(domain: string): Promise<DomainSnapshot> {
  return getJson(`${BASE}/domains/${domain}.json`)
}
