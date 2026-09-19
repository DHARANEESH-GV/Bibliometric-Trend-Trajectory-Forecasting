"""Local Phase-2 normalize entry point (PROJECT_MASTER_PLAN.md §11).

Usage:
  python pipelines/local_normalize.py --domain quantum_computing \
      [--run-id RUN_ID]      # default: latest run in raw/openalex/<domain>/
      [--raw-dir DIR] [--staged-dir DIR]

Reads raw/openalex/<domain>/<run_id>/batch_*.jsonl.gz, writes the 7-table
staged Parquet (partitioned domain+year, filename part-{run_id}), writes
the normalize report, honors year-gate quarantine.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))               # direct-CLI runs without PYTHONPATH

from pipelines.normalize import Normalizer  # noqa: E402


def latest_run(raw_domain_dir: Path) -> str | None:
    if not raw_domain_dir.exists():
        return None
    runs = sorted(p.name for p in raw_domain_dir.iterdir() if p.is_dir())
    return runs[-1] if runs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", required=True)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--raw-dir", default=str(REPO / "raw" / "openalex"))
    ap.add_argument("--staged-dir", default=str(REPO / "staged"))
    args = ap.parse_args()

    raw_domain_dir = Path(args.raw_dir) / args.domain
    run_id = args.run_id or latest_run(raw_domain_dir)
    if run_id is None:
        print(
            f"no runs found under {raw_domain_dir} — fetch first: "
            f"python pipelines/local_fetch.py --domain {args.domain}",
            file=sys.stderr,
        )
        return 2

    norm = Normalizer(Path(args.staged_dir))
    report = norm.normalize_domain(args.domain, raw_domain_dir / run_id, run_id)
    print(json.dumps(json.loads(report.to_json()), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
