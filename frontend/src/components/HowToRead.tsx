/**
 * HowToRead — the collapsible "How to read this" panel.
 *
 * Shared by the Lag and Leaderboard views so the explanation of what the
 * numbers mean lives in ONE place. Collapsed by default: it is orientation
 * material, not the result, and the views are already lead-first.
 *
 * Wording rules (asserted in tests): never "papers lead patents by N
 * quarters" and never "research-to-patent lag". The lag here is a
 * descriptive offset between two series, and grant dates include patent
 * examination time.
 */
import { useId, useState } from 'react'
import { GlossaryTerm } from './GlossaryTerm'

interface HowToReadProps {
  /** Which explanation set to show. Keeps each view's copy specific. */
  variant: 'lag' | 'leaderboard'
}

export function HowToRead({ variant }: HowToReadProps) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <section className="howto">
      <button
        type="button"
        className="howto-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="howto-caret" aria-hidden>
          {open ? '\u2212' : '+'}
        </span>
        How to read this
      </button>

      <div id={id} className="howto-body" hidden={!open}>
        {variant === 'lag' ? (
          <ol className="howto-list">
            <li>
              Each panel shows two growth series for one domain: research
              papers (gold) and granted patents (blue), both as 4-quarter
              year-over-year growth on a shared normalized axis.
            </li>
            <li>
              The lag is a <em>descriptive offset</em> between the two series,
              not a cause-and-effect chain. It says the shapes line up better
              when the patent series is moved earlier by that many quarters.
            </li>
            <li>
              Patent dates are <strong>grant</strong> dates, which include
              patent examination time. A width of a few quarters is well
              inside typical pendency, so this cannot be read as the time from
              a discovery to an invention.
            </li>
            <li>
              <strong>Reliable</strong> means the pooled result survives the
              robustness checks. <strong>Exploratory</strong> means the panel
              has too few independent quarters to settle anything on its own.{' '}
              <strong>Low confidence</strong> marks domains with sparse or
              derived data.
            </li>
            <li>
              Individually almost no domain is significant, which is what
              chance produces across twenty tests. The finding is a pooled
              one, and a <GlossaryTerm term="placebo test" /> is what stops it
              from being an artefact of mismatched pairs.
            </li>
          </ol>
        ) : (
          <ol className="howto-list">
            <li>
              Each row is one technology domain, ranked by its{' '}
              <GlossaryTerm term="emergence score" />, a 0-100 blend of recent
              growth, acceleration, keyword bursts and volume.
            </li>
            <li>
              The score uses configurable weights. Perturbing them changes the
              order very little, which shows the ranking is insensitive to the
              weights, not that the weights are the right ones.
            </li>
            <li>
              <strong>Emerging</strong>, <strong>Accelerating</strong>,{' '}
              <strong>Active</strong> and <strong>Watch</strong> are lifecycle
              labels with hysteresis, so a domain does not flip back and forth
              on a single year.
            </li>
            <li>
              A <GlossaryTerm term="burst" /> marks a stretch of years when a
              keyword ran far above its own baseline. Paper counts come from a
              single OpenAlex snapshot.
            </li>
            <li>
              <strong>Reliable</strong> domains are full-corpus or well
              sampled. <strong>Exploratory</strong> and{' '}
              <strong>Low confidence</strong> domains carry sparse or derived
              data and should not be read as settled.
            </li>
          </ol>
        )}
      </div>
    </section>
  )
}
