#!/usr/bin/env python3
"""
entrypoint.py — the container's real entry point for AWS Batch jobs.

Make is fine interactively but a poor fit for a batch job: it cannot report
progress to CloudWatch, cannot fail loudly on a partial run, and re-runs
whatever the Makefile thinks is stale. This wraps the same pipeline stages
with explicit, ordered steps and structured logging.

Modes (set BIBLIO_MODE, or pass as argv[1]):
  stats      rebuild every data product (trajectories → snapshots)
  snapshots  rebuild only the dashboard JSON
  domain     ingest one domain end-to-end; requires BIBLIO_DOMAIN

Every step is a subprocess whose stdout/stderr is streamed to CloudWatch, so
a failure in the middle is visible in the log rather than a silent truncation.
Exit code is non-zero if ANY step fails, which is what Batch uses to mark the
job FAILED and trigger the retry policy.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from datetime import datetime, timezone

# Ordered pipeline stages. Each entry is (label, argv).
# `stats` touches only already-ingested data products, so it is safe to run
# without re-fetching from OpenAlex (which is rate-limited).
STATS_STEPS = [
    ("trajectories", ["python", "stats/trajectories.py"]),
    ("bursts", ["python", "stats/bursts.py"]),
    ("forecasts", ["python", "stats/forecasts.py"]),
    ("emergence", ["python", "stats/emergence.py"]),
    ("patents", ["python", "stats/patents.py"]),
    ("snapshots", ["python", "stats/snapshots.py"]),
]


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[biblio {ts}] {msg}", flush=True)


def upload_snapshots() -> None:
    """Copy the newest snapshot run to S3 when SNAPSHOT_BUCKET is set.

    The local pipeline writes to ./snapshots/<run_id>/. On Batch that
    directory is ephemeral — the task is destroyed when it exits — so the
    hand-off to the website has to go through S3 or the work is lost.

    Skipped silently when SNAPSHOT_BUCKET is unset, so the same image runs
    unchanged locally.
    """
    bucket = os.environ.get("SNAPSHOT_BUCKET", "").strip()
    if not bucket:
        log("SNAPSHOT_BUCKET unset: leaving snapshots on local disk")
        return

    import pathlib

    runs = sorted(pathlib.Path("snapshots").glob("*/leaderboard.json"))
    if not runs:
        log("no snapshot to upload")
        return
    run_dir = runs[-1].parent
    log(f"uploading {run_dir} -> s3://{bucket}/snapshots/{run_dir.name}")

    # awscli is not in the image (it would add ~100 MB). boto3 is already a
    # transitive dependency of nothing here, so use the S3 API directly via
    # boto3, which the Batch execution role permits with no credentials file:
    # the task role supplies short-lived credentials automatically.
    import mimetypes

    try:
        import boto3
    except ImportError:
        log("boto3 missing; cannot upload (add it to requirements.txt)")
        raise SystemExit("boto3 required for SNAPSHOT_BUCKET")

    s3 = boto3.client("s3")
    for path in sorted(run_dir.rglob("*")):
        if not path.is_file():
            continue
        key = f"snapshots/{run_dir.name}/{path.relative_to(run_dir).as_posix()}"
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        s3.upload_file(
            str(path), bucket, key,
            ExtraArgs={"ContentType": ctype, "CacheControl": "public,max-age=300"},
        )
    log(f"uploaded {len(list(run_dir.rglob('*.json')))} objects")



def run(label: str, argv: list[str]) -> float:
    log(f"START {label}: {' '.join(argv)}")
    started = time.monotonic()
    # No shell: argv is a list, so nothing in the environment can inject a
    # command. Output inherits the parent's streams and lands in CloudWatch.
    result = subprocess.run(argv, check=False)
    elapsed = time.monotonic() - started
    if result.returncode != 0:
        log(f"FAIL  {label} (exit {result.returncode}) after {elapsed:.1f}s")
        raise SystemExit(f"step failed: {label}")
    log(f"DONE  {label} in {elapsed:.1f}s")
    return elapsed


def main() -> int:
    mode = (os.environ.get("BIBLIO_MODE") or (sys.argv[1] if len(sys.argv) > 1 else "stats")).strip()
    log(f"mode={mode} python={sys.version.split()[0]}")

    if mode == "snapshots":
        run("snapshots", ["python", "stats/snapshots.py"])

    elif mode == "stats":
        for label, argv in STATS_STEPS:
            run(label, argv)

    elif mode == "domain":
        domain = os.environ.get("BIBLIO_DOMAIN", "").strip()
        if not domain:
            log("BIBLIO_DOMAIN is required for mode=domain")
            return 2
        # Ingest is deliberately last-ordered: fetch → normalize → aggregate,
        # because normalize consumes what fetch wrote and aggregate consumes
        # what normalize staged. Running them out of order silently produces
        # an empty panel.
        run("fetch", ["python", "pipelines/local_fetch.py", "--domain", domain])
        run("normalize", ["python", "pipelines/local_normalize.py", "--domain", domain])
        run("aggregate", ["python", "pipelines/local_aggregate.py", "--domain", domain])

    else:
        log(f"unknown mode: {mode!r} (expected stats | snapshots | domain)")
        return 2

    # A zero-byte snapshots dir means every step "succeeded" but produced
    # nothing — the failure mode a green job would otherwise hide.
    import pathlib

    produced = sorted(pathlib.Path("snapshots").glob("*/leaderboard.json"))
    if not produced:
        log("FAIL no snapshot output produced")
        return 3
    log(f"OK latest={produced[-1].parent.name}")

    # Hand off to S3 so the website can pick the run up.
    upload_snapshots()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
