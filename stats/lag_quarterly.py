"""Quarterly paper-vs-patent lag analysis (2008Q1-2025Q4 panel).

PRIMARY series:   date_type = grant,   window 2015Q1-2025Q4
SECONDARY series: date_type = filing,  window 2014Q1-2020Q4 (pooled only)
The two are never mixed. They are reported in separate result blocks.

Method
------
1. 4-quarter rolling sums S_t for papers and patents, per domain.
2. Year-over-year log growth g_t = ln((S_t+1)/(S_t-4+1)).
3. Per domain: corr(g_paper[t], g_patent[t+k]) for k = 0..12. Best lag = argmax.
   Permutation p: circularly shift the patent growth series 1000 times and take
   the share of shifts whose *max-over-k* correlation is >= the observed max.
4. Pooled: z-score each domain's growth series, average the per-domain
   correlation curves. Bootstrap the curve and the best lag by resampling
   DOMAINS (1000 draws). Pooled permutation p with an independent circular
   shift per domain.
5. Placebo: pair each domain's papers with another domain's patents (random
   distinct mismatches, 200 draws) and recompute the pooled curve.
6. Granger (optional, statsmodels, maxlag 8, differenced growth).

Absent quarters are real zeros
------------------------------
sql/patent_counts_quarterly.sql is a `GROUP BY ... COUNT(...)`, so a quarter in
which no patent matched emits NO row rather than a zero row. Absent quarters
inside a window are therefore zero counts, not missing data. This matches the
project honesty rule in stats/patents.py: zeros inside the covered range are
real zeros of the CPC concordance (which is approximate); NULL is reserved for
years outside source coverage. Domain/date_type combinations that never appear
at all are reported as ERROR and are never silently zero-filled.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
PAPERS_CSV = REPO / "data" / "papers" / "panel_quarterly.csv"
PATENTS_CSV = REPO / "data" / "patents" / "patent_quarterly.csv"
OUT_JSON = REPO / "data" / "lag" / "lag_results.json"

PAPER_WINDOW = (2008, 1, 2025, 4)
GRANT_WINDOW = (2015, 1, 2025, 4)
FILING_WINDOW = (2014, 1, 2020, 4)

ROLL = 4          # rolling-sum width
MAX_LAG = 12      # k = 0..12
N_PERM = 1000
N_BOOT = 1000
N_PLACEBO = 200
GRANGER_MAXLAG = 8
SEED = 20261029

LOW_CONFIDENCE = (
    "quantum_error_correction",
    "smart_manufacturing",
    "synthetic_biology",
    "space_technologies",
)

CAVEATS = [
    "OpenAlex topic drift: topic assignments are re-derived over time, so a "
    "domain's paper counts are not necessarily measured on a single frozen "
    "topic snapshot.",
    "CPC concordance noise: CPC boundaries do not align cleanly with human "
    "technology categories, so patent counts may over- or under-count a domain. "
    "Known overlaps include QEC subset-of quantum_computing and "
    "genAI/ai_agents subset-of AI's G06N3/00 group.",
    "Jan-1 dating: patents with only a year (Jan 1 sentinel) and papers with "
    "coarse dates are assigned deterministically, which can shift a small "
    "number of records across quarter boundaries.",
    "Grant-date lag includes pendency: the grant window is dated by issue date, "
    "so k-quarter alignment absorbs examination pendency (typically 1-3 years), "
    "not just inventive lag.",
    "Multi-membership: a patent matching several domains is counted once per "
    "matched domain, so domains are not statistically independent, which makes "
    "the pooled bootstrap over domains mildly anti-conservative.",
    "Rolling 4-quarter sums plus a 4-quarter lag consume 8 quarters per "
    "observation, so overlapping observations are strongly autocorrelated and "
    "effective sample size is far below the nominal point count.",
]


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------
def quarter_list(y0: int, q0: int, y1: int, q1: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    y, q = y0, q0
    while (y, q) <= (y1, q1):
        out.append((y, q))
        q += 1
        if q == 5:
            y, q = y + 1, 1
    return out


def load_papers() -> dict[str, dict[tuple[int, int], int]]:
    data: dict[str, dict[tuple[int, int], int]] = defaultdict(dict)
    with PAPERS_CSV.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            data[row["domain"]][(int(row["year"]), int(row["quarter"]))] = int(
                row["papers"]
            )
    return dict(data)


def load_patents(date_type: str) -> dict[str, dict[tuple[int, int], int]]:
    data: dict[str, dict[tuple[int, int], int]] = defaultdict(dict)
    with PATENTS_CSV.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["date_type"] != date_type:
                continue
            data[row["domain"]][(int(row["year"]), int(row["quarter"]))] = int(
                row["patents"]
            )
    return dict(data)


def completeness_report() -> tuple[bool, dict]:
    """Step 1 gate. Returns (ok, detail). Absent quarters are zero-filled."""
    papers = load_papers()
    paper_qs = quarter_list(*PAPER_WINDOW)
    detail: dict = {"papers": {}, "grant": {}, "filing": {}}
    ok = True

    for dom in sorted(papers):
        missing = [q for q in paper_qs if q not in papers[dom]]
        detail["papers"][dom] = {"points": len(papers[dom]), "missing": missing}
        if missing:
            ok = False

    for name, dt, win in (
        ("grant", "grant", GRANT_WINDOW),
        ("filing", "filing", FILING_WINDOW),
    ):
        pat = load_patents(dt)
        win_qs = quarter_list(*win)
        for dom in sorted(papers):
            if dom not in pat:
                detail[name][dom] = {"points": 0, "missing": win_qs, "error": True}
                ok = False
                continue
            # absent quarter inside a covered window == zero count (GROUP BY count)
            missing = [q for q in win_qs if q not in pat[dom]]
            detail[name][dom] = {"points": len(win_qs), "zero_filled": missing}
    return ok, detail


def build_series(
    papers: dict, patents: dict, winp: tuple, winpat: tuple
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray], dict[str, tuple]]:
    """Aligned growth series per domain.

    Returns (paper_growth, patent_growth, meta) where each growth array is
    indexed by the quarter at which the observation is formed (t), and meta
    maps domain -> (first_t, last_t, n_points).
    """
    p_qs = quarter_list(*winp)
    pat_qs = set(quarter_list(*winpat))
    # common observation quarters: t must have t and t-7 available in both,
    # since S_t uses t-3..t and S_{t-4} uses t-7..t-4.
    inter = [q for q in p_qs if q in pat_qs]
    idx = {q: i for i, q in enumerate(inter)}

    def roll_log_growth(raw: dict[tuple[int, int], int]) -> dict[tuple[int, int], float]:
        """g_t needs raw values for t-7..t. Reconstruct the full quarter axis
        from the union of both windows so the rolling sums see real neighbours."""
        out: dict[tuple[int, int], float] = {}
        for t in inter:
            i = idx[t]
            if i < 7:
                continue
            win_now = inter[i - 3: i + 1]
            win_prev = inter[i - 7: i - 3]
            if len(win_now) != ROLL or len(win_prev) != ROLL:
                continue
            s_t = sum(raw.get(q, 0) for q in win_now)
            s_p = sum(raw.get(q, 0) for q in win_prev)
            out[t] = float(np.log((s_t + 1) / (s_p + 1)))
        return out

    pg: dict[str, np.ndarray] = {}
    qg: dict[str, np.ndarray] = {}
    meta: dict[str, tuple] = {}
    for dom in sorted(papers):
        g_p = roll_log_growth(papers[dom])
        g_q = roll_log_growth(patents.get(dom, {}))
        shared = sorted(set(g_p) & set(g_q))
        if len(shared) < 3:
            continue
        pg[dom] = np.array([g_p[t] for t in shared], dtype=float)
        qg[dom] = np.array([g_q[t] for t in shared], dtype=float)
        meta[dom] = (shared[0], shared[-1], len(shared))
    return pg, qg, meta


# --------------------------------------------------------------------------
# statistics
# --------------------------------------------------------------------------
def safe_corr(a: np.ndarray, b: np.ndarray) -> float:
    """Pearson r, 0.0 when either input is constant or too short."""
    if len(a) < 3 or len(b) < 3:
        return 0.0
    if np.std(a) == 0 or np.std(b) == 0:
        return 0.0
    r = float(np.corrcoef(a, b)[0, 1])
    return 0.0 if not np.isfinite(r) else r


def lag_curve(p: np.ndarray, q: np.ndarray, max_lag: int = MAX_LAG) -> np.ndarray:
    """r for k = 0..max_lag, pairing paper[t] with patent[t+k]."""
    out = np.zeros(max_lag + 1)
    n = len(p)
    for k in range(max_lag + 1):
        if n - k < 3:
            out[k] = np.nan
            continue
        out[k] = safe_corr(p[: n - k], q[k:])
    return out


def circular_shift(a: np.ndarray, shift: int) -> np.ndarray:
    return np.roll(a, shift)


def perm_pvalue(
    p: np.ndarray, q: np.ndarray, observed: float, rng: np.random.Generator,
    n_perm: int = N_PERM,
) -> float:
    """p = share of circular shifts with max-over-k r >= observed max r."""
    n = len(q)
    count = 0
    for _ in range(n_perm):
        shift = int(rng.integers(1, n)) if n > 1 else 0
        curve = lag_curve(p, circular_shift(q, shift))
        stat = np.nanmax(curve) if np.any(np.isfinite(curve)) else 0.0
        if stat >= observed:
            count += 1
    return (count + 1) / (n_perm + 1)


def per_domain(pg: dict, qg: dict, meta: dict, rng: np.random.Generator) -> dict:
    out: dict[str, dict] = {}
    for dom in pg:
        curve = lag_curve(pg[dom], qg[dom])
        finite = np.isfinite(curve)
        best_k = int(np.nanargmax(curve)) if finite.any() else None
        obs = float(curve[best_k]) if best_k is not None else 0.0
        p = perm_pvalue(pg[dom], qg[dom], obs, rng)
        out[dom] = {
            "n_points": int(meta[dom][2]),
            "first_t": f"{meta[dom][0][0]}Q{meta[dom][0][1]}",
            "last_t": f"{meta[dom][1][0]}Q{meta[dom][1][1]}",
            "curve": [None if not np.isfinite(v) else round(float(v), 6) for v in curve],
            "best_lag": best_k,
            "best_r": round(obs, 6),
            "perm_p": round(float(p), 6),
            "significant_05": bool(p < 0.05),
            "low_confidence": dom in LOW_CONFIDENCE,
        }
    return out


def pooled_curve(pg: dict, qg: dict) -> tuple[np.ndarray, list[str]]:
    """Mean of per-domain correlation curves over z-scored growth series.

    Z-scoring a series is affine, so r is unchanged; it is applied as specified
    and keeps the per-domain curves on a common scale.
    """
    curves = []
    used = []
    for dom in pg:
        p = pg[dom]
        q = qg[dom]
        if np.std(p) == 0 or np.std(q) == 0:
            continue
        pz = (p - p.mean()) / p.std()
        qz = (q - q.mean()) / q.std()
        c = lag_curve(pz, qz)
        if np.any(np.isfinite(c)):
            curves.append(c)
            used.append(dom)
    if not curves:
        return np.full(MAX_LAG + 1, np.nan), []
    return np.nanmean(np.vstack(curves), axis=0), used


def bootstrap_pooled(pg: dict, qg: dict, rng: np.random.Generator,
                     n_boot: int = N_BOOT) -> dict:
    doms = [d for d in pooled_curve(pg, qg)[1]]
    if not doms:
        return {"ok": False}
    # precompute per-domain curves once; resampling domains = resampling rows
    rows = []
    for d in doms:
        p, q = pg[d], qg[d]
        rows.append(lag_curve((p - p.mean()) / p.std(), (q - q.mean()) / q.std()))
    rows_a = np.vstack(rows)
    base = np.nanmean(rows_a, axis=0)
    best = int(np.nanargmax(base))

    boot_curves = np.empty((n_boot, MAX_LAG + 1))
    boot_best = np.empty(n_boot, dtype=int)
    n = len(doms)
    for b in range(n_boot):
        pick = rng.integers(0, n, n)
        c = np.nanmean(rows_a[pick], axis=0)
        boot_curves[b] = c
        boot_best[b] = int(np.nanargmax(c))
    lo = np.nanpercentile(boot_curves, 2.5, axis=0)
    hi = np.nanpercentile(boot_curves, 97.5, axis=0)
    lag_lo, lag_hi = np.percentile(boot_best, [2.5, 97.5])
    return {
        "ok": True,
        "n_domains": n,
        "curve": [round(float(v), 6) for v in base],
        "ci_lo": [round(float(v), 6) for v in lo],
        "ci_hi": [round(float(v), 6) for v in hi],
        "best_lag": best,
        "best_r": round(float(base[best]), 6),
        "best_lag_ci": [int(lag_lo), int(lag_hi)],
        "best_lag_boot_mode": int(np.bincount(boot_best, minlength=MAX_LAG + 1).argmax()),
        "peak_excludes_zero": bool(lo[best] > 0),
    }


def pooled_permutation(pg: dict, qg: dict, rng: np.random.Generator,
                       n_perm: int = N_PERM) -> float:
    """Independent circular shift per domain; statistic = pooled max-over-k r."""
    obs_curve, used = pooled_curve(pg, qg)
    if not used:
        return float("nan")
    observed = float(np.nanmax(obs_curve))
    rows = []
    for d in used:
        p, q = pg[d], qg[d]
        rows.append((p, q))
    count = 0
    for _ in range(n_perm):
        shifted = []
        for p, q in rows:
            s = int(rng.integers(1, len(q))) if len(q) > 1 else 0
            shifted.append(lag_curve(p, circular_shift(q, s)))
        stat = float(np.nanmean(np.vstack(shifted), axis=0).max())
        if stat >= observed:
            count += 1
    return (count + 1) / (n_perm + 1)


def placebo(pg: dict, qg: dict, rng: np.random.Generator,
            n_draw: int = N_PLACEBO) -> dict:
    """Pair each domain's papers with a different domain's patents."""
    doms = sorted(pg)
    if len(doms) < 2:
        return {"ok": False}
    obs_curve, _ = pooled_curve(pg, qg)
    obs_peak = float(np.nanmax(obs_curve))
    peaks = []
    for _ in range(n_draw):
        perm = rng.permutation(len(doms))
        # ensure no domain is paired with itself
        if any(perm[i] == i for i in range(len(doms))):
            perm = np.roll(perm, 1)
        mixed = {d: qg[doms[perm[i]]] for i, d in enumerate(doms)}
        c, _ = pooled_curve(pg, mixed)
        if np.any(np.isfinite(c)):
            peaks.append(float(np.nanmax(c)))
    peaks_a = np.array(peaks)
    return {
        "ok": True,
        "n_draws": len(peaks),
        "true_peak": round(obs_peak, 6),
        "placebo_mean_peak": round(float(peaks_a.mean()), 6),
        "placebo_p95_peak": round(float(np.percentile(peaks_a, 95)), 6),
        "placebo_max_peak": round(float(peaks_a.max()), 6),
        "exceeds_all_placebo": bool(obs_peak > peaks_a.max()),
        "empirical_p": round(float((peaks_a >= obs_peak).mean()), 6),
    }


def granger_per_domain(pg: dict, qg: dict) -> dict:
    """Optional: statsmodels Granger causality on differenced growth."""
    try:
        from statsmodels.tsa.stattools import grangercausalitytests
    except Exception as exc:  # pragma: no cover - optional dependency path
        return {"skipped": True, "reason": f"statsmodels unavailable: {exc}"}

    out: dict[str, dict] = {}
    for dom in sorted(pg):
        p = np.diff(pg[dom])
        q = np.diff(qg[dom])
        if len(p) < GRANGER_MAXLAG * 3:
            out[dom] = {"skipped": True, "reason": "too few observations"}
            continue
        try:
            data = np.column_stack([p, q])  # [target, predictor]
            res = grangercausalitytests(data, maxlag=GRANGER_MAXLAG, verbose=False)
            pvals = {int(k): float(v[0]["ssr_ftest"][1]) for k, v in res.items()}
            best = min(pvals, key=pvals.get)
            out[dom] = {"min_p": round(pvals[best], 6), "at_lag": best,
                        "significant_05": bool(pvals[best] < 0.05)}
        except Exception as exc:
            out[dom] = {"skipped": True, "reason": str(exc)[:120]}
    return out


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def run(seed: int = SEED) -> dict:
    rng = np.random.default_rng(seed)
    ok, comp = completeness_report()
    if not ok:
        raise SystemExit("completeness check failed; see report above")

    papers = load_papers()

    # PRIMARY
    grant = load_patents("grant")
    pg, qg, meta = build_series(papers, grant, PAPER_WINDOW, GRANT_WINDOW)
    primary = {
        "window_papers": "2008Q1-2025Q4",
        "window_patents": "2015Q1-2025Q4",
        "date_type": "grant",
        "per_domain": per_domain(pg, qg, meta, rng),
        "pooled": bootstrap_pooled(pg, qg, rng),
        "pooled_perm_p": round(float(pooled_permutation(pg, qg, rng)), 6),
        "placebo": placebo(pg, qg, rng),
        "granger": granger_per_domain(pg, qg),
    }

    # SECONDARY (filing) — pooled only, separate block
    filing = load_patents("filing")
    fpg, fqg, fmeta = build_series(papers, filing, PAPER_WINDOW, FILING_WINDOW)
    sensitivity = {
        "window_papers": "2008Q1-2025Q4",
        "window_patents": "2014Q1-2020Q4",
        "date_type": "filing",
        "note": "sensitivity only — pooled result; requires two transforms, so "
                "every point carries roughly 8 quarters of lookback",
        "pooled": bootstrap_pooled(fpg, fqg, rng),
        "pooled_perm_p": round(float(pooled_permutation(fpg, fqg, rng)), 6),
        "placebo": placebo(fpg, fqg, rng),
        "n_domains_used": len(fpg),
        "points_per_domain": {d: fmeta[d][2] for d in sorted(fmeta)},
    }

    return {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "paper_source": "OpenAlex API via data/papers/panel_quarterly.csv",
        "patent_source": "BigQuery patents-public-data via "
                         "data/patents/patent_quarterly.csv (CC BY 4.0)",
        "method": {
            "rolling_window_quarters": ROLL,
            "growth": "g_t = ln((S_t+1)/(S_t-4+1)) with S_t the 4-quarter sum",
            "lags_scanned": f"0..{MAX_LAG}",
            "permutations": N_PERM,
            "bootstrap_draws": N_BOOT,
            "placebo_draws": N_PLACEBO,
            "granger_maxlag": GRANGER_MAXLAG,
            "seed": seed,
        },
        "completeness": comp,
        "primary_grant": primary,
        "filing_sensitivity": sensitivity,
        "caveats": CAVEATS,
        "low_confidence_domains": list(LOW_CONFIDENCE),
    }
