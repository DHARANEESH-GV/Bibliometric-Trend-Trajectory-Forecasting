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
PATENTS = REPO / "data" / "patents" / "patent_series.json"
LAG = REPO / "data" / "lag" / "lag_results.json"
RANK_STABILITY = REPO / "data" / "scores" / "rank_stability.json"
OUT = REPO / "snapshots"
SPARK_YEARS = (2020, 2025)


def _meta(run_id: str) -> dict:
    lineage = {
        "trajectories": "data/tier_a + panel.json (annual exact, quarterly derived)",
        "scores": "stats/emergence.py (weights in data/scores/emergence.json)",
        "forecasts": "stats/forecasts.py (gated; see backtest.json gate)",
        "bursts": "stats/bursts.py (Kleinberg 2-state)",
        "samples": "raw/samples (2k recent + 2k top-cited per domain)",
    }
    if PATENTS.exists():
        lineage["patents"] = ("BigQuery patents-public-data (CC BY 4.0) via "
                              "sql/patent_counts.sql → data/patents/patent_series.json")
    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "lineage": lineage,
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


def gen_trajectories(panel, forecasts, patents=None) -> list[dict]:
    out = []
    for slug in sorted(panel):
        annual = {int(y): c for y, c in panel[slug]["annual"].items()}
        f = forecasts["forecasts"][slug]
        pat = (patents or {}).get("domains", {}).get(slug)
        pat_annual = {int(y): c for y, c in pat["annual"].items()} if pat else {}
        series = [{"year": y, "works": annual[y], "patents": pat_annual.get(y),
                   "forecast": None}
                  for y in sorted(annual)]
        for year, value in zip(f["horizon"], f["forecast"]):
            iv = f["interval_68pct"][str(year)]
            series.append({"year": year, "works": None, "patents": None,
                           "forecast": value,
                           "lower": iv[0], "upper": iv[1],
                           "model": f["model"]})
        row = {"domain": slug, "display_name": panel[slug]["display_name"],
               "series": series, "train_through": f["train_through"],
               "model_gate": f["gate_failed"]}
        if pat:
            row["patents_total"] = pat["total"]
            row["patents_caveat"] = pat["metadata"]["caveat"]
            row["patents_covered_years"] = pat["covered_years"]
        out.append(row)
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


def gen_domain_files(panel, scores, forecasts, kw_bursts, sample_stats,
                     patents=None) -> dict:
    by_slug = {r["domain_slug"]: r for r in scores["leaderboard"]}
    pat_domains = (patents or {}).get("domains", {})
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
        pat = pat_domains.get(slug)
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
            "patents": ({
                "annual": pat["annual"], "total": pat["total"],
                "peak_year": pat["peak_year"],
                "covered_years": pat["covered_years"],
                "caveat": pat["metadata"]["caveat"],
                "coverage": pat["metadata"]["coverage"],
                "lag": (patents or {}).get("paper_patent_crosswalk", {}).get(slug),
                "lag_panel": (patents or {}).get("lag_panel_test"),
            } if pat else None),
        }
    return out


def gen_lag(lag: dict | None, scores: dict) -> dict | None:
    """Lag view payload.

    Every number the UI prints is read from data/lag/lag_results.json. Nothing
    is recomputed or hardcoded here; this function only reshapes the file and
    attaches display names from the leaderboard.
    """
    if not lag:
        return None
    names = {r["domain_slug"]: r["display_name"] for r in scores["leaderboard"]}
    pg = lag["primary_grant"]
    pooled = pg["pooled"]
    placebo = pg["placebo"]
    per = pg["per_domain"]
    series = pg.get("series", {})

    domains = []
    for slug, row in per.items():
        domains.append({
            "domain": slug,
            "display_name": names.get(slug, slug.replace("_", " ").title()),
            "best_lag": row["best_lag"],
            "best_r": row["best_r"],
            "perm_p": row["perm_p"],
            "significant_05": row["significant_05"],
            "low_confidence": row["low_confidence"],
            "n_points": row["n_points"],
            "curve": row["curve"],
            "series": series.get(slug),
        })
    # Sorted by correlation so the panel reads best-first.
    domains.sort(key=lambda r: -(r["best_r"] if r["best_r"] is not None else -9))

    return {
        "_meta": lag.get("_meta"),
        "generated_utc": lag["generated_utc"],
        "windows": {
            "papers": pg["window_papers"],
            "patents": pg["window_patents"],
            "date_type": pg["date_type"],
        },
        "method": lag["method"],
        "caveats": lag["caveats"],
        "pooled": {
            "curve": pooled["curve"],
            "ci_lo": pooled["ci_lo"],
            "ci_hi": pooled["ci_hi"],
            "best_lag": pooled["best_lag"],
            "best_r": pooled["best_r"],
            "best_lag_ci": pooled["best_lag_ci"],
            "n_domains": pooled["n_domains"],
            "perm_p": pg["pooled_perm_p"],
            "peak_excludes_zero": pooled["peak_excludes_zero"],
        },
        "placebo": {
            "true_peak": placebo["true_peak"],
            "placebo_mean_peak": placebo["placebo_mean_peak"],
            "placebo_p95_peak": placebo["placebo_p95_peak"],
            "placebo_max_peak": placebo["placebo_max_peak"],
            "exceeds_all_placebo": placebo["exceeds_all_placebo"],
            "empirical_p": placebo["empirical_p"],
            "n_draws": placebo["n_draws"],
        },
        "counts": {
            "n_domains": len(domains),
            "n_significant": sum(1 for d in domains if d["significant_05"]),
        },
        "domains": domains,
        "robustness": lag.get("robustness"),
        "filing_sensitivity": {
            "window_patents": lag["filing_sensitivity"]["window_patents"],
            "date_type": lag["filing_sensitivity"]["date_type"],
            "pooled": lag["filing_sensitivity"]["pooled"],
            "pooled_perm_p": lag["filing_sensitivity"]["pooled_perm_p"],
            "placebo": lag["filing_sensitivity"]["placebo"],
        },
    }


