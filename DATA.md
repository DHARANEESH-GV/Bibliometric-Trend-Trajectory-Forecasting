# DATA.md — Data storage map & dictionary

For reviewers, auditors, or anyone handed this repository who needs to know
**where the data lives, what shape it is, and how to reproduce it**.

> Design authority: `PROJECT_MASTER_PLAN.md` §2 (constraints), §5 (flow), §10
> (storage layout), §15 (known limitations). This document describes what is
> **actually on disk** in this checkout, not the aspiration — where the two
> differ, the difference is called out.

---

## 0. TL;DR for a reviewer

| Question | Answer |
|---|---|
| Where is the data? | Local-first. Raw API responses in `raw/`, clean Parquet in `staged/`, analytics in `data/`, dashboard contracts in `snapshots/`. |
| What is the contract of record? | `snapshots/{run_id}/` — the frontend reads only these. Four runs exist; the latest is `20261029T094600Z`. |
| What is committed to git? | `data/` (12 files) and `snapshots/`. `raw/` and `staged/` are **git-ignored** (large, regenerable). |
| How do I reproduce? | `make fetch && make normalize` then the `stats/` stages, or `make run` for all 20 domains. See §7. |
| Is it deployed to AWS? | No. `lambdas/` contains six empty placeholder folders (handler.py and Dockerfile are 0 lines) and `template.yaml` is empty. No AWS resources are deployed. The pipeline runs locally; Phase 7 is planned, not implemented. The S3 layout below is the *target* mapping. |
| What are the known limitations? | §8 — sampled vs full-corpus domains, quarterly interpolation, snapshot citation proxy, patent coverage 2014-2025 with approximate CPC concordance. |

Two facts a reviewer should absorb before trusting any number:

1. **Only one domain is full-corpus on disk.** `quantum_computing` is a complete
   walk (162,782 staged works, 8 fetch runs). The other 19 domains are
   **sampled**: their annual counts come from the OpenAlex aggregate
   (`data/tier_a/tier_a.json`), and their drill-down lists come from a
   4,000-work sample each (`raw/samples/<domain>/`).
2. **Quarterly buckets are derived, not measured.** Annual counts are exact;
   intra-year quarters are equal-split interpolation (`stats/trajectories.py`).

---

## 1. Storage layers

The tree mirrors the planned S3 layout (`PROJECT_MASTER_PLAN.md` §10), with a
local-first naming convention.

```
raw/         verbatim API responses      (git-ignored)   ~373 MB
staged/      normalized Parquet tables   (git-ignored)   ~99 MB
data/        analytics JSON intermediates (tracked)      ~548 KB
snapshots/   dashboard contracts          (tracked)      ~332 KB
.state/      pipeline cursor/state        (git-ignored)
frontend/public/snapshots/  generated copy of the latest run (git-ignored)
```

| Layer | Path pattern | Tracked? | Produced by | Consumed by |
|---|---|---|---|---|
| Raw OpenAlex pages | `raw/openalex/{domain}/{run_id}/batch_*.jsonl.gz` | no | `pipelines/local_fetch.py` | normalize |
| Raw run manifest | `raw/openalex/{domain}/{run_id}/manifest.json` | no | fetch | provenance |
| Raw samples | `raw/samples/{domain}/recent.jsonl.gz`, `top_cited.jsonl.gz` | no | `scripts/tier_c_samples.py` | emergence score, drill-down |
| Sample stats | `raw/samples/tier_c_stats.json` | no | tier_c sampler | `stats/emergence.py`, `stats/snapshots.py` |
| Staged Parquet | `staged/{table}/domain={slug}/year={yyyy}/part-{run_id}.parquet` | no | `pipelines/local_normalize.py` | analytics |
| Normalize report | `staged/normalize_{domain}_{run_id}.json` | no | normalize | QA / this doc |
| Quarantine | `staged/staged_quarantine/domain={slug}/reason={reason}/part-{run_id}.parquet` | no | normalize | audit |
| Analytics JSON | `data/{trajectories,keywords,bursts,scores,forecasts}/` | **yes** | `stats/*.py` | snapshot build |
| Snapshots | `snapshots/{run_id}/…` | **yes** | `stats/snapshots.py` | React frontend |
| Pipeline state | `.state/pipeline_state/openalex#{domain}.json` | no | fetch | resume/idempotency |

### S3 mapping (target — not yet deployed)

Local prefix → S3 prefix, one-to-one: `raw/` → `raw/`, `staged/` → `staged/`,
`snapshots/` → `snapshots/`. Bucket name is not yet fixed. Lifecycle plan:
`raw/` expires after 90 days; `staged/` retained; `snapshots/` keep latest runs.

---

## 2. Raw layer (`raw/`)

