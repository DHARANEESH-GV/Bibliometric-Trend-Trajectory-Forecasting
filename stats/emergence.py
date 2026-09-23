"""Emergence scoring — PROJECT_MASTER_PLAN.md §Emergence Score / Phase 4.

Emergence score per plan (0-100, config-weighted, fully deterministic):

    score = 100 × Σ w_i · min(1, s_i / cap_i)

    inputs (5, per plan §Phase 4):
      growth_recent   — damped last-2-bucket YoY (trajectories.growth_last2)
      acceleration    — YoY(t) − YoY(t−1) momentum turn
      keyword_burst   — recent keyword-burst coverage in the domain
      volume_scaled   — ln-scaled total works (scale relevance)
      momentum_intent — frontier-intent share momentum (tier C where
                        available; neutral 0.5 otherwise — honest absence)

Lifecycle labels with hysteresis (plan §Phase 4 "labels don't flap"):
  EnterEmerging: score ≥ 70 (stay Emerging until < 55)
  EnterAccelerating: growing + momentum positive ≥ 2 consecutive years
  EnterPlateauing: growth < 5% for 3 consecutive years (stay until > 12%)
  Evaluation windows use the FINAL 5 annual buckets (2021–2025).

Outputs: data/scores/emergence.json (leaderboard order + labels + inputs).
QEC handling: alias-deduplicated vs quantum_computing (twin-series
limitation annotation) — QEC appears with tied score, flagged.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PANEL = REPO / "data" / "trajectories" / "panel.json"
KW_BURSTS = REPO / "data" / "bursts" / "keyword_bursts.json"
OUT = REPO / "data" / "scores"
OUT.mkdir(parents=True, exist_ok=True)

WEIGHTS = {
    "growth_recent": 0.30,
    "acceleration": 0.20,
    "keyword_burst": 0.20,
    "volume_scaled": 0.15,
    "momentum_intent": 0.15,
}
CAPS = {
    "growth_recent": 1.0,      # cap: +100% YoY saturates
    "acceleration": 0.5,       # cap: +50pt momentum turn saturates
    "keyword_burst": 0.6,      # cap: 60% of keywords bursting recently
    "volume_scaled": 1.0,      # ln scale, normalized below
    "momentum_intent": 1.0,
}
EMERGE_IN, EMERGE_OUT = 70.0, 55.0           # hysteresis band
PLATEAU_GROWTH, PLATEAU_EXIT = 0.05, 0.12


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def volume_component(total: int, max_total: int) -> float:
    """ln-scaled volume, normalized to the panel's biggest domain."""
    if total <= 0 or max_total <= 0:
        return 0.0
    return _clamp01(math.log1p(total) / math.log1p(max_total))


def burst_component(slug: str, kw_bursts: dict) -> float:
    """Share of the domain's keywords with a burst ending 2019 or later."""
    d = kw_bursts.get(slug)
    if not d or not d["keywords"]:
        return 0.0
    kws = d["keywords"]
    recent = sum(1 for k in kws.values()
                 if any(b["end"] >= 2019 for b in k["bursts"]))
    return _clamp01(recent / len(kws))


def acceleration_component(panel: dict, slug: str) -> float:
    """YoY(t) − YoY(t−1): the momentum turn. Saturates at ±50pt (CAPS)."""
    a = {int(y): c for y, c in panel[slug]["annual"].items()}
    ys = sorted(a)
    t3, t2, t1 = a[ys[-3]], a[ys[-2]], a[ys[-1]]
    yoy1 = (t1 - t2) / (t2 + 1.0)
    yoy0 = (t2 - t3) / (t3 + 1.0)
    return _clamp01((yoy1 - yoy0 + 0.5) / 1.0)   # shift −0.5..+0.5 → 0..1


def growth_component(panel: dict, slug: str) -> float:
    a = {int(y): c for y, c in panel[slug]["annual"].items()}
    ys = sorted(a)
    prev, cur = a[ys[-2]], a[ys[-1]]
    return _clamp01((cur - prev) / (prev + 1.0) / CAPS["growth_recent"])


