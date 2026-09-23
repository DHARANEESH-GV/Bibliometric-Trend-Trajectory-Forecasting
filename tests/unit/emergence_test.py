"""Phase 4 tests — emergence scores & lifecycle labels (§Phase 4 family)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

import pytest

from stats.emergence import (
    build_scores,
    burst_component,
    growth_component,
    lifecycle_label,
    score_domain,
    volume_component,
    acceleration_component,
)


def _panel():
    import json
    return json.loads((REPO / "data" / "trajectories" / "panel.json").read_text())


def test_all_20_domains_scored_and_ranked():
    out = build_scores()
    lb = out["leaderboard"]
    assert len(lb) == 20
    ranks = [r["rank"] for r in lb]
    assert ranks == list(range(1, 21))
    scores = [r["score"] for r in lb]
    assert scores == sorted(scores, reverse=True)


def test_weights_sum_to_one():
    out = build_scores()
    assert pytest.approx(sum(out["weights"].values()), abs=1e-9) == 1.0


def test_genai_takes_rank1_with_emerging_label():
    lb = {r["domain_slug"]: r for r in build_scores()["leaderboard"]}
    g = lb["generative_ai"]
    assert g["rank"] == 1
    assert g["score"] >= 70.0
    assert g["label"] == "Emerging"


def test_advanced_semiconductors_downranked_not_emerging():
    lb = {r["domain_slug"]: r for r in build_scores()["leaderboard"]}
    a = lb["advanced_semiconductors"]
    assert a["rank"] >= 15
    assert a["label"] in ("Watch", "Plateauing")


def test_qec_carries_twin_caveat():
    lb = {r["domain_slug"]: r for r in build_scores()["leaderboard"]}
    assert "twin-series" in lb["quantum_error_correction"]["caveat"]


def test_volume_component_log_scale():
    assert volume_component(0, 1000) == 0.0
    big, small = volume_component(600_000, 600_000), volume_component(60_000, 600_000)
    assert big == 1.0 and 0.5 < small < 1.0


def test_burst_component_counts_recent_bursts_only():
    kw = {"x": {"keywords": {
        "a": {"bursts": [{"end": 2015}]},        # old — doesn't count
        "b": {"bursts": [{"end": 2021}]},        # recent
        "c": {"bursts": []},
    }}}
    assert burst_component("x", kw) == pytest.approx(1 / 3)
    assert burst_component("missing", kw) == 0.0


def test_growth_component_saturates_at_cap():
    panel = _panel()
    g = growth_component(panel, "generative_ai")     # 2.43x raw → saturated 1.0
    assert g == 1.0


def test_lifecycle_hysteresis_do_not_flap():
    # score in band 55..70 while already Emerging → STAYS Emerging
    panel = _panel()
    a = {int(y): c for y, c in panel["edge_computing"]["annual"].items()}
    ys = sorted(a)[-5:]
    tail = [a[y] for y in ys]
    growths = [(tail[i] - tail[i - 1]) / (tail[i - 1] + 1.0) for i in range(1, len(tail))]
    if all(-0.02 < g <= 0.10 for g in growths[1:]):
        assert lifecycle_label(panel, "edge_computing", 60.0, prev_state="Emerging") == "Emerging"


def test_plateau_label_needs_three_consecutive_years():
    panel = _panel()
    # custom synthetic: flat tail → Plateauing
    synthetic = {"s": {"annual": {str(y): 1000 for y in range(2000, 2026)},
                       "display_name": "S"}}
    assert lifecycle_label(synthetic, "s", 50.0) == "Plateauing"


def test_accelerating_needs_positive_momentum():
    panel = _panel()
    synthetic = {"s": {"annual": {**{str(y): 1000 for y in range(2000, 2023)},
                                  "2023": 1100, "2024": 1210, "2025": 1400},
                       "display_name": "S"}}
    assert lifecycle_label(synthetic, "s", 50.0) == "Accelerating"


def test_score_domain_inputs_all_present_and_bounded():
    panel = _panel()
    import json
    kw = json.loads((REPO / "data" / "bursts" / "keyword_bursts.json").read_text())
    s = score_domain(panel, kw, {}, "quantum_computing", 600_000)
    assert set(s["inputs"]) == {"growth_recent", "acceleration", "keyword_burst",
                                "volume_scaled", "momentum_intent"}
    assert all(0.0 <= v <= 1.0 for v in s["inputs"].values())
    assert 0.0 <= s["score"] <= 100.0
