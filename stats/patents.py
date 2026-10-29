"""Phase 3.5 — patent series + paper-vs-patent lag analysis.

Input:  data/patents/patent_counts.csv — the BigQuery result produced by
        sql/patent_counts.sql (generated from config/domains.yaml CPC rules;
        see scripts/gen_patent_query.py for the full workaround rationale:
        USPTO ODP key is passport-gated, PatentsView bulk exceeds local disk,
        so the counts are computed in the BigQuery sandbox and only the
        ~500-row aggregate is downloaded).
Output: data/patents/patent_series.json — per domain:
          annual{year: patents} 2014–2025, with 2000–2013 present as NULL
          (no data — the source has no usable CPC coverage there),
          total, peak_year, metadata(source, query, concordance, caveats)
        plus a crosswalk section: paper-vs-patent peak-year lag per domain
        (papers from data/trajectories/panel.json).

Coverage boundary — MEASURED 2026-10-29 against the live BigQuery mirror:
  * Google's `patents.publications` holds only 265 US grants for year 2000
    (~166,000 in 2001), so 2000 is unusable.
  * US-grant CPC population is 100% in every year 2001–2025, BUT whole CPC
    sections are effectively unclassified before 2014: H01L (semiconductors)
    returns 1 patent for 2005 and 24,241 for 2015, with identical results
    for spaced/unspaced/trimmed code variants — so it is a source-coverage
    property, not a join bug.
  * 2014 is the first year where every one of the 20 domains has a
    continuous series, hence PATENT_YEAR_MIN.

Honesty rules (§8):
  * Pre-2014 years are NULL, never 0. A zero would claim "no patents were
    granted", which is false; the source simply has no classification.
  * Zeros WITHIN 2014–2025 are real zeros of the CPC concordance — but the
    concordance itself is approximate (plan §15): CPC boundaries do not
    align cleanly with human domain categories. Every series carries that
    caveat.
  * Grant-year basis: a patent appears in its GRANT year, not its filing
    year. Grant lag (1–3 yr) means recent patent years undercount relative
    to papers' publication-year basis. The lag analysis states this.
  * Multi-membership: a patent matching several domains counts once per
    matched domain; known overlaps are parent/child CPC pairs (QEC ⊂
    quantum_computing; genAI/ai_agents ⊂ AI's G06N3/00 group).
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CSV_IN = REPO / "data" / "patents" / "patent_counts.csv"
PANEL = REPO / "data" / "trajectories" / "panel.json"
QUERY = REPO / "sql" / "patent_counts.sql"
OUT = REPO / "data" / "patents" / "patent_series.json"

YEAR_MIN, YEAR_MAX = 2000, 2025
PATENT_YEAR_MIN = 2014          # measured coverage boundary — see module docstring
# Grants for a given filing year complete ~3-4 years later, so the last few
# grant years are structurally incomplete (AI falls 18,746 -> 15,788 across
# 2023-2025 purely from ungranted filings).
PATENT_COMPLETE_MAX = 2024
YEARS = list(range(YEAR_MIN, YEAR_MAX + 1))
LAG_WINDOW = (PATENT_YEAR_MIN, PATENT_COMPLETE_MAX)
MAX_LAG = 3
# Minimum paired growth points before a lag correlation is even attempted.
# 2014-2024 gives 10 growth values; at |lag|=3 that leaves 7. Below this the
# critical r exceeds 0.75 and nothing short of a perfect correlation can
# clear it, so a result would be an artefact rather than a finding.
MIN_LAG_PAIRS = 7

CONCORDANCE_CAVEAT = (
    "CPC-to-domain concordance is approximate: CPC boundaries do not align "
    "cleanly with human technology categories, so counts may over- or "
    "under-count a domain. Patents are US grants by grant year; grant lag "
    "(1-3 years) makes recent years undercount relative to paper "
    "publication years."
)


def read_counts(quiet: bool = False) -> dict[str, dict[int, int]]:
    """Parse the BigQuery CSV export → {slug: {year: count}}.

    Validates: header exactly domain,year,patents; years in range; counts
    non-negative integers; no duplicate (domain, year) rows.

    Rows before PATENT_YEAR_MIN are dropped with a notice: a CSV exported
    before the coverage boundary was established still carries them, and
    they are unusable (the source has no classification there). Dropping is
    safe and lossless; the covered window is unaffected.
    """
    if not CSV_IN.exists():
        raise SystemExit(
            f"{CSV_IN} not found.\n"
            "Run the query in sql/patent_counts.sql in the BigQuery sandbox\n"
            "(https://console.cloud.google.com/bigquery — free, no credit card)\n"
            "and download the result as CSV to data/patents/patent_counts.csv.\n"
            "See scripts/gen_patent_query.py for the step-by-step."
        )
    counts: dict[str, dict[int, int]] = {}
    seen: set[tuple[str, int]] = set()
    dropped = 0
    with CSV_IN.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != ["domain", "year", "patents"]:
            raise SystemExit(
                f"unexpected CSV header {reader.fieldnames}; expected "
                "['domain', 'year', 'patents'] — re-export from BigQuery"
            )
        for row in reader:
            slug = row["domain"].strip()
            year = int(row["year"])
            n = int(row["patents"])
            if not (YEAR_MIN <= year <= YEAR_MAX):
                raise SystemExit(f"year {year} outside {YEAR_MIN}-{YEAR_MAX} for {slug}")
            if year < PATENT_YEAR_MIN:
                dropped += 1
                continue
            if n < 0:
                raise SystemExit(f"negative count for {slug} {year}")
            key = (slug, year)
            if key in seen:
                raise SystemExit(f"duplicate row for {slug} {year}")
            seen.add(key)
            counts.setdefault(slug, {})[year] = n
    if dropped and not quiet:
        print(f"[patents] dropped {dropped} pre-{PATENT_YEAR_MIN} rows "
              f"(no usable CPC coverage before {PATENT_YEAR_MIN})")
    return counts


def _growth(series: dict[int, int], years: list[int]) -> dict[int, float]:
    """Year-over-year growth rate for the given years (needs y-1 present)."""
    out: dict[int, float] = {}
    for y in years:
        prev, cur = series.get(y - 1), series.get(y)
        if prev is None or cur is None:
            continue
        out[y] = (cur - prev) / (prev + 1.0)
    return out


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    """Pearson correlation, or None when either series is constant.

    Used only to pick the best lead/lag shift; a constant series (e.g. all
    zeros) has no defined correlation rather than a spurious 0.
    """
    n = len(xs)
    if n < 3 or n != len(ys):
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    if dx == 0 or dy == 0:
        return None
    return num / (dx * dy)


def _max_lag_r(p_growth: dict[int, float], q_growth: dict[int, float]) -> tuple[int | None, float | None, list[dict]]:
    """Scan lags in [-MAX_LAG, +MAX_LAG]; return best lag, its r, and the scan.

    lag > 0 means patents trail papers. Ties resolve toward the smaller |lag|.
    Lags with fewer than MIN_LAG_PAIRS paired points are recorded as
    underpowered and are not eligible to win.
    """
    rows: list[dict] = []
    best: tuple[tuple[float, int], int, float] | None = None
    for lag in range(-MAX_LAG, MAX_LAG + 1):
        xs, ys = [], []
        for y in sorted(q_growth):
            if y - lag in p_growth:
                xs.append(p_growth[y - lag])
                ys.append(q_growth[y])
        r = _pearson(xs, ys)
        powered = len(xs) >= MIN_LAG_PAIRS
        rows.append({"lag": lag, "r": round(r, 3) if r is not None else None,
                     "n": len(xs), "powered": powered})
        if r is None or not powered:
            continue
        key = (r, -abs(lag))
        if best is None or key > best[0]:
            best = (key, lag, r)
    if best is None:
        return None, None, rows
    return best[1], best[2], rows


def _permutation_p(p_growth: dict[int, float], q_growth: dict[int, float],
                   observed_r: float, n_perm: int = 2000,
                   seed: int = 20261029) -> float | None:
    """Null distribution for the BEST lag correlation.

    Scanning 9 lags and keeping the maximum inflates r substantially: with
    only ~8 growth points, a max-r of 0.8 is routine under pure noise. The
    honest test is therefore "is the best-lag r unusual given the number of
    lags scanned?", not "is r large?".

    Shuffles the patent growth values (destroying any true alignment while
    preserving the marginal distribution), re-scans every lag, and returns
    the share of permutations whose max-r >= the observed max-r.
    """
    if observed_r is None:
        return None
    import random

    q_values = [q_growth[y] for y in sorted(q_growth)]
    q_years = sorted(q_growth)
    rng = random.Random(seed)
    hits = 0
    for _ in range(n_perm):
        shuffled = q_values[:]
        rng.shuffle(shuffled)
        perm_q = dict(zip(q_years, shuffled))
        _, perm_r, _ = _max_lag_r(p_growth, perm_q)
        if perm_r is not None and perm_r >= observed_r:
            hits += 1
    return round((hits + 1) / (n_perm + 1), 4)


def _panel_significance(crosswalk: dict) -> dict:
    """Panel-level verdict across the 20 domain tests.

    Testing 20 domains at alpha=0.10 yields ~2 false positives by chance, so
    a per-domain 'significant' flag cannot stand alone. Two corrections:
      * binomial tail — is the count of significant domains surprising?
      * Bonferroni   — does any single domain survive 0.10/20?
    """
    from math import comb

    tested = [x for x in crosswalk.values() if x["permutation_p"] is not None]
    n = len(tested)
    k = sum(1 for x in tested if x["significant"])
    alpha = 0.10
    tail = (sum(comb(n, i) * alpha ** i * (1 - alpha) ** (n - i)
                for i in range(k, n + 1)) if n else None)
    bonferroni = [(slug, x["permutation_p"]) for slug, x in crosswalk.items()
                  if x["permutation_p"] is not None
                  and x["permutation_p"] <= alpha / max(n, 1)]
    return {
        "domains_tested": n,
        "domains_significant": k,
        "alpha_per_domain": alpha,
        "expected_false_positives": round(n * alpha, 1),
        "binomial_p_at_least_k": round(tail, 4) if tail is not None else None,
        "bonferroni_alpha": round(alpha / max(n, 1), 5),
        "survive_bonferroni": [s for s, _ in bonferroni],
        "verdict": (
            "A majority-lead pattern is not established: the per-domain flags "
            "are consistent with chance once 20 tests are accounted for. Only "
            "the Bonferroni survivors should be cited as findings."
            if len(bonferroni) < 2 else
            "Multiple domains survive Bonferroni correction; the lead/lag "
            "pattern is unlikely to be a testing artefact."
        ),
    }


def build_series(counts: dict[str, dict[int, int]], panel: dict) -> dict:
    domains = sorted(panel)
    unknown = sorted(set(counts) - set(domains))
    if unknown:
        raise SystemExit(f"CSV has domains not in the panel: {unknown}")

    series: dict[str, dict] = {}
    for slug in domains:
        # Pre-coverage years are NULL (no data), not 0. Inside the covered
        # window a missing CSV row is a real zero: no CPC-matched grant.
        annual: dict[int, int | None] = {
            y: (counts.get(slug, {}).get(y, 0) if y >= PATENT_YEAR_MIN else None)
            for y in YEARS
        }
        covered = [v for v in annual.values() if v is not None]
        total = sum(covered)
        peak = max((y for y in YEARS if annual[y] is not None),
                   key=lambda y: annual[y] or 0) if total else None
        series[slug] = {
            "display_name": panel[slug]["display_name"],
            "annual": {str(y): annual[y] for y in YEARS},
            "covered_years": [PATENT_YEAR_MIN, YEAR_MAX],
            "total": total,
            "peak_year": peak,
            "metadata": {
                "source": "BigQuery patents-public-data.patents.publications (CC BY 4.0)",
                "query": "sql/patent_counts.sql (generated from config/domains.yaml)",
                "basis": "US granted patents (kind B*) by grant year",
                "coverage": (f"{PATENT_YEAR_MIN}-{YEAR_MAX}; earlier years are "
                             "null because the source has no usable CPC "
                             "classification before 2014"),
                "concordance": "CPC group/subgroup rules; multi-membership",
                "caveat": CONCORDANCE_CAVEAT,
            },
        }

    # Paper-vs-patent lead/lag over the COMPLETE window only.
    #
    # Correlating LEVELS is meaningless here: both series rise monotonically
    # across 2014-2022, so r is ~0.99 at every shift and picking the max is
    # noise. We correlate year-over-year GROWTH instead, which removes the
    # shared trend and asks the actual question: when papers accelerate,
    # do patents accelerate k years later?
    #
    # lag > 0 means patents trail papers (papers lead), the direction the
    # plan hypothesises. Ties resolve toward the smaller |lag|.
    crosswalk = {}
    for slug in domains:
        papers_annual = {int(y): c for y, c in panel[slug]["annual"].items()}
        pat_annual = {y: (series[slug]["annual"][str(y)] or 0)
                      for y in range(YEAR_MIN, YEAR_MAX + 1)}
        lo, hi = LAG_WINDOW

        p_growth = _growth(papers_annual, list(range(lo, hi + 2)))
        q_growth = _growth(pat_annual, list(range(lo, hi + 2)))

        best_lag, best_r, lag_rows = _max_lag_r(p_growth, q_growth)
        p_value = _permutation_p(p_growth, q_growth, best_r)
        # An optimum sitting on the edge of the scan is not identified: the
        # true lag may lie outside the range, so the value is an artefact of
        # where the scan stopped. Such domains can never be called significant.
        at_boundary = (best_lag is not None and abs(best_lag) == MAX_LAG)
        powered = any(row["powered"] for row in lag_rows)
        significant = (p_value is not None and p_value <= 0.10
                       and not at_boundary and powered)

        papers_peak = max(papers_annual, key=papers_annual.get)
        crosswalk[slug] = {
            "papers_peak_year": papers_peak,
            "patents_peak_year": series[slug]["peak_year"],
            "best_lag_years": best_lag,
            "best_lag_r": round(best_r, 3) if best_r is not None else None,
            "permutation_p": p_value,
            "at_scan_boundary": at_boundary,
            "underpowered": not powered,
            "significant": significant,
            "lag_scan": lag_rows,
            "lag_window": [lo, hi],
            "min_pairs_required": MIN_LAG_PAIRS,
            "lag_basis": ("year-over-year growth correlation; p from a "
                          "2000-shuffle permutation of the best-lag statistic"),
            "papers_total": panel[slug]["total_works"],
            "patents_total": series[slug]["total"],
        }

    return {
        "_meta": {
            "generated_utc": datetime.now(timezone.utc).isoformat(),
            "source": "BigQuery patents-public-data.patents.publications (CC BY 4.0)",
            "query": "sql/patent_counts.sql",
            "generator": "scripts/gen_patent_query.py + stats/patents.py",
            "years": [YEAR_MIN, YEAR_MAX],
            "patent_year_min": PATENT_YEAR_MIN,
            "coverage_note": (
                "Pre-2014 patent years are null, not zero: the source mirror "
                "has only 265 US grants for 2000 and no usable CPC coverage "
                "for several sections (notably H01L) before 2014."
            ),
            "caveat": CONCORDANCE_CAVEAT,
        },
        "domains": series,
        "paper_patent_crosswalk": crosswalk,
        "lag_panel_test": _panel_significance(crosswalk),
    }


def main() -> int:
    panel = json.loads(PANEL.read_text())
    counts = read_counts()
    out = build_series(counts, panel)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1))
    n_domains = len(out["domains"])
    total = sum(d["total"] for d in out["domains"].values())
    print(f"patent series → {OUT}")
    print(f"{n_domains} domains, {total:,} CPC-matched US grants "
          f"{PATENT_YEAR_MIN}-{YEAR_MAX} (pre-{PATENT_YEAR_MIN} = null, no coverage)")
    print(f"{'domain':30s} {'patents':>9s} {'peak':>5s} {'lag':>5s} {'r':>6s} {'p':>7s} sig")
    n_sig = 0
    n_pow = 0
    for slug, d in out["domains"].items():
        x = out["paper_patent_crosswalk"][slug]
        lag = f"{x['best_lag_years']:+d}" if x["best_lag_years"] is not None else "  n/a"
        r = f"{x['best_lag_r']:+.2f}" if x["best_lag_r"] is not None else "   n/a"
        p = f"{x['permutation_p']:.3f}" if x["permutation_p"] is not None else "    n/a"
        if x["underpowered"]:
            sig = "n/p"
        elif x["significant"]:
            sig = "YES"
        elif x["at_scan_boundary"]:
            sig = "edge"
        else:
            sig = "no"
        n_sig += 1 if x["significant"] else 0
        n_pow += 0 if x["underpowered"] else 1
        print(f"{slug:30s} {d['total']:>9,} {str(d['peak_year'] or '-'):>5s} "
              f"{lag:>5s} {r:>6s} {p:>7s} {sig}")
    print(f"\n{n_sig}/{len(out['domains'])} domains show a lag distinguishable "
          f"from chance at p<=0.10 ({n_pow} had enough pairs to test at all; "
          f"{len(out['domains']) - n_pow} underpowered)")
    pnl = out["lag_panel_test"]
    print(f"panel test: expected {pnl['expected_false_positives']} false positives "
          f"by chance, binomial p={pnl['binomial_p_at_least_k']}, "
          f"Bonferroni survivors={pnl['survive_bonferroni'] or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
