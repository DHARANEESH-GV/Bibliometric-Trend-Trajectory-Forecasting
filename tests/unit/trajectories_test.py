"""Phase 3a tests — trajectory panel (§12 data-quality family)."""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import pytest

from stats.trajectories import (
    DomainTrajectory,
    build_panel,
    derive_quarterly,
    yoy_series,
    YEAR_MAX,
    YEAR_MIN,
)


def test_quarterly_updates_to_annual_exactly():
    quarterly = derive_quarterly({2021: 10_731, 2000: 1})
    q21 = [q["papers"] for q in quarterly if q["quarter"].startswith("2021")]
    assert sum(q21) == 10_731
    # divmod(10731,4)=2682 r3 → base 2682, remainder 3 distributed HEAD-FIRST
    assert q21 == [2683, 2683, 2683, 2682]
    assert [q["papers"] for q in quarterly if q["quarter"] == "2000-Q1"] == [1]


def test_quarterly_104_buckets_every_domain():
    panel = build_panel()
    assert len(panel) == 20
    for t in panel:
        assert len(t.quarterly) == 104
        assert t.quarterly[0]["quarter"] == "2000-Q1"
        assert t.quarterly[-1]["quarter"] == f"{YEAR_MAX}-Q4"


def test_annual_totals_match_tier_a():
    panel = build_panel()
    by_slug = {t.domain_slug: t for t in panel}
    assert by_slug["quantum_computing"].total_works == 162_781
    assert by_slug["artificial_intelligence"].total_works == 620_016
    assert sum(t.total_works for t in panel) == 5_474_269


def test_panel_years_contiguous_flag_set_everywhere():
    for t in build_panel():
        assert t.metadata["years_contiguous"] is True
        assert sorted(t.annual) == list(range(YEAR_MIN, YEAR_MAX + 1))


def test_yoy_series_shape_and_epsilon_stability():
    annual = {2000: 0, 2001: 100, 2002: 50}
    yoy = yoy_series(annual)
    # ε=1.0 guard: prev=0 → (100-0)/(0+1) = 100
    assert yoy[0] == {"year": 2001, "yoy_growth": 100.0, "papers": 100}
    assert yoy[1]["yoy_growth"] == (50 - 100) / (100 + 1.0)   # -0.495...


@pytest.mark.parametrize("prev,cur,expect", [
    (100_000, 150_000, 0.5),      # domain-scale: ε negligible
    (100_000, 100_000, 0.0),
    (100_000, 50_000, -0.5),
])
def test_growth_last2_math(prev, cur, expect):
    t = DomainTrajectory(
        domain_slug="d", display_name="D",
        annual={2021: prev, 2022: cur, 2000: 1, 2001: 1},
        quarterly=[], yoy=[],
    )
    assert t.growth_last2 == pytest.approx(expect, abs=1e-4)


def test_quantum_metadata_records_full_corpus_provenance():
    t = {x.domain_slug: x for x in build_panel()}["quantum_computing"]
    assert "814-page" in t.metadata["source"]
    assert t.metadata["count_verified"] is False    # it IS the verification set
    assert t.metadata["live_drift_note"]