### 2.1 Full-corpus domain — `quantum_computing`

```
raw/openalex/quantum_computing/{run_id}/
  batch_00001.jsonl.gz … batch_NNNNN.jsonl.gz   # one gzip file per API page (200 records)
  manifest.json                                  # query + accounting
```

Eight runs contributed staged data (`20260921T041642Z` … `20260921T070143Z`).
Each batch file is a JSONL stream of **verbatim OpenAlex `works` objects**, so
normalize is replayable without re-fetching.

`manifest.json` is the reproducibility artefact — it records the exact
`filter`, `select`, page/record/byte totals, mode, and start/finish timestamps:

```json
{
  "domain": "quantum_computing",
  "exit_reason": "max_pages_per_run",
  "mode": "backfill",
  "pages_fetched": 5,
  "records_fetched": 1000,
  "raw_bytes_total": 2108758,
  "query_semantics": {
    "filter": "topics.id:T10682,from_publication_date:2000-01-01,to_publication_date:2025-12-31",
    "per-page": "200",
    "select": "id,doi,title,publication_date,publication_year,cited_by_count,type,language,primary_location,authorships,abstract_inverted_index,topics,keywords,open_access,referenced_works"
  },
  "run_id": "20260921T041642Z",
  "source": "openalex"
}
```

### 2.2 Sampled domains — `raw/samples/`

19 domain directories, each with:

| File | Contents | Coverage |
|---|---|---|
| `recent.jsonl.gz` | 2,000 most-recently-published works (`publication_date:desc`) | per domain |
| `top_cited.jsonl.gz` | 2,000 most-cited works (`cited_by_count:desc`) | per domain |
| `tier_c_stats.json` | `{domain: {recent: n, top_cited: n}}` | 16 domains recorded |

`quantum_computing` is excluded from sampling (`scripts/tier_c_samples.py`)
because it has a full corpus. `generative_ai` and `ai_agents` have sample
directories but no `tier_c_stats.json` entry (the stats file predates those
runs) — their drill-down lists still render from the sample files.

Sample fields use the same `select` projection as the corpus fetch, so the
shape matches `raw/openalex/…`.

---

## 3. Staged layer (`staged/`) — Parquet tables

Seven tables are specified (`PROJECT_MASTER_PLAN.md` §Phase 2). Six exist;
`patents` does not — patent counts are computed in the BigQuery sandbox
instead (see §4.4; the ODP API key is passport-gated and the PatentsView
bulk TSVs exceed local disk).

Only `quantum_computing` is staged. The six tables below are the **real
schemas** read from the Parquet files, matching `WORKS_SCHEMA` et al. in
`pipelines/normalize.py`.

### `works` — 1:1 work records · 155 files, 162,782 rows, 0 duplicate `openalex_id`

| Column | Type | Meaning |
|---|---|---|
| `openalex_id` | string | OpenAlex work ID (primary key) |
| `doi` | string | Normalized DOI (lowercase, scheme/host stripped) |
| `title` | string | Work title |
| `publication_date` | string | ISO date |
| `publication_year` | int32 | Coerced year; range-gated 2000–2025 |
| `cited_by_count` | int32 | Snapshot citation count |
| `type` | string | OpenAlex work type |
| `language` | string | Language code |
| `primary_location_source` | string | Journal/venue source |
| `open_access_oa_status` | string | OA status |
| `domain_slug` | string | Owning domain |
| `run_id` | string | Fetch run that produced this row |
| `abstract` | string | Reconstructed from inverted index (§3.1) |
| `updated_datetime` | string | OpenAlex last-updated timestamp |

Partitioning: `domain={slug}/year={yyyy}`. Works are the one table partitioned
by **publication year**; the other five are partitioned under a single
`year={run_id[:4]}` placeholder (see §3.2).

### `work_authors` — 1:N via `authorships[]` · 8 files, 527,493 rows

| Column | Type | Meaning |
|---|---|---|
| `openalex_id` | string | FK → `works` |
| `author_id` | string | OpenAlex author ID |
| `author_position` | int32 | Ordinal: 0 first, 1 middle, 2 last |
| `author_position_raw` | string | Original string (`first`/`middle`/`last`) |
| `author_raw_name` | string | Author display name |
| `domain_slug` | string | Owning domain |

### `work_institutions` — N:M authorships → institutions · 8 files, 468,151 rows

| Column | Type | Meaning |
|---|---|---|
| `openalex_id` | string | FK → `works` |
| `author_id` | string | Author the institution is attached to |
| `institution_id` | string | OpenAlex institution ID |
| `institution_name` | string | Institution display name |
| `country_code` | string | ISO country code |
| `domain_slug` | string | Owning domain |

### `work_topics` — 1:N, retains topic score · 8 files, 464,489 rows

