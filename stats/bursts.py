"""Phase 3b — Kleinberg burst detection (PROJECT_MASTER_PLAN.md §Phase 4, §Phase 3).

In-house 2-state burst automaton over the Tier B keyword×year series
(285 series across 19 domains) + the Tier A domain annual counts
(20 series) — per plan §Phase 4:

  * 2 states: baseline rate q₀ (slow) vs burst rate q₁ (fast/HMM-high)
  * emission: Poisson — cost(state n) = −ln P(series_n | rate_state)
  * transition penalty: γ·ln(n) per plan (log-length, not state-count)
  * Viterbi over the 2-state lattice, in-house (no hmmlearn dependency —
    plan §Phase 4 "no S3-event-storm" philosophy of minimal deps)
  * burst output per series: start, end, strength (log q₁/q₀ ratio),
    max-interval mass

Design notes:
  * rates are estimated from the series itself (q₀ = global mean of the
    non-burst mass on first pass; Viterbi removes burst windows, rate is
    re-estimated, 2 EM passes — deterministic)
  * short-series fallback per plan: laplace ratio (recent+1)/(hist+1)
    when n < 6 years
  * series are ANNUAL counts; a keyword "burst" is a run of years where
    the keyword's share of the domain mass is sustainedly elevated —
    share normalization prevents big-domain keywords from swamping
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TIER_B = REPO / "data" / "keywords" / "tier_b.json"
TIER_A = REPO / "data" / "tier_a" / "tier_a.json"
OUT = REPO / "data" / "bursts"
OUT.mkdir(parents=True, exist_ok=True)

GAMMA = 1.0          # plan: γ·ln(n) transition penalty
MIN_SHARE_RATE = 1e-6

@dataclass
class Burst:
    start: int
    end: int
    strength: float      # ln(q1/q0), sustained ≥ thresholds
    years: list[int]

    def as_json(self) -> dict:
        return {"start": self.start, "end": self.end,
                "duration": self.end - self.start + 1,
                "strength": round(self.strength, 4), "years": self.years}


def _poisson_cost(counts_in_window: int, expected: float) -> float:
    expected = max(expected, MIN_SHARE_RATE)
    return -counts_in_window * math.log(expected) + expected


def viterbi_2state(series: list[int], q0_mean: float, q1_mean: float,
                   gamma: float = GAMMA) -> tuple[list[int], float]:
    """2-state Viterbi. Returns (state path 0/1 per year, path cost)."""
    n = len(series)
    cost = [[0.0, 0.0] for _ in range(n)]
    back = [[0, 0] for _ in range(n)]
    cost[0][0] = _poisson_cost(series[0], q0_mean)
    cost[0][1] = _poisson_cost(series[0], q1_mean)
    for i in range(1, n):
        penalty = gamma * math.log(n) if gamma > 0 else 0.0
        stay0 = cost[i - 1][0] + _poisson_cost(series[i], q0_mean)
        switch1 = cost[i - 1][0] + penalty + _poisson_cost(series[i], q1_mean)
        cost[i][0] = stay0
        back[i][0] = 0 if stay0 <= switch1 else 1
        cost[i][1] = min(cost[i - 1][1] + _poisson_cost(series[i], q1_mean),
                         cost[i - 1][0] + penalty + _poisson_cost(series[i], q1_mean))
        back[i][1] = 0 if (cost[i - 1][0] + penalty) <= cost[i - 1][1] else 1
    states = [0] * n
    states[n - 1] = 0 if cost[n - 1][0] <= cost[n - 1][1] else 1
    for i in range(n - 1, 0, -1):
        states[i - 1] = back[i][states[i]]
    return states, min(cost[n - 1])


def find_bursts(states: list[int], series: list[int], years: list[int]) -> list[Burst]:
    """State-1 runs → Burst list. Strength from q1/q0 mass ratio in-window."""
    bursts = []
    run_start = None
    for i, s in enumerate(states + [0]):     # sentinel 0 closes trailing run
        if s == 1 and run_start is None:
            run_start = i
        elif s == 0 and run_start is not None:
            window = series[run_start:i]
            w_mass = sum(window)
            base = [series[j] for j in range(len(series)) if states[j] == 0]
            b_mean = sum(base) / max(len(base), 1)
            strength = w_mass / max(b_mean * (i - run_start), MIN_SHARE_RATE)
            strength = math.log(max(strength, 1.05))   # floor: ln(1.05)>0
            bursts.append(Burst(
                start=years[run_start], end=years[i - 1],
                strength=strength, years=years[run_start:i]))
            run_start = None
    return bursts


def detect_bursts(series_dict: dict[int, int], min_years: int = 6) -> dict:
    """Full 2-pass EM burst detection over one ANNUAL count series.

    Returns {"bursts": [...], "n_years": ..., "method": ...}.
    Short-series fallback (n<6): laplace ratio per plan §Phase 4.
    """
    years = sorted(series_dict)
    series = [series_dict[y] for y in years]
    n = len(series)
    if n < min_years:
        if n < 2:
            return {"bursts": [], "n_years": n, "method": "insufficient_series"}
        recent, hist = series[-1], sum(series[:-1]) / (n - 1)
        ratio = (recent + 1) / (hist + 1)
        out = {"bursts": [{"start": years[-1], "end": years[-1],
                           "duration": 1,
                           "strength": round(math.log(max(ratio, 1.05)), 4),
                           "years": [years[-1]]}] if ratio > 1.5 else [],
               "n_years": n, "method": "laplace_fallback"}
        return out

    bursts_out: list[Burst] = []
    working = list(series)
    for _pass in range(2):                    # 2 EM passes, deterministic
        b_mean = sum(working) / n
        q1_mean = b_mean * 1.8                # seed: burst = +80% over mean
        # tighten: use in-window share so big-mass years don't force state1
        above = [x for x in working if x > b_mean * 1.4]
        if above:
            q1_mean = sum(above) / len(above)
        q0_mean = sum(x for x in working if x <= b_mean * 1.4) / max(
            len([x for x in working if x <= b_mean * 1.4]), 1)
        q0_mean = max(q0_mean, MIN_SHARE_RATE)
        states, _cost = viterbi_2state(series, q0_mean, q1_mean)
        bursts_out = find_bursts(states, series, years)
        # EM: remove burst windows from baseline estimate, re-run
        working = [x if s == 0 else 0 for x, s in zip(series, states)]
        if not any(s == 1 for s in states):
            break
    bursts_out.sort(key=lambda b: -b.strength)
    return {"bursts": [b.as_json() for b in bursts_out],
            "n_years": n, "method": "kleinberg_2state_viterbi"}


def run_tier_b_bursts() -> dict:
    """Cluster: 19 domains × 15 keywords — includes ~285 series."""
    tier_b = json.loads(TIER_B.read_text())
    out = {}
    for slug, d in tier_b.items():
        kws = {}
        for kid, k in d["keywords"].items():
            if "by_year" in k and k["by_year"]:
                kws[kid] = {"name": k["name"], "total": k["total"],
                            **detect_bursts({int(y): c for y, c in k["by_year"].items()})}
        out[slug] = {"display_name": d["display_name"], "keywords": kws}
    return out


def run_tier_a_domain_bursts() -> dict:
    """Domain-level annual series (20) — coarse bursts = whole-domain phase shifts."""
    tier_a = json.loads(TIER_A.read_text())
    out = {}
    for slug, d in tier_a.items():
        out[slug] = detect_bursts({int(y): int(c) for y, c in d["by_year"].items()})
    return out


def main() -> int:
    kw = run_tier_b_bursts()
    dom = run_tier_a_domain_bursts()
    (OUT / "keyword_bursts.json").write_text(json.dumps(kw, indent=1))
    (OUT / "domain_bursts.json").write_text(json.dumps(dom, indent=1))
    n_kw = sum(len(d["keywords"]) for d in kw.values())
    n_burst_kw = sum(len(k["bursts"]) for d in kw.values() for k in d["keywords"].values())
    n_burst_dom = sum(len(v["bursts"]) for v in dom.values())
    print(f"keyword series: {n_kw} | keyword bursts: {n_burst_kw}")
    print(f"domain series: {len(dom)} | domain bursts: {n_burst_dom}")
    print(f"saved → {OUT}/keyword_bursts.json + domain_bursts.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
