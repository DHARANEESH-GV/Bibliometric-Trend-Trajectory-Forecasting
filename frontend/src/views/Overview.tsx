/**
 * Overview — Biblio's front page. A welcome, not a report: mast with
 * line-reveal, computed count-up stats, a live marquee of the twenty
 * domains, and three teases computed from this run's snapshot. every
 * number derives from disk at render time — nothing hardcoded (tests
 * enforce this). Motion via GSAP; everything static under reduced-motion.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '../lib/useQuery'
import { loadLeaderboard, loadBursts } from '../lib/snapshots'
import { useStore } from '../lib/store'
import { StagePill } from '../components/StagePill'
import { useCountUp } from '../hooks/useCountUp'
import { gsap, useGSAP, prefersReducedMotion, ScrollTrigger } from '../lib/gsap'
import { useRef } from 'react'

function Stat({
  value,
  decimals = 0,
  suffix,
  label,
  to,
}: {
  value: number
  decimals?: number
  suffix?: string
  label: string
  to: string
}) {
  const { ref, display } = useCountUp(value, decimals)
  return (
    <Link
      to={to}
      className="hairline-top overview-stat"
      style={{ textDecoration: 'none', display: 'block', paddingTop: 'var(--sp-3)' }}
    >
      <span
        className="num"
        style={{
          display: 'block',
          fontSize: 'var(--text-xl)',
          color: 'var(--ink-0)',
        }}
      >
        <span ref={ref as React.RefObject<HTMLSpanElement>}>{display}</span>
        {suffix}
      </span>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-2)' }}>{label}</span>
    </Link>
  )
}

export function OverviewView() {
  const { data: lb } = useQuery(loadLeaderboard, [])
  const { data: bursts } = useQuery(loadBursts, [])
  const { runId } = useStore()
  const root = useRef<HTMLDivElement>(null)

  const rows = lb?.leaderboard ?? []
  const feed = bursts?.feed ?? []

  const facts = useMemo(() => {
    if (rows.length === 0) return null
    const stages = new Set(rows.map((r) => r.label))
    const top = rows[0]
    const riser = [...rows].sort((a, b) => (b.yoy_delta ?? 0) - (a.yoy_delta ?? 0))[0]
    if (!top || !riser) return null
    const oldest = feed.length
      ? feed.reduce((a, b) => (b.duration > a.duration ? b : a))
      : null
    const gateModel = lb?.gate
      ? Object.entries(lb.gate).find(([, g]) => g.gate_passed)
      : undefined
    const gate = gateModel ? { model: gateModel[0], ...gateModel[1] } : null
    return { stages, top, riser, oldest, gate }
  }, [rows, feed, lb])

  // ---- GSAP timeline: mast line-reveal, rule draw, scroll staggers ----
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const ctx = gsap.context(() => {
        gsap.from('.ov-line', {
          yPercent: 110,
          duration: 0.9,
          ease: 'power3.out',
          stagger: 0.08,
        })
        gsap.from('.ov-rule', {
          scaleX: 0,
          transformOrigin: 'left center',
          duration: 1.1,
          ease: 'power2.inOut',
          delay: 0.35,
        })
        gsap.utils.toArray<HTMLElement>('.ov-reveal').forEach((el) => {
          gsap.from(el, {
            y: 24,
            autoAlpha: 0,
            duration: 0.7,
            ease: 'power2.out',
            scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          })
        })
      }, root)
      return () => {
        ctx.revert()
        ScrollTrigger.refresh()
      }
    },
    { scope: root },
  )

  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <div ref={root}>
      {/* ------------------------------ Mast ------------------------------ */}
      <header style={{ paddingBlock: 'var(--sp-7) var(--sp-6)' }}>
        <div style={{ overflow: 'hidden' }}>
          <p className="ov-line num" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-3)', letterSpacing: '0.08em' }}>
            ISSUE {runId}
          </p>
        </div>
        <div style={{ overflow: 'hidden' }}>
          <h1
            className="ov-line"
            style={{
              margin: 'var(--sp-3) 0 0',
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-xl)',
              lineHeight: 1.05,
              maxWidth: '22ch',
            }}
          >
            Biblio watches how technology takes shape.
          </h1>
        </div>
        <div style={{ overflow: 'hidden' }}>
          <p
            className="ov-line"
            style={{
              margin: 'var(--sp-4) 0 0',
              fontSize: 'var(--text-lg)',
              color: 'var(--ink-2)',
              maxWidth: '58ch',
            }}
          >
            A quiet, plain-language read on research across twenty fields —
            what is rising, what is burning, and what the models honestly
            expect next. Every number here comes straight from the latest
            data run.
          </p>
        </div>
        <div className="ov-rule hairline-bottom" style={{ height: 1, marginTop: 'var(--sp-6)' }} />
      </header>

      {!facts ? (
        <p style={{ color: 'var(--ink-2)', paddingBlock: 'var(--sp-7)' }}>Loading…</p>
      ) : (
        <>
          {/* --------------------------- Hero stats --------------------------- */}
          <section className="ov-reveal" aria-label="This run at a glance">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
                gap: 'var(--sp-5)',
              }}
            >
              <Stat value={rows.length} label="fields under watch" to="/leaderboard" />
              <Stat value={facts.stages.size} label="stages of life, represented" to="/matrix" />
              <Stat value={feed.length} label="bursts detected" to="/bursts" />
              <Stat
                value={(facts.top.yoy_delta ?? 0) * 100}
                decimals={0}
                suffix="%"
                label={`rise at the top — ${facts.top.display_name}`}
                to={`/domain/${facts.top.domain}`}
              />
            </div>
          </section>

          {/* ------------------------ From this run --------------------------- */}
          <section className="ov-reveal" style={{ marginTop: 'var(--sp-8)' }} aria-label="From this run">
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-md)',
                margin: 0,
              }}
            >
              From this run
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
                gap: 'var(--sp-6)',
                marginTop: 'var(--sp-4)',
              }}
            >
              <div className="hairline-top" style={{ paddingTop: 'var(--sp-3)' }}>
                <p style={{ margin: 0 }}>
                  <Link to={`/domain/${facts.riser.domain}`} style={{ color: 'var(--stage-emerging)' }}>
                    {facts.riser.display_name}
                  </Link>{' '}
                  leads the year, up {pct(facts.riser.yoy_delta ?? 0)}.
                </p>
                <p className="num" style={{ margin: 'var(--sp-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                  biggest riser · rank {facts.riser.rank}
                </p>
              </div>
              {facts.oldest && (
                <div className="hairline-top" style={{ paddingTop: 'var(--sp-3)' }}>
                  <p style={{ margin: 0 }}>
                    <Link to="/bursts">“{facts.oldest.keyword}”</Link> in{' '}
                    {facts.oldest.domain.replace(/_/g, ' ')} has burned for{' '}
                    {facts.oldest.duration} straight years.
                  </p>
                  <p className="num" style={{ margin: 'var(--sp-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                    oldest running burst
                  </p>
                </div>
              )}
              {facts.gate && (
                <div className="hairline-top" style={{ paddingTop: 'var(--sp-3)' }}>
                  <p style={{ margin: 0 }}>
                    The {facts.gate.model.replace(/_/g, '-')} forecast cleared{' '}
                    {facts.gate.wins} of {facts.gate.series} backtests — it earns
                    the{' '}
                    <Link to="/trajectory">bands you see on Trajectories</Link>.
                  </p>
                  <p className="num" style={{ margin: 'var(--sp-2) 0 0', fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                    forecast gate · honest by design
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* -------------------- Live marquee (live wire) -------------------- */}
          <section className="ov-reveal" style={{ marginTop: 'var(--sp-8)' }} aria-label="Every field, live">
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-md)',
                margin: 0,
              }}
            >
              Every field, live
            </h2>
            <p style={{ color: 'var(--ink-2)', margin: 'var(--sp-2) 0 var(--sp-4)' }}>
              Hover to pause. Click any field to open its page.
            </p>
            <TickerMarquee rows={rows} />
          </section>

          {/* ------------------------ How to read ----------------------------- */}
          <section className="ov-reveal" style={{ marginBlock: 'var(--sp-8)' }}>
            <div className="hairline-top" style={{ paddingTop: 'var(--sp-4)' }}>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-md)',
                  margin: 0,
                }}
              >
                How to read this
              </h2>
              <p style={{ color: 'var(--ink-2)', maxWidth: '68ch', margin: 'var(--sp-3) 0 0' }}>
                Each field gets a <strong>score</strong> from its recent growth
                and momentum — higher means faster emergence. Shaded bands on
                forecasts show what the model honestly expects, not promises.
                Words like <em>accelerating</em> are computed labels, not
                opinions. The{' '}
                <Link to="/about">methodology page</Link> carries every caveat.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Marquee — the live wire. Duplicated track, seamless wrap, pause on  */
/* hover, reduced-motion = static wrap. Cards link to drill-downs.     */
/* ------------------------------------------------------------------ */
import { StagePill as _SP } from '../components/StagePill'

function TickerMarquee({
  rows,
}: {
  rows: Array<{
    domain: string
    display_name: string
    label: string
    rank: number
    emergence_score: number
  }>
}) {
  const track = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (prefersReducedMotion() || rows.length === 0) return
      const tween = gsap.to(track.current, {
        xPercent: -50,
        ease: 'none',
        duration: 40, // calm pacing: whole list in ~20s per half
        repeat: -1,
      })
      const el = track.current?.parentElement
      const pause = () => tween.pause()
      const play = () => tween.play()
      el?.addEventListener('mouseenter', pause)
      el?.addEventListener('mouseleave', play)
      return () => {
        el?.removeEventListener('mouseenter', pause)
        el?.removeEventListener('mouseleave', play)
        tween.kill()
      }
    },
    { dependencies: [rows.length] },
  )

  const card = (r: (typeof rows)[number], key: string) => (
    <Link
      key={key}
      to={`/domain/${r.domain}`}
      style={{
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 'var(--sp-3)',
        whiteSpace: 'nowrap',
        paddingInline: 'var(--sp-4)',
      }}
    >
      <span className="num" style={{ color: 'var(--ink-3)', fontSize: 'var(--text-xs)' }}>
        {String(r.rank).padStart(2, '0')}
      </span>
      <span style={{ color: 'var(--ink-0)' }}>{r.display_name}</span>
      <StagePill label={r.label} />
      <span className="num" style={{ color: 'var(--ink-2)', fontSize: 'var(--text-sm)' }}>
        {r.emergence_score.toFixed(1)}
      </span>
      <span aria-hidden style={{ color: 'var(--ink-3)' }}>·</span>
    </Link>
  )

  return (
    <div
      style={{
        borderBlock: 'var(--hairline)',
        overflow: 'hidden',
        paddingBlock: 'var(--sp-3)',
      }}
      role="marquee"
      aria-label="Fields rising through the observatory, in rank order"
    >
      <div style={{ display: 'flex', width: 'max-content' }} ref={track}>
        {rows.map((r) => card(r, r.domain))}
        {prefersReducedMotion() && rows.map((r) => card(r, 'dup-' + r.domain))}
      </div>
    </div>
  )
}