| Column | Type | Meaning |
|---|---|---|
| `openalex_id` | string | FK → `works` |
| `topic_id` | string | OpenAlex topic ID |
| `topic_name` | string | Topic display name |
| `topic_score` | float32 | Relevance score |
| `topic_rank` | int32 | Rank within the work's topic list |
| `domain_slug` | string | Owning domain |

### `work_keywords` — 1:N · 8 files, 1,937,224 rows

| Column | Type | Meaning |
|---|---|---|
| `openalex_id` | string | FK → `works` |
| `keyword_id` | string | OpenAlex keyword ID |
| `keyword_name` | string | Keyword display name |
| `keyword_score` | float32 | Relevance score |
| `domain_slug` | string | Owning domain |

### `work_refs` — 1:N citation edges · 8 files, 3,820,806 rows

| Column | Type | Meaning |
|---|---|---|
| `openalex_id` | string | Citing work |
| `referenced_work_id` | string | Cited work (edge target) |
| `domain_slug` | string | Owning domain |

### 3.1 Abstract reconstruction

OpenAlex stores abstracts as an inverted index `{word: [pos, …]}`.
`reconstruct_abstract()` flattens to `(pos, insertion_order, word)`, sorts
stably by position, and joins. Unreconstructable abstracts (missing/invalid
index) are counted, not invented — see `staged/normalize_*.json`
(`abstracts_reconstructed`, `abstracts_unreconstructable`).

### 3.2 Normalize report & quarantine

Each run writes `staged/normalize_{domain}_{run_id}.json`:

```json
{
  "records_in": 10582,
  "dedup_removed": 0,
  "year_quarantined": 0,
  "year_gated": 0,
  "abstracts_reconstructed": 8808,
  "abstracts_unreconstructable": 1774,
  "dois_normalized": 7534,
  "table_rows": {"works": 10582, "work_authors": 28107, "…": "…"}
}
```

Null or out-of-range publication years are written to
`staged/staged_quarantine/…` — **never silently dropped** (§Phase 2 hygiene).

> **Implementation note / reviewer caveat:** only `works` gets true per-year
> partitioning. The five fan-out tables use `year={run_id[:4]}` (i.e. `2026`)
> as a placeholder partition, per `pipelines/normalize.py`. They are not
> year-scannable today; source-of-truth year lives on the joined `works` row.

### 3.3 Hygiene rules applied

- Dedup on `openalex_id`, keep-first by `updated_datetime` (0 removed in the
  current corpus — the walk produced no duplicates).
- DOI normalization: lowercase, strip `https://doi.org/`.
- Year coercion with `publication_date` fallback; gate to 2000–2025.
- Abstract reconstruction (above).

---

## 4. Analytics layer (`data/`) — tracked JSON

These are the intermediate products between staged Parquet and the dashboard.
They are small and versioned in git.

### 4.1 Tier model (provenance vocabulary)

| Tier | Meaning | Corpus | Where |
|---|---|---|---|
| **A** | Exact annual counts from the source aggregate, 20 domains × 2000–2025 | all 20 | `data/tier_a/tier_a.json` |
| **B** | Per-keyword annual counts (drill-down keywords) | 19 | `data/keywords/tier_b.json` |
| **C** | Bounded work samples (recent + top-cited) for intent/provenance | 16 recorded, 19 on disk | `raw/samples/tier_c_stats.json` |

`raw/trajectories/` holds byte-identical copies of the tier-A/tier-B files;
`data/` is the copy the analytics stages read.

### 4.2 File inventory

