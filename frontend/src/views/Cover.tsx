/**
 * Cover — Biblio's true landing. Its own "Ink & Paper" world: Fraunces
 * + Newsreader on cream paper, no app chrome. One 'Enter the
 * observatory' button triggers a curtain wipe into the dark workbench.
 * Every figure below derives from this run's snapshot at render time.
 * Absorbs the old Overview tab; Source wordmark returns here anytime.
 */
import { useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '../lib/useQuery'
import { loadLeaderboard, loadBursts } from '../lib/snapshots'
import { useStore } from '../lib/store'
import { gsap, useGSAP, prefersReducedMotion } from '../lib/gsap'
import './cover.css'

/** Line-mask reveal: wraps children in an overflow-hidden line with a
 *  span GSAP can slide up from below. */
function Line({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <span className="reveal-line">
      <span data-delay={delay}>{children}</span>
    </span>
  )
}

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

export function CoverView() {
  const { data: lb } = useQuery(loadLeaderboard, [])
  const { data: bursts } = useQuery(loadBursts, [])
  const { runId } = useStore()
  const navigate = useNavigate()
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)

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

  // ---------------- Entrance + scroll choreography ----------------
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const ctx = gsap.context(() => {
        // Mast lines rise, staggered
        gsap.from('.reveal-line > span', {
          yPercent: 115,
          duration: 1.0,
          ease: 'power4.out',
          stagger: 0.09,
        })
        // Hairline rule draws itself
        gsap.from('.draw-rule', {
          strokeDasharray: 1200,
          strokeDashoffset: 1200,
          duration: 1.4,
          ease: 'power2.inOut',
          delay: 0.5,
        })
        // Scroll-entrances for plates below the fold
        gsap.utils.toArray<HTMLElement>('.cover-reveal').forEach((el) => {
          gsap.from(el, {
            y: 28,
            autoAlpha: 0,
            duration: 0.8,
            ease: 'power2.out',
            scrollTrigger: { trigger: el, start: 'top 87%', once: true },
          })
        })
        // Live wire marquee: seamless -50% loop, pause on hover
        if (track.current && rows.length > 0) {
          const tween = gsap.to(track.current, {
            xPercent: -50,
            ease: 'none',
            duration: Math.max(24, rows.length * 1.6),
            repeat: -1,
          })
          const wrap = track.current.parentElement
          const pause = () => tween.pause()
          const play = () => tween.play()
          wrap?.addEventListener('mouseenter', pause)
          wrap?.addEventListener('mouseleave', play)
          // Clean removal inside ctx.revert()
          return () => {
            wrap?.removeEventListener('mouseenter', pause)
            wrap?.removeEventListener('mouseleave', play)
          }
        }
      }, root)
      return () => ctx.revert()
    },
    { scope: root, dependencies: [rows.length] },
  )

  // ---------------- Curtain transition ----------------
  const enter = () => {
    if (prefersReducedMotion()) {
      navigate('/leaderboard')
      return
    }
    const el = document.createElement('div')
    el.className = 'curtain'
    document.body.appendChild(el)
    gsap
      .timeline({ onComplete: () => navigate('/leaderboard') })
      .fromTo(el, { yPercent: 100 }, { yPercent: 0, duration: 0.55, ease: 'power3.in' })
      .to(el, {
        yPercent: -100,
        duration: 0.7,
        ease: 'power3.inOut',
        delay: 0.08,
        onStart: () => {
          // navigate happens on complete; wipe reveals the next page
        },
      })
      .set(el, { display: 'none' })
      .call(() => el.remove())
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div className="cover-scope" ref={root}>
      <div className="container">
        {/* ------------------------- Masthead ------------------------- */}
        <div className="cover-mast" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)', alignItems: 'baseline' }}>
          <Link to="/cover" className="cover-brand">
            Biblio<em>.</em>
          </Link>
          <span className="cover-issue">No. {runId ?? '—'}</span>
          <span
            className="cover-issue"
            style={{ marginLeft: 'auto' }}
          >
            a plain-language watch on technology
          </span>
        </div>

        {/* --------------------------- Hero --------------------------- */}
        <section className="cover-hero">
          <p className="cover-kicker">The state of technology, read honestly.</p>
          <h1 className="cover-title">
            <Line>Twenty fields,</Line>
            <Line>
              one <span className="accent">quiet</span>
            </Line>
            <Line>observatory.</Line>
          </h1>
          <p className="cover-dek">
            Biblio reads the papers so you don't have to — watching what is
            rising, what is burning, and what the models honestly expect
            next, across twenty corners of modern technology.
          </p>
          <button type="button" className="enter-cta" onClick={enter}>
            <span>Enter the observatory</span>
            <span aria-hidden>→</span>
          </button>
        </section>

        {!facts ? (
          <p style={{ fontStyle: 'italic', color: 'var(--ink-faint)', paddingBlock: 'var(--sp-7)' }}>
            Warming the presses…
          </p>
        ) : (
          <>
            {/* ------------------- Computed stat plate ------------------- */}
            <section className="cover-stats cover-reveal" aria-label="This run in numbers">
              <Link to="/leaderboard" className="cover-stat" onClick={(e) => { e.preventDefault(); enter() }}>
                <span className="stat-figure">
                  <CoverCount value={rows.length} />
                </span>
                <span className="stat-label">fields under watch</span>
              </Link>
              <Link to="/matrix" className="cover-stat" onClick={(e) => { e.preventDefault(); enter() }}>
                <span className="stat-figure">
                  <CoverCount value={facts.stages.size} />
                </span>
                <span className="stat-label">stages of life represented</span>
              </Link>
              <Link to="/bursts" className="cover-stat" onClick={(e) => { e.preventDefault(); enter() }}>
                <span className="stat-figure">
                  <CoverCount value={feed.length} />
                </span>
                <span className="stat-label">bursts detected</span>
              </Link>
              <Link to="/matrix" className="cover-stat" onClick={(e) => { e.preventDefault(); enter() }}>
                <span className="stat-figure">
                  <CoverCount value={(facts.riser.yoy_delta ?? 0) * 100} suffix="%" />
                </span>
                <span className="stat-label">rise at the top — {facts.riser.display_name}</span>
              </Link>
            </section>

            {/* ---------------------- Teases column ---------------------- */}
            <section className="cover-teases cover-reveal" aria-label="From this run">
              <div className="cover-tease">
                <span className="tease-no">i.</span>
                <p className="tease-body">
                  <Link
                    to={`/domain/${facts.riser.domain}`}
                    onClick={(e) => { e.preventDefault(); enter() }}
                  >
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
                    {facts.gate.wins} of {facts.gate.series} backtests — it earns
                    the bands it shows.
                  </p>
                  <p className="tease-foot">honesty, by design</p>
                </div>
              )}
            </section>

            {/* ------------------------ Live wire ------------------------ */}
            <section className="cover-wire cover-reveal" aria-label="Every field, in rank order">
              <div ref={track} className="wire-track">
                {rows.map((r) => (
                  <Link
                    key={r.domain}
                    to={`/domain/${r.domain}`}
                    className="wire-card"
                    onClick={(e) => { e.preventDefault(); enter() }}
                  >
                    <span className="w-rank">{String(r.rank).padStart(2, '0')}</span>
                    <span className="w-name">{r.display_name}</span>
                    <span className="w-stage">{r.label}</span>
                    <span className="w-score">{r.emergence_score.toFixed(1)}</span>
                  </Link>
                ))}
                {/* duplicated half for the seamless loop */}
                {rows.map((r) => (
                  <Link
                    key={'b-' + r.domain}
                    to={`/domain/${r.domain}`}
                    className="wire-card"
                    aria-hidden
                    tabIndex={-1}
                  >
                    <span className="w-rank">{String(r.rank).padStart(2, '0')}</span>
                    <span className="w-name">{r.display_name}</span>
                    <span className="w-stage">{r.label}</span>
                    <span className="w-score">{r.emergence_score.toFixed(1)}</span>
                  </Link>
                ))}
              </div>
            </section>

            {/* ----------------------- How to read ----------------------- */}
            <section className="cover-read cover-reveal">
              <h2>How to read this</h2>
              <p>
                Every field carries a score built from recent growth, citation
                acceleration, and bursts of language — higher means faster
                emergence, nothing more mystical than that. Bands around
                forecasts are the model's honest uncertainty, not promises.
                The <Link to="/about" onClick={(e) => { e.preventDefault(); enter() }}>methodology</Link> carries every caveat in full.
              </p>
            </section>
          </>
        )}

        {/* ------------------------- Colophon ------------------------- */}
        <div className="cover-colophon">
          <span>Biblio — the public face of the biblio-trend observatory.</span>
          <span>Data: OpenAlex works, 2000–2025.</span>
        </div>
      </div>
    </div>
  )
}
