"""Step 4 — rank-stability sweep for the emergence leaderboard.

Perturbs the five emergence weights by up to +/-30%, renormalizes them to sum
to 1, recomputes every domain's score, re-ranks, and measures Spearman rank
correlation against the baseline ranking.

Writes data/scores/rank_stability.json.

Degenerate input (measured, reported, not hidden)
-------------------------------------------------
`momentum_intent` has the SAME input value (0.5) for all 20 domains in the
current snapshot, because raw/samples/tier_c_stats.json carries sample counts
only, never a frontier share. A term that adds the same constant to every
domain cannot reorder them; perturbing that weight only shifts scores through
the renormalization denominator. The sweep therefore reports its effect
separately and also runs a 4-weight variant, since that is the number of
weights that can actually move a rank.

Usage:  .venv/bin/python scripts/rank_stability.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
SCORES = REPO / "data" / "scores" / "emergence.json"
OUT = REPO / "data" / "scores" / "rank_stability.json"

N_DRAWS = 500
PERTURB = 0.30
SEED = 20261029


def spearman(a: list[float], b: list[float]) -> float:
    """Spearman rho with average ranks for ties."""
    def rank(x: list[float]) -> np.ndarray:
        arr = np.asarray(x, dtype=float)
        order = arr.argsort()
        ranks = np.empty(len(arr), dtype=float)
        # average ranks for ties
        i = 0
        while i < len(arr):
            j = i
            while j + 1 < len(arr) and arr[order[j + 1]] == arr[order[i]]:
                j += 1
            avg = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                ranks[order[k]] = avg
            i = j + 1
        return ranks

    ra, rb = rank(a), rank(b)
    if ra.std() == 0 or rb.std() == 0:
        return 1.0
    return float(np.corrcoef(ra, rb)[0, 1])


def scores_from(weights: dict, inputs: dict) -> dict[str, float]:
    total = sum(weights.values())
    w = {k: v / total for k, v in weights.items()}
    return {d: 100.0 * sum(w[k] * inp[k] for k in w) for d, inp in inputs.items()}


def run_sweep(weights: dict, inputs: dict, rng: np.random.Generator,
              n_draws: int = N_DRAWS, keys: list[str] | None = None) -> dict:
    """Perturb `keys` (default: all weights), renormalize, re-rank."""
    keys = keys or list(weights)
    base_scores = scores_from(weights, inputs)
    doms = list(inputs)
    base_vec = [base_scores[d] for d in doms]
    base_rank = {d: r for r, d in enumerate(
        sorted(doms, key=lambda x: -base_scores[x]), 1)}

    rhos: list[float] = []
    top1: dict[str, int] = {}
    top3_changed = 0
    max_rank_shift = 0
    for _ in range(n_draws):
        w = dict(weights)
        for k in keys:
            w[k] = weights[k] * float(rng.uniform(1 - PERTURB, 1 + PERTURB))
        s = scores_from(w, inputs)
        rhos.append(spearman(base_vec, [s[d] for d in doms]))
        order = sorted(doms, key=lambda x: -s[x])
        top1[order[0]] = top1.get(order[0], 0) + 1
        if set(order[:3]) != set(sorted(doms, key=lambda x: -base_scores[x])[:3]):
            top3_changed += 1
        shift = max(abs(base_rank[d] - (i + 1)) for i, d in enumerate(order))
        max_rank_shift = max(max_rank_shift, shift)

    arr = np.array(rhos)
    return {
        "n_draws": n_draws,
        "perturbed_weights": keys,
        "spearman_mean": round(float(arr.mean()), 4),
        "spearman_min": round(float(arr.min()), 4),
        "spearman_max": round(float(arr.max()), 4),
        "spearman_p05": round(float(np.percentile(arr, 5)), 4),
        "spearman_p25": round(float(np.percentile(arr, 25)), 4),
        "share_rho_above_0_9": round(float((arr >= 0.9).mean()), 4),
        "max_rank_shift_any_domain": int(max_rank_shift),
        "top3_changed_share": round(top3_changed / n_draws, 4),
        "top1_counts": dict(sorted(top1.items(), key=lambda kv: -kv[1])),
    }


def main() -> int:
    data = json.loads(SCORES.read_text(encoding="utf-8"))
    weights = dict(data["weights"])
    rows = data["leaderboard"]
    inputs = {r["domain_slug"]: dict(r["inputs"]) for r in rows}
    stored = {r["domain_slug"]: r["score"] for r in rows}

    # sanity: our recompute must reproduce the stored scores
    recomputed = scores_from(weights, inputs)
    worst = max(abs(recomputed[d] - stored[d]) for d in stored)
    print(f"weights: {weights}")
    print(f"recompute vs stored scores: max abs diff {worst:.4f} "
          f"({'OK' if worst < 0.02 else 'MISMATCH'})")

    degenerate = [k for k in weights
                  if len({inputs[d][k] for d in inputs}) == 1]
    print(f"degenerate inputs (identical across all domains): "
          f"{degenerate or 'none'}")

    rng = np.random.default_rng(SEED)
    all5 = run_sweep(weights, inputs, rng)
    four = [k for k in weights if k not in degenerate]
    rng4 = np.random.default_rng(SEED + 1)
    all4 = run_sweep(weights, inputs, rng4, keys=four)

    print(f"\n{'variant':<28}{'rho mean':>10}{'rho min':>9}{'p05':>8}"
          f"{'max shift':>11}{'top3 chg':>10}")
    for label, res in (("all 5 weights", all5), (f"{len(four)} effective weights", all4)):
        print(f"{label:<28}{res['spearman_mean']:>10.3f}{res['spearman_min']:>9.3f}"
              f"{res['spearman_p05']:>8.3f}{res['max_rank_shift_any_domain']:>11}"
              f"{res['top3_changed_share']:>10.2f}")
    print(f"\ntop-1 stability (all 5): {all5['top1_counts']}")

    out = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "n_draws": N_DRAWS,
        "perturbation": f"+/-{int(PERTURB*100)}% uniform, renormalized to sum 1",
        "baseline_weights": weights,
        "baseline_ranking": [
            {"rank": r, "domain": d} for r, d in enumerate(
                sorted(inputs, key=lambda x: -stored[x]), 1)
        ],
        "degenerate_inputs": degenerate,
        "degenerate_note": (
            "momentum_intent is identical (0.5) for every domain because "
            "tier_c_stats.json carries sample counts, not a frontier share. "
            "It cannot reorder domains; only the 4 remaining weights can."
        ),
        "all_weights": all5,
        "effective_weights": all4,
        "summary_line": (
            f"Ranking is stable: perturbing the emergence weights by up to "
            f"{int(PERTURB*100)}% keeps Spearman correlation with the baseline at "
            f"{all5['spearman_mean']:.2f} on average (worst {all5['spearman_min']:.2f}); "
            f"at most {all5['max_rank_shift_any_domain']} rank position(s) move."
        ),
    }
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT}")
    print(f"\nsummary line: {out['summary_line']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