| File | Shape | Notes |
|---|---|---|
| `data/tier_a/tier_a.json` | `{slug: {display_name, by_year: {"2000": n, …}}}` | 20 domains, exact source aggregate. Sum = 5,474,269 works. |
| `data/trajectories/panel.json` | `{slug: {display_name, annual, quarterly (104), total_works, metadata}}` | Adds derived quarterly buckets + provenance metadata. |
| `data/trajectories/summary.json` | `{generated, domains, panel_total_works, trajectory[]}` | Compact per-domain growth summary. |
| `data/keywords/tier_b.json` | `{slug: {display_name, keywords: {kw_id: {name, total, by_year}}}}` | 19 domains. |
| `data/bursts/keyword_bursts.json` | tier_b + `bursts[]`, `n_years`, `method` | Kleinberg 2-state Viterbi per keyword. |
| `data/bursts/domain_bursts.json` | `{slug: {bursts[], n_years, method}}` | Domain-level bursts (from tier A). |
| `data/scores/emergence.json` | `{weights, caps, hysteresis, leaderboard[]}` | Score config + ranked panel. |
| `data/forecasts/forecasts.json` | `{horizon, gate, forecasts}` | Point + 68% interval forecast per domain. |
| `data/forecasts/backtest.json` | `{train_end, targets, gate, per_series}` | Per-series MAE/RMSE/sMAPE/directional. |
| `data/patents/patent_counts.csv` | `{domain, year, patents}` CSV | BigQuery result (human-downloaded; see §4.4). |
| `data/patents/patent_quarterly.csv` | `{domain, date_type, year, quarter, patents}` CSV | Quarterly BigQuery aggregate; `date_type` is `filing` or `grant`. Absent quarters are real zeros (GROUP BY COUNT emits no row). |
| `data/patents/patent_series.json` | `{_meta, domains{}, paper_patent_crosswalk{}}` | Patent series + annual lag test (superseded; see §4.4). |
| `data/papers/panel_quarterly.csv` | `{domain, year, quarter, papers}` CSV | Measured quarterly papers, 20 domains × 72 quarters (2008Q1–2025Q4). |
| `data/lag/lag_results.json` | `{method, primary_grant{per_domain, pool, placebo, granger, series}, filing_sensitivity, robustness}` | Quarterly lag analysis + robustness block. |
| `data/scores/rank_stability.json` | `{baseline_weights, all_weights, effective_weights, summary_line}` | ±30% weight-perturbation sweep, 500 draws. |

### 4.3 Key structures

**`data/scores/emergence.json`** — weights are tunable priors, not derived
constants (`config/score_weights.yaml`):

```json
{
  "weights": {"growth_recent": 0.30, "acceleration": 0.20,
               "keyword_burst": 0.20, "volume_scaled": 0.15,
               "momentum_intent": 0.15},
  "caps": {"growth_recent": 1.0, "acceleration": 0.5, "keyword_burst": 0.6,
            "volume_scaled": 1.0, "momentum_intent": 1.0},
  "hysteresis": {"emerge_in": 70.0, "emerge_out": 55.0,
                  "plateau_growth": 0.05, "plateau_exit": 0.12},
  "leaderboard": [
    {"rank": 1, "domain_slug": "generative_ai", "display_name": "Generative AI",
     "label": "Emerging", "score": 90.19,
     "inputs": {"growth_recent": 1.0, "acceleration": 1.0, "keyword_burst": 1.0,
                 "volume_scaled": 0.8463, "momentum_intent": 0.5},
     "notes": ["2025 count flagged: search-term sensitivity"]}
  ]
}
```

**`data/forecasts/forecasts.json`** — the honesty gate lives in `gate`;
`gate_failed: true` means the persisted series *is* the naive baseline:

```json
{
  "horizon": [2026, 2027, 2028],
  "gate": {"hw_damped": {"beats_naive_share": 0.8, "gate_passed": true, "wins": 16, "series": 20},
            "drift":     {"beats_naive_share": 0.8, "gate_passed": true, "wins": 16, "series": 20},
            "pooled":    {"beats_naive_share": 0.05, "gate_passed": false, "wins": 1, "series": 20}},
  "forecasts": {
    "quantum_computing": {
      "model": "hw_damped", "gate_failed": false, "train_through": 2025,
      "forecast": [21428, 24251, 27059],
      "interval_68pct": {"2026": [17000, 25857], "2027": [19823, 28679], "2028": [22631, 31487]},
      "resid_sigma": 4428.12,
      "horizon": [2026, 2027, 2028]
    }
  }
}
```

**`data/forecasts/backtest.json` `per_series`** — metrics per domain per model:

```json
{"advanced_semiconductors": {
   "naive":     {"mae": 1414,    "rmse": 1650.16, "smape": 0.0587, "directional": 0.5},
   "drift":     {"mae": 712.79,  "rmse": 770.69,  "smape": 0.0294, "directional": 0.5},
   "hw_damped": {"mae": 1576.93, "rmse": 2069.15, "smape": 0.0639, "directional": 0.75},
   "pooled":    {"mae": 23235.29,"rmse": 23246.87,"smape": 1.8305, "directional": 0.25}}}
```

### 4.4 Patents — the BigQuery sandbox workaround (Phase 3.5)

The plan's Phase 3.5 (USPTO ODP API) is **not implementable here**: the ODP
API key requires ID.me identity verification, which for international
users without an SSN/ITIN is passport-gated; and the PatentsView bulk TSVs
(~1 GB zipped, ~10 GB unpacked for the three needed tables) exceed local
disk. The workaround computes the counts **in Google's copy of the data**
and downloads only the aggregate:

