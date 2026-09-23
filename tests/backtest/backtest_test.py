"""Phase 4b tests — backtest + honesty gate (§12 backtest family)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

import pytest

from stats.forecasts import (
    apply_honesty_gate,
    backtest_panel,
    directional_accuracy,
    drift_forecast,
    mae,
    naive_forecast,
    persist_forecasts,
    rmse,
    smape,
    GATE_THRESHOLD,
)


def _panel():
    import json
    return json.loads((REPO / "data" / "trajectories" / "panel.json").read_text())


def test_naive_forecast_is_persistence():
    assert naive_forecast([5, 6, 7], 3) == [7, 7, 7]
    assert naive_forecast([], 2) == [0, 0]


def test_drift_forecast_extends_slope():
    out = drift_forecast([100, 200, 300, 400], 2)
    assert out == [500, 600]


def test_drift_never_negative():
    assert all(v >= 0 for v in drift_forecast([100, 50, 10], 3))


def test_directional_accuracy_full_and_zero():
    assert directional_accuracy([110, 120, 130], [105, 115, 125], 100) == 1.0
    assert directional_accuracy([90, 80], [110, 120], 100) == 0.0


def test_smape_handles_zero_denominators():
    # a=0: |0-10|/((0+10)/2)=2.0 → mean of [0.0, 2.0] = 1.0 (bounded 0..2)
    assert smape([0, 0], [0, 10]) == pytest.approx(1.0)
    assert smape([0, 0], [0, 0]) == 0.0


def test_mae_rmse_basics():
    assert mae([10, 20], [12, 18]) == 2.0
    assert rmse([0, 6], [0, 0]) == pytest.approx(4.2426, abs=1e-3)


def test_backtest_covers_all_20_domains_all_models():
    bt = backtest_panel(_panel())
    assert len(bt) == 20
    for slug, m in bt.items():
        assert set(m) == {"naive", "drift", "hw_damped", "pooled"}
        for fam in m.values():
            assert 0.0 <= fam["directional"] <= 1.0
            assert 0.0 <= fam["smape"] <= 2.0


def test_honesty_gate_threshold_is_60pct():
    assert GATE_THRESHOLD == 0.60
    # craft: hw beats naive on 1/2 series → 0.5 < 0.6 → FAIL
    bt = {"a": {"naive": {"directional": 0.5}, "hw_damped": {"directional": 0.9},
                "drift": {"directional": 0.0}, "pooled": {"directional": 0.0}},
          "b": {"naive": {"directional": 0.9}, "hw_damped": {"directional": 0.5},
                "drift": {"directional": 0.0}, "pooled": {"directional": 0.0}}}
    v = apply_honesty_gate(bt)
    assert v["hw_damped"]["gate_passed"] is False
    assert v["hw_damped"]["beats_naive_share"] == 0.5


def test_real_gate_hw_and_drift_pass_pooled_fails():
    import json
    out = json.loads((REPO / "data" / "forecasts" / "backtest.json").read_text())
    g = out["gate"]
    assert g["hw_damped"]["gate_passed"] is True
    assert g["drift"]["gate_passed"] is True
    assert g["pooled"]["gate_passed"] is False
    assert g["hw_damped"]["wins"] >= 12          # 16/20 observed, sanity floor


def test_persisted_forecasts_respect_gates():
    import json
    panel = _panel()
    backtest = backtest_panel(panel)
    verdict = apply_honesty_gate(backtest)
    forecasts = persist_forecasts(panel, verdict)
    # pooled FAILED gate → pooled never the persisted model
    for slug, f in forecasts.items():
        assert f["model"] in ("hw_damped", "naive", "drift")
        assert all(v >= 0 for v in f["forecast"])
        assert f["horizon"] == [2026, 2027, 2028]
        k0 = str(f["horizon"][0])          # interval keys are str(year)
        assert f["interval_68pct"][k0][0] <= f["forecast"][0] + 1
