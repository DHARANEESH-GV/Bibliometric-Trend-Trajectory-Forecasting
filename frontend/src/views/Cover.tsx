/**
 * Cover — Biblio's landing, Ethereal Glass rebuild.
 * OLED world, drifting orbs, glass bento (stats / teases / shader card),
 * spotlight border, line-mask choreography, cinema curtain into the app.
 * Words and numbers stay computed from the run's snapshot — the honesty
 * contract survives every visual rebuild.
 */
import { useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { useQuery } from '../lib/useQuery'
import { loadLeaderboard, loadBursts } from '../lib/snapshots'
import { useStore } from '../lib/store'
import { gsap, useGSAP, prefersReducedMotion } from '../lib/gsap'
import { setMotionChoice, onMotionChange } from '../lib/motion'
import { startTour } from '../components/TourStrip'
import { useEffect, useState, useCallback } from 'react'
import { CTASection } from '@/components/ui/hero-dithering-card'
import './cover.css'

/** Count-up that lands exactly on `value` (honesty: never off by drift). */
function CoverCount({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useGSAP(
    () => {
      const el = ref.current
      if (!el || prefersReducedMotion()) return
      const state = { n: Math.round(value * 0.25) }
      const tween = gsap.to(state, {
        n: value,
        duration: 1.6,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
        onUpdate: () => {
          el.textContent = Math.round(state.n).toLocaleString('en-US') + suffix
        },
        onComplete: () => {
          el.textContent = value.toLocaleString('en-US') + suffix
        },
      })
      return () => {
        tween.kill()
      }
    },
    { dependencies: [value] },
  )
  return (
    <span ref={ref}>
      {Math.round(value).toLocaleString('en-US')}
      {suffix}
    </span>
  )
}

/** Line-mask pair for the headline (two staggered lines). */
function MaskedLine({ children }: { children: React.ReactNode }) {
  return (
    <span className="reveal-line">
      <span>{children}</span>
    </span>
  )
}

// Front-door film: plays on every fresh open of the site (full page
// load). A module-level flag keeps SPA route changes from replaying it —
// navigating Cover → Leaderboard → Cover stays quiet — but a reload or a
// new tab opens the film again, which is what "entering the site" means.
let filmWatchedThisSession = false

declare const __FILM_BUILD__: string

export function CoverView() {
  const { data: lb } = useQuery(loadLeaderboard, [])
  const { data: bursts } = useQuery(loadBursts, [])
  const { runId } = useStore()
  const navigate = useNavigate()
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const spotRef = useRef<HTMLDivElement>(null)
  const [, setTick] = useState(0)
  useEffect(() => onMotionChange(() => setTick((t) => t + 1)), [])

  // ---- Front-door film: the explainer plays once on arrival, then the
  // cover reveals underneath. Skippable (click / Esc / skip button);
  // remembered per tab so a route swap back never replays it, but a fresh
  // load does. Transitions are GSAP-driven so they never read choppy:
  // fade-up + scale-settle on entry, slow crossfade + scale-down on exit,
  // timed so the cover's own hero animation lands as the film lifts.
  const videoRef = useRef<HTMLVideoElement>(null)
  const filmRef = useRef<HTMLDivElement>(null)
  const filmGsapRef = useRef<gsap.core.Timeline | null>(null)
  const exitingRef = useRef(false)
  const [filmState, setFilmState] = useState<'pending' | 'playing' | 'done'>(() => {
    // Audit/deep-link escape hatch: ?film=0 skips the front-door film
    // entirely (headless audits cannot wait out a 52s film).
    if (new URLSearchParams(window.location.search).get('film') === '0') return 'done'
    return filmWatchedThisSession ? 'done' : 'pending'
  })
  const [muted, setMuted] = useState(true)

  const endFilm = useCallback(() => {
    exitingRef.current = true
    setFilmState((prev) => {
      if (prev === 'done') return prev
      filmWatchedThisSession = true
      return 'done'
    })
  }, [])

  // Entry: fade the film up from black and settle the picture from a hair
  // of over-scale, right as playback begins. KEY: the effect is latched to
  // `mounted`, not `filmState` — the pending→playing flip (which fires when
  // playback starts) would otherwise re-run this effect, killing the fade
  // mid-flight and resetting opacity to 0: the "film pops up, then dies a
  // second later" bug.
  const filmMounted = filmState !== 'done'
  useGSAP(
    () => {
      if (!filmMounted) return
      const el = filmRef.current
      if (!el) return
      if (prefersReducedMotion()) {
        gsap.set(el, { opacity: 1 })
        return
      }
      const inner = el.querySelector('video')
      const tl = gsap.timeline()
      gsap.set(el, { opacity: 0 })
      if (inner) gsap.set(inner, { scale: 1.045, transformOrigin: 'center center' })
      tl.to(el, { opacity: 1, duration: 0.9, ease: 'power2.inOut' }, 0)
      if (inner) tl.to(inner, { scale: 1, duration: 5.5, ease: 'power1.out' }, 0)
      filmGsapRef.current = tl
      return () => {
        tl.kill()
      }
    },
    { dependencies: [filmMounted] },
  )

  // Exit: fade the film out over ~1.1s (unmount happens after the fade
  // completes), letting the cover underneath be seen arriving.
  const exitFilm = useCallback(() => {
    const el = filmRef.current
    if (!el || exitingRef.current) {
      endFilm()
      return
    }
    exitingRef.current = true
    const v = videoRef.current
    if (v) v.pause()
    if (prefersReducedMotion()) {
      endFilm()
      return
    }
    gsap.to(el, {
      opacity: 0,
      duration: 1.1,
      ease: 'power2.inOut',
      onComplete: endFilm,
    })
  }, [endFilm])

  useEffect(() => {
    if (filmState !== 'playing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') exitFilm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filmState, exitFilm])

  useEffect(() => {
    if (filmState !== 'pending') return
    const v = videoRef.current
    if (!v) return
    // Audible autoplay is routinely rejected; try sound first, fall back to
    // muted playback (with an unmute pill) rather than skipping the film.
    v.play()
      .then(() => {
        setFilmState('playing')
        setMuted(false)
      })
      .catch(() => {
        v.muted = true
        setMuted(true)
        v.play()
          .then(() => setFilmState('playing'))
          .catch(() => endFilm())
      })
  }, [filmState, endFilm])

  const rows = lb?.leaderboard ?? []
  const feed = bursts?.feed ?? []

  const facts = useMemo(() => {
    if (rows.length === 0) return null
    const stages = new Set(rows.map((r) => r.label))
    const riser = [...rows].sort((a, b) => (b.yoy_delta ?? 0) - (a.yoy_delta ?? 0))[0]
    if (!riser) return null
    const oldest = feed.length ? feed.reduce((a, b) => (b.duration > a.duration ? b : a)) : null
    const gateEntry = lb?.gate ? Object.entries(lb.gate).find(([, g]) => g.gate_passed) : undefined
    const gate = gateEntry ? { model: gateEntry[0], ...gateEntry[1] } : null
    return { stages, riser, oldest, gate }
  }, [rows, feed, lb?.gate])

  // ---- Hero entrance + ambient orb drift ----
  // Explicit fromTo endpoints (not `from`) so a re-run can never latch onto
  // a stale inline transform and tween 118% -> 118% (which parked the masked
  // headline outside its clip window). Runs once on mount, independent of
  // snapshot arrival.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const ctx = gsap.context(() => {
        gsap.fromTo(
          '.reveal-line > span',
          { yPercent: 118 },
          {
            yPercent: 0,
            duration: 1.05,
            ease: 'power4.out',
            stagger: 0.1,
            clearProps: 'transform',
          },
        )
        gsap.fromTo(
          '.cover-hero-side > *',
          { y: 26, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            duration: 0.8,
            ease: 'power2.out',
            stagger: 0.09,
            delay: 0.35,
            clearProps: 'transform,opacity,visibility',
          },
        )
        // Orbs: perpetual slow drift (independent of entrance). A CSS
        // animation instead of a GSAP tween: these are two 36-44rem radial
        // gradients, and animating them from the main-thread ticker kept a
        // compositor pass running forever on the landing page (measured
        // ~+8fps when removed). CSS transform animations run off the main
        // thread and are skipped entirely under prefers-reduced-motion
        // (see cover.css). The drift itself now lives in the stylesheet.
      }, root)
      return () => ctx.revert()
    },
    { scope: root, dependencies: [] },
  )

  // ---- Bento entrance (cells mount only after the snapshot resolves) ----
  // The settle: plates land with mass (scale 1.02 -> 1, a hair of rotation).
  // Rotation drops out under the mobile width, where a tilt reads as
  // misalignment. Explicit fromTo endpoints keep a re-run from latching
  // a stale inline transform.
  useGSAP(
    () => {
      if (prefersReducedMotion() || rows.length === 0) return
      const tilted = !window.matchMedia('(max-width: 760px)').matches
      const tween = gsap.fromTo(
        '.cover-bento .plate',
        { y: 30, autoAlpha: 0, scale: 1.02, rotate: () => (tilted ? 0.3 : 0) },
        {
          y: 0,
          autoAlpha: 1,
          scale: 1,
          rotate: 0,
          duration: 0.75,
          ease: 'power2.out',
          stagger: 0.08,
          clearProps: 'transform,opacity,visibility',
          scrollTrigger: { trigger: '.cover-bento', start: 'top 88%', once: true },
        },
      )
      return () => {
        tween.kill()
      }
    },
    { scope: root, dependencies: [rows.length] },
  )

  useGSAP(
    () => {
      const el = track.current
      if (!el) return
      const wrap = el.parentElement
      const tween = gsap.to(el, { xPercent: -50, duration: 42, ease: 'none', repeat: -1 })
      const pause = () => tween.pause()
      const play = () => tween.play()
      wrap?.addEventListener('mouseenter', pause)
      wrap?.addEventListener('mouseleave', play)
      return () => {
        tween.kill()
        wrap?.removeEventListener('mouseenter', pause)
        wrap?.removeEventListener('mouseleave', play)
      }
    },
    { scope: root, dependencies: [rows.length] },
  )

  // Spotlight border: CSS vars track the cursor over the wrap
  const spotlightMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = spotRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  // Cinema curtain: ink covers -> route swaps underneath -> lift
  const enter = () => {
    if (prefersReducedMotion()) {
      navigate('/leaderboard')
      return
    }
    const el = document.createElement('div')
    el.className = 'curtain-glass'
    el.innerHTML =
      '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:\'Fraunces\',serif;font-style:italic;font-size:1.7rem;color:#eceef1">Biblio<span style="color:#f5b84c">.</span></span>'
    document.body.appendChild(el)
    gsap
      .timeline()
      .fromTo(
        el,
        { yPercent: 100, scale: 1.06 },
        { yPercent: 0, scale: 1, duration: 0.55, ease: 'power3.in' },
      )
      .call(() => navigate('/leaderboard'))
      .to(el, { yPercent: -100, duration: 0.85, ease: 'power4.inOut', delay: 0.16 })
      .call(() => el.remove())
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div className="cover-scope" ref={root}>
      {/* Front-door film overlay: covers the cover until watched/skipped.
          Plays on every fresh site open (reload/new tab); SPA route changes
          within the visit stay quiet. GSAP fades it up on entry and lifts
          it out over ~1.1s on exit, so the reveal into the cover reads as
          one choreographed move. */}
      {filmState !== 'done' && (
        <div className="cover-film" ref={filmRef} onClick={exitFilm} role="button" aria-label="Skip the intro film">
          {/* preload="none" on purpose. This file is 9.9 MB; with "metadata"
              the browser still opens a range request and buffers behind the
              first frame, which competes with the cover's own paint. Nothing
              downloads until play() is called a moment later. */}
          <video
            ref={videoRef}
            src={`/biblio-explainer.mp4?v=${__FILM_BUILD__}`}
            playsInline
            preload="none"
            muted={muted}
            onPlaying={() => setFilmState((s) => (s === 'pending' ? 'playing' : s))}
            onEnded={exitFilm}
            onError={endFilm}
          />
          {muted && (
            <button
              type="button"
              className="film-sound"
              onClick={(e) => {
                e.stopPropagation()
                const v = videoRef.current
                if (v) {
                  v.muted = false
                  setMuted(false)
                }
              }}
            >
              Sound on
            </button>
          )}
          <button
            type="button"
            className="film-skip"
            onClick={(e) => {
              e.stopPropagation()
              exitFilm()
            }}
          >
            Skip <ArrowRight weight="light" className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Ambient field */}
      <div className="cover-orbs" aria-hidden>
        <div className="orb orb-warm" />
        <div className="orb orb-cold" />
      </div>

      <div className="container">
        {/* Masthead */}
        <div className="cover-mast">
          <Link to="/cover" className="cover-brand">
            Biblio<em>.</em>
          </Link>
          <span className="cover-issue">No. {runId ?? 'in press'}</span>
          <span className="cover-issue" style={{ marginLeft: 'auto' }}>
            a plain-language watch on technology
          </span>
        </div>

        {/* Hero: split composition */}
        <section className="cover-hero">
          <div className="cover-hero-grid">
            <div>
              <p className="cover-kicker">
                <span className="dot" />
                The state of technology, read honestly
              </p>
              <h1 className="cover-title">
                <MaskedLine>Twenty fields,</MaskedLine>
                <MaskedLine>
                  one <span className="accent">quiet</span>
                </MaskedLine>
                <MaskedLine>observatory.</MaskedLine>
              </h1>            </div>
            <div className="cover-hero-side">
              <p className="cover-dek">
                Biblio reads the papers so you don't have to: what is rising,
                what is burning, and what the models expect next.
              </p>
              <div className="cover-enter">
                <span className="enter-title">run {runId ?? '…'}</span>
                <button type="button" className="enter-cta" onClick={enter}>
                  <span>Enter</span>
                  <span className="cta-orbit">
                    <ArrowRight weight="light" className="h-5 w-5" />
                  </span>
                </button>
                <button
                  type="button"
                  className="cover-tour-start"
                  onClick={() => {
                    startTour()
                    navigate('/lag')
                  }}
                >
                  Start tour
                </button>
              </div>
            </div>
          </div>
        </section>

        {!facts ? (
          <p style={{ color: 'var(--ink-faint)', paddingBlock: 'var(--sp-7)' }}>Warming the presses…</p>
        ) : (
          <>
            {/* Bento: stats plate / teases / shader card */}
            <div className="cover-bento">
              <div className="plate cover-bento-cell-a">
                <div className="plate-core">
                  <section className="cover-stats" aria-label="This run in numbers">
                    <Link to="/leaderboard" className="cover-stat" onClick={(e) => { e.preventDefault(); enter() }}>
                      <span className="stat-figure"><CoverCount value={rows.length} /></span>
                      <span className="stat-label">fields under watch</span>
                    </Link>
                    <Link to="/matrix" className="cover-stat" onClick={(e) => { e.preventDefault(); enter() }}>
                      <span className="stat-figure"><CoverCount value={facts.stages.size} /></span>
                      <span className="stat-label">stages of life represented</span>
                    </Link>
                    <Link to="/bursts" className="cover-stat" onClick={(e) => { e.preventDefault(); enter() }}>
                      <span className="stat-figure"><CoverCount value={feed.length} /></span>
                      <span className="stat-label">bursts detected</span>
                    </Link>
                    <Link to="/matrix" className="cover-stat" onClick={(e) => { e.preventDefault(); enter() }}>
                      <span className="stat-figure"><CoverCount value={(facts.riser.yoy_delta ?? 0) * 100} suffix="%" /></span>
                      <span className="stat-label">rise at the top, {facts.riser.display_name} leading</span>
                    </Link>
                  </section>
                </div>
              </div>

              <div className="plate cover-bento-cell-b">
                <div className="plate-core">
                  <section className="cover-teases" aria-label="From this run">
                    <div className="cover-tease">
                      <span className="tease-no">i.</span>
                      <p className="tease-body">
                        <Link to={`/domain/${facts.riser.domain}`} onClick={(e) => { e.preventDefault(); enter() }}>
                          {facts.riser.display_name}
                        </Link>{' '}
                        leads the year, up {pct(facts.riser.yoy_delta ?? 0)}.
                      </p>
                      <p className="tease-foot">the biggest riser, rank {facts.riser.rank}</p>
                    </div>
                    {facts.oldest && (
                      <div className="cover-tease">
                        <span className="tease-no">ii.</span>
                        <p className="tease-body">
                          <Link to="/bursts" onClick={(e) => { e.preventDefault(); enter() }}>
                            “{facts.oldest.keyword}”
                          </Link>{' '}
                          in {facts.oldest.domain.replace(/_/g, ' ')} has burned for{' '}
                          {facts.oldest.duration} straight years.
                        </p>
                        <p className="tease-foot">the oldest running burst</p>
                      </div>
                    )}
                    {facts.gate && (
                      <div className="cover-tease">
                        <span className="tease-no">iii.</span>
                        <p className="tease-body">
                          The {facts.gate.model.replace(/_/g, '-')} forecast cleared{' '}
                          {facts.gate.wins} of {facts.gate.series} backtests, so it
                          earns the bands it shows.
                        </p>
                        <p className="tease-foot">honesty, by design</p>
                      </div>
                    )}
                  </section>
                </div>
              </div>

              <div className="cover-bento-cell-c spotlight-wrap" ref={spotRef} onMouseMove={spotlightMove}>
                <div className="spotlight-border" aria-hidden />
                <CTASection
                  kicker={`Issue ${runId ? runId.slice(0, 8) : '…'}, twenty fields in view`}
                  titleLines={['Every field,', 'in plain sight.']}
                  description={
                    <>
                      Twenty research fields, tracked year by year: which are
                      rising, which are cooling, and what the backtests honestly
                      expect next.
                    </>
                  }
                  ctaLabel="Enter the observatory"
                  onCta={enter}
                  shaderColor="#f5b84c"
                  ariaLabel="Biblio cover card"
                />
              </div>
            </div>

            {/* Live wire: the one marquee. The track carries both the audit
                shim class and the owned cover class; cover.css neutralizes
                the workbench 60s CSS marquee at higher specificity so THIS
                GSAP tween is the only animation, with a live hover pause. */}
            <section className="cover-wire" aria-label="Every field, in rank order">
              <div ref={track} className="wire-track cover-wire-track">
                {rows.map((r) => (
                  <Link key={r.domain} to={`/domain/${r.domain}`} className="wire-card" onClick={(e) => { e.preventDefault(); enter() }}>
                    <span className="w-rank">{String(r.rank).padStart(2, '0')}</span>
                    <span className="w-name">{r.display_name}</span>
                    <span className="w-stage">{r.label}</span>
                    <span className="w-score">{r.emergence_score.toFixed(1)}</span>
                  </Link>
                ))}
                {rows.map((r) => (
                  <Link key={'b-' + r.domain} to={`/domain/${r.domain}`} className="wire-card" aria-hidden tabIndex={-1}>
                    <span className="w-rank">{String(r.rank).padStart(2, '0')}</span>
                    <span className="w-name">{r.display_name}</span>
                    <span className="w-stage">{r.label}</span>
                    <span className="w-score">{r.emergence_score.toFixed(1)}</span>
                  </Link>
                ))}
              </div>
            </section>

            {/* How to read */}
            <section className="cover-read">
              <h2>How to read this</h2>
              <p>
                Every field carries a score built from recent growth, citation
                acceleration, and bursts of language. Higher means faster
                emergence, nothing more mystical than that. Bands around
                forecasts are the model's honest uncertainty, not promises. The{' '}
                <Link to="/about" onClick={(e) => { e.preventDefault(); enter() }}>methodology</Link> carries every caveat in full.
              </p>
            </section>
          </>
        )}

        {/* Colophon */}
        <div className="cover-colophon">
          <span>Biblio, the public face of the biblio-trend observatory.</span>
          <span>
            {prefersReducedMotion() ? (
              <>Motion is reduced by your choice,{' '}
                <button type="button" className="cover-motion-link" onClick={() => setMotionChoice('full')}>
                  bring the full show
                </button></>
            ) : (
              <button type="button" className="cover-motion-link" onClick={() => setMotionChoice('reduced')}>
                reduce motion
              </button>
            )}
          </span>
          <span>Data: OpenAlex works, 2000-2025.</span>
        </div>
      </div>
    </div>
  )
}