| Step | Actor | Artifact |
|---|---|---|
| 1. Generate SQL from `config/domains.yaml` CPC rules | `make patents` → `scripts/gen_patent_query.py` | `sql/patent_counts.sql` |
| 2. Run in BigQuery sandbox (free, no credit card, 1 TB scanned/month) | human, ~10 min | query result (~240 rows) |
| 3. Download result as CSV | human | `data/patents/patent_counts.csv` |
| 4. Validate + coverage-gate + lag analysis | `make patent-series` → `stats/patents.py` | `data/patents/patent_series.json` |
| 5. Snapshot wiring | `make snapshots` (reads `patent_series.json` when present) | `snapshots/{run_id}/` |

**Source:** `patents-public-data.patents.publications` (Google Patents
Public Data, CC BY 4.0, updated quarterly). US granted patents only
(`country_code='US'`, `kind_code LIKE 'B%'`), counted by **grant year**.

### Measured coverage boundaries (2026-10-29)

Two properties of the source, established by direct probe rather than
assumption. Both change what the series may claim:

| Finding | Evidence | Consequence |
|---|---|---|
| **Year 2000 is unusable** | 265 US grants recorded for 2000 vs 166,034 for 2001 | Series starts later; 2000 is `null`, never `0` |
| **CPC coverage starts 2014 for some sections** | `H01L` (semiconductors) returns 1 patent for 2005 and 24,241 for 2015. Identical counts for spaced, unspaced and trimmed code variants — so it is a coverage property, not a join bug | Series window is **2014–2025**; every domain is continuous from 2014 |
| **CPC population is 100% where present** | `pct_with_cpc = 100.0` for every year 2001–2025 | Within the covered window, a missing row really is a zero grant |

Pre-2014 years are stored as `null` ("no data"), never `0`. A zero would
claim no patents were granted, which the source cannot support.

**Grant-lag cutoff.** Patents are granted 1–3 years after filing, so the
most recent grant years are structurally incomplete — AI patents fall
18,746 → 17,768 → 15,788 across 2023–2025 purely from ungranted filings.
The displayed series runs to 2025 with that truncation labelled.

**Lag windows (quarterly analysis).** The primary quarterly series uses
**grant dates, 2015Q1–2025Q4**; the filing-date series is a sensitivity
check over **2014Q1–2020Q4** and is pooled-only. The two are never mixed.

**Concordance (deterministic, documented):** a configured CPC code with
subgroup `00` (e.g. `G06N3/00`) matches every leaf in its group
(`G06N3/xx`); a specific subgroup (e.g. `G06N3/08`) matches only itself.
A patent matching several domains counts **once per matched domain**
(multi-membership). Known overlaps are parent/child pairs: QEC
(`G06N10/70`) ⊂ quantum_computing (`G06N10/00`) — consistent with the
existing twin-series caveat — and generative_ai / ai_agents leaves ⊂
artificial_intelligence's `G06N3/00` group.

### Paper-to-patent lag: what the data actually supports

#### Annual lag test (superseded, kept for provenance)

The original Phase 3.5 test correlated **annual year-over-year growth** with
only 8 usable growth points per domain, scanning 9 lags. It reported 5/20
domains at p ≤ 0.10 with only `edge_computing` surviving Bonferroni
(α = 0.005), and concluded that a general pattern was not established. That
test was **underpowered by construction** and has been superseded by the
quarterly analysis below; `paper_patent_crosswalk` and `lag_panel_test` remain
in `patent_series.json` as provenance.

#### Quarterly lag result (current, 2026-10-29)

Correlating raw **levels** is meaningless: both series trend upward, so r sits
near 0.99 at every shift. The quarterly analysis therefore uses 4-quarter
rolling sums and year-over-year log growth
`g_t = ln((S_t+1)/(S_t−4+1))`, then scans lags 0–12.

**Primary series:** grant dates, patents 2015Q1–2025Q4, papers 2008Q1–2025Q4.
**Sensitivity series:** filing dates, 2014Q1–2020Q4, pooled only. Never mixed.

| Result | Value |
|---|---|
| Pooled best lag | **5 quarters** (bootstrap 95% CI 3–5) |
| Pooled correlation | **0.23** (95% CI 0.08–0.40, **resampling domains**) |
| Pooled permutation p | **0.010** |
| Domains significant individually | **1 / 20** (≈ 1 expected by chance) |
| Placebo (cross-domain mismatch) | true peak 0.23 vs placebo max 0.19, p = 0.000 |

The **location** of the peak is stable under every robustness check, but its
**statistical significance is fragile**. The headline 95% CI (0.08 to 0.40) is
what you get **when resampling domains, which assumes domains are independent —
they are not**. Under a **time-block bootstrap the interval (−0.13 to 0.28)
includes zero**, and when the four low-confidence domains are dropped the
**placebo test no longer separates the true pairing** (true 0.226 vs placebo
max 0.240). Treat this as **suggestive, not conclusive**.

