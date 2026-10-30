# AGENTS.md

## Non-negotiable workflow rule

**Every change must be run live.** After any code or style edit, restart / confirm
the live dev server and verify the route responds, before reporting the change as
done. Do not hand back a change that was only typechecked or unit-tested.

### How to run it live

```bash
cd frontend
npm run live            # predev copies snapshots, then starts Vite
# or, detached for agent use:
setsid bash -c 'exec npx vite --port 5180 --host > /tmp/opencode/vite.log 2>&1' </dev/null & disown
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5180/
```

`npm run dev`/`npm run live` run `predev` (scripts/copy-snapshots.mjs) which
populates the git-ignored `public/snapshots/`. If snapshots are missing, the SPA
fallback serves index.html for JSON paths, which is why the loader now checks
content-type and gives an actionable error.

### Definition of done for a change

1. `npm run verify` — typecheck + unit tests + build + render-audit + pixel-audit.
2. Live server restarted/confirmed, target route returns HTTP 200.
3. For any visual change, pixel-audit numbers reported (RMSE / luminance /
   texture), not just "the element exists".
4. Screenshots for visual changes are captured (the model cannot see images, so
   measurements stand in for eyeballing; the user does the final visual check).

## Session log — 2026-10-30 (completed)

All items below are implemented, verified live (`:5180` returns 200), and
considered **done**:

- **Dark-only theme.** The light theme is gone: `[data-theme='light']` blocks
  removed from `tokens.css`, `tailwind.css`, and `workbench.css`. The
  observatory is a dark room; print inherits the dark palette. Do not
  reintroduce light variants — they were dead, half-maintained code.
- **Fluid dialog choreography.** New shared hook
  `frontend/src/lib/useDialogTransition.ts` gives the ⌘K palette, shortcuts
  HUD, and weight-simulator drawer a real exit beat (`.is-closing`, 170 ms)
  instead of a hard unmount. Reopening mid-exit cancels the pending unmount.
- **First-visit tour auto-start.** `maybeAutoStartTour()` opens the guided
  tour once per browser (localStorage `bt-tour-seen`), never on the cover,
  and every step is reachable from inside the workbench (no dead `/` step).
  Covered by `demochrome.test.ts`.
- **Plain-language status bar.** "Data from 29 October 2026" via `fmtDate()`
  replaced the run-id / UTC-clock readout; the 30 s clock interval is gone.
- **Vite dep pre-bundling.** `optimizeDeps.include` pins the Phosphor deep
  paths, `gsap`, and `@paper-design/shaders-react` so dialogs no longer
  trigger a mid-session re-optimization + full-page reload that nuked app
  state (see gotcha below).
- **Presentation mode removed.** `lib/presentation.ts`, its nav button, the
  `T`/`P` shortcuts, and the `data-presentation` CSS block are gone. It
  duplicated what browser zoom and the motion toggle already do.
- **Print keeps the dark palette.** `@media print` no longer flips to a
  white page; it sets `print-color-adjust: exact` and inherits the tokens.
- **Lag explainer.** `components/LagExplainer.tsx` leads the Lag view with
  the question, a one-sentence answer, three numbered steps, and the
  grant-date caveat. The statistical statements and robustness table still
  follow it unchanged, and `lag.test.ts` guards both the plain wording and
  the honesty claims.
