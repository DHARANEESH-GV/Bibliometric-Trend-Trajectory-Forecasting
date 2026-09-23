"""Phase 5 — dashboard snapshot generation (PROJECT_MASTER_PLAN.md §Phase 5).

Emits snapshots/{run_id}/*.json per §Phase 5 data contracts:
  leaderboard.json  — rank, domain, label, score, sparkline (24q), yoy, caveats
  trajectories.json — per-domain annual series + forecast + interval bounds
  bursts.json       — per-domain keyword burst feed (recent-first)
  matrix.json       — domains × years heatmap cells + tail label/score
  domains/{slug}.json — drill-down: annual, forecast, top keywords w/ bursts,
                        sample provenance notes

Every file carries _meta: generated_utc, run_id, data_lineage pointers.
Sparklines: equal-split quarterly (24 = last 6 years, 2020–2025) per
panel quarterly derivation; forecast tail appended for frontier domains.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PANEL = REPO / "data" / "trajectories" / "panel.json"
SCORES = REPO / "data" / "scores" / "emergence.json"
FORECASTS = REPO / "data" / "forecasts" / "forecasts.json"
BACKTEST = REPO / "data" / "forecasts" / "backtest.json"
KW_BURSTS = REPO / "data" / "bursts" / "keyword_bursts.json"
SAMPLE_STATS = REPO / "raw" / "samples" / "tier_c_stats.json"
OUT = REPO / "snapshots"
SPARK_YEARS = (2020, 2025)


def _meta(run_id: str) -> dict:
    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "lineage": {
            "trajectories": "data/tier_a + panel.json (annual exact, quarterly derived)",
            "scores": "stats/emergence.py (weights in data/scores/emergence.json)",
            "forecasts": "stats/forecasts.py (gated; see backtest.json gate)",
            "bursts": "stats/bursts.py (Kleinberg 2-state)",
            "samples": "raw/samples (2k recent + 2k top-cited per domain)",
        },
    }


def _sparkline(panel: dict, slug: str) -> list[int]:
    out = []
    for year in range(SPARK_YEARS[0], SPARK_YEARS[1] + 1):
        total = panel[slug]["annual"].get(str(year), 0)
        base, rem = divmod(total, 4)
        out.extend([base + (1 if q < rem else 0) for q in range(4)])
    return out


def gen_leaderboard(panel, scores, forecasts) -> list[dict]:
    lb = []
    for row in scores["leaderboard"]:
        slug = row["domain_slug"]
        f = forecasts["forecasts"][slug]
        annual = panel[slug]["annual"]
        ys = sorted(annual, key=int)
        yoy = (annual[ys[-1]] - annual[ys[-2]]) / (annual[ys[-2]] + 1.0)
        lb.append({
            "rank": row["rank"],
            "domain": slug,
            "display_name": row["display_name"],
            "label": row["label"],
            "emergence_score": row["score"],
            "score_inputs": row["inputs"],
            "yoy_delta": round(yoy, 4),
            "sparkline": _sparkline(panel, slug),
            "sparkline_years": list(SPARK_YEARS),
            "forecast_next3": f["forecast"],
            "forecast_model": f["model"],
            "caveat": row.get("caveat"),
            "notes": row.get("notes", []),
        })
    return lb


def gen_trajectories(panel, forecasts) -> list[dict]:
    out = []
    for slug in sorted(panel):
        annual = {int(y): c for y, c in panel[slug]["annual"].items()}
        f = forecasts["forecasts"][slug]
        series = [{"year": y, "works": annual[y], "forecast": None}
                  for y in sorted(annual)]
        for year, value in zip(f["horizon"], f["forecast"]):
            iv = f["interval_68pct"][str(year)]
            series.append({"year": year, "works": None, "forecast": value,
                           "lower": iv[0], "upper": iv[1],
                           "model": f["model"]})
        out.append({"domain": slug, "display_name": panel[slug]["display_name"],
                    "series": series, "train_through": f["train_through"],
                    "model_gate": f["gate_failed"]})
    return out


def gen_burst_feed(kw_bursts, panel) -> list[dict]:
    feed = []
    for slug, d in kw_bursts.items():
        for kid, k in d["keywords"].items():
            for b in k["bursts"]:
                feed.append({
                    "domain": slug,
                    "keyword": k["name"],
                    "start": b["start"], "end": b["end"],
                    "duration": b["duration"],
                    "strength": b["strength"],
                    "years": b["years"],
                })
    feed.sort(key=lambda x: (-x["end"], -x["strength"]))
    return feed


def gen_matrix(panel, scores) -> dict:
    domains = sorted(panel)
    years = list(range(2000, 2026))
    labels = {r["domain_slug"]: r for r in scores["leaderboard"]}
    cells = {slug: [panel[slug]["annual"].get(str(y), 0) for y in years]
             for slug in domains}
    tail = {slug: {"label": labels[slug]["label"],
                   "score": labels[slug]["score"]} for slug in domains}
    return {"years": years, "domains": domains, "cells": cells, "tail": tail}


def gen_domain_files(panel, scores, forecasts, kw_bursts, sample_stats) -> dict:
    by_slug = {r["domain_slug"]: r for r in scores["leaderboard"]}
    out = {}
    for slug in sorted(panel):
        f = forecasts["forecasts"][slug]
        d = kw_bursts.get(slug, {"keywords": {}})
        kws = sorted(d["keywords"].values(),
                     key=lambda k: -max((b["strength"] for b in k["bursts"]), default=0))
        top_keywords = [{
            "name": k["name"], "total": k["total"],
            "bursts": k["bursts"][:2],
        } for k in kws[:15]]
        if slug == "quantum_computing":
            note = "full-corpus domain (every work walked, 814 pages)"
        else:
            note = "sampled domain: drill-down lists from recent+top-cited 4k sample"
        out[slug] = {
            "display_name": panel[slug]["display_name"],
            "annual": panel[slug]["annual"],
            "forecast": f["forecast"], "model": f["model"],
            "horizon": f["horizon"],
            "interval_68pct": f["interval_68pct"],
            "score": by_slug[slug]["score"], "label": by_slug[slug]["label"],
            "provenance_note": note,
            "sample_stats": sample_stats.get(slug),
            "top_keywords": top_keywords,
            "caveat": by_slug[slug].get("caveat"),
        }
    return out


def main(run_id: str | None = None) -> int:
    run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    panel = json.loads(PANEL.read_text())
    scores = json.loads(SCORES.read_text())
    forecasts = json.loads(FORECASTS.read_text())
    backtest = json.loads(BACKTEST.read_text())
    kw_bursts = json.loads(KW_BURSTS.read_text())
    sample_stats = json.loads(SAMPLE_STATS.read_text()) if SAMPLE_STATS.exists() else {}

    dest = OUT / run_id
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "leaderboard.json").write_text(json.dumps(
        {"_meta": _meta(run_id), "gate": backtest["gate"], "leaderboard":
         gen_leaderboard(panel, scores, forecasts)}, indent=1))
    (dest / "trajectories.json").write_text(json.dumps(
        {"_meta": _meta(run_id), "domains": gen_trajectories(panel, forecasts)}, indent=1))
    (dest / "bursts.json").write_text(json.dumps(
        {"_meta": _meta(run_id), "feed": gen_burst_feed(kw_bursts, panel)}, indent=1))
    (dest / "matrix.json").write_text(json.dumps(
        {"_meta": _meta(run_id), **gen_matrix(panel, scores)}, indent=1))
    domain_dir = dest / "domains"
    domain_dir.mkdir(exist_ok=True)
    for slug, doc in gen_domain_files(panel, scores, forecasts, kw_bursts,
                                      sample_stats).items():
        (domain_dir / f"{slug}.json").write_text(json.dumps(
            {"_meta": _meta(run_id), **doc}, indent=1))
    n = len(list(dest.rglob("*.json")))
    print(f"snapshot run {run_id} → {dest} ({n} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
