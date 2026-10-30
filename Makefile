# biblio-trend Makefile — local run targets (§11 Local development)
#
# Data flow (matches DATA.md §"Where to look for provenance"):
#   fetch (raw/openalex) → normalize (staged parquet) → aggregate
#   (data/tier_a) → trajectories (panel.json) → bursts → forecasts
#   → emergence (scores) → samples → snapshots (dashboard JSON)
# tier_a.json is a source-aggregate data product; `aggregate` rebuilds
# drill-down samples + stats from it, the fetch walk rebuilds the corpus.
PY := .venv/bin/python
DOMAIN ?= quantum_computing

.PHONY: help venv fetch normalize aggregate trajectories bursts forecasts emergence patents stats snapshots samples validate-domains frontend test clean

help:
	@echo "make venv                     - create venv + install requirements"
	@echo "make domain DOMAIN=<slug>     - fetch+normalize+aggregate one domain"
	@echo "make stats                    - rebuild all data products (panel→scores)"
	@echo "make patents                  - regenerate BigQuery SQL + instructions"
	@echo "make patent-series            - build patent series (needs data/patents/patent_counts.csv)"
	@echo "make snapshots                - build dashboard snapshot JSON"
	@echo "make samples                  - tier-C drill-down samples (API-metered)"
	@echo "make validate-domains         - re-run domain validation (rate-limit aware)"
	@echo "make frontend                 - build the React dashboard"
	@echo "make deploy                   - build + publish to S3/CloudFront (needs AWS creds)"
	@echo "make deploy-fast              - publish the existing dist/ without rebuilding"
	@echo "make pipeline                 - deploy the AWS Batch pipeline stack (Fargate)"
	@echo "make pipeline-run             - submit a Batch job and follow its logs"
	@echo "make snapshots-pull           - pull the newest snapshot from S3 into the repo"
	@echo "make teardown                 - delete the AWS stack (prompts; empties bucket first)"
	@echo "make test-deploy              - dry-run the deploy/teardown scripts, no AWS calls"
	@echo "make test                     - pytest unit + data + backtest tests"

venv:
	python3.12 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r requirements.txt

fetch:
	$(PY) pipelines/local_fetch.py --domain $(DOMAIN)

normalize:
	$(PY) pipelines/local_normalize.py --domain $(DOMAIN)

aggregate:
	$(PY) pipelines/local_aggregate.py --domain $(DOMAIN)

domain: fetch normalize aggregate

trajectories:
	$(PY) stats/trajectories.py

bursts:
	$(PY) stats/bursts.py

forecasts:
	$(PY) stats/forecasts.py

emergence:
	$(PY) stats/emergence.py

patents:
	$(PY) scripts/gen_patent_query.py
	@echo "── human step ──────────────────────────────────────────────"
	@echo "1. Open https://console.cloud.google.com/bigquery (sandbox,"
	@echo "   free, no credit card — sign in with any Google account)."
	@echo "2. Paste sql/patent_counts.sql, run it, download CSV."
	@echo "3. Save as data/patents/patent_counts.csv, then: make patent-series"
	@echo "────────────────────────────────────────────────────────────"

patent-series:
	$(PY) stats/patents.py

stats: trajectories bursts forecasts emergence patents

samples:
	$(PY) scripts/tier_c_samples.py

validate-domains:
	$(PY) scripts/validate_domains.py

snapshots:
	$(PY) stats/snapshots.py

frontend:
	cd frontend && npm ci && npm run build

# ---- AWS static hosting (S3 + CloudFront, frontend only) -----------------
# The deploy script checks for the aws + sam CLIs and real credentials, and
# explains exactly what is missing rather than half-deploying. Teardown
# empties the bucket first, which is what actually returns the account to $0.
deploy:
	./scripts/deploy.sh

deploy-fast:
	./scripts/deploy.sh --skip-build

# ---- AWS Batch pipeline (the "produce" half, separate stack) -------------
# Runs the Python pipeline in Fargate. No Lambda (15-min timeout cannot hold
# a rate-limited multi-hour ingest), no NAT Gateway (public subnets).
pipeline:
	./scripts/deploy-pipeline.sh

pipeline-run:
	./scripts/run-pipeline.sh

snapshots-pull:
	./scripts/sync-snapshots.sh

teardown:
	./scripts/teardown.sh

test-deploy:
	./scripts/test-deploy-dryrun.sh

test:
	.venv/bin/pytest tests/ -q

clean:
	rm -rf .venv .pytest_cache frontend/dist
	find . -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null; true
