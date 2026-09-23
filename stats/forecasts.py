"""Phase 4b — forecasting + rolling-origin backtest (PROJECT_MASTER_PLAN.md §Phase 4).

Models (§3, §Phase 4 — classical only, series-length rationale §9):
  * Holt-Winters damped (additive trend, damped φ) — primary
  * drift (last value + mean slope) — baseline
  * naive persistence (last value repeated) — honesty anchor
  * pooled/global benchmark row: the panel-mean drift (cross-learning)

Backtest (rolling-origin, expanding window): train ≤2021, targets
2022..2025 annually. Metrics: MAE, RMSE, sMAPE (over MAPE — 0-denominators),
directional accuracy.

HONESTY GATE (§Phase 4): a model family is REPORTED only if directional
accuracy beats naive on ≥60% of series. Otherwise the persisted forecast IS
the naive forecast, with gate_failed=true in metadata.

Horizon: 2026–2028 (3 years) with residual-σ prediction intervals.
"""

from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
PANEL = REPO / "data" / "trajectories" / "panel.json"
OUT = REPO / "data" / "forecasts"
OUT.mkdir(parents=True, exist_ok=True)

TRAIN_END = 2021
TARGETS = [2022, 2023, 2024, 2025]
HORIZON = [2026, 2027, 2028]
GATE_THRESHOLD = 0.60


def _hw_damped(train: list[float], horizon: int) -> list[float] | None:
    """Holt damped (φ=0.85) via statsmodels ExponentialSmoothing."""
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        fit = ExponentialSmoothing(
            np.asarray(train, dtype=float), trend="add", damped_trend=True,
            initialization_method="estimated").fit(optimized=True)
        return list(fit.forecast(horizon))
    except Exception:
        return None


def naive_forecast(train: list[float], horizon: int) -> list[float]:
    last = train[-1] if train else 0.0
    return [last] * horizon


def drift_forecast(train: list[float], horizon: int) -> list[float]:
    if len(train) < 2:
        return naive_forecast(train, horizon)
    slope = (train[-1] - train[0]) / (len(train) - 1)
    return [max(train[-1] + slope * (i + 1), 0.0) for i in range(horizon)]


def pooled_drift_forecast(all_trains: list[list[float]], horizon: int) -> list[float]:
    """Global cross-learning benchmark: median per-origin slope × panel."""
    slopes = []
    for tr in all_trains:
        if len(tr) >= 2:
            slopes.append((tr[-1] - tr[0]) / (len(tr) - 1))
    med = statistics.median(slopes) if slopes else 0.0
    return [max(0.0, med * (i + 1)) for i in range(horizon)]   # additive drift from 0


def smape(actual: list[float], predicted: list[float]) -> float:
    out = []
    for a, p in zip(actual, predicted):
        denom = (abs(a) + abs(p)) / 2
        out.append(0.0 if denom == 0 else abs(a - p) / denom)
    return statistics.mean(out) if out else 0.0


def directional_accuracy(actual: list[float], predicted: list[float],
                         origin: float) -> float:
    """Did the forecast call the direction (up/down) of each target year?"""
    if not actual:
        return 0.0
    hits = 0
    prev = origin
    for a, p in zip(actual, predicted):
        a_dir, p_dir = (a > prev), (p > prev)
        hits += a_dir == p_dir
        prev = a
    return hits / len(actual)


def mae(actual: list[float], predicted: list[float]) -> float:
    return statistics.mean(abs(a - p) for a, p in zip(actual, predicted)) if actual else 0.0


def rmse(actual: list[float], predicted: list[float]) -> float:
    if not actual:
        return 0.0
    return math.sqrt(statistics.mean((a - p) ** 2 for a, p in zip(actual, predicted)))


def evaluate_series(train: list[float], actual: list[float],
                    all_trains: list[list[float]]) -> dict:
    h = len(actual)
    preds = {
        "naive": naive_forecast(train, h),
        "drift": drift_forecast(train, h),
        "hw_damped": _hw_damped(train, h) or naive_forecast(train, h),
        "pooled": pooled_drift_forecast(all_trains, h),
    }
    metrics = {}
    for name, p in preds.items():
        metrics[name] = {
            "mae": round(mae(actual, p), 2),
            "rmse": round(rmse(actual, p), 2),
            "smape": round(smape(actual, p), 4),
            "directional": round(directional_accuracy(actual, p, train[-1]), 4),
        }
    return metrics


