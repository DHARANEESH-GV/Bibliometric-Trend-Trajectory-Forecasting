"""Step 1 robustness checks for the quarterly paper-vs-patent lag result.

Appends a "robustness" block to data/lag/lag_results.json. Nothing else in the
file is touched.

Variants
--------
  a  leave-one-domain-out  (20 refits; min/max of best lag and peak r)
  b  drop the three nested domains (QEC, generative_ai, ai_agents)
  c  drop all four low-confidence domains
  d  time-block bootstrap, 8-quarter blocks, 500 draws

For every variant we report whether the pooled peak stays inside 3-6 quarters
and whether the 95% CI at the peak excludes zero.

Why 3-6 quarters: the baseline pooled peak is 5 with a domain-bootstrap lag CI
of [3, 5]. A robustness variant that moves the peak outside that neighbourhood
is evidence the location is not stable.

Usage:  .venv/bin/python scripts/robustness_lag.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from stats import lag_quarterly as L

NESTED = ["quantum_error_correction", "generative_ai", "ai_agents"]
LOWCONF = list(L.LOW_CONFIDENCE)
BLOCK = 8
N_BLOCK_DRAWS = 500
STABLE_LO, STABLE_HI = 3, 6


def subset(pg: dict, qg: dict, keep: list[str]) -> tuple[dict, dict]:
    return ({d: pg[d] for d in keep}, {d: qg[d] for d in keep})


def evaluate(pg: dict, qg: dict, rng: np.random.Generator,
             n_boot: int = 1000, n_perm: int = 1000) -> dict:
    """Pooled best lag, peak r, CI at peak, permutation p."""
    boot = L.bootstrap_pooled(pg, qg, rng, n_boot=n_boot)
    if not boot.get("ok"):
        return {"ok": False}
    best = int(boot["best_lag"])
    lo, hi = float(boot["ci_lo"][best]), float(boot["ci_hi"][best])
    return {
        "ok": True,
        "n_domains": int(boot["n_domains"]),
        "best_lag": best,
        "peak_r": float(boot["best_r"]),
        "ci_at_peak": [round(lo, 4), round(hi, 4)],
        "ci_excludes_zero": bool(lo > 0),
        "peak_in_3_6": bool(STABLE_LO <= best <= STABLE_HI),
        "best_lag_ci": list(boot["best_lag_ci"]),
        "perm_p": round(float(L.pooled_permutation(pg, qg, rng, n_perm=n_perm)), 4),
    }


def placebo_for(pg: dict, qg: dict, rng: np.random.Generator) -> dict:
    pl = L.placebo(pg, qg, rng)
    if not pl.get("ok"):
        return {"ok": False}
    return {
        "true_peak": pl["true_peak"],
        "placebo_p95_peak": pl["placebo_p95_peak"],
        "placebo_max_peak": pl["placebo_max_peak"],
        "exceeds_all_placebo": pl["exceeds_all_placebo"],
        "empirical_p": pl["empirical_p"],
    }


def time_block_bootstrap(pg: dict, qg: dict, best_lag: int,
                         rng: np.random.Generator, n_draws: int = N_BLOCK_DRAWS) -> dict:
    """Resample contiguous 8-quarter blocks of time, shared across domains.

    All domains sit on the same 37-point observation axis (identical windows),
    so one set of block indices is applied to every domain. That preserves the
    cross-domain alignment while perturbing the time dimension, which is the
    dependence the domain bootstrap ignores.
    """
    doms = sorted(pg)
    n = len(pg[doms[0]])
    for d in doms:
        if len(pg[d]) != n:
            raise SystemExit(f"time axis misaligned for {d}: {len(pg[d])} vs {n}")

    n_blocks = int(np.ceil(n / BLOCK))
    draws = np.empty(n_draws)

    def z(a: np.ndarray) -> np.ndarray:
        sd = a.std()
        return (a - a.mean()) / sd if sd > 0 else a * 0.0

    for b in range(n_draws):
        starts = rng.integers(0, n, n_blocks)
        idx = np.concatenate([(s + np.arange(BLOCK)) % n for s in starts])[:n]
        curves = []
        for d in doms:
            c = L.lag_curve(z(pg[d][idx]), z(qg[d][idx]))
            if np.any(np.isfinite(c)):
                curves.append(c)
        pooled = np.nanmean(np.vstack(curves), axis=0)
        draws[b] = pooled[best_lag]

    lo, hi = np.percentile(draws, [2.5, 97.5])
    return {
        "n_draws": n_draws,
        "block_quarters": BLOCK,
        "lag_used": best_lag,
        "mean_r": round(float(draws.mean()), 4),
        "ci_at_peak": [round(float(lo), 4), round(float(hi), 4)],
        "ci_excludes_zero": bool(lo > 0),
        "peak_in_3_6": bool(STABLE_LO <= best_lag <= STABLE_HI),
        "share_positive": round(float((draws > 0).mean()), 4),
    }


def main() -> int:
    rng = np.random.default_rng(L.SEED + 7)
    papers = L.load_papers()
    grant = L.load_patents("grant")
    pg, qg, meta = L.build_series(papers, grant, L.PAPER_WINDOW, L.GRANT_WINDOW)
    doms = sorted(pg)

    print("=" * 74)
    print("STEP 1  ROBUSTNESS OF THE POOLED LAG RESULT")
    print("=" * 74)
    print(f"domains: {len(doms)}   points per domain: {meta[doms[0]][2]}   "
          f"baseline peak: k=5, r=0.232")

    baseline = evaluate(pg, qg, rng)
    baseline["placebo"] = placebo_for(pg, qg, rng)

    # ---- (a) leave-one-domain-out -------------------------------------
    print("\n(a) LEAVE-ONE-DOMAIN-OUT")
    print(f"{'dropped':<28}{'best k':>7}{'peak r':>8}{'CI at peak':>20}{'>0':>4}{'3-6':>5}")
    lodo = []
    for d in doms:
        keep = [x for x in doms if x != d]
        res = evaluate(*subset(pg, qg, keep), rng)
        res["dropped"] = d
        lodo.append(res)
        ci = res["ci_at_peak"]
        print(f"{d:<28}{res['best_lag']:>7}{res['peak_r']:>8.3f}"
              f"{f'[{ci[0]:.3f}, {ci[1]:.3f}]':>20}"
              f"{('yes' if res['ci_excludes_zero'] else 'NO'):>4}"
              f"{('yes' if res['peak_in_3_6'] else 'NO'):>5}")
    lags = [r["best_lag"] for r in lodo]
    peaks = [r["peak_r"] for r in lodo]
    lodo_summary = {
        "best_lag_min": int(min(lags)),
        "best_lag_max": int(max(lags)),
        "peak_r_min": round(float(min(peaks)), 4),
        "peak_r_max": round(float(max(peaks)), 4),
        "all_peaks_in_3_6": bool(all(r["peak_in_3_6"] for r in lodo)),
        "all_ci_exclude_zero": bool(all(r["ci_excludes_zero"] for r in lodo)),
        "n_dropping_peak_out_of_3_6": int(sum(1 for r in lodo if not r["peak_in_3_6"])),
    }
    print(f"\nbest lag range {lodo_summary['best_lag_min']}-"
          f"{lodo_summary['best_lag_max']}, "
          f"peak r range {lodo_summary['peak_r_min']:.3f}-{lodo_summary['peak_r_max']:.3f}; "
          f"all peaks in 3-6: {lodo_summary['all_peaks_in_3_6']}; "
          f"all CIs exclude 0: {lodo_summary['all_ci_exclude_zero']}")

    # ---- (b) drop nested domains --------------------------------------
    print("\n(b) DROP NESTED DOMAINS (QEC, generative_ai, ai_agents)")
    keep_b = [d for d in doms if d not in NESTED]
    b = evaluate(*subset(pg, qg, keep_b), rng)
    b["placebo"] = placebo_for(*subset(pg, qg, keep_b), rng)
    b["dropped"] = NESTED
    ci = b["ci_at_peak"]
    print(f"domains {b['n_domains']}  best k={b['best_lag']}  r={b['peak_r']:.3f}  "
          f"CI [{ci[0]:.3f}, {ci[1]:.3f}]  >0={b['ci_excludes_zero']}  "
          f"in3-6={b['peak_in_3_6']}  perm p={b['perm_p']}")
    print(f"placebo: true {b['placebo']['true_peak']:.3f} vs max "
          f"{b['placebo']['placebo_max_peak']:.3f} "
          f"(exceeds all: {b['placebo']['exceeds_all_placebo']})")

    # ---- (c) drop low-confidence domains ------------------------------
    print("\n(c) DROP ALL FOUR LOW-CONFIDENCE DOMAINS")
    keep_c = [d for d in doms if d not in LOWCONF]
    c = evaluate(*subset(pg, qg, keep_c), rng)
    c["placebo"] = placebo_for(*subset(pg, qg, keep_c), rng)
    c["dropped"] = LOWCONF
    ci = c["ci_at_peak"]
    print(f"domains {c['n_domains']}  best k={c['best_lag']}  r={c['peak_r']:.3f}  "
          f"CI [{ci[0]:.3f}, {ci[1]:.3f}]  >0={c['ci_excludes_zero']}  "
          f"in3-6={c['peak_in_3_6']}  perm p={c['perm_p']}")
    print(f"placebo: true {c['placebo']['true_peak']:.3f} vs max "
          f"{c['placebo']['placebo_max_peak']:.3f} "
          f"(exceeds all: {c['placebo']['exceeds_all_placebo']})")

    # ---- (d) time-block bootstrap -------------------------------------
    print(f"\n(d) TIME-BLOCK BOOTSTRAP ({BLOCK}-quarter blocks, {N_BLOCK_DRAWS} draws)")
    d = time_block_bootstrap(pg, qg, baseline["best_lag"], rng)
    ci = d["ci_at_peak"]
    print(f"r at k={d['lag_used']}: mean {d['mean_r']:.3f}  "
          f"CI [{ci[0]:.3f}, {ci[1]:.3f}]  >0={d['ci_excludes_zero']}  "
          f"share positive {d['share_positive']:.3f}")

    # ---- summary -------------------------------------------------------
    print("\nSUMMARY")
    rows = [
        ("baseline (20 domains)", baseline),
        ("b: drop nested (17)", b),
        ("c: drop low-confidence (16)", c),
    ]
    print(f"{'variant':<32}{'best k':>7}{'peak r':>8}{'CI excludes 0':>15}{'peak in 3-6':>13}")
    for label, r0 in rows:
        print(f"{label:<32}{r0['best_lag']:>7}{r0['peak_r']:>8.3f}"
              f"{('yes' if r0['ci_excludes_zero'] else 'no'):>15}"
              f"{('yes' if r0['peak_in_3_6'] else 'no'):>13}")
    lag_span = f"{lodo_summary['best_lag_min']}-{lodo_summary['best_lag_max']}"
    r_span = f"{lodo_summary['peak_r_min']:.3f}-{lodo_summary['peak_r_max']:.3f}"
    print(f"{'a: LODO range':<32}{lag_span:>7}  {r_span:<14}"
          f"{('all yes' if lodo_summary['all_ci_exclude_zero'] else 'NOT all'):>15}"
          f"{('all yes' if lodo_summary['all_peaks_in_3_6'] else 'NOT all'):>13}")
    print(f"{'d: time-block CI':<32}{d['lag_used']:>7}{d['mean_r']:>8.3f}"
          f"{('yes' if d['ci_excludes_zero'] else 'no'):>15}"
          f"{('yes' if d['peak_in_3_6'] else 'no'):>13}")

    out_path = L.OUT_JSON
    full = json.loads(out_path.read_text(encoding="utf-8"))
    full["robustness"] = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "stability_band_quarters": [STABLE_LO, STABLE_HI],
        "baseline": baseline,
        "leave_one_domain_out": {
            "per_drop": [{k: v for k, v in r.items() if k != "curve"} for r in lodo],
            "summary": lodo_summary,
        },
        "drop_nested": b,
        "drop_low_confidence": c,
        "time_block_bootstrap": d,
    }
    out_path.write_text(json.dumps(full, indent=2), encoding="utf-8")
    print(f"\nappended 'robustness' to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
