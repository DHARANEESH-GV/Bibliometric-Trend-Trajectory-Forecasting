"""Enrich data/lag/lag_results.json with the normalized growth series.

The headline statistics were computed once with 1000 permutations + 1000
bootstrap draws. The frontend's per-domain panel additionally needs the two
growth series per domain so it can draw "papers vs patents growth on one
normalized timeline". Recomputing the whole analysis to add them would waste
minutes of CPU, so this script only re-derives the growth series (pure
arithmetic, no resampling) and attaches them under primary_grant.series.

Both series are z-scored so they can share one axis per domain. Z-scoring is
affine, so every correlation in the file is unchanged.

Idempotent: running it twice produces the same file.

Usage:  .venv/bin/python scripts/enrich_lag_series.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from stats import lag_quarterly as L


def zscore(a: np.ndarray) -> list[float]:
    sd = float(a.std())
    if sd == 0:
        return [0.0 for _ in a]
    return [round(float(v), 4) for v in (a - a.mean()) / sd]


def main() -> int:
    papers = L.load_papers()
    grant = L.load_patents("grant")
    pg, qg, meta = L.build_series(papers, grant, L.PAPER_WINDOW, L.GRANT_WINDOW)

    path = L.OUT_JSON
    full = json.loads(path.read_text(encoding="utf-8"))

    # Reconstruct the observation quarters so the frontend can label the axis.
    series: dict[str, dict] = {}
    for dom in sorted(pg):
        first, last, n = meta[dom]
        # build the quarter labels in order, starting at first_t
        labels: list[str] = []
        y, q = first
        for _ in range(n):
            labels.append(f"{y}Q{q}")
            q += 1
            if q == 5:
                y, q = y + 1, 1
        series[dom] = {
            "quarters": labels,
            "papers_z": zscore(pg[dom]),
            "patents_z": zscore(qg[dom]),
        }

    per = full["primary_grant"]["per_domain"]
    missing = sorted(set(per) - set(series))
    if missing:
        print(f"[warn] no series for {missing}", file=sys.stderr)

    full["primary_grant"]["series"] = series
    full["primary_grant"]["series_note"] = (
        "Growth series are z-scored 4-quarter-log-growth observations used to "
        "draw the per-domain panel. They are the exact inputs behind every "
        "correlation in this file."
    )
    path.write_text(json.dumps(full, indent=2), encoding="utf-8")

    print(f"attached series for {len(series)} domains -> {path}")
    d0 = sorted(series)[0]
    print(f"  example {d0}: {len(series[d0]['quarters'])} points, "
          f"{series[d0]['quarters'][0]}..{series[d0]['quarters'][-1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
