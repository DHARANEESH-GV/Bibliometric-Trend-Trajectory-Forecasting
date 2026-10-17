# biblio-trend

**Technology observatory:** a $0-budget serverless pipeline tracking 20 technology domains across scientific papers (OpenAlex) and patents (USPTO Open Data Portal — PatentsView's replacement), classifying emerging/growing/maturing/declining trajectories, forecasting 1–3 years ahead with backtested classical models, and presenting results in a React dashboard.

> Full methodology and locked decisions: [`PROJECT_MASTER_PLAN.md`](PROJECT_MASTER_PLAN.md) (v3.1)

## Status

| Phase | Deliverable | State |
|---|---|---|
| 0 | Scaffold + 20-domain config | **in progress** |
| 1 | OpenAlex paper ingestion | not started |
| 2 | DuckDB preprocessing → 7 Parquet tables | not started |
| 3 | Bibliometric analytics | not started |
| 3.5 | Patent ingestion — *stop point: needs USPTO ODP key (ID.me verification)* | not started |
| 4 | Forecasting + emergence score + backtest | not started |
| 5 | Dashboard data contracts | not started |
| 6 | React dashboard | not started |
| 7 | AWS SAM stack — *stop point: needs credentials* | not started |

Pipeline code that exists runs **locally first** — no AWS deployment happens before explicit approval (§14 Human interaction points).

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
lambdas/    6 pipeline functions; container images where deps are heavy (DuckDB/PyArrow)
pipelines/  local_* entry points — everything runs locally before AWS
sql/ stats/ snapshots/ tests/ frontend/ reports/
```

## Data provenance

- **Data map & dictionary:** [`DATA.md`](DATA.md) — where every artefact lives (`raw/` → `staged/` → `data/` → `snapshots/`), real Parquet schemas, the dashboard JSON contracts, reproduction commands, and known limitations. Start here if a reviewer asks "where is the data?".
- **Papers:** OpenAlex works via `topics.id` filters — deterministic recall, no free-text search. All 20 topic-ID sets resolved and recall-checked live on 2026-09-19 (`reports/domain_validation.md`). Four domains carry documented taxonomy-scope notes (no dedicated OpenAlex topic exists: QEC, digital twins, solid-state batteries; AI anchored on "Neural Networks and Applications").
- **Patents:** USPTO Open Data Portal API (PatentsView's replacement since 2026-03-20), keyed by CPC classes per domain (Phase 3.5).

## Honesty gates (by design)

- Forecasts are persisted **only if** the chosen model beats the naive baseline on ≥60% of backtest series — otherwise the naive forecast *is* the persisted forecast.
- Emergence-score weights are configurable priors, never presented as derived constants; rank-stability analysis ships with the report.
- Sparse-coverage year ranges get an explicit label instead of plots.
