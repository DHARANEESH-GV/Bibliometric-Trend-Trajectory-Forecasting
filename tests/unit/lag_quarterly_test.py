"""Tests for the quarterly lag analysis (stats/lag_quarterly.py).

Two invariants decide whether the pipeline is trustworthy, so they are tested
directly rather than asserted in prose:

  1. If patents are a pure 5-quarter-lagged copy of papers, the pipeline must
     recover best_lag == 5. This catches sign errors (t+k vs t-k), an off-by-one
     in the rolling-sum index, and any accidental time reversal.
  2. Independent random noise must NOT yield a significant pooled peak. This
     catches a permutation test that is too permissive (e.g. one that compares
     against the null of zero instead of the observed max-over-k statistic).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

from stats import lag_quarterly as L


WINDOW = (2008, 1, 2025, 4)
NQ = 72


def make_domain(seed: int, lag: int | None, n: int = NQ) -> tuple[dict, dict]:
    """Raw quarterly counts: patents = papers shifted forward by `lag` quarters.

    Patents issued/observed at t track papers at t-lag, which is exactly the
    alignment corr(paper[t], patent[t+k]) with k == lag. `lag=None` gives an
    independent noise series instead.
    """
    rng = np.random.default_rng(seed)
    # smooth positive level with multiplicative drift so log-growth is defined
    paper = 1000.0 * np.exp(np.cumsum(rng.normal(0.02, 0.10, n)))
    if lag is None:
        patent = 500.0 * np.exp(np.cumsum(rng.normal(0.02, 0.10, n)))
    else:
        patent = np.empty(n)
        patent[:lag] = paper[0]
        patent[lag:] = paper[: n - lag]

    qs = L.quarter_list(*WINDOW)
    papers = {f"d{seed}": {qs[i]: int(paper[i]) for i in range(n)}}
    patents = {f"d{seed}": {qs[i]: int(patent[i]) for i in range(n)}}
    return papers, patents


def test_recovers_known_5_quarter_lag():
    papers, patents = make_domain(seed=11, lag=5)
    pg, qg, meta = L.build_series(papers, patents, WINDOW, WINDOW)
    dom = "d11"
    assert dom in pg
    # 4-quarter rolling sum plus 4-quarter lookback consumes 8 quarters
    assert meta[dom][2] == NQ - 7

    curve = L.lag_curve(pg[dom], qg[dom])
    best = int(np.nanargmax(curve))
    assert best == 5, f"expected lag 5, recovered {best} (curve={np.round(curve, 3)})"
    assert curve[5] > 0.99, f"lag-5 correlation should be ~1, got {curve[5]:.3f}"

    # and the peak must be clearly distinguished from its neighbours
    assert curve[5] > curve[4] and curve[5] > curve[6]


@pytest.mark.parametrize("seed", [11, 23, 47])
def test_recovers_lag_across_seeds(seed):
    papers, patents = make_domain(seed=seed, lag=5)
    pg, qg, _ = L.build_series(papers, patents, WINDOW, WINDOW)
    dom = f"d{seed}"
    assert int(np.nanargmax(L.lag_curve(pg[dom], qg[dom]))) == 5


def test_recovers_other_lags_with_correct_sign():
    """A 2-quarter lag must come back as +2, not -2 (guards the t+k direction)."""
    papers, patents = make_domain(seed=31, lag=2)
    pg, qg, _ = L.build_series(papers, patents, WINDOW, WINDOW)
    assert int(np.nanargmax(L.lag_curve(pg["d31"], qg["d31"]))) == 2


def test_random_noise_is_not_significant():
    """Independent noise across 20 domains must not produce a significant peak."""
    n_dom = 20
    papers: dict = {}
    patents: dict = {}
    for i in range(n_dom):
        p, q = make_domain(seed=1000 + i, lag=None)
        papers.update(p)
        patents.update(q)

    pg, qg, _ = L.build_series(papers, patents, WINDOW, WINDOW)
    assert len(pg) == n_dom

    curve, used = L.pooled_curve(pg, qg)
    assert len(used) == n_dom
    peak = float(np.nanmax(curve))
    assert abs(peak) < 0.30, f"noise produced an implausibly large peak r={peak:.3f}"

    rng = np.random.default_rng(7)
    p = L.pooled_permutation(pg, qg, rng, n_perm=200)
    assert p > 0.05, f"noise flagged significant (p={p:.3f})"


def test_circular_shift_preserves_spectrum_but_breaks_alignment():
    papers, patents = make_domain(seed=5, lag=5)
    pg, qg, _ = L.build_series(papers, patents, WINDOW, WINDOW)
    q = qg["d5"]
    shifted = L.circular_shift(q, 17)
    assert np.allclose(np.sort(q), np.sort(shifted))
    assert not np.allclose(q, shifted)
    # alignment is destroyed, so correlation at the true lag collapses
    assert abs(L.safe_corr(pg["d5"], shifted)) < 0.9


def test_degenerate_inputs_are_zero_not_nan():
    """Constant series must yield r=0.0 rather than NaN/crash."""
    a = np.ones(10)
    b = np.arange(10, dtype=float)
    assert L.safe_corr(a, b) == 0.0
    assert L.safe_corr(np.array([1.0]), np.array([2.0])) == 0.0


def test_quarter_list_is_contiguous_and_correct():
    qs = L.quarter_list(2008, 1, 2025, 4)
    assert len(qs) == 72
    assert qs[0] == (2008, 1) and qs[-1] == (2025, 4)
    assert all(qs[i] < qs[i + 1] for i in range(len(qs) - 1))
    assert L.quarter_list(2015, 1, 2025, 4)[0] == (2015, 1)
    assert len(L.quarter_list(2015, 1, 2025, 4)) == 44
