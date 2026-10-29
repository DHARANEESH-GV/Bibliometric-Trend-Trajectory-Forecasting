"""Consolidate every paper quarterly CSV into one 2008-Q1..2025-Q4 panel.

Why this exists
---------------
Quarterly paper counts arrive in several files because the OpenAlex budget is
credit-metered (see RATE_LIMIT notes in scripts/openalex_quarterly_counts.py):

  * data/papers/quarterly_counts.csv            - the 2008-2025 panel as it
                                                   is being pulled, domain by
                                                   domain
  * data/papers/quarterly_counts_<domain>.csv   - single-domain runs

`quantum_computing` is special: it was pulled over 2000-2025 in one sitting
and its 104 quarterly counts summed exactly to OpenAlex's own full-range
total for the same filter, which proves it is internally consistent. Per the
project decision, it is NOT re-fetched for the 2008-2025 window - its rows
are simply extracted from that existing file. This keeps all 20 domains on
the same API snapshot while spending zero extra credits.

Output
------
data/papers/panel_quarterly.csv with header `domain,year,quarter,papers`,
restricted to 2008-Q1..2025-Q4, one row per (domain, quarter), 72 rows per
domain when complete (20 x 72 = 1,440 rows).

Precedence when the same (domain, year, quarter) appears in more than one
file: the first file supplying it wins, and a differing value is reported as
a conflict rather than silently overwritten. Files are read in the order
returned by `sorted()`, so `quarterly_counts.csv` precedes the
per-domain files and is therefore authoritative for the panel window.

Usage
-----
    .venv/bin/python scripts/consolidate_quarterly.py          # write panel + report
    .venv/bin/python scripts/consolidate_quarterly.py --check  # report only, no write
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
PAPERS_DIR = REPO / "data" / "papers"
DOMAINS = REPO / "config" / "domains.yaml"
OUT = PAPERS_DIR / "panel_quarterly.csv"

YEAR_FROM, YEAR_TO = 2008, 2025
QUARTERS = [(y, q) for y in range(YEAR_FROM, YEAR_TO + 1) for q in range(1, 5)]
EXPECTED = len(QUARTERS)  # 72


def load_domain_order() -> list[str]:
    raw = yaml.safe_load(DOMAINS.read_text(encoding="utf-8"))
    return [d["domain_slug"] for d in raw["domains"]]


def discover_files() -> list[Path]:
    """Panel file first, then per-domain smoke files, deterministically."""
    files = []
    panel = PAPERS_DIR / "quarterly_counts.csv"
    if panel.exists():
        files.append(panel)
    files.extend(sorted(p for p in PAPERS_DIR.glob("quarterly_counts_*.csv")))
    return files


def in_window(year: int, quarter: int) -> bool:
    return YEAR_FROM <= year <= YEAR_TO and 1 <= quarter <= 4


def fmt_gaps(gaps: list[tuple[int, int]]) -> str:
    """Compress missing (year, quarter) pairs into readable runs.

    [(2022,1),(2022,2),(2022,3)] -> "2022-Q1..Q3"
    """
    if not gaps:
        return "none"

    def label(a: tuple[int, int], b: tuple[int, int]) -> str:
        if a == b:
            return f"{a[0]}-Q{a[1]}"
        return f"{a[0]}-Q{a[1]}..{b[0]}-Q{b[1]}"

    runs: list[str] = []
    start = prev = gaps[0]
    for q in gaps[1:]:
        if q == (prev[0], prev[1] + 1) and q[1] <= 4:
            prev = q
            continue
        runs.append(label(start, prev))
        start = prev = q
    runs.append(label(start, prev))
    return ", ".join(runs)


def collect(files: list[Path]) -> tuple[dict, list[tuple], list[tuple]]:
    """Return (data, conflicts, out_of_window_counts).

    data: {(domain, year, quarter): (papers, source_file_name)}
    conflicts: [(domain, year, quarter, kept_value, other_value, other_file)]
    """
    data: dict[tuple[str, int, int], tuple[int, str]] = {}
    conflicts: list[tuple] = []
    skipped = 0

    for fp in files:
        with fp.open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            if reader.fieldnames != ["domain", "year", "quarter", "papers"]:
                print(f"[skip] {fp.name}: unexpected header {reader.fieldnames}",
                      file=sys.stderr)
                continue
            for row in reader:
                dom = row["domain"].strip()
                y, q = int(row["year"]), int(row["quarter"])
                n = int(row["papers"])
                if not in_window(y, q):
                    skipped += 1
                    continue
                key = (dom, y, q)
                if key in data:
                    prev, src = data[key]
                    if prev != n:
                        conflicts.append((dom, y, q, prev, n, fp.name))
                    continue
                data[key] = (n, fp.name)
    return data, conflicts, skipped


def report(data: dict, order: list[str], files: list[Path]) -> dict:
    present = defaultdict(set)
    for (dom, y, q) in data:
        present[dom].add((y, q))

    print(f"files read ({len(files)}):")
    for f in files:
        rows = sum(1 for _ in open(f)) - 1
        print(f"  {f.name:52s} {rows:>5d} rows")

    print()
    print(f"{'domain':30s} {'have':>5s} {'need':>5s} {'span':>21s}  status")
    complete, partial, missing = [], [], []
    for dom in order:
        got = present.get(dom, set())
        if not got:
            missing.append(dom)
            print(f"{dom:30s} {0:>5d} {EXPECTED:>5d} {'-':>21s}  MISSING")
            continue
        qs = sorted(got)
        span = f"{qs[0][0]}-Q{qs[0][1]}..{qs[-1][0]}-Q{qs[-1][1]}"
        gap = sorted(set(QUARTERS) - got)
        if len(got) >= EXPECTED:
            status = "COMPLETE"
        else:
            status = f"PARTIAL ({EXPECTED-len(got)} short: {fmt_gaps(gap)})"
        (complete if len(got) >= EXPECTED else partial).append(dom)
        print(f"{dom:30s} {len(got):>5d} {EXPECTED:>5d} {span:>21s}  {status}")

    print()
    print(f"COMPLETE: {len(complete)}/{len(order)}")
    if partial:
        print(f"PARTIAL:  {len(partial)} -> {', '.join(partial)}")
    if missing:
        print(f"MISSING:  {len(missing)} -> {', '.join(missing)}")
    total_rows = sum(len(v) for v in present.values())
    print(f"rows collected: {total_rows} of {len(order) * EXPECTED} expected")
    return {"complete": complete, "partial": partial, "missing": missing,
            "rows": total_rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="report only; do not write panel_quarterly.csv")
    args = ap.parse_args()

    order = load_domain_order()
    files = discover_files()
    if not files:
        print(f"no quarterly CSVs in {PAPERS_DIR}", file=sys.stderr)
        return 1

    data, conflicts, skipped = collect(files)
    if skipped:
        print(f"[note] {skipped} rows outside {YEAR_FROM}-{YEAR_TO} ignored\n")
    if conflicts:
        print(f"[WARN] {len(conflicts)} conflicting values (kept the first):")
        for c in conflicts[:10]:
            print(f"   {c[0]} {c[1]}-Q{c[2]}: kept {c[3]} from panel, "
                  f"{c[5]} had {c[4]}")
        print()

    stats = report(data, order, files)

    if args.check:
        print("\n--check: panel_quarterly.csv not written")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["domain", "year", "quarter", "papers"])
        for dom in order:
            for (y, q) in QUARTERS:
                key = (dom, y, q)
                if key in data:
                    w.writerow([dom, y, q, data[key][0]])
    print(f"\nwrote {OUT} ({stats['rows']} rows, {YEAR_FROM}-{YEAR_TO})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