def intent_component(tier_c: dict, slug: str) -> float:
    """Frontier-intent momentum from tier C sample; neutral 0.5 if absent
    (honest absence per §8 — tier C fast-track covered 16/20 domains)."""
    d = tier_c.get(slug) or {}
    fp = d.get("frontier_pct") or d.get("frontier_share")
    if fp is None:
        return 0.5
    return _clamp01(float(fp))


def score_domain(panel: dict, kw_bursts: dict, tier_c: dict, slug: str,
                 max_total: int) -> dict:
    inputs = {
        "growth_recent": growth_component(panel, slug),
        "acceleration": acceleration_component(panel, slug),
        "keyword_burst": burst_component(slug, kw_bursts),
        "volume_scaled": volume_component(
            sum(panel[slug]["annual"].values()), max_total),
        "momentum_intent": intent_component(tier_c, slug),
    }
    score = 100.0 * sum(WEIGHTS[k] * inputs[k] for k in WEIGHTS)
    return {"score": round(score, 2), "inputs": {k: round(v, 4) for k, v in inputs.items()}}


def lifecycle_label(panel: dict, slug: str, score: float,
                    prev_state: str | None = None) -> str:
    """Hysteresis labels over the final 5 annual buckets (2021–2025)."""
    a = {int(y): c for y, c in panel[slug]["annual"].items()}
    ys = sorted(a)[-5:]
    tail = [a[y] for y in ys]
    growths = [(tail[i] - tail[i - 1]) / (tail[i - 1] + 1.0) for i in range(1, len(tail))]

    if score >= EMERGE_IN and (prev_state != "Emerging" or score >= EMERGE_OUT):
        return "Emerging"
    # plateau: <5% growth 3 consecutive years
    if len(growths) >= 3 and all(g < PLATEAU_GROWTH for g in growths[-3:]):
        # stay plateauing until growth exits >12%
        if prev_state == "Plateauing" and growths[-1] > PLATEAU_EXIT:
            return "Active"
        return "Plateauing"
    # accelerating: momentum positive 2 consecutive years + real growth
    if len(growths) >= 2 and growths[-1] > 0.10 and growths[-2] > -0.02:
        return "Accelerating"
    if growths[-1] >= 0.02:
        return "Active"
    return "Watch"


def build_scores() -> dict:
    panel = json.loads(PANEL.read_text())
    kw_bursts = json.loads((KW_BURSTS).read_text())
    tier_c_path = REPO / "raw" / "samples" / "tier_c_stats.json"
    tier_c = json.loads(tier_c_path.read_text()) if tier_c_path.exists() else {}

    max_total = max(sum(d["annual"].values()) for d in panel.values())
    rows = []
    for slug in panel:
        s = score_domain(panel, kw_bursts, tier_c, slug, max_total)
        s["domain_slug"] = slug
        s["display_name"] = panel[slug]["display_name"]
        s["label"] = lifecycle_label(panel, slug, s["score"])
        rows.append(s)

    rows.sort(key=lambda r: -r["score"])
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    # QEC twin flag carried through
    for r in rows:
        meta = panel[r["domain_slug"]].get("metadata", {})
        if meta.get("known_limitation"):
            r["caveat"] = "twin-series of quantum_computing (do not rank independently)"
        if meta.get("search_term_sensitivity"):
            r.setdefault("notes", []).append("2025 count flagged: search-term sensitivity")

    out = {"weights": WEIGHTS, "caps": CAPS, "hysteresis": {
        "emerge_in": EMERGE_IN, "emerge_out": EMERGE_OUT,
        "plateau_growth": PLATEAU_GROWTH, "plateau_exit": PLATEAU_EXIT},
        "leaderboard": rows}
    (OUT / "emergence.json").write_text(json.dumps(out, indent=1))
    return out


def main() -> int:
    out = build_scores()
    print(f"{'rank':>4} {'domain':32s} {'score':>6}  label")
    for r in out["leaderboard"]:
        print(f"{r['rank']:>4} {r['display_name'][:32]:32s} {r['score']:>6.2f}  {r['label']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
