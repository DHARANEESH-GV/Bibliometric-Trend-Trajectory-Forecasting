"""Local Phase-1 fetch entry point (PROJECT_MASTER_PLAN.md §11).

Usage:
  python pipelines/local_fetch.py --domain quantum_computing \
      [--mode backfill|incremental|reconciliation] \
      [--range-start 2000-01-01 --range-end 2025-12-31] \
      [--max-pages N] [--max-records N]      # smoke dimensions

Defaults per locked decisions §4.1-1:
  backfill        → from_publication_date 2000-01-01 .. 2025-12-31
  incremental     → from_created_date: last successful run timestamp .. now
  reconciliation  → backfill semantics
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

from pipelines.openalex_client import DomainFetcher, OpenAlexClient, PoliteSleeper, RunLimits
from pipelines.state_store import StateStore

REPO = Path(__file__).resolve().parent.parent


def load_config() -> dict:
    return yaml.safe_load((REPO / "config" / "settings.yaml").read_text(encoding="utf-8"))


def load_domains() -> dict:
    raw = yaml.safe_load((REPO / "config" / "domains.yaml").read_text(encoding="utf-8"))
    return {d["domain_slug"]: d for d in raw["domains"]}


def incremental_range(state: dict | None) -> tuple[str | None, str | None]:
    """§4.1-1: re-fetch on from_created_date since last success → UTC now."""
    if not state or state.get("status") != "complete" or not state.get("last_run_timestamp"):
        return None, None
    start = state["last_run_timestamp"][:10]
    now = state and __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    return start, now[:10]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", required=True)
    ap.add_argument("--mode", choices=["backfill", "incremental", "reconciliation"], default="backfill")
    ap.add_argument("--range-start", default=None)
    ap.add_argument("--range-end", default=None)
    ap.add_argument("--max-pages", type=int, default=None)
    ap.add_argument("--max-records", type=int, default=None)
    ap.add_argument("--state-dir", default=str(REPO / ".state" / "pipeline_state"))
    ap.add_argument("--raw-dir", default=str(REPO / "raw" / "openalex"))
    args = ap.parse_args()

    cfg = load_config()["sources"]["openalex"]
    domains = load_domains()
    if args.domain not in domains:
        print(f"unknown domain: {args.domain}", file=sys.stderr)
        return 2
    dom = domains[args.domain]

    state_store = StateStore(Path(args.state_dir))
    state = state_store.get(args.domain)

    range_start, range_end = args.range_start, args.range_end
    if args.mode == "backfill" and range_start is None:
        range_start, range_end = "2000-01-01", "2025-12-31"
    elif args.mode == "incremental":
        range_start, range_end = incremental_range(state)

    limits = RunLimits(
        batch_size=int(cfg["batch_size"]),
        per_domain_record_cap=int(cfg["ingest"]["per_domain_record_cap"]),
        raw_bytes_cap_per_domain=int(cfg["ingest"]["raw_bytes_cap_per_domain"]),
        max_pages_per_run=args.max_pages,
        max_records_per_run=args.max_records,
    )
    polite_cfg = cfg.get("ingest", {})
    client = OpenAlexClient(polite=PoliteSleeper(floor_s=float(polite_cfg.get("polite_floor_s", 0.12))))
    fetcher = DomainFetcher(client, limits)

    manifest = fetcher.fetch_domain(
        domain=args.domain,
        topic_ids=[t.split("/")[-1] for t in dom["openalex_topic_ids"]],
        raw_dir=Path(args.raw_dir),
        state_store=state_store,
        mode=args.mode,
        range_start=range_start,
        range_end=range_end,
    )
    if manifest.exit_reason in ("next_cursor_null", "per_domain_record_cap", "raw_bytes_cap"):
        state_store.mark_complete(args.domain, manifest.run_id)
    print(json.dumps(json.loads(manifest.to_json()), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