Robustness (see `robustness` in `lag_results.json`):

| Check | Peak lag | r | CI excludes 0 | Peak in 3–6 |
|---|---|---|---|---|
| Baseline (20 domains) | 5 | 0.23 | yes | yes |
| Leave-one-domain-out | 4–5 | 0.20–0.26 | yes (all 20) | yes |
| Drop nested (17 domains) | 4 | 0.27 | yes | yes |
| Drop low-confidence (16 domains) | 4 | 0.23 | **fails placebo** | yes |
| Time-block bootstrap (8q blocks) | 5 | 0.08 | **no** (−0.13 to 0.28) | yes |

Two dependence caveats bound what this can claim:

- **Nested domains are not independent.** `quantum_error_correction` ⊂
  `quantum_computing`, and `generative_ai` / `ai_agents` ⊂
  `artificial_intelligence`'s `G06N3/00` group. Patents matching several
  domains count once per domain, so the domain bootstrap resamples correlated
  series as if they were independent.
- **One emergence-score component is constant across domains.**
  `momentum_intent` is 0.5 for all 20 domains because the tier-C stats carry
  counts, not a frontier share. It cannot reorder the leaderboard; see
  `data/scores/rank_stability.json`, which reports the 4 effective weights
  separately. **Because that component is inert, the rank-stability result
  shows insensitivity to the weights, not correctness of the weighting**: a
  stable ranking is not evidence that the weights are right.

Grant dates include examination pendency, so this is **not** a
research-to-invention lag.

The filing-date sensitivity check peaks at 12 quarters, the edge of the scan,
and does **not** beat cross-domain placebo pairing (p = 0.63). It is reported
for completeness and is not used as corroboration.

**`data/patents/patent_series.json`** shape:

```json
{
 "_meta": {"generated_utc": "...", "source": "BigQuery patents-public-data...",
            "query": "sql/patent_counts.sql", "years": [2000, 2025],
            "patent_year_min": 2014, "caveat": "CPC-to-domain concordance..."},
 "domains": {
   "quantum_computing": {
     "display_name": "Quantum Computing",
     "annual": {"2000": null, "2013": null, "2014": 20, "2025": 775},
     "covered_years": [2014, 2025],
     "total": 3696, "peak_year": 2025,
     "metadata": {"source": "...", "basis": "US granted patents (kind B*) by grant year",
                   "coverage": "2014-2025; earlier years are null because the source has no usable CPC classification before 2014",
                   "concordance": "CPC group/subgroup rules; multi-membership",
                   "caveat": "..."}}},
 "paper_patent_crosswalk": {
   "quantum_computing": {"papers_peak_year": 2025, "patents_peak_year": 2025,
                          "best_lag_years": 1, "best_lag_r": 0.103,
                          "permutation_p": 0.931, "at_scan_boundary": false,
                          "underpowered": false, "significant": false,
                          "lag_scan": [{"lag": -3, "r": 0.41, "n": 8, "powered": true}, "..."],
                          "lag_window": [2014, 2024], "min_pairs_required": 7,
                          "lag_basis": "year-over-year growth correlation; p from a 2000-shuffle permutation of the best-lag statistic",
                          "papers_total": 162781, "patents_total": 3696}},
 "lag_panel_test": {"domains_tested": 20, "domains_significant": 5,
                     "alpha_per_domain": 0.1, "expected_false_positives": 2.0,
                     "binomial_p_at_least_k": 0.0432, "bonferroni_alpha": 0.005,
                     "survive_bonferroni": ["edge_computing"],
                     "verdict": "A majority-lead pattern is not established..."}}
```

Inside the covered window a missing year is a **real zero of the
concordance** (no CPC-matched grant), while pre-2014 years are `null`.
The concordance itself is approximate (plan §15): CPC boundaries do not
align cleanly with human domain categories. Grant-year basis means recent
years undercount relative to papers' publication-year basis; the last
three grant years are truncated by grant lag and the lag analysis excludes
them.

When `patent_counts.csv` is absent, `make stats` still succeeds and
snapshots simply carry papers only (`patents: null` in domain files, no
`patents` key in trajectory points).

---

## 5. Dashboard contracts (`snapshots/`) — the product of record

`snapshots/{run_id}/` is what the frontend consumes; the frontend **never reads
Parquet**. Latest run: **`20261029T094600Z`** (26 JSON files, including
`lag.json` and `rank_stability.json`).
`frontend/src/lib/types.ts` documents the same contracts in TypeScript.

### 5.1 Envelope

Every file carries an identical `_meta`:

