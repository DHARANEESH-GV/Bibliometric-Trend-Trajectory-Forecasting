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
| What is the contract of record? | `snapshots/{run_id}/` — the frontend reads only these. One run exists: `20260923T082601Z`. |
| What is committed to git? | `data/` (9 files) and `snapshots/` (24 files). `raw/` and `staged/` are **git-ignored** (large, regenerable). |
| How do I reproduce? | `make fetch && make normalize` then the `stats/` stages, or `make run` for all 20 domains. See §7. |
| Is it deployed to AWS? | No. Nothing has been deployed; everything runs locally. S3 layout below is the *target* mapping. |
| What are the known limitations? | §8 — sampled vs full-corpus domains, quarterly interpolation, snapshot citation proxy, no patents yet. |

Two facts a reviewer should absorb before trusting any number:

1. **Only one domain is full-corpus on disk.** `quantum_computing` is a complete
   walk (162,782 staged works, 6 fetch runs). The other 19 domains are
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

Six runs contributed staged data (`20260921T041642Z` … `20260921T070143Z`).
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
`patents` is Phase 3.5 (not started — no API key).

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

---

## 5. Dashboard contracts (`snapshots/`) — the product of record

`snapshots/{run_id}/` is what the frontend consumes; the frontend **never reads
Parquet**. One run exists: **`20260923T082601Z`** (24 JSON files).
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

### 5.6 `domains/{slug}.json`

`{_meta, display_name, annual{"2000": n,…}, forecast[], model, horizon[],
interval_68pct{"2026": [lo,hi],…}, score, label, provenance_note,
sample_stats, top_keywords[], caveat}`.

`provenance_note` states the coverage tier per domain:

- `quantum_computing` → `"full-corpus domain (every work walked, 814 pages)"`
- every other domain → `"sampled domain: drill-down lists from recent+top-cited 4k sample"`

`top_keywords[]` shape: `{name, total, bursts[{start, end, duration, strength,
years[]}]}`, top 15 by peak burst strength. May be `[]` (a real empty state).

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
.venv/bin/python stats/snapshots.py      # snapshots/{run_id}/*
```

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
6. **No patent data.** Phase 3.5 needs a USPTO Open Data Portal API key
   (USPTO.gov account + ID.me verification; the legacy PatentsView API was
   retired 2026-03-20 — `search.patentsview.org` is NXDOMAIN and old
   PatentsView keys are void). `patents` table, `raw/patents/`, and
   paper-to-patent lag analysis do not exist yet. Note: the ODP
   file-wrapper search returns bibliographic data only — **no patent
   abstracts** — so the plan's `patent_abstract` field is dropped.
7. **Fan-out tables are not year-partitioned** (they all sit under `year=2026`);
   use the joined `works` row for year filtering (see §3.2 note).
8. **A ~1-work drift** exists between the staged quantum corpus (162,782 rows)
   and the panel total (162,781) — recorded in
   `panel.json.metadata.live_drift_note` for 2025.
9. **Not deployed.** No AWS resources exist; the S3/DynamoDB layout is a target.

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
| What does the UI read? | `frontend/src/lib/types.ts` + `snapshots/{run_id}/` |
