"""Phase 3.5 — patent series + paper-vs-patent lag analysis.

Input:  data/patents/patent_counts.csv — the BigQuery result produced by
        sql/patent_counts.sql (generated from config/domains.yaml CPC rules;
        see scripts/gen_patent_query.py for the full workaround rationale:
        USPTO ODP key is passport-gated, PatentsView bulk exceeds local disk,
        so the counts are computed in the BigQuery sandbox and only the
        ~500-row aggregate is downloaded).
Output: data/patents/patent_series.json — per domain:
          annual{year: patents} 2000–2025 (missing years = 0, real zeros —
          a domain with no CPC-matched grants that year),
          total, peak_year, metadata(source, query, concordance, caveats)
        plus a crosswalk section: paper-vs-patent peak-year lag per domain
        (papers from data/trajectories/panel.json).

Honesty rules (§8):
  * Zeros are real zeros of the CPC concordance, not missing data — but the
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
YEARS = list(range(YEAR_MIN, YEAR_MAX + 1))

CONCORDANCE_CAVEAT = (
    "CPC-to-domain concordance is approximate: CPC boundaries do not align "
    "cleanly with human technology categories, so counts may over- or "
    "under-count a domain. Patents are US grants by grant year; grant lag "
    "(1-3 years) makes recent years undercount relative to paper "
    "publication years."
)


def read_counts() -> dict[str, dict[int, int]]:
    """Parse the BigQuery CSV export → {slug: {year: count}}.

    Validates: header exactly domain,year,patents; years in range; counts
    non-negative integers; no duplicate (domain, year) rows.
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
            if n < 0:
                raise SystemExit(f"negative count for {slug} {year}")
            key = (slug, year)
            if key in seen:
                raise SystemExit(f"duplicate row for {slug} {year}")
            seen.add(key)
            counts.setdefault(slug, {})[year] = n
    return counts


def build_series(counts: dict[str, dict[int, int]], panel: dict) -> dict:
    domains = sorted(panel)
    unknown = sorted(set(counts) - set(domains))
    if unknown:
        raise SystemExit(f"CSV has domains not in the panel: {unknown}")

    series: dict[str, dict] = {}
    for slug in domains:
        annual = {y: counts.get(slug, {}).get(y, 0) for y in YEARS}
        total = sum(annual.values())
        peak = max(annual, key=annual.get) if total else None
        series[slug] = {
            "display_name": panel[slug]["display_name"],
            "annual": {str(y): annual[y] for y in YEARS},
            "total": total,
            "peak_year": peak,
            "metadata": {
                "source": "BigQuery patents-public-data.patents.publications (CC BY 4.0)",
                "query": "sql/patent_counts.sql (generated from config/domains.yaml)",
                "basis": "US granted patents (kind B*) by grant year",
                "concordance": "CPC group/subgroup rules; multi-membership",
                "caveat": CONCORDANCE_CAVEAT,
            },
        }

    # Paper-vs-patent peak-year lag: papers peak year minus patents peak year.
    # Positive = patents peaked EARLIER than papers (unusual); negative =
    # papers peaked first and patents followed `lag` years later. Grant lag
    # (1-3 yr) biases patents toward LATER peaks, so a negative lag is the
    # expected shape for a growing field; interpret alongside the caveat.
    crosswalk = {}
    for slug in domains:
        papers_annual = {int(y): c for y, c in panel[slug]["annual"].items()}
        papers_peak = max(papers_annual, key=papers_annual.get)
        pat_peak = series[slug]["peak_year"]
        crosswalk[slug] = {
            "papers_peak_year": papers_peak,
            "patents_peak_year": pat_peak,
            "lag_years": (papers_peak - pat_peak) if pat_peak else None,
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
            "caveat": CONCORDANCE_CAVEAT,
        },
        "domains": series,
        "paper_patent_crosswalk": crosswalk,
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
    print(f"{n_domains} domains, {total:,} CPC-matched US grants {YEAR_MIN}-{YEAR_MAX}")
    print(f"{'domain':32s} {'patents':>9s} {'peak':>5s} {'lag':>4s}")
    for slug, d in out["domains"].items():
        x = out["paper_patent_crosswalk"][slug]
        lag = f"{x['lag_years']:+d}" if x["lag_years"] is not None else "  n/a"
        print(f"{slug:32s} {d['total']:>9,} {str(d['peak_year'] or '-'):>5s} {lag:>4s}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