```json
{"generated_utc": "2026-09-23T08:26:01.597752+00:00",
 "run_id": "20260923T082601Z",
 "lineage": {
   "trajectories": "data/tier_a + panel.json (annual exact, quarterly derived)",
   "scores": "stats/emergence.py (weights in data/scores/emergence.json)",
   "forecasts": "stats/forecasts.py (gated; see backtest.json gate)",
   "bursts": "stats/bursts.py (Kleinberg 2-state)",
   "samples": "raw/samples (2k recent + 2k top-cited per domain)"}}
```

### 5.2 `leaderboard.json`

`{_meta, gate, leaderboard[]}` — `gate` is verbatim from `backtest.json`.
Each entry: `rank, domain, display_name, label, emergence_score, score_inputs
{growth_recent, acceleration, keyword_burst, volume_scaled, momentum_intent},
yoy_delta, sparkline[24], sparkline_years[2020,2025], forecast_next3[],
forecast_model, caveat, notes[]`.

`sparkline` is 24 points = six years (2020–2025) × four equal-split quarters.

### 5.3 `trajectories.json`

`{_meta, domains[]}`; each domain: `domain, display_name, train_through,
model_gate, series[]`. A series point:

```json
{"year": 2000, "works": 14536, "forecast": null}
{"year": 2028, "works": null, "forecast": 24243, "lower": 20987, "upper": 27499, "model": "hw_damped"}
```

Actuals carry `works` 2000–2025; the forecast tail (2026–2028) carries
`forecast` + 68% `lower`/`upper`.

### 5.4 `bursts.json`

`{_meta, feed[]}` — the keyword-burst feed, recent-first. Each:
`domain, keyword, start, end, duration, strength, years[]`. No before/after
frequencies exist on disk; `strength` + `duration` are the intensity signals.

### 5.5 `matrix.json`

`{_meta, years[2000..2025], domains[], cells{slug: [n_per_year]}, tail{slug:
{label, score}}}` — the domain × year heatmap plus the lifecycle tail.

### 5.5b `lag.json` and `rank_stability.json`

`lag.json` is a reshape of `data/lag/lag_results.json`; the `/lag` view renders
only from it and recomputes nothing in the browser.

`{_meta, windows{papers, patents, date_type}, method, caveats[],
pooled{curve[13], ci_lo[13], ci_hi[13], best_lag, best_r, best_lag_ci,
n_domains, perm_p, peak_excludes_zero}, placebo{true_peak,
placebo_mean_peak, placebo_p95_peak, placebo_max_peak, exceeds_all_placebo,
empirical_p, n_draws}, counts{n_domains, n_significant}, domains[{domain,
display_name, best_lag, best_r, perm_p, significant_05, low_confidence,
n_points, curve, series{quarters[], papers_z[], patents_z[]}}],
robustness{baseline, leave_one_domain_out{per_drop[], summary},
drop_nested, drop_low_confidence, time_block_bootstrap},
filing_sensitivity{...}}`

`rank_stability.json` carries the weight-perturbation sweep.
`leaderboard.json` embeds the same block under `rank_stability` so the
leaderboard can print its one summary line without a second request.

### 5.6 `domains/{slug}.json`

`{_meta, display_name, annual{"2000": n,…}, forecast[], model, horizon[],
interval_68pct{"2026": [lo,hi],…}, score, label, provenance_note,
sample_stats, top_keywords[], caveat}`.

`provenance_note` states the coverage tier per domain:

- `quantum_computing` → `"full-corpus domain (every work walked, 814 pages)"`
- every other domain → `"sampled domain: drill-down lists from recent+top-cited 4k sample"`

`top_keywords[]` shape: `{name, total, bursts[{start, end, duration, strength,
years[]}]}`, top 15 by peak burst strength. May be `[]` (a real empty state).

When the run carries a patent series, domain files also carry
`patents: {annual{"2000": n,…}, total, peak_year, caveat}` (null
otherwise), and `trajectories.json` points carry `patents` per year plus
`patents_total` / `patents_caveat` per domain (§4.4).

### 5.7 Frontend handoff

`frontend/scripts/copy-snapshots.mjs` copies the **lexicographically-latest**
`snapshots/{run_id}/` directory into `frontend/public/snapshots/` and writes
`frontend/public/snapshots-run.json` at predev/prebuild. `public/snapshots/` is
generated and git-ignored; `snapshots/{run_id}/` in the repo root is the
committed source.

---

## 6. Pipeline state (`.state/`)

`.state/pipeline_state/openalex#{domain}.json` holds the cursor /
last-run bookkeeping used for idempotent incremental fetch
(`pipelines/state_store.py`). Regenerable; safe to delete.

---

## 7. Reproducing the data

```bash
make venv                       # Python 3.12 venv + requirements
make domain DOMAIN=quantum_computing   # fetch + normalize one domain
make test                       # unit + data + backtest tests
```

Full analytics + snapshot chain (after staged data exists):

