# biblio-trend

**Technology observatory:** a $0-budget pipeline tracking 20 technology domains across scientific papers (OpenAlex) and patents (Google BigQuery public patent data), classifying emerging/growing/maturing/declining trajectories, forecasting 1–3 years ahead with backtested classical models, and presenting results in a React dashboard. It currently runs locally; a serverless AWS deployment (Phase 7) is designed but not implemented.

> Full methodology and locked decisions: [`PROJECT_MASTER_PLAN.md`](PROJECT_MASTER_PLAN.md) (v3.1)

## Status

| Phase | Deliverable | State |
|---|---|---|
| 0 | Scaffold + 20-domain config | **done** |
| 1 | OpenAlex paper ingestion | **done** (19 domains sampled; `quantum_computing` full corpus) |
| 2 | DuckDB preprocessing → Parquet tables | **done** (6 of 7 specified tables exist) |
| 3 | Bibliometric analytics | **done** |
| 3.5 | Patent ingestion — Google BigQuery public patent data | **done** (USPTO ODP was **not** used; see below) |
| 4 | Forecasting + emergence score + backtest | **done** |
| 5 | Dashboard data contracts | **done** |
| 6 | React dashboard | **done** (7 views incl. Lag) |
| 7 | AWS SAM stack — *stop point: needs credentials* | **not started** |

Pipeline code runs **locally first** — nothing has been deployed to AWS, and no deployment happens before explicit approval (§14 Human interaction points).

`lambdas/` contains six empty placeholder folders (handler.py and Dockerfile are 0 lines) and template.yaml is empty. No AWS resources are deployed. The pipeline runs locally; Phase 7 is planned, not implemented.

## Lag result (paper growth vs patent grants)

Across 20 domains, growth in research papers shows a **weak association** with growth in granted patents, with the peak roughly **3 to 5 quarters later** (pooled correlation **0.23**). The **location** of the peak is stable under every robustness check, but its **statistical significance is fragile**.

Read this carefully:

- Individually, only **1 of 20** domains is significant, about what chance alone would produce. This is a **pooled signal**, not a per-domain finding.
- **Grant dates include patent examination time**, so this is not a research-to-invention lag. The k-quarter alignment absorbs administrative pendency.
- The 95% CI (0.08 to 0.40) is what you get **when resampling domains**, which assumes domains are independent — **they are not**. Under a **time-block bootstrap the interval (−0.13 to 0.28) includes zero**, and when the four low-confidence domains are dropped the **placebo test no longer separates the true pairing**. Treat this as **suggestive, not conclusive**.
- The filing-date series is reported separately as a sensitivity check only. It peaks at the edge of the scan (12 quarters) and does **not** beat cross-domain placebo pairing, so it is not used as corroboration.

Two further caveats that limit what any ranking in this repo can claim:

- **Nested domains are not independent.** `quantum_error_correction` is a CPC subset of `quantum_computing`, and `generative_ai` / `ai_agents` fall inside `artificial_intelligence`'s `G06N3/00` group. They are counted once per matched domain, so the pooled resampling treats correlated series as if they were separate draws.
- **One emergence-score component is constant across domains.** `momentum_intent` holds the same value (0.5) for all 20 domains, because the tier-C sample stats carry counts rather than a frontier share. It cannot reorder the leaderboard. **Because that component is inert, the rank-stability result shows insensitivity to the weights, not correctness of the weighting**: the ranking is stable, but a stable ranking is not evidence that the weights are right.

Full tables: [`data/lag/lag_results.json`](data/lag/lag_results.json). Dashboard view: `/lag`.

## Quick start

```bash
make venv                     # Python 3.12 virtualenv + requirements
make domain DOMAIN=quantum_computing    # one domain end-to-end
make test
```

## Layout

```
config/     domains.yaml (20 domains, live-validated OpenAlex topic IDs + CPC codes)
            settings.yaml (cadence, year gates, model + backtest settings, cost guardrails)
            score_weights.yaml (emergence score priors — tunable, sensitivity-analyzed)
scripts/    validate_domains.py (live OpenAlex topic-ID validator)
lambdas/    six empty placeholder folders; handler.py and Dockerfile are 0 lines
pipelines/  local_* entry points — everything runs locally before AWS
sql/ stats/ snapshots/ tests/ frontend/ reports/
```

`lambdas/` contains six empty placeholder folders (handler.py and Dockerfile are
0 lines) and template.yaml is empty. No AWS resources are deployed. The pipeline
runs locally; Phase 7 is planned, not implemented.

## Data provenance

- **Data map & dictionary:** [`DATA.md`](DATA.md) — where every artefact lives (`raw/` → `staged/` → `data/` → `snapshots/`), real Parquet schemas, the dashboard JSON contracts, reproduction commands, and known limitations. Start here if a reviewer asks "where is the data?".
- **Papers:** OpenAlex works via `topics.id` filters — deterministic recall, no free-text search. All 20 topic-ID sets resolved and recall-checked live on 2026-09-19 (`reports/domain_validation.md`). Four domains carry documented taxonomy-scope notes (no dedicated OpenAlex topic exists: QEC, digital twins, solid-state batteries; AI anchored on "Neural Networks and Applications").
- **Patents:** **Google BigQuery public patent data** (`patents-public-data.patents.publications`, CC BY 4.0), US grants keyed by CPC classes per domain, aggregated in the BigQuery sandbox. The USPTO Open Data Portal API was **not** used: its PatentsView replacement requires a passport-gated ID.me account, so the counts are computed upstream and only the ~500-row aggregate is downloaded.

## Honesty gates (by design)

- Forecasts are persisted **only if** the chosen model beats the naive baseline on ≥60% of backtest series — otherwise the naive forecast *is* the persisted forecast.
- Emergence-score weights are configurable priors, never presented as derived constants; rank-stability analysis ships with the report.
- Sparse-coverage year ranges get an explicit label instead of plots.
