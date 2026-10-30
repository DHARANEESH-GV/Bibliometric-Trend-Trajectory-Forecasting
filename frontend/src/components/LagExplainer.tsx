/**
 * LagExplainer — the plain-language tutorial at the top of the Lag view.
 *
 * The Lag view answers one question, and the old page opened with four
 * jargon-dense statements ("pooled correlation", "time-block bootstrap",
 * "95% CI when resampling domains") before showing a single chart. Anyone
 * without a stats background bounced here.
 *
 * This panel leads with the question in ordinary words, gives the answer as
 * one headline sentence, then explains what the charts are actually showing
 * as three numbered steps. Every figure is passed in from the snapshot (the
 * caller reads lag.json); nothing here invents or hardcodes a number.
 *
 * The rigor is not removed, only moved: the technical statements and the
 * full robustess table still live below, unchanged. Wording rules from
 * demochrome.test.ts still apply (no "papers lead patents by N").
 */
import { useState } from 'react'

interface LagExplainerProps {
  /** Plain-language headline answer, built by the caller from the data. */
  headline: string
  /** Supporting sentence, also data-derived. */
  support: string
  /** The domain count, for the "how much this covers" line. */
  nDomains: number
}

export function LagExplainer({ headline, support, nDomains }: LagExplainerProps) {
  const [open, setOpen] = useState(true)

  return (
    <section className="lag-explainer" aria-labelledby="lag-explainer-title">
      <div className="lag-explainer-head">
        <div>
          <span className="section-eyebrow">Start here</span>
          <h2 id="lag-explainer-title" className="lag-explainer-title">
            What this page is asking
          </h2>
        </div>
        <button
          type="button"
          className="lag-explainer-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide the walkthrough' : 'Show the walkthrough'}
        </button>
      </div>

      {open ? (
        <div className="lag-explainer-body">
          <p className="lag-explainer-question">
            When a field gets busier in research, how long until it gets
            busier in patents?
          </p>

          <p className="lag-explainer-answer">{headline}</p>
          <p className="lag-explainer-support">{support}</p>

          <ol className="lag-explainer-steps">
            <li>
              <span className="lag-explainer-step-num num">1</span>
              <div>
                <strong>Two lines, one field.</strong> For each of the{' '}
                {nDomains} fields, we draw how fast its research papers grew
                and how fast its patents grew, year by year. One line is
                papers, the other is patents.
              </div>
            </li>
            <li>
              <span className="lag-explainer-step-num num">2</span>
              <div>
                <strong>Slide one line along the other.</strong> If patents
                follow papers, the two lines should line up best when the
                patent line is pushed later. The slider under each chart does
                exactly that, and the number beside it says how well they
                line up at that offset.
              </div>
            </li>
            <li>
              <span className="lag-explainer-step-num num">3</span>
              <div>
                <strong>Read the curve, not a single number.</strong> The big
                chart tries every offset at once. Its peak is the offset where
                the lines agree most. A high peak means the two move together;
                a flat curve means they do not.
              </div>
            </li>
          </ol>

          <p className="lag-explainer-caveat">
            One honest catch before you read anything else: patent dates are
            the day a patent was <em>granted</em>, which includes years of
            examination. So this measures how two published records move
            together. It does not measure how long an invention took.
          </p>
        </div>
      ) : null}
    </section>
  )
}
