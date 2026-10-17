import { describe, expect, it } from 'vitest'
import { readJsonResponse } from './snapshots'

/**
 * Regression guard: a static host with SPA fallback serves index.html
 * (text/html, 200) for a missing snapshot. The loader must surface an
 * actionable message, never the raw "JSON.parse: unexpected character".
 */
describe('readJsonResponse', () => {
  const json = (body: string) =>
    new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })

  it('parses a JSON body', async () => {
    await expect(readJsonResponse<{ a: number }>(json('{"a":1}'), '/snapshots/x.json')).resolves.toEqual({ a: 1 })
  })

  it('explains the HTML-fallback case instead of throwing a parse error', async () => {
    const html = new Response('<!doctype html><html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
    await expect(readJsonResponse(html, '/snapshots/matrix.json')).rejects.toThrow(
      /Snapshot not found at \/snapshots\/matrix\.json.*copy-snapshots/s,
    )
  })

  it('does not emit a bare JSON.parse message', async () => {
    const html = new Response('<!doctype html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
    await expect(readJsonResponse(html, '/x.json')).rejects.not.toThrow(/JSON\.parse/)
  })

  it('reports a non-ok status', async () => {
    const gone = new Response('', { status: 404 })
    await expect(readJsonResponse(gone, '/snapshots/y.json')).rejects.toThrow(/unavailable \(404\)/)
  })

  it('reports invalid JSON that still claims to be json', async () => {
    const broken = new Response('not json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    await expect(readJsonResponse(broken, '/snapshots/z.json')).rejects.toThrow(/not valid JSON/)
  })
})
