# MASTER PROJECT PLAN v3.1
## Data-Driven Bibliometric Trajectory Analysis and Technology Trend Prediction using Cloud-Based Big Data Pipelines

**Local path:** `/home/vampgvd/biblio-trend/`
**Budget:** $0 / free-tier-safe
**Build agent:** OpenCode + GLM-5.3-Flash via Hive
**Status:** plan locked — ready to execute Phase 0

> **v3.1 merges v2.3 and v3.0.** Where the two conflicted, §4.1 records which won and why. Do not silently revert those four decisions.

---

## 1. One-liner

A budget-free serverless AWS pipeline tracking **20 technology domains** across scientific papers (OpenAlex) and patents (USPTO ODP — PatentsView's replacement since 2026-03-20), detecting which are emerging, growing, maturing, or declining, forecasting 1–3 years ahead with backtested models, and presenting results in a React dashboard.

The output is not just a dashboard — it's a **technology observatory**.

**What makes it capstone-grade is not data volume** (~1.4M records is mid-scale). It's the parts that are hard at any scale: forecasts validated against naive baselines, science→patent transfer lag analysis, cost-engineered IaC, and reproducibility.

### Questions the system answers
1. Which technologies are rising, declining, emerging, mature?
2. What happens over the next 1–3 years?
3. How quickly do papers convert into patents?
4. Which countries/institutions/authors lead each domain?
5. Which domains should researchers, investors, or policymakers watch?

---

## 2. Hard constraints

### Budget
- No paid APIs. No Scopus/Web of Science. No expensive AWS services.
- Weekly batch, never hourly. Budget alert at $1. One-command teardown required.
- **If any action may incur cost: stop, explain, propose a free alternative, wait for approval.**

### Technical
- Python 3.12, container-image Lambdas where deps are heavy, DuckDB for analytics, Parquet for staged data.
- DynamoDB **scalar-only** serving items — no large arrays, respect the 400KB item limit.
- Step Functions for orchestration. **No S3-event-storm architectures.**
- Immutable Parquet naming: `part-{run_id}`. Reserved concurrency = 4.

---

## 3. AWS services

| Purpose | Service |
|---|---|
| Orchestration | Step Functions (Map state) |
| Scheduling | EventBridge Scheduler |
| Raw + staged storage | S3 |
| Processing | Lambda container images (python3.12, arm64 Graviton ~20% cheaper) |
| Query engine | DuckDB (in-Lambda — **no Athena dependency**) |
| Serving metadata | DynamoDB (PAY_PER_REQUEST) |
| API | API Gateway HTTP API (~70% cheaper than REST, CORS-native) |
| Frontend hosting | S3 + CloudFront + OAC (private origin, no public ACLs) |
| Container registry | ECR |
| Cost controls | AWS Budgets |

**Avoided:** Redshift · EMR · RDS · OpenSearch · SageMaker endpoints · QuickSight · NAT Gateway · ALB · Kinesis · Athena · long-running EC2

> **Watch ECR's free tier (500MB/month).** Container-image Lambdas push layers to ECR; iterating on Dockerfiles can quietly exceed it. This meter didn't exist in the earlier Lambda-zip design.

---

## 4. Locked architecture decisions

| Decision | Final choice |
|---|---|
| Orchestration | Step Functions Map state |
| Ingestion cadence | **Incremental weekly on `from_created_date` + monthly full reconciliation** |
| Year range | **2000–2025** |
| Paper source | OpenAlex (topic IDs, not free-text search) |
| Patent source | USPTO Open Data Portal (PatentsView retired 2026-03-20) |
| Processing engine | DuckDB in container-image Lambdas |
| Staged storage | Parquet on S3, **partitioned by domain + year**, filename `part-{run_id}` |
| Serving DB | DynamoDB, scalar-only |
| API | API Gateway HTTP API |
| Frontend | React 18 + Vite + TypeScript + ECharts |
| Forecasting | Holt-Winters damped, optional ARIMA, naive + drift baselines |
| Burst detection | In-house Kleinberg 2-state Viterbi |
| Score weights | Tunable priors in `config/score_weights.yaml` |
| Cost guardrails | $1 budget alert, lifecycle rules, reserved concurrency 4, teardown script |

### 4.1 Four conflicts between v2.3 and v3.0 — resolved

**1. Crawl cadence → incremental + monthly reconciliation wins.**
v3.0 specified weekly full snapshot re-crawls. That's correct but wasteful: it re-fetches the same thousands of papers every week at a 10 req/s ceiling. The actual problem it solves — papers with old publication dates that OpenAlex indexes *late* — is solved by filtering on `from_created_date` (the indexing timestamp) rather than `from_publication_date`. Weekly incremental on `from_created_date` plus a **monthly** full reconciliation pass gets identical correctness at a fraction of the request volume and Lambda runtime.

**2. Year range → 2000–2025 wins.**
v3.0's preprocessing section says "gate years to configured range, usually 2010–2025." The backfill to 2000 was already decided: it's a free config change that takes series from 64 to ~104 quarterly points, materially strengthening seasonality tests and AIC-based ARIMA order selection. Spot-check 2–3 domains first — newer topics (AI agents, quantum error correction) may have thin pre-2010 signal, which is what the sparse-data honesty label exists for.

**3. Parquet partitioning → domain + year wins; run_id goes in the filename only.**
v3.0 writes `staged/works/domain={d}/run_id={r}/part-{r}.parquet`. Partitioning by `run_id` destroys the year-based partition pruning that makes later scans cheap, and creates a new directory per run forever. Correct form keeps year as a partition key and run_id as the filename discriminator:
```
staged/works/domain={slug}/year={yyyy}/part-{run_id}.parquet
```
This preserves pruning *and* prevents concurrent-write clobbering, which was the original reason for run-scoped naming.

**4. UI copy → sentences, not middle-dot strings. — REVOKED 2026-10-07.**
v3.0 reintroduced `Data through 2025-Q3 · refreshed weekly`, `Holt-Winters damped, trained 2010–2021 · 94% directional accuracy`, and `Emerging · 6 quarters`. Middle-dot-joined meta strings are a recognized generated-UI tell. Same information, written as sentences:
- `Snapshot from Q3 2025, refreshed every Monday`
- `Trained on 2000–2021 data; correctly called direction 94% of the time`
- `Emerging, held 6 quarters`

> This decision was revoked on 2026-10-07: all UI/design constraints were removed from the plan at the user's request ahead of a full UI redesign. UI copy is now unconstrained.

---

## 5. System flow

```
OpenAlex API                          USPTO ODP API (X-API-KEY)
     ↓                                        ↓
Fetch Lambda                          Fetch Patents Lambda
     ↓                                        ↓
raw/openalex/…/batch_*.jsonl.gz       raw/patents/…/batch_*.json.gz
     ↓                                        ↓
     └──────────→ Normalize Lambda (DuckDB) ←─┘
                          ↓
              staged/*.parquet (7 tables)
                          ↓
                 Aggregate Lambda (DuckDB)
                          ↓
                quarterly trajectories
                          ↓
          Score / Forecast / Burst Lambda
                          ↓
              DynamoDB + snapshot JSON
                          ↓
                  Read API Lambda
                          ↓
                 React Dashboard
```

**Orchestration:**
```
EventBridge Schedule
     ↓
Step Functions state machine
     ↓
Create run_id
     ↓
Map over 20 domains (reserved concurrency 4)
   ├─ Fetch papers
   ├─ Fetch patents
   ├─ Normalize
   └─ Aggregate
     ↓
Global score + forecast + backtest
     ↓
Snapshot generation
     ↓
Finish
```

The Map state is what avoids the 15-minute Lambda timeout a single 20-domain loop would hit.

---

## 6. Technology domains

Twenty domains, defined in `config/domains.yaml`:

1. Artificial Intelligence
2. Generative AI
3. AI Agents
4. Quantum Computing
5. Quantum Error Correction
6. Solid-State Batteries
7. Clean Hydrogen
8. Carbon Capture
9. Synthetic Biology
10. Brain-Computer Interfaces
11. Cybersecurity
12. Blockchain
13. Internet of Things
14. Edge Computing
15. Digital Twins
16. Smart Manufacturing
17. Autonomous Vehicles
18. Space Technologies
19. Advanced Semiconductors
20. Biotechnology

Each entry:
```yaml
- domain_slug: quantum_computing
  display_name: Quantum Computing
  openalex_topic_ids:
    - "T12345"
  patent_cpc_codes:
    - G06N10/00
    - G06N10/20
    - G06N10/40
  description: "Computing systems using quantum-mechanical phenomena."
```

Domain scoping uses **OpenAlex `topics.id` sets**, not free-text search — deterministic recall.

---

## 7. Build phases

| Phase | Deliverable |
|---|---|
| 0 | Scaffold: venv, deps, 20-domain config, README, folder tree |
| 1 | Paper ingestion (OpenAlex): pagination, JSONL.gz, manifests + tests |
| 2 | Preprocess: DuckDB → 7 Parquet tables, dedup, abstract reconstruction |
| 3 | Bibliometrics: trends, keywords, bursts, networks, country ranks |
| 3.5 | Patent ingestion + CPC↔domain concordance + paper-vs-patent trajectories |
| 4 | Forecasting, emergence score, maturity labels, backtest, rank-stability |
| 5 | Dashboard data contracts (snapshot JSON + API shapes) |
| 6 | React SPA |
| 7 | SAM stack |
| 8 | Deploy + verify + teardown |
| 9 | Final report |

---

### Phase 0 — Scaffold

```
/home/vampgvd/biblio-trend/
├── README.md
├── PROJECT_MASTER_PLAN.md
├── Makefile
├── requirements.txt
├── .env.example
├── .gitignore
├── template.yaml
├── config/
│   ├── domains.yaml
│   ├── settings.yaml
│   └── score_weights.yaml
├── lambdas/
│   ├── fetch_openalex/
│   ├── fetch_patents/
│   ├── normalize/
│   ├── aggregate/
│   ├── score/
│   └── read_api/
├── pipelines/
│   ├── local_fetch.py
│   ├── local_normalize.py
│   ├── local_aggregate.py
│   └── local_score.py
├── sql/
├── stats/
├── snapshots/
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── components/
│   │   ├── charts/
│   │   ├── views/
│   │   ├── styles/
│   │   ├── lib/
│   │   └── App.tsx
│   └── public/
├── tests/
├── reports/
└── scripts/
    ├── deploy.sh
    ├── teardown.sh
    └── empty_bucket.sh
```

**Done when:** scaffold exists, venv works, config files exist, README explains the project, no AWS deployment yet.

---

### Phase 1 — Paper ingestion (OpenAlex)

`GET https://api.openalex.org/works`

- **Cursor pagination:** `cursor=*` → opaque base64 `meta.next_cursor`. Keyset pagination, O(1) per page, no offset drift under concurrent writes.
- **Field projection** cuts payload ~10×:
  `select=id,doi,title,publication_date,publication_year,cited_by_count,type,language,primary_location,authorships,abstract_inverted_index,topics,keywords,open_access,referenced_works`
- **Polite pool:** `mailto` param + User-Agent → 10 req/s vs 1 anonymous, edge-cached responses.
- Batch size 200. Write to `raw/openalex/{domain}/{run_id}/batch_{n:05d}.jsonl.gz` — object-per-page, atomic PUTs, no partial-object risk.
- **Idempotency:** cursor + `last_run_timestamp` in DDB `pipeline_state` (PK=`{source}#{domain}`), conditional update with version attribute → safe against concurrent invocations.
- Exit: `next_cursor == null` ∨ per-domain record cap.
- Manifest per run: query, record count, byte totals, sync timestamp.
- **Resilience:** OpenAlex 5xx → exponential backoff with jitter. Raw S3 is preserved so normalize is replayable without re-fetching.

**Done when:** client works, pagination works, checkpointing works, files compressed, manifest written, tests cover pagination + failure handling.

---

### Phase 2 — Normalization

**Abstract reconstruction:** inverted index `{word: [pos,...]}` → flatten to (pos, word) pairs, stable sort by position (positions may repeat → tie-break on insertion order), join. O(total tokens).

**Entity fan-out — 7 tables:**

| Table | Cardinality |
|---|---|
| `works` | 1:1 |
| `work_authors` | 1:N via `authorships[]` |
| `work_institutions` | N:M through authorships → institutions |
| `work_topics` | 1:N, retains `topics[i].score` |
| `work_keywords` | 1:N |
| `work_refs` | 1:N from `referenced_works` → citation edges |
| `patents` | Phase 3.5 |

**Hygiene:** dedup on `openalex_id` (keep-first by `updated_datetime`) · DOI normalization (lowercase, strip `https://doi.org/`) · year coercion + range gate 2000–2025 · null-year quarantine.

**Write path:** PyArrow → Parquet (zstd, dictionary-encoded strings):
```
staged/{table}/domain={slug}/year={yyyy}/part-{run_id}.parquet
```

**Done when:** tables exist, duplicates removed, abstracts reconstructed, partitioning correct, zstd-compressed, data dictionary generated.

---

### Phase 3 — Bibliometric analytics

Per domain per quarter:
```
paper_count               = count(*)
patent_count
citation_count            = Σ cited_by_count   -- snapshot proxy
unique_author_count       = ndistinct(author_id)
unique_institution_count
unique_country_count
new_author_count          -- authors not seen in prior buckets
growth_rate_qoq           = (c_t − c_t-1) / (c_t-1 + ε)
citation_momentum
```

Outputs: `analysis/trajectories.parquet`, `top_keywords`, `keyword_bursts`, `top_papers`, `top_authors`, `top_institutions`, `top_countries`.

Analyses: publication trajectory · citation trajectory · top keywords · keyword bursts · topic evolution · country/institution/author rankings · **sparse data detection** · lifecycle classification.

---

### Phase 3.5 — Patent ingestion

**Human interaction point #1:** free USPTO Open Data Portal (ODP) API key.
**Source migration (2026-03-20):** the legacy PatentsView API
(`search.patentsview.org`) was retired into USPTO's ODP — the old host is
NXDOMAIN and PatentsView keys are void. ODP key requires a USPTO.gov
account **plus ID.me identity verification**; stored in `.env` as
`USPTO_ODP_API_KEY`, sent as `X-API-KEY` to `https://api.uspto.gov`.
Rate model: ~5M metadata calls/week, **one in-flight call per key**
(concurrency with the same key is blocked), 429 → wait ≥5 s.
**Field change:** ODP file-wrapper search returns bibliographic data only
— **no `patent_abstract`**. That field is dropped from the schema; noted
in §Limitations.

Fields collected (ODP file-wrapper search — bibliographic only, no abstract):
```
patent_id, patent_title, patent_date,
patent_year, patent_quarter, assignee_organization,
assignee_country, cpc_codes, domain_slug, run_id
```

Output: `raw/patents/{domain}/{run_id}/batch_*.json.gz` → `staged/patents/domain={d}/year={y}/part-{run_id}.parquet`

**Done when:** client works, CPC concordance exists, records fetched, quarterly patent counts exist, paper-vs-patent comparison possible.

---

### Phase 4 — Forecasting and scoring

**Models:**
- **Holt-Winters damped trend** (additive, damped φ) via `statsmodels.ExponentialSmoothing` — primary.
- **ARIMA(p,d,q)** auto-order (min AIC over p,q∈{0..2}, d∈{0,1}; KPSS/ADF for stationarity) where n≥40 and variance stabilizes under log1p.
- **Baselines:** naive persistence, drift.
- Horizon 4–8 quarters, prediction intervals from Gaussian state-space residual variance.

**Forecast output per domain:**
```
domain, quarter, actual_value, forecast_value,
forecast_lower, forecast_upper, model_used
```

**Burst detection:** Kleinberg 2-state automaton (baseline rate q₀ vs burst rate q₁; cost = −ln P(series|state) + γ·ln n transition penalty), in-house Viterbi. Fallback for short series: `(recent+1)/(hist_avg+1)`.

**Emergence score** — components min-max normalized across the 20-domain panel:
```
S = 0.35·g + 0.25·c + 0.20·ν + 0.20·b

g = QoQ growth of last 2 buckets (damped)
c = citation acceleration = (ȳ_recent − ȳ_prior)/(ȳ_prior + ε)
ν = novelty = 1{first_bucket ≥ T−8q}, scaled by ramp slope
b = burst contribution (0 if none)
```

```yaml
# config/score_weights.yaml
score_weights:
  growth: 0.35
  citation_momentum: 0.25
  novelty: 0.20
  burst: 0.20
```

> **These are tunable priors, not derived constants.** Phase 4 includes a **rank-stability sensitivity analysis** measuring how far the leaderboard moves under weight perturbation.

**Lifecycle classification:** rule cascade on (growth sign, growth magnitude, volume percentile within panel) → {emerging, growth, maturity, decline}, **with hysteresis** — requires 2 consecutive opposing buckets to flip, preventing label flapping.

**Backtesting:** rolling-origin, expanding window. Train to 2021-Q4, target 2022-Q1…2024-Q4. Metrics: MAE, RMSE, sMAPE (over MAPE — near-zero denominators), directional accuracy.

> **Honesty gate:** the model is reported only if it beats naive on **≥60% of series**. Otherwise **the persisted forecast IS the baseline forecast.** Results → `models/backtest_results.csv`, feeding the report's confidence claims.
>
> **Methodology footnotes bind to real output:** any methodology footnote shown in the UI must be generated from this Phase 4 backtest output — never placeholder copy.

---

### Phase 5 — Dashboard data contracts

The frontend never queries Parquet directly. It consumes:
```
snapshots/{run_id}/leaderboard.json
snapshots/{run_id}/trajectories.json
snapshots/{run_id}/bursts.json
snapshots/{run_id}/matrix.json
snapshots/{run_id}/domains/{domain}.json
```

**`leaderboard.json`:**
```json
[
  {
    "rank": 1,
    "domain": "ai_agents",
    "display_name": "AI Agents",
    "stage": "emerging",
    "stage_held_quarters": 6,
    "emergence_score": 92.4,
    "yoy_delta": 0.87,
    "patent_signal": true,
    "sparkline": [12, 18, 25, 41, 66, 94]
  }
]
```

**`trajectories.json`:**
```json
[
  {
    "domain": "quantum_computing",
    "series": [
      { "quarter": "2018-Q1", "papers": 320, "patents": 40, "forecast": null },
      { "quarter": "2026-Q1", "papers": null, "patents": null,
        "forecast": 1210, "forecast_lower": 1050, "forecast_upper": 1390 }
    ]
  }
]
```

Snapshots versioned by `run_id`. API read shapes documented alongside.

---

### Phase 6 — React dashboard

Stack: React 18 · Vite · TypeScript · ECharts · React Router · CSS custom properties. No heavy UI framework, no Redux — state is **URL search params + a ~30-line context store**.

Hydration: bulk fetch of `snapshots/*.json` (single round-trip for page shell) + incremental API fetches for drill-down/search.

**UI structure and visual design are unconstrained** (constraints removed 2026-10-07 ahead of a full redesign). The only surviving requirements are functional: the frontend consumes the Phase 5 snapshot JSON contracts, and the methodology footnote under charts must bind to real Phase 4 backtest output — never placeholder copy.

---

## 8. UI/UX specification — REVOKED

**All UI/design constraints in this section were removed on 2026-10-07** at the user's request, ahead of a full UI redesign. The previous editorial-style specification (design tokens, 5-view IA, chart craft rules, motion rules, banned-pattern lists) no longer applies. UI structure and visual design are unconstrained.

Surviving requirements (functional, not aesthetic):
- The frontend consumes the Phase 5 snapshot JSON contracts.
- The methodology footnote under charts must bind to real Phase 4 backtest output — never placeholder copy.
- Sparse-coverage data gets an explicit label instead of plots presented as meaningful.

---

## 9. Why classical forecasting, not deep learning

The deciding fact is **series length, not budget**. Quarterly buckets 2000–2025 = ~104 points. That ceiling is set by calendar time — no budget buys more quarterly history, because 2010 only happened once. LSTM/transformer forecasting wants orders of magnitude more.

What the budget *does* constrain: breadth (20 domains × capped records vs the full 250M-paper corpus), retention, crawl frequency, no GPU cluster. It does not force the statistical method.

State this in the report as **consistent with published forecasting-competition findings on short univariate series** — not as a settled verdict, since M4/M5 had ML and hybrid methods place well in several tracks.

### Free scale upgrades (ranked)
1. **Backfill to 2000** — locked in. ~104 points/series. Spot-check 2–3 domains first for thin pre-2010 signal.
2. **Pooled/global model benchmark** — highest payoff, add in Phase 4 as an extra backtest row. One model cross-learning across all 20 series turns "we used ARIMA because data was small" into "we tested whether pooling changes that conclusion." Trivial compute at this size, no GPU.
3. **Monthly buckets for the 5–6 highest-volume domains** — optional Phase 6 polish. Caution: monthly counts are noisy (indexing lag varies month to month; small buckets destabilize growth ratios — 3→6 papers reads as a 100% burst). Keep quarterly as the primary backtested signal; monthly is supplementary resolution only.

---

## 10. Storage layout

```
s3://{bucket}/
├── raw/
│   ├── openalex/{domain}/{run_id}/batch_*.jsonl.gz + manifest.json
│   └── patents/{domain}/{run_id}/batch_*.json.gz  + manifest.json
├── staged/
│   ├── works/domain={d}/year={y}/part-{run_id}.parquet
│   ├── work_authors/…      ├── work_topics/…
│   ├── work_institutions/… ├── work_keywords/…
│   ├── work_refs/…         └── patents/…
├── snapshots/{run_id}/
│   ├── leaderboard.json  ├── trajectories.json
│   ├── bursts.json       ├── matrix.json
│   └── domains/{domain}.json
└── frontend/
```

**Lifecycle:** `raw/` expires after 90d · `staged/` retained (~10:1 compression vs raw) · `snapshots/` keep latest few runs

### DynamoDB tables (PAY_PER_REQUEST, TTL on state rows)

**`pipeline_state`** — PK=`source#domain`
`cursor, last_run_id, last_run_timestamp, status, record_count, version`

**`trajectories`** — PK=`domain`, SK=`quarter` (ISO, lexicographic = chronological)
`paper_count, patent_count, citation_count, unique_author_count, growth_rate_qoq, stage`
GSI: quarter-only for cross-domain scans. Scalar values only.

**`scores`** — PK=`domain`, SK=`as_of`
`emergence_score, rank, growth_component, citation_component, novelty_component, burst_component, stage, stage_held_quarters`
GSI: as_of-only for "current panel" query.

**`bursts`** (optional) — PK=`domain#keyword`, SK=`start_quarter`
`burst_strength, duration, frequency_before, frequency_after`

### Lambda functions

| Function | Memory | Container? | Responsibilities |
|---|---|---|---|
| `fetch_openalex` | 256 MB | no | Paginate, save JSONL.gz, persist cursor, write manifest |
| `fetch_patents` | 256 MB | no | Query USPTO ODP (X-API-KEY, single-flight), map CPC→domain, save batches |
| `normalize` | 1024 MB | **yes** | Clean, reconstruct abstracts, fan out entities, write Parquet |
| `aggregate` | 1024 MB | **yes** | DuckDB over Parquet, quarterly trajectories, keyword metrics, top entities |
| `score` | 1024 MB | **yes** | Forecast, bursts, emergence score, lifecycle, backtest |
| `read_api` | 256 MB | no | Serve leaderboard, trajectories, drill-down, search |

### API routes
```
GET /topics
GET /trajectories/{domain}
GET /scores?as_of=latest
GET /search?q=          (prefix scan over topics GSI)
GET /drilldown/{domain} (in-Lambda DuckDB over staged Parquet, cached in DDB)
```

---

## 11. Local development

Everything runs locally before any AWS deployment.

```bash
cd /home/vampgvd/biblio-trend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Per-domain:
```bash
python pipelines/local_fetch.py --domain quantum_computing --source openalex
python pipelines/local_normalize.py --domain quantum_computing
python pipelines/local_aggregate.py --domain quantum_computing
python pipelines/local_score.py --domain quantum_computing
```

Full run:
```bash
make fetch && make normalize && make aggregate && make score && make snapshots && make frontend
```

---

## 12. Testing requirements

**Unit tests:** OpenAlex pagination · cursor persistence · abstract reconstruction · DOI normalization · CPC mapping · quarter assignment · emergence score normalization · DynamoDB item size safety

**Data tests:** no duplicate `openalex_id` · no null publication year in final works table · all quarters valid · forecast dates don't overlap actuals · score components in range · stage labels valid

**Backtest tests:** naive baseline exists · model-beats-naive threshold enforced · directional accuracy computed · sMAPE handles near-zero values

---

## 13. Cost guardrails

Before any AWS deployment:

- [ ] Free Tier limits reviewed
- [ ] AWS Budgets $1 alert created
- [ ] Free-tier usage alerts enabled
- [ ] Cost Explorer enabled
- [ ] All resources tagged
- [ ] S3 lifecycle policies configured
- [ ] Lambda reserved concurrency = 4
- [ ] EventBridge schedule weekly, not hourly
- [ ] ECR image count/size checked against 500MB free tier
- [ ] No NAT Gateway, RDS, Redshift, EMR, SageMaker endpoints
- [ ] Teardown script tested

```
Project     = biblio-trend
Environment = dev
CostCenter  = free-tier
```

**Teardown** (`./scripts/teardown.sh`): empty S3 bucket → delete SAM stack → delete ECR images → confirm resources removed. Returns account to true $0.

---

## 14. Human interaction points

Only two.

**1. USPTO ODP API key** — Phase 3.5. Requires a USPTO.gov account with
ID.me identity verification (not a 5-minute form). The legacy PatentsView
key/API was retired 2026-03-20. → `.env`:
```env
USPTO_ODP_API_KEY=your_key_here
```

**2. AWS credentials** — Phase 7. Before deploying, the agent must show: expected cost summary · resource list · free-tier usage estimate · teardown instructions. **Deploy only after explicit approval.**

---

## 15. Known limitations — state these explicitly in the final report

- **CPC↔domain concordance is approximate.** CPC boundaries don't align cleanly with human categories like "AI" or "quantum computing"; some domains will over- or under-count patents. Name this specifically in §Limitations — don't fold it into generic caveats.
- **`citation_count` is a snapshot proxy.** True citation timing requires joining refs to cited-work publication dates; recent buckets are citation-lag-biased by construction. The emergence score partly compensates by weighting growth/novelty over citation momentum for recent buckets.
- **Emergence score weights are priors**, not empirically derived. See the rank-stability analysis.
- **Forecasts are not certainties** — always presented with intervals and backtested error rates.
- **Pre-2010 coverage may be thin** for newer domains — hence the sparse-data honesty label.

---

## 16. Final report structure

```
1.  Executive Summary
2.  Dataset Description
3.  Data Sources
4.  Domain Definitions
5.  Bibliometric Trajectories
6.  Patent Trajectories
7.  Paper-to-Patent Lag Analysis
8.  Burst Detection Results
9.  Forecasting Methodology
10. Backtesting Results
11. Emergence Leaderboard
12. Limitations
13. Future Work
14. Cost Appendix
```

---

## 17. Definition of done

- [ ] Pipeline runs end to end, rerunnable from the README
- [ ] Paper + patent data collected, cleaned, deduped
- [ ] Trajectories, bursts, networks, rankings generated
- [ ] Forecasts generated, backtested, gated against naive baselines
- [ ] Dashboard renders from real data
- [ ] Tests pass (unit, data, backtest)
- [ ] AWS resources documented; `sam delete` returns account to $0
- [ ] Budget alert configured; no recurring compute active
- [ ] Final report with methodology, limitations, cost appendix

---

## Appendix A — OpenCode environment (already working)

- Installed via `npm install -g opencode-ai` (v1.18.30) after `npm config set prefix ~/.npm-global`
- Provider config in `opencode.json` at project root
- **Move the Hive key to `{env:HIVE_API_KEY}`**, `export HIVE_API_KEY=...` in `~/.bashrc`, and add `opencode.json` to `.gitignore` before this becomes a git repo
- Skip `/init` on empty folders; run it once real code exists
- Cost so far: ~$0.07 for ~1.5M tokens. Expect roughly **$8–$35** for the full build. Phase 3.5 (patents) and Phase 6 (dashboard) are the most expensive remaining phases — simplify or defer those first if budget tightens

## Appendix B — full handoff prompt

```
You are an autonomous AI engineer and data architect.

Execute the project in PROJECT_MASTER_PLAN.md.

Project: Data-Driven Bibliometric Trajectory Analysis and Technology
Trend Prediction using Cloud-Based Big Data Pipelines

Constraints:
- $0 budget / free-tier-safe.
- OpenAlex for papers (topic IDs, not free-text search).
- USPTO Open Data Portal for patents (PatentsView retired 2026-03-20).
- AWS serverless; Step Functions Map for orchestration.
- Container-image Lambdas for DuckDB/PyArrow/statsmodels.
- Parquet on S3, partitioned domain + year, filename part-{run_id}.
- DynamoDB scalar-only; respect the 400KB item limit.
- No S3 event storms.
- Incremental weekly crawl on from_created_date + monthly full
  reconciliation. Year range 2000-2025.
- Reserved concurrency 4.
- In-house Kleinberg 2-state Viterbi for burst detection.
- Tunable emergence score weights in config/score_weights.yaml.
- Backtested forecasting; report the model only if it beats naive on
  >=60% of series, otherwise persist the naive forecast.
- Do not deploy to AWS until the user provides credentials and approves
  a cost summary.
- Ask the user only for the USPTO ODP API key and AWS credentials.

Phases: 0 scaffold, 1 OpenAlex ingestion, 2 preprocessing, 3
bibliometrics, 3.5 patents, 4 forecasting/scoring/backtest, 5 data
contracts, 6 React dashboard, 7 SAM stack, 8 deploy/verify/teardown,
9 final report.

Local path: /home/vampgvd/biblio-trend/

Validate each phase before the next. Document all assumptions.
If any action may incur cost, stop and ask for approval.

Start with Phase 0.
```

## Appendix C — shortest restart prompt

```
Read PROJECT_MASTER_PLAN.md in /home/vampgvd/biblio-trend/ and execute
Phase 0. Create the repository scaffold, Python 3.12 environment,
requirements.txt, config/domains.yaml for 20 technology domains, README,
and folder structure. Do not deploy AWS resources. Do not use paid
services. Stop before Phase 3.5 and ask me for the USPTO ODP API key
(PatentsView was retired 2026-03-20; ODP needs ID.me verification).
Stop before Phase 7 and ask me for AWS credentials.
```
