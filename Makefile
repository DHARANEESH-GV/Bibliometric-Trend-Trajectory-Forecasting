# biblio-trend Makefile — local full-run targets (§11 Local development)
PY := .venv/bin/python
DOMAIN ?= quantum_computing

.PHONY: help venv fetch normalize aggregate score snapshots frontend domain run all clean

help:
	@echo "make venv                     - create venv + install requirements"
	@echo "make domain DOMAIN=<slug>     - fetch+normalize+aggregate+score one domain"
	@echo "make run                      - full 20-domain run"
	@echo "make validate-domains         - re-run domain validation (rate-limit aware)"
	@echo "make snapshots                - build dashboard snapshot JSON"
	@echo "make frontend                 - build the React dashboard"
	@echo "make test                     - pytest unit + data + backtest tests"

venv:
	python3.12 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r requirements.txt

fetch:
	$(PY) pipelines/local_fetch.py --domain $(DOMAIN) --source openalex

normalize:
	$(PY) pipelines/local_normalize.py --domain $(DOMAIN)

aggregate:
	$(PY) pipelines/local_aggregate.py --domain $(DOMAIN)

score:
	$(PY) pipelines/local_score.py --domain $(DOMAIN)

domain: fetch normalize aggregate score

run: domain
	$(PY) pipelines/local_run_all.py

validate-domains:
	$(PY) scripts/validate_domains.py

snapshots:
	$(PY) pipelines/local_snapshots.py

frontend:
	cd frontend && npm ci && npm run build

test:
	.venv/bin/pytest tests/ -q

clean:
	rm -rf .venv .pytest_cache frontend/dist
	find . -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null; true
