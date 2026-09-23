"""Phase 3a — trajectory panel (PROJECT_MASTER_PLAN.md §Phase 3, fast-track).

Input:  data/tier_a/tier_a.json (exact source-aggregate annual counts,
        20 domains × 2000–2025, validated against the quantum full corpus
        25/26 years to-the-digit in calibration)
Output: data/trajectories/panel.json — per domain:
          annual(counts), quarterly(104 buckets, derived),
          yoy, qoq, metadata(source, method, drift notes)

Quarterly derivation (§9 decision, documented): annual counts are EXACT;
intra-year quarterly buckets are derived by equal-split interpolation.
Seasonal detail would cost 26 requests/domain (date-window slices) and the
Holt-Winters/ARIMA modeling consumes annual-scale anyway; equal-split keeps
hysteresis stable without pretending intra-quarter shape is measured.
Emergence scores' "damped" growth of last buckets uses ANNUAL deltas, so
interpolation does not touch the score math.
"""

from __future__ import annotations

import json
import statistics
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TIER_A = REPO / "data" / "tier_a" / "tier_a.json"
OUT = REPO / "data" / "trajectories"
OUT.mkdir(parents=True, exist_ok=True)

YEAR_MIN, YEAR_MAX = 2000, 2025
QUARTERS_PER_YEAR = 4


def derive_quarterly(annual: dict[int, int]) -> list[dict]:
    """Exact annual counts → 104 equal-split quarterly buckets.

    E.g. 2021: 10,731 → Q1–Q4: 2,682, 2,683, 2,683, 2,683 (remainder
    distributed head-first for determinism). Documented interpolation —
    not measurement (module docstring).
    """
    quarters = []
    for year in range(YEAR_MIN, YEAR_MAX + 1):
        total = annual.get(year, 0)
        base, rem = divmod(total, QUARTERS_PER_YEAR)
        for q in range(QUARTERS_PER_YEAR):
            quarters.append({
                "quarter": f"{year}-Q{q + 1}",
                "papers": base + (1 if q < rem else 0),
                "derived": True,          # interp flag per §8 honesty rules
            })
    return quarters


def yoy_series(annual: dict[int, int]) -> list[dict]:
    """Year-over-year growth ratio; ε=domain-scale guard per §Phase 3."""
    yoy = []
    for year in sorted(annual):
        if year == YEAR_MIN:
            continue
        prev, cur = annual[year - 1], annual[year]
        eps = 1.0
        yoy.append({
            "year": year,
            "yoy_growth": (cur - prev) / (prev + eps),
            "papers": cur,
        })
    return yoy


@dataclass
class DomainTrajectory:
    domain_slug: str
    display_name: str
    annual: dict[int, int]
    quarterly: list[dict]
    yoy: list[dict]
    metadata: dict = field(default_factory=dict)

    @property
    def total_works(self) -> int:
        return sum(self.annual.values())

    @property
    def growth_last2(self) -> float:
        """Damped last-2-bucket growth on ANNUAL scale (score input)."""
        ys = sorted(self.annual)
        if len(ys) < 3:
            return 0.0
        prev, cur = self.annual[ys[-2]], self.annual[ys[-1]]
        return (cur - prev) / (prev + 1.0)


def build_panel(tier_a_path: Path = TIER_A) -> list[DomainTrajectory]:
    tier = json.loads(tier_a_path.read_text())
    panel = []
    for slug, d in tier.items():
        annual = {int(y): int(c) for y, c in d["by_year"].items()}
        # year keys verified contiguous 2000-2025 at calibration
        contig = sorted(annual) == list(range(YEAR_MIN, YEAR_MAX + 1))
        panel.append(DomainTrajectory(
            domain_slug=slug,
            display_name=d["display_name"],
            annual=annual,
            quarterly=derive_quarterly(annual),
            yoy=yoy_series(annual),
            metadata={
                "source": ("full-corpus staged (814-page walk)" if slug == "quantum_computing"
                           else "tier_a source aggregate (group_by=publication_year)"),
                "count_verified": (slug != "quantum_computing"),
                "years_contiguous": contig,
                "quarterly_method": "equal_split_interpolation",
                "live_drift_note": ("2025 differ by 1 work vs live corpus"
                                    if slug == "quantum_computing" else None),
            },
        ))
    return panel


def panel_summary(panel: list[DomainTrajectory]) -> dict:
    lines = []
    for t in sorted(panel, key=lambda x: -x.total_works):
        last_yoy = t.yoy[-1]["yoy_growth"] if t.yoy else 0.0
        lines.append({
            "domain_slug": t.domain_slug,
            "display_name": t.display_name,
            "total_works": t.total_works,
            "peak_year": max(t.annual, key=t.annual.get),
            "growth_last2": round(t.growth_last2, 4),
            "yoy_2025": round(last_yoy, 4),
        })
    return {
        "generated": "tier_a_aggregate",
        "domains": len(panel),
        "panel_total_works": sum(t.total_works for t in panel),
        "trajectory": lines,
    }


def commit_panel(panel: list[DomainTrajectory]) -> Path:
    out = OUT / "panel.json"
    out.write_text(json.dumps({
        t.domain_slug: {
            "display_name": t.display_name,
            "annual": {str(y): c for y, c in sorted(t.annual.items())},
            "quarterly": t.quarterly,
            "total_works": t.total_works,
            "metadata": t.metadata,
        }
        for t in panel
    }, indent=1))
    (OUT / "summary.json").write_text(json.dumps(panel_summary(panel), indent=1))
    return out


def main() -> int:
    panel = build_panel()
    assert len(panel) == 20, f"panel {len(panel)} != 20"
    for t in panel:
        assert t.metadata["years_contiguous"], t.domain_slug
        assert all(q["quarter"] for q in t.quarterly), t.domain_slug
        # data-quality: quarterly buckets enterprise to annual exactly
        for year in range(YEAR_MIN, YEAR_MAX + 1):
            qsum = sum(q["papers"] for q in t.quarterly
                       if q["quarter"].startswith(f"{year}-"))
            assert qsum == t.annual[year], f"{t.domain_slug} {year}: {qsum} != {t.annual[year]}"
    out = commit_panel(panel)
    print(f"trajectory panel → {out}")
    print(json.dumps(panel_summary(panel), indent=1)[:900])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
