"""Phase 3.5 tests — patent series + concordance + lag crosswalk.

Covers the BigQuery-workaround ingest path: series construction with
zero-fill, unknown-domain rejection, the paper-vs-patent lag crosswalk,
and the concordance rule encoded in scripts/gen_patent_query.py
(parent-group vs exact subgroup, multi-membership semantics).
CSV-shape validation (header/duplicate/BOM/out-of-range) is exercised
live in stats/patents.py::read_counts against the real download.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

import pytest

from stats.patents import build_series, CONCORDANCE_CAVEAT
from scripts.gen_patent_query import load_rows


@pytest.fixture()
def panel():
    return json.loads((REPO / "data" / "trajectories" / "panel.json").read_text())


def test_series_zero_fills_missing_years(panel):
    counts = {"quantum_computing": {2015: 412}}
    out = build_series(counts, panel)
    annual = out["domains"]["quantum_computing"]["annual"]
    assert annual["2015"] == 412
    assert annual["2014"] == 0          # missing year = real zero
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


def test_crosswalk_lag_math(panel):
    counts = {"quantum_computing": {2017: 690}}
    out = build_series(counts, panel)
    x = out["paper_patent_crosswalk"]["quantum_computing"]
    assert x["papers_peak_year"] == 2025
    assert x["patents_peak_year"] == 2017
    assert x["lag_years"] == 8
    assert x["papers_total"] == panel["quantum_computing"]["total_works"]
    assert x["patents_total"] == 690


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