```bash
.venv/bin/python stats/trajectories.py   # data/trajectories/*
.venv/bin/python stats/bursts.py         # data/bursts/*
.venv/bin/python stats/emergence.py      # data/scores/emergence.json
.venv/bin/python stats/forecasts.py      # data/forecasts/*
.venv/bin/python stats/patents.py        # data/patents/* (needs patent_counts.csv, §4.4)
.venv/bin/python stats/snapshots.py      # snapshots/{run_id}/*
```

Or via make: `make stats` (runs all of the above; the patents step prints
the BigQuery instructions when the CSV is absent).

Then serve the dashboard (`cd frontend && npm run live`), which copies the
latest snapshot into `public/snapshots/`.

> The sampled domains' tier-A/tier-B counts are produced by an OpenAlex
> aggregate walk recorded in `data/tier_a/tier_a.json` and
> `data/keywords/tier_b.json`. The generator script for those aggregates is
> not present in this checkout (the files are committed); the quantum
> full-corpus path *is* fully reproduced by the `make` targets above.

---

## 8. Known limitations (read before citing numbers)

Carried from `PROJECT_MASTER_PLAN.md` §15 and extended with what this checkout
actually contains:

1. **Sampled vs full corpus.** 19 of 20 domains are sampled (aggregate counts +
   4k-work drill-down lists); only `quantum_computing` is a complete walk.
   `provenance_note` in each `domains/{slug}.json` states which.
2. **Quarterly buckets are interpolated.** Annual counts are exact; intra-year
   quarters are an equal split. Growth/acceleration math uses annual deltas, so
   interpolation does not touch the emergence score.
3. **`cited_by_count` is a snapshot proxy.** No citation-*timing* data;
   recent buckets are citation-lag-biased by construction.
4. **Emergence weights are tunable priors**, not empirically derived. See the
   rank-stability sensitivity sweep in `config/score_weights.yaml`.
5. **Forecasts are gated, not free.** A domain uses the naive baseline if the
   model fails the ≥60% beats-naive gate (`gate_failed`).
6. **Patent coverage is 2014–2025 only, and the concordance is approximate.**
   The ingest path is a workaround (§4.4): the USPTO ODP key is
   passport-gated and PatentsView bulk exceeds local disk, so counts come
   from the BigQuery sandbox against the Google Patents Public Data mirror
   (CC BY 4.0), with only the aggregate downloaded. Two measured source
   limits shape what the series may claim: Google's mirror holds 265 US
   grants for 2000 (vs ~166k in 2001), and CPC classification for several
   sections (notably H01L semiconductors) is absent before 2014. Pre-2014
   years are therefore `null`, not `0`, and the window is 2014–2025.
   Further: CPC↔domain concordance is approximate (over/under-count);
   counts are US grants by **grant year** (the last three years are
   truncated by grant lag); multi-membership means parent/child series
   overlap (QEC ⊂ quantum_computing; genAI/ai_agents ⊂ AI). No patent
   abstracts, assignees, or record-level paper→patent linkage exist, and
   the paper-to-patent lag test (§4.4) finds a detectable relationship in
   only 1 of 20 domains after multiple-comparison correction — a general
   papers-lead-patents pattern is not established.
7. **Fan-out tables are not year-partitioned** (they all sit under `year=2026`);
   use the joined `works` row for year filtering (see §3.2 note).
8. **A ~1-work drift** exists between the staged quantum corpus (162,782 rows)
   and the panel total (162,781) — recorded in
   `panel.json.metadata.live_drift_note` for 2025.
9. **Not deployed.** `lambdas/` contains six empty placeholder folders (handler.py
   and Dockerfile are 0 lines) and `template.yaml` is empty. No AWS resources are
   deployed. The pipeline runs locally; Phase 7 is planned, not implemented. The
   S3/DynamoDB layout is a target mapping.

---

## 9. Where to look for provenance

| Question | File |
|---|---|
| Which OpenAlex topic IDs define each domain? | `config/domains.yaml` |
| How were they validated as fully-recalling? | `reports/domain_validation.md`, `reports/domain_validation_pass1.md` |
| What query produced a raw batch? | `raw/openalex/{domain}/{run_id}/manifest.json` |
| What did normalize accept/reject? | `staged/normalize_{domain}_{run_id}.json` |
| How was a score computed? | `stats/emergence.py` + `data/scores/emergence.json` |
| How was a forecast gated? | `stats/forecasts.py` + `data/forecasts/backtest.json` |
| Where do patent counts come from? | `sql/patent_counts.sql` + `data/patents/patent_counts.csv` → `stats/patents.py` (§4.4) |
| What does the UI read? | `frontend/src/lib/types.ts` + `snapshots/{run_id}/` |