def backtest_panel(panel: dict) -> dict:
    results = {}
    slugs = sorted(panel)
    all_trains = [[panel[s]["annual"][str(y)] for y in sorted(panel[s]["annual"],
                  key=int) if int(y) <= TRAIN_END] for s in slugs]
    for slug in slugs:
        annual = {int(y): int(c) for y, c in panel[slug]["annual"].items()}
        train = [annual[y] for y in sorted(annual) if y <= TRAIN_END]
        actual = [annual[y] for y in TARGETS]
        results[slug] = evaluate_series(train, actual, all_trains)
    return results


def apply_honesty_gate(backtest: dict) -> dict:
    """Model family beats naive directionally on ≥60% of series → keep;
    else the persisted forecast IS naive (per-family gate_failed flag)."""
    verdict = {}
    for family in ("hw_damped", "drift", "pooled"):
        wins = 0
        for slug, m in backtest.items():
            if m[family]["directional"] > m["naive"]["directional"]:
                wins += 1
        verdict[family] = {"beats_naive_share": round(wins / len(backtest), 4),
                           "gate_passed": wins / len(backtest) >= GATE_THRESHOLD,
                           "wins": wins, "series": len(backtest)}
    return verdict


def persist_forecasts(panel: dict, verdict: dict) -> dict:
    """Full-train forecasts for 2026–2028, gated per honesty verdict."""
    slugs = sorted(panel)
    all_trains = [[panel[s]["annual"][str(y)] for y in sorted(panel[s]["annual"],
                  key=int)] for s in slugs]
    forecasts = {}
    for slug in slugs:
        annual = {int(y): int(c) for y, c in panel[slug]["annual"].items()}
        train = [annual[y] for y in sorted(annual)]
        cands = {
            "hw_damped": _hw_damped(train, len(HORIZON)),
            "drift": drift_forecast(train, len(HORIZON)),
            "naive": naive_forecast(train, len(HORIZON)),
        }
        chosen_model, chosen = "hw_damped", cands["hw_damped"]
        if not verdict["hw_damped"]["gate_passed"]:
            chosen_model, chosen = "naive", cands["naive"]
        resid_sigma = max(statistics.pstdev([annual[y] - drift_forecast(train[:-1], 1)[0]
                                             for y in sorted(annual)[1:]] or [0.0]), 1.0)
        intervals = {
            str(year): [round(v - resid_sigma), round(v + resid_sigma)]
            for year, v in zip(HORIZON, chosen)
        }
        forecasts[slug] = {
            "model": chosen_model,
            "gate_failed": chosen_model == "naive" and verdict["hw_damped"]["gate_passed"] is False,
            "horizon": HORIZON,
            "forecast": [round(v) for v in chosen],
            "interval_68pct": intervals,
            "resid_sigma": round(resid_sigma, 2),
            "train_through": sorted(annual)[-1],
        }
    return forecasts


def main() -> int:
    panel = json.loads(PANEL.read_text())
    backtest = backtest_panel(panel)
    verdict = apply_honesty_gate(backtest)
    forecasts = persist_forecasts(panel, verdict)
    (OUT / "backtest.json").write_text(json.dumps(
        {"train_end": TRAIN_END, "targets": TARGETS, "gate": verdict,
         "per_series": backtest}, indent=1))
    (OUT / "forecasts.json").write_text(json.dumps(
        {"horizon": HORIZON, "gate": verdict, "forecasts": forecasts}, indent=1))
    print("HONESTY GATE (directional accuracy vs naive, ≥60% of series):")
    for fam, v in verdict.items():
        print(f"  {fam:10s} wins {v['wins']:>2}/{v['series']} "
              f"({v['beats_naive_share']:.0%}) → {'PASS' if v['gate_passed'] else 'FAIL (naive persisted)'}")
    print(f"\nsaved → {OUT}/backtest.json + forecasts.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
