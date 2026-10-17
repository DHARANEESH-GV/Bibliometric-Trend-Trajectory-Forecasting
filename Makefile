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

.PHONY: help venv fetch normalize aggregate trajectories bursts forecasts emergence stats snapshots samples validate-domains frontend test clean

help:
	@echo "make venv                     - create venv + install requirements"
	@echo "make domain DOMAIN=<slug>     - fetch+normalize+aggregate one domain"
	@echo "make stats                    - rebuild all data products (panel→scores)"
	@echo "make snapshots                - build dashboard snapshot JSON"
	@echo "make samples                  - tier-C drill-down samples (API-metered)"
	@echo "make validate-domains         - re-run domain validation (rate-limit aware)"
	@echo "make frontend                 - build the React dashboard"
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

stats: trajectories bursts forecasts emergence

samples:
	$(PY) scripts/tier_c_samples.py

validate-domains:
	$(PY) scripts/validate_domains.py

snapshots:
	$(PY) stats/snapshots.py

frontend:
	cd frontend && npm ci && npm run build

test:
	.venv/bin/pytest tests/ -q

clean:
	rm -rf .venv .pytest_cache frontend/dist
	find . -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null; true
