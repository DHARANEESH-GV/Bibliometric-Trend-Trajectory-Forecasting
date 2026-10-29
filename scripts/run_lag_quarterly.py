"""Run the quarterly lag analysis and print every table.

Usage:  .venv/bin/python scripts/run_lag_quarterly.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from stats import lag_quarterly as L


def fmt(v, nd=2, width=6):
    return f"{'-':>{width}}" if v is None else f"{v:>{width}.{nd}f}"


def main() -> int:
    ok, comp = L.completeness_report()

    print("=" * 78)
    print("STEP 1  COMPLETENESS (2008Q1-2025Q4)")
    print("=" * 78)
    paper_qs = L.quarter_list(*L.PAPER_WINDOW)
    bad_p = [d for d, v in comp["papers"].items() if v["missing"]]
    print(f"papers: {len(comp['papers'])} domains, {len(paper_qs)} quarters each, "
          f"missing in {len(bad_p)} domain(s)")
    for name, label in (("grant", "PRIMARY grant 2015Q1-2025Q4"),
                        ("filing", "SECONDARY filing 2014Q1-2020Q4")):
        errs = [d for d, v in comp[name].items() if v.get("error")]
        zf = {d: v["zero_filled"] for d, v in comp[name].items()
              if v.get("zero_filled")}
        print(f"{label}: {len(comp[name])} domains; absent-quarter-as-zero: "
              f"{sum(len(v) for v in zf.values())} across {len(zf)} domain(s); "
              f"errors: {len(errs)}")
        for d, v in sorted(zf.items()):
            print(f"    {d}: {len(v)} absent quarter(s) -> 0  "
                  f"({', '.join(f'{y}Q{q}' for y, q in v[:6])}"
                  f"{' ...' if len(v) > 6 else ''})")
    if not ok:
        print("\nCOMPLETENESS FAILED - stopping before any analysis.")
        return 1
    print("\ncompleteness OK - proceeding")

    res = L.run()

    pr = res["primary_grant"]
    pd = pr["per_domain"]
    print("\n" + "=" * 78)
    print(f"STEP 2-3  PRIMARY: grant-date patents {pr['window_patents']}, "
          f"k = 0..{L.MAX_LAG}")
    print("=" * 78)
    print(f"{'domain':<28}{'n':>4}{'best k':>7}{'r':>7}{'perm p':>8}"
          f"{'sig.05':>7}{'lowconf':>8}   r by k (0,2,4,6,8,10,12)")
    for dom in sorted(pd, key=lambda d: (pd[d]["best_r"]), reverse=True):
        v = pd[dom]
        c = v["curve"]
        picks = ", ".join(fmt(c[k], 2, 5) for k in (0, 2, 4, 6, 8, 10, 12)
                          if k < len(c))
        print(f"{dom:<28}{v['n_points']:>4}{str(v['best_lag']):>7}"
              f"{v['best_r']:>7.2f}{v['perm_p']:>8.3f}"
              f"{('yes' if v['significant_05'] else 'no'):>7}"
              f"{('YES' if v['low_confidence'] else ''):>8}   {picks}")

    nsig = sum(1 for v in pd.values() if v["significant_05"])
    print(f"\nper-domain significant at p<0.05: {nsig}/{len(pd)} "
          f"(expected ~{0.05*len(pd):.1f} by chance at 20 tests)")

    po = pr["pooled"]
    print("\n" + "=" * 78)
    print("STEP 4  POOLED (z-scored per domain, bootstrapped over domains)")
    print("=" * 78)
    print(f"domains used: {po['n_domains']}")
    print(f"{'k':>3}{'r_pooled':>10}{'95% CI':>20}")
    for k in range(len(po["curve"])):
        star = "  <-- peak" if k == po["best_lag"] else ""
        print(f"{k:>3}{po['curve'][k]:>10.3f}"
              f"   [{po['ci_lo'][k]:>6.3f}, {po['ci_hi'][k]:>6.3f}]{star}")
    print(f"\npooled best lag = {po['best_lag']} (r={po['best_r']:.3f}), "
          f"bootstrap 95% CI on lag = {po['best_lag_ci']}, "
          f"modal lag = {po['best_lag_boot_mode']}")
    print(f"peak CI excludes zero: {po['peak_excludes_zero']}")
    print(f"pooled permutation p (independent circular shifts per domain) = "
          f"{pr['pooled_perm_p']:.3f}")

    pl = pr["placebo"]
    print("\n" + "=" * 78)
    print(f"STEP 5  PLACEBO (cross-domain patent mismatches, {pl['n_draws']} draws)")
    print("=" * 78)
    print(f"true pairing peak          : {pl['true_peak']:.3f}")
    print(f"placebo mean peak          : {pl['placebo_mean_peak']:.3f}")
    print(f"placebo 95th percentile    : {pl['placebo_p95_peak']:.3f}")
    print(f"placebo max peak           : {pl['placebo_max_peak']:.3f}")
    print(f"true peak exceeds all      : {pl['exceeds_all_placebo']}")
    print(f"empirical p vs placebo     : {pl['empirical_p']:.3f}")

    g = pr["granger"]
    print("\n" + "=" * 78)
    print(f"STEP 6  GRANGER (maxlag {L.GRANGER_MAXLAG}, differenced growth)")
    print("=" * 78)
    if g.get("skipped"):
        print(f"SKIPPED: {g['reason']}")
    else:
        skipped = [d for d, v in g.items() if v.get("skipped")]
        ran = {d: v for d, v in g.items() if not v.get("skipped")}
        for dom in sorted(ran, key=lambda d: ran[d]["min_p"]):
            v = ran[dom]
            print(f"{dom:<28} min p={v['min_p']:.4f} at lag {v['at_lag']}"
                  f"{'  *' if v['significant_05'] else ''}")
        nsig = sum(1 for v in ran.values() if v["significant_05"])
        print(f"\nsignificant at p<0.05: {nsig}/{len(ran)} (expected ~{0.05*len(ran):.1f} by chance)")
        if skipped:
            print(f"skipped: {len(skipped)} -> {', '.join(sorted(skipped))}")

    fs = res["filing_sensitivity"]
    fo = fs["pooled"]
    print("\n" + "=" * 78)
    print(f"FILING SENSITIVITY (separate series, pooled only) "
          f"{fs['window_patents']}")
    print("=" * 78)
    print(f"domains used: {fo['n_domains']}, points/domain: "
          f"{min(fs['points_per_domain'].values())}-{max(fs['points_per_domain'].values())}")
    print(f"{'k':>3}{'r_pooled':>10}{'95% CI':>20}")
    for k in range(len(fo["curve"])):
        star = "  <-- peak" if k == fo["best_lag"] else ""
        print(f"{k:>3}{fo['curve'][k]:>10.3f}"
              f"   [{fo['ci_lo'][k]:>6.3f}, {fo['ci_hi'][k]:>6.3f}]{star}")
    print(f"\nfiling pooled best lag = {fo['best_lag']} (r={fo['best_r']:.3f}), "
          f"lag CI {fo['best_lag_ci']}")
    print(f"filing pooled perm p = {fs['pooled_perm_p']:.3f}; "
          f"placebo empirical p = {fs['placebo']['empirical_p']:.3f}")

    print("\n" + "=" * 78)
    print("STEP 7  LOW-CONFIDENCE DOMAINS")
    print("=" * 78)
    for dom in L.LOW_CONFIDENCE:
        v = pd.get(dom, {})
        print(f"{dom:<28} best k={v.get('best_lag')} r={fmt(v.get('best_r'))} "
              f"p={fmt(v.get('perm_p'),3)} n={v.get('n_points')}")

    out = L.OUT_JSON
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