def gen_rank_stability(rs: dict | None) -> dict | None:
    if not rs:
        return None
    return {
        "generated_utc": rs["generated_utc"],
        "n_draws": rs["n_draws"],
        "perturbation": rs["perturbation"],
        "all_weights": rs["all_weights"],
        "effective_weights": rs["effective_weights"],
        "degenerate_inputs": rs["degenerate_inputs"],
        "degenerate_note": rs["degenerate_note"],
        "summary_line": rs["summary_line"],
    }


def main(run_id: str | None = None) -> int:
    run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    panel = json.loads(PANEL.read_text())
    scores = json.loads(SCORES.read_text())
    forecasts = json.loads(FORECASTS.read_text())
    backtest = json.loads(BACKTEST.read_text())
    kw_bursts = json.loads(KW_BURSTS.read_text())
    sample_stats = json.loads(SAMPLE_STATS.read_text()) if SAMPLE_STATS.exists() else {}
    patents = json.loads(PATENTS.read_text()) if PATENTS.exists() else None
    if patents is None:
        print("[snapshots] patent series absent — snapshots carry papers only "
              "(run the BigQuery query, see scripts/gen_patent_query.py)")
    lag = json.loads(LAG.read_text()) if LAG.exists() else None
    if lag is None:
        print("[snapshots] lag results absent — /lag view will show no data "
              "(run scripts/run_lag_quarterly.py)")
    rank_stability = (json.loads(RANK_STABILITY.read_text())
                      if RANK_STABILITY.exists() else None)
    if rank_stability is None:
        print("[snapshots] rank stability absent — leaderboard line omitted "
              "(run scripts/rank_stability.py)")

    dest = OUT / run_id
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "leaderboard.json").write_text(json.dumps(
        {"_meta": _meta(run_id), "gate": backtest["gate"],
         "rank_stability": gen_rank_stability(rank_stability),
         "leaderboard":
         gen_leaderboard(panel, scores, forecasts)}, indent=1))
    (dest / "trajectories.json").write_text(json.dumps(
        {"_meta": _meta(run_id), "domains": gen_trajectories(panel, forecasts, patents)}, indent=1))
    (dest / "bursts.json").write_text(json.dumps(
        {"_meta": _meta(run_id), "feed": gen_burst_feed(kw_bursts, panel)}, indent=1))
    (dest / "matrix.json").write_text(json.dumps(
        {"_meta": _meta(run_id), **gen_matrix(panel, scores)}, indent=1))
    lag_doc = gen_lag(lag, scores)
    if lag_doc is not None:
        (dest / "lag.json").write_text(json.dumps(
            {"_meta": _meta(run_id), **lag_doc}, indent=1))
    rs_doc = gen_rank_stability(rank_stability)
    if rs_doc is not None:
        (dest / "rank_stability.json").write_text(json.dumps(
            {"_meta": _meta(run_id), **rs_doc}, indent=1))
    domain_dir = dest / "domains"
    domain_dir.mkdir(exist_ok=True)
    for slug, doc in gen_domain_files(panel, scores, forecasts, kw_bursts,
                                      sample_stats, patents).items():
        (domain_dir / f"{slug}.json").write_text(json.dumps(
            {"_meta": _meta(run_id), **doc}, indent=1))
    n = len(list(dest.rglob("*.json")))
    print(f"snapshot run {run_id} → {dest} ({n} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
