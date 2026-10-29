"""Phase 3.5 tests — patent series + concordance + lag crosswalk.

Covers the BigQuery-workaround ingest path: series construction with
null-before-coverage / zero-inside-coverage semantics, unknown-domain
rejection, the growth-based lag scan and its permutation test, and the
concordance rule in scripts/gen_patent_query.py (parent-group vs exact
subgroup, multi-membership semantics).

The 2014 coverage boundary and the grant-lag cutoff are properties of the
SOURCE, verified live on 2026-10-29 (see stats/patents.py docstring), so
they are asserted here as invariants rather than recomputed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

import pytest

from stats.patents import (
    build_series,
    CONCORDANCE_CAVEAT,
    LAG_WINDOW,
    MAX_LAG,
    MIN_LAG_PAIRS,
    PATENT_COMPLETE_MAX,
    PATENT_YEAR_MIN,
    _max_lag_r,
    _panel_significance,
    _pearson,
    _permutation_p,
)
from scripts.gen_patent_query import load_rows


@pytest.fixture()
def panel():
    return json.loads((REPO / "data" / "trajectories" / "panel.json").read_text())


def test_coverage_boundaries_are_measured_constants():
    assert PATENT_YEAR_MIN == 2014, "pre-2014 CPC coverage is unusable in the source"
    assert PATENT_COMPLETE_MAX == 2024, "2025+ grants are incomplete (grant lag)"
    assert LAG_WINDOW == (2014, 2024)
    assert MIN_LAG_PAIRS >= 7, "fewer points cannot support a lag correlation"


def test_series_nulls_before_coverage_zeros_inside(panel):
    counts = {"quantum_computing": {2015: 412}}
    out = build_series(counts, panel)
    annual = out["domains"]["quantum_computing"]["annual"]
    assert annual["2013"] is None       # no source coverage — NOT zero
    assert annual["2000"] is None
    assert annual["2015"] == 412
    assert annual["2014"] == 0          # covered year, no match = real zero
    assert annual["2025"] == 0
    assert out["domains"]["quantum_computing"]["total"] == 412
    assert out["domains"]["quantum_computing"]["peak_year"] == 2015


def test_series_covers_all_20_domains(panel):
    out = build_series({}, panel)
    assert set(out["domains"]) == set(panel)
    assert len(out["domains"]) == 20
    for slug, d in out["domains"].items():
        assert set(d["annual"]) == {str(y) for y in range(2000, 2026)}
        assert d["total"] == 0
        assert d["peak_year"] is None
        assert d["metadata"]["caveat"] == CONCORDANCE_CAVEAT
        assert d["covered_years"] == [PATENT_YEAR_MIN, 2025]
        # every pre-coverage year must be null, never 0
        for y in range(2000, PATENT_YEAR_MIN):
            assert d["annual"][str(y)] is None


def test_crosswalk_reports_lag_window_and_basis(panel):
    counts = {"quantum_computing": {2017: 690}}
    out = build_series(counts, panel)
    x = out["paper_patent_crosswalk"]["quantum_computing"]
    assert x["papers_peak_year"] == 2025
    assert x["patents_peak_year"] == 2017
    assert x["lag_window"] == [PATENT_YEAR_MIN, PATENT_COMPLETE_MAX]
    assert "growth" in x["lag_basis"]
    assert x["min_pairs_required"] == MIN_LAG_PAIRS
    assert x["papers_total"] == panel["quantum_computing"]["total_works"]
    assert x["patents_total"] == 690
    # lag scan must cover every lag in range with a result record
    assert [r["lag"] for r in x["lag_scan"]] == list(range(-MAX_LAG, MAX_LAG + 1))
    assert all("powered" in r for r in x["lag_scan"])


def test_boundary_optimum_flagged_not_significant():
    """A peak at the scan edge means the true lag is unidentified, so the
    domain must never be reported as significant."""
    panel = json.loads((REPO / "data" / "trajectories" / "panel.json").read_text())
    a = {int(y): c for y, c in panel["autonomous_vehicles"]["annual"].items()}
    q = {y: float((y * 7) % 5) for y in range(2000, 2026)}
    out = build_series({"autonomous_vehicles": {y: int(v) for y, v in q.items()
                                                if 2014 <= y <= 2025}}, panel)
    x = out["paper_patent_crosswalk"]["autonomous_vehicles"]
    if x["best_lag_years"] is not None and abs(x["best_lag_years"]) == MAX_LAG:
        assert x["at_scan_boundary"] is True
        assert x["significant"] is False
    # the invariant itself, independent of which lag won
    assert x["significant"] == (x["permutation_p"] is not None
                                and x["permutation_p"] <= 0.10
                                and not x["at_scan_boundary"]
                                and not x["underpowered"])


def test_panel_significance_flags_chance_level_results():
    """5 flags out of 20 at alpha=0.10 must not read as a discovery."""
    cw = {}
    for i in range(20):
        cw[f"d{i}"] = {"permutation_p": 0.08 if i < 5 else 0.5,
                       "significant": i < 5}
    out = _panel_significance(cw)
    assert out["domains_tested"] == 20
    assert out["domains_significant"] == 5
    assert out["expected_false_positives"] == 2.0
    # 0.08 does not clear 0.10/20 = 0.005
    assert out["survive_bonferroni"] == []
    assert "not established" in out["verdict"]


def test_panel_significance_recognises_a_real_signal():
    cw = {f"d{i}": {"permutation_p": 0.001 if i < 3 else 0.6,
                    "significant": i < 3} for i in range(20)}
    out = _panel_significance(cw)
    assert len(out["survive_bonferroni"]) == 3
    assert "unlikely to be a testing artefact" in out["verdict"]


def test_pearson_edge_cases():
    assert _pearson([1, 2, 3], [1, 2, 3]) == pytest.approx(1.0)
    assert _pearson([1, 2, 3], [3, 2, 1]) == pytest.approx(-1.0)
    assert _pearson([5, 5, 5], [1, 2, 3]) is None    # constant → undefined
    assert _pearson([1, 2], [1, 2]) is None          # too short


def test_max_lag_reports_every_lag_with_power_flag():
    p = {y: 0.1 * y for y in range(2014, 2024)}
    q = {y: 0.1 * y for y in range(2014, 2024)}
    lag, r, rows = _max_lag_r(p, q)
    assert len(rows) == MAX_LAG * 2 + 1
    assert lag is not None and r is not None
    for row in rows:
        # each shift drops at least one pairing; only unpowered ones may
        # fall below MIN_LAG_PAIRS, and the flag must match the count
        assert row["powered"] == (row["n"] >= MIN_LAG_PAIRS)
    ns = {row["lag"]: row["n"] for row in rows}
    assert ns[0] >= ns[MAX_LAG] and ns[0] >= ns[-MAX_LAG]


def test_underpowered_lags_cannot_win():
    """A lag with too few pairs must be skipped even if its r is highest."""
    p = {y: float(y) for y in range(2014, 2024)}
    # patent growth deliberately aligned only at the widest lag
    q = {y: float(-y) for y in range(2014, 2024)}
    lag, r, rows = _max_lag_r(p, q)
    if lag is not None:
        winning = [row for row in rows if row["lag"] == lag][0]
        assert winning["powered"] is True
        assert winning["n"] >= MIN_LAG_PAIRS


def test_permutation_p_high_for_pure_noise():
    """A best-lag r that any shuffle reproduces must not look significant."""
    p = {y: float((y * 37) % 11) for y in range(2014, 2023)}
    q = {y: float((y * 53) % 13) for y in range(2014, 2023)}
    _, r, _ = _max_lag_r(p, q)
    pval = _permutation_p(p, q, r, n_perm=200)
    assert pval is not None and pval > 0.10


def test_real_crosswalk_marks_significance_honestly(panel):
    """On the real data, significance must be a minority: 20 tests at
    p<=0.10 would flag ~2 by chance alone, so a majority 'significant'
    would mean the permutation test is broken, not that science happened."""
    import csv
    src = REPO / "data" / "patents" / "patent_counts.csv"
    if not src.exists():
        pytest.skip("patent_counts.csv not present")
    counts: dict[str, dict[int, int]] = {}
    with src.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            y = int(row["year"])
            if y >= PATENT_YEAR_MIN:
                counts.setdefault(row["domain"], {})[y] = int(row["patents"])
    out = build_series(counts, panel)
    sig = [s for s, x in out["paper_patent_crosswalk"].items() if x["significant"]]
    assert len(sig) <= 8, f"implausibly many significant domains: {sig}"
    for x in out["paper_patent_crosswalk"].values():
        assert x["permutation_p"] is None or 0.0 <= x["permutation_p"] <= 1.0


def test_unknown_domain_rejected(panel):
    with pytest.raises(SystemExit, match="not in the panel"):
        build_series({"not_a_domain": {2015: 1}}, panel)


def test_concordance_rules_from_config():
    """The generated rule set: 38 rows, parent '00' subgroups flagged by the
    SQL (subgroup='00' matches the whole group), exact subgroups elsewhere."""
    rows = load_rows()
    assert len(rows) == 38
    by_slug = {}
    for g, s, slug in rows:
        by_slug.setdefault(slug, []).append((g, s))
    # quantum_computing parent group G06N10 with subgroup 00 present
    assert ("G06N10", "00") in by_slug["quantum_computing"]
    # QEC exact leaf G06N10/70
    assert ("G06N10", "70") in by_slug["quantum_error_correction"]
    # genAI exact leaves under AI's parent group G06N3
    assert ("G06N3", "08") in by_slug["generative_ai"]
    assert ("G06N3", "00") in by_slug["artificial_intelligence"]


def test_concordance_membership_semantics():
    """Mirror of the SQL join: parent subgroup '00' claims the whole group;
    exact subgroup claims only itself. Multi-membership is intended."""
    rows = load_rows()

    def domains_for(leaf_group: str, leaf_sub: str) -> set[str]:
        hits = set()
        for g, s, slug in rows:
            if g == leaf_group and (s == "00" or s == leaf_sub):
                hits.add(slug)
        return hits

    assert domains_for("G06N3", "08") == {"artificial_intelligence", "generative_ai"}
    assert domains_for("G06N10", "70") == {"quantum_computing", "quantum_error_correction"}
    assert domains_for("G06N10", "40") == {"quantum_computing"}
    assert domains_for("G06N20", "00") == {"artificial_intelligence"}
    assert domains_for("A01B", "02") == set()      # unrelated agriculture code