- **Matrix ramp fix (zrender color parsing).** The heatmap rendered as a
  black void: its ramp tokens were `color-mix()` strings, and zrender
  (ECharts' renderer) parses colors in JS with no color-mix branch — an
  unparsable color silently falls back to `#000000`
  (`VisualMapping.js`: `return color || [0, 0, 0, 1]`). Measured before:
  52.8% of the chart area near-black, 0.2% amber. Fix: solid-hex ramp
  tokens (`--matrix-low: #26272e` visible floor, `--matrix-mid: #8a6a34`,
  `--matrix-high: var(--accent)`), a 5-stop perceptual spread in the
  visualMap (median cell now lands mid-ramp instead of at 8%), a 1px
  page-black cell grid, per-cell label ink (dark on bright amber, light on
  the floor), and a matching 5-stop CSS legend. After: near-black 23.4%
  (axis text/whitespace), mean luma 0.066 -> 0.151. Guarded by
  `matrix-ramp.test.ts`, which runs zrender's own `parse()` against the
  tokens. `scripts/matrix-probe.mjs` measures the rendered heatmap.
- **Matrix now shows GROWTH, indexed per row.** Colour was near-meaningless
  even after the palette fix: twenty domains on ONE absolute scale differ by
  up to 60x in a given year, so 90% of the 520 cells sat in the bottom
  quarter of the ramp and a cell told you which field was big, not what its
  year did. Colour now encodes `works / that domain's 2000 output`, plotted
  as `log10` (1x = flat = scale origin, then 10x, 100x). Tooltip and inline
  labels quote the multiple with the raw count underneath; the hidden a11y
  table carries both; the lead sentence names the fastest grower
  (Generative AI, 215x). After: amber pixels 0.2% -> 9.9%, distinct tones
  76 -> 97, all ten ramp deciles populated, 137 distinct multiples.
  Guarded by `matrix-growth.test.ts`.
- **Chart-bound colours must be solid hex/rgb.** `--matrix-high` is
  `var(--accent)` (the browser resolves it before zrender sees it) which is
  fine; a literal `color-mix()` in a chart option is not.

### Performance pass — 2026-10-30

Measured in chromium under `Emulation.setCPUThrottlingRate: 4`. Yardstick:
a **blank page manages 55.8 fps** at that throttle, so ~55 is the ceiling.

- **Cover was 10.7 fps; now 36.9.** The culprit was NOT the WebGL dither
  shader (~5 fps) but the two ambient `.orb` elements: 36-44rem radial
  gradients with `filter: blur(90px)`, so every transform frame
  re-rasterised a huge blurred layer. Fix: drop the redundant blur (the
  gradient is already soft), drop `will-change`, and move the infinite GSAP
  drift to a CSS `transform` animation so it leaves the main thread.
- **/matrix was 43 fps; now 55.4 (= ceiling).** Three causes:
  1. `StagePill` called `getComputedStyle()` **during render** — a forced
     synchronous layout, 20x per render on the row tails (74 layouts + 300 ms
     of script per 3 s). It now resolves `var(--stage-*)` in CSS.
  2. TimeLapse and BarRace auto-played from mount, driving an ECharts
     `setOption` every 420/650 ms for charts 1-3 viewports below the fold.
     Both now wait for `useInViewOnce` (`lib/useInViewOnce.ts`).
  3. A `backdrop-blur-sm` pill sat on the cover's fully opaque card core —
     pure cost, removed.
- **The in-app Motion toggle never reached CSS.** `lib/motion.ts` now mirrors
  the verdict onto `<html data-motion="reduced">`, so CSS animations honour
  the same setting as the JS. Guarded by `perf-guards.test.ts`.

Probe script kept: `scripts/matrix-probe.mjs` (rendered heatmap stats).
Ad-hoc FPS/attribution probes were deleted after use; method is above.

## Non-negotiable: no theme or presentation code returns

Biblio is dark only. There is no `bt-theme` key, no `[data-theme='light']`
block, no `data-presentation` attribute, and no `lib/presentation.ts`. The
`demochrome.test.ts` guards assert their absence. Print inherits the dark
palette deliberately.

## Visual-effect gotchas learned here

- `soft-light` and `overlay` blending are **zero on a black backdrop**
  (result = 2*base*blend, base=0). They cannot show grain on OLED.
- `screen` cannot darken, so it vanishes on the light theme.
- Unblended grayscale noise (mean ~0.5) at low opacity works on both themes.
- A `display:none !important` injected for an A/B screenshot cannot be undone
  with inline `style.display`; remove the injected rule instead.
- Vite discovers lazily-imported deps (Phosphor `dist/csr/*` deep paths, gsap,
  shaders-react) only when a dialog first mounts → mid-session re-optimization
  force-reloads the page and wipes app state. Fix: list them in
  `optimizeDeps.include` so discovery happens at server start.
- A dialog that unmounts on `!open` frame-cuts its exit. Derive the closing
  phase **during render** (not in an effect — an effect lags one frame, which
  strands focus and breaks Escape-to-close); see `useDialogTransition.ts`.
- **`filter: blur()` on a large animated element is the most expensive
  thing in this app.** A 44rem element with `blur(90px)` re-rasterises the
  whole blurred surface on every transform frame: the cover measured
  10.7 fps and hit 38.7 fps with the orbs removed. A radial gradient at that
  size is already soft, so the blur buys nothing. Never combine a large
  blur with an infinite transform animation.
- **`getComputedStyle()` during render is a forced synchronous layout.** It
  reads layout state mid-render, so the browser must flush pending style and
  layout work before returning. Render-time only cost is invisible in unit
  tests and shows up as "the page is laggy". Resolve tokens as
  `var(--token)` in CSS instead; `StagePill` was the offender (20 per render).
- **zrender cannot parse `color-mix()`** (or `oklch`, `lab`, `color()`).
  ECharts colors are parsed in JS (`zrender/lib/tool/color.js`), not by the
  browser; an unparsable string silently becomes `#000000`. Any token fed to
  a chart (visualMap ramps, gradients, series colors) must be solid hex/rgb.
  CSS-only consumers can keep color-mix — the danger is chart-bound tokens,
  and the failure is invisible to DOM checks because CSS renders the legend
  correctly. Guard: `matrix-ramp.test.ts` runs zrender's `parse()` on the
  tokens.

## Verification commands

- `npm run lint`     — pre-flight L1/L2/L4 static guards
- `npm run audit`    — chromium render + interaction audit
- `npm run pixel`    — ImageMagick visibility measurement
- `npm run verify`   — all of the above plus build
