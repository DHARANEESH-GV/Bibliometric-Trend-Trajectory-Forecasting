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

## Visual-effect gotchas learned here

- `soft-light` and `overlay` blending are **zero on a black backdrop**
  (result = 2*base*blend, base=0). They cannot show grain on OLED.
- `screen` cannot darken, so it vanishes on the light theme.
- Unblended grayscale noise (mean ~0.5) at low opacity works on both themes.
- A `display:none !important` injected for an A/B screenshot cannot be undone
  with inline `style.display`; remove the injected rule instead.

## Verification commands

- `npm run lint`     — pre-flight L1/L2/L4 static guards
- `npm run audit`    — chromium render + interaction audit
- `npm run pixel`    — ImageMagick visibility measurement
- `npm run verify`   — all of the above plus build
