"""Quarterly OpenAlex paper counts per domain, 2000-Q1 .. 2025-Q4.

Why this exists
---------------
`data/trajectories/panel.json` carries 104 quarterly buckets per domain, but
they are DERIVED, not measured: `stats/trajectories.py` splits each exact
annual total into four equal parts (`quarterly_method:
"equal_split_interpolation"`). That is documented and fine for sparklines,
but it cannot support any within-year analysis, and it makes "sparse quarter"
questions unanswerable.

This script produces MEASURED quarterly counts straight from OpenAlex using
`meta.count` — one cheap request per (domain, quarter). No work records are
downloaded, so the request is a count aggregate rather than a document page.

Cost model (important)
----------------------
104 quarters x 20 domains = 2,080 requests. OpenAlex is free but credit-metered.
Per the rate-limit docs (checked 2026-10-29): a free API key raises the budget
10x over keyless and lifts the per-second ceiling to 30 req/s. The key is read
from `OPENALEX_API_KEY` in `.env` (see `load_api_key`) and sent as the
documented `api_key` query parameter. Current account state: 10,000 credits/day
at $1/day, so a full 20-domain run fits comfortably in one day. `--resume`
(default) continues from the CSV instead of restarting.

Usage
-----
    # smoke test: one domain
    .venv/bin/python scripts/openalex_quarterly_counts.py --domains quantum_computing

    # 2008-Q1..2025-Q4 backfill for the 19 non-quantum domains, resumable
    .venv/bin/python scripts/openalex_quarterly_counts.py --resume \
        --from-year 2008 --to-year 2025 --domains <19 slugs>

    # plan the request count without spending quota
    .venv/bin/python scripts/openalex_quarterly_counts.py --dry-run

Output
------
`data/papers/quarterly_counts.csv` with header `domain,year,quarter,papers`.
With `--domains`, the output is written to
`data/papers/quarterly_counts_<domains joined>.csv` so a smoke test cannot
overwrite a full-panel file.

Failure handling
----------------
* 429 / 5xx → exponential backoff with jitter, honouring Retry-After.
* Per-request results are appended to the CSV as they succeed, so an aborted
  run loses nothing.
* A quarter whose count cannot be obtained after retries is recorded as
  empty (the row is omitted) and reported at the end — never silently 0.
"""

from __future__ import annotations

import argparse
import csv
import http.client
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
DOMAINS = REPO / "config" / "domains.yaml"
SETTINGS = REPO / "config" / "settings.yaml"
ENV_FILE = REPO / ".env"
OUT_DIR = REPO / "data" / "papers"


class QuotaExhausted(RuntimeError):
    """OpenAlex polite-pool budget spent; stop and resume after reset."""

BASE_URL = "https://api.openalex.org"
YEAR_MIN, YEAR_MAX = 2000, 2025   # default window; --from/--to override

# OpenAlex polite-pool budget, read from response headers on 2026-10-29:
#   X-RateLimit-Limit: 1000        (credits per day, 1 credit per request)
#   X-RateLimit-Remaining: 958
#   X-RateLimit-Reset: 55226       (seconds until reset)
# When the budget is exhausted every further call returns 429, so the run
# stops cleanly instead of burning retries - --resume continues after reset.
RATE_LIMIT_HEADER = "X-RateLimit-Remaining"

# Per-second ceiling from the OpenAlex rate-limit docs (checked 2026-10-29,
# https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication):
#   no key      -> 10 req/s
#   free key    -> 30 req/s
#   annual plan -> 50 req/s
# With a key present we budget 30 req/s; the configured polite_floor_s (0.5s,
# i.e. 2 req/s) is far below that, and rps_floor() enforces the hard ceiling
# regardless of how the floor is configured.
RPS_LIMIT_KEYED = 30.0
RPS_LIMIT_ANON = 10.0

RATE_LIMIT_HEADERS = (
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Credits-Used",
    "X-RateLimit-Reset",
)


def load_api_key() -> str | None:
    """Read OPENALEX_API_KEY from .env (or the environment).

    Per the OpenAlex docs the key may be sent either as an `api_key` query
    parameter or as `Authorization: Bearer <key>`. We use the query parameter
    (see build_url). The value is never logged, printed, or written anywhere.
    """
    env = os.environ.get("OPENALEX_API_KEY")
    if env:
        return env.strip()
    if not ENV_FILE.exists():
        return None
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() != "OPENALEX_API_KEY":
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        return value or None
    return None


def rps_floor(configured_floor_s: float, has_key: bool) -> float:
    """Pace requests under the documented per-second ceiling."""
    ceiling = RPS_LIMIT_KEYED if has_key else RPS_LIMIT_ANON
    return max(configured_floor_s, 1.0 / ceiling)


def load_settings() -> dict:
    cfg = yaml.safe_load(SETTINGS.read_text(encoding="utf-8"))
    return cfg["sources"]["openalex"]


def mailto() -> str:
    return load_settings().get("mailto", "")


def user_agent() -> str:
    return f"biblio-trend/0.1 (mailto:{mailto()})"


def load_domains() -> dict[str, dict]:
    raw = yaml.safe_load(DOMAINS.read_text(encoding="utf-8"))
    return {d["domain_slug"]: d for d in raw["domains"]}


def quarter_bounds(year: int, quarter: int) -> tuple[str, str]:
    """Inclusive publication_date bounds for a calendar quarter."""
    start_month = 3 * (quarter - 1) + 1
    start = date(year, start_month, 1)
    end_month = start_month + 2
    if end_month == 12:
        end = date(year, 12, 31)
    else:
        end = date(year, end_month + 1, 1) - timedelta(days=1)
    return start.isoformat(), end.isoformat()


def build_url(topic_ids: list[str], start: str, end: str,
              api_key: str | None = None) -> str:
    """Count-only query: per_page=1 and no select, so OpenAlex returns
    meta.count without any work payload."""
    filters = [
        f"topics.id:{'|'.join(topic_ids)}",
        f"from_publication_date:{start}",
        f"to_publication_date:{end}",
    ]
    params = {
        "filter": ",".join(filters),
        "per-page": "1",
        "mailto": mailto(),
    }
    if api_key:
        # Documented auth for OpenAlex: `?api_key=...` (or Authorization:
        # Bearer). Placed last so it never lands mid-URL in a log preview.
        params["api_key"] = api_key
    return f"{BASE_URL}/works?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"


def print_rate_limit_headers(headers) -> None:
    """Print the four documented X-RateLimit headers (never the key)."""
    print("rate-limit headers:", flush=True)
    for name in RATE_LIMIT_HEADERS:
        print(f"  {name}: {headers.get(name)}", flush=True)


def fetch_count(url: str, *, max_retries: int, backoff_base: float,
                backoff_max: float, floor_s: float,
                show_headers: bool = False) -> int | None:
    """GET one count. Returns meta.count, or None if it never succeeded.

    Backoff mirrors pipelines/openalex_client.BackoffPolicy: exponential with
    jitter, honouring Retry-After when the server sends one.

    Raises QuotaExhausted when the polite-pool budget is spent, so the caller
    can stop the run without wasting retries or losing partial progress.
    """
    last: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": user_agent()})
            with urllib.request.urlopen(req, timeout=60) as resp:
                if show_headers:
                    print_rate_limit_headers(resp.headers)
                remaining = resp.headers.get(RATE_LIMIT_HEADER)
                if remaining is not None and int(remaining) <= 1:
                    payload = json.load(resp)
                    meta = payload.get("meta") or {}
                    if meta.get("count") is not None:
                        time.sleep(floor_s)
                        return int(meta["count"])
                    raise QuotaExhausted("credit budget exhausted")
                payload = json.load(resp)
            meta = payload.get("meta") or {}
            count = meta.get("count")
            if count is None:
                raise ValueError("response had no meta.count")
            time.sleep(floor_s)
            return int(count)
        except urllib.error.HTTPError as e:
            last = e
            retry_after = e.headers.get("Retry-After") if e.headers else None
            if e.code == 403:
                # Documented failure mode: key present but email unverified.
                print("  [fatal] HTTP 403 (key_not_activated?) - the API key "
                      "exists but is not active yet; verify the email.",
                      file=sys.stderr)
                raise
            if e.code == 429:
                rem = e.headers.get("X-RateLimit-Remaining") if e.headers else None
                if rem is not None and int(rem) <= 0:
                    raise QuotaExhausted("HTTP 429 with 0 credits remaining")
            if e.code not in (429, 500, 502, 503, 504):
                raise
            wait = (float(retry_after) if retry_after and retry_after.isdigit()
                    else min(backoff_max, backoff_base * (2 ** attempt)))
        except (urllib.error.URLError, TimeoutError, ConnectionError,
                json.JSONDecodeError, ValueError, OSError,
                # http.client.IncompleteRead / RemoteDisconnected are
                # HTTPException, NOT OSError - this is what killed the
                # 2026-10-29 run after 16 domains. Retry instead of crashing.
                http.client.HTTPException) as e:
            last = e
            wait = min(backoff_max, backoff_base * (2 ** attempt))
        if attempt == max_retries:
            break
        time.sleep(wait + random.uniform(0, 0.25))
    print(f"  [warn] giving up after {max_retries + 1} attempts: {last}", file=sys.stderr)
    return None


def read_done(path: Path) -> set[tuple[str, int, int]]:
    """Existing rows, for --resume."""
    if not path.exists():
        return set()
    done: set[tuple[str, int, int]] = set()
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            done.add((row["domain"], int(row["year"]), int(row["quarter"])))
    return done


def resolve_out_path(domains: list[str]) -> Path:
    if len(domains) == 1:
        return OUT_DIR / f"quarterly_counts_{domains[0]}.csv"
    return OUT_DIR / "quarterly_counts.csv"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--domains", nargs="*", default=None,
                    help="subset of domain slugs (default: all 20)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report the request count and exit without calling OpenAlex")
    ap.add_argument("--no-resume", action="store_true",
                    help="ignore existing rows and re-fetch everything")
    ap.add_argument("--resume", action="store_true",
                    help="explicitly resume from existing rows (default behaviour)")
    ap.add_argument("--from-year", type=int, default=YEAR_MIN,
                    help=f"first year of the window (default {YEAR_MIN})")
    ap.add_argument("--to-year", type=int, default=YEAR_MAX,
                    help=f"last year of the window (default {YEAR_MAX})")
    ap.add_argument("--out", default=None,
                    help="override the output CSV path")
    args = ap.parse_args()

    cfg = load_settings()
    all_domains = load_domains()
    slugs = args.domains or sorted(all_domains)
    unknown = [s for s in slugs if s not in all_domains]
    if unknown:
        print(f"unknown domain(s): {unknown}", file=sys.stderr)
        return 2

    quarters = [(y, q) for y in range(args.from_year, args.to_year + 1)
                for q in range(1, 5)]
    total_reqs = len(quarters) * len(slugs)

    api_key = load_api_key()

    if args.dry_run:
        print(f"domains:  {len(slugs)}  {slugs if len(slugs) <= 5 else slugs[:5] + ['...']}")
        print(f"quarters: {len(quarters)} per domain ({quarters[0]} .. {quarters[-1]})")
        print(f"requests: {total_reqs}")
        print(f"api key:  {'loaded from .env' if api_key else 'MISSING (anonymous)'}")
        print(f"output:   {args.out or resolve_out_path(slugs)}")
        return 0

    if not api_key:
        print("[warn] OPENALEX_API_KEY not found in .env or environment; "
              "falling back to the anonymous budget (10 req/s, 1000 credits/day).",
              file=sys.stderr)

    out = Path(args.out) if args.out else resolve_out_path(slugs)
    out.parent.mkdir(parents=True, exist_ok=True)
    done = set() if args.no_resume else read_done(out)
    if done:
        print(f"resuming: {len(done)} (domain, year, quarter) rows already present")

    # Append mode when resuming into an existing file, otherwise (re)write.
    write_header = not out.exists() or args.no_resume or not done
    mode = "w" if write_header else "a"

    configured_floor_s = float(cfg.get("ingest", {}).get("polite_floor_s", 0.5))
    floor_s = rps_floor(configured_floor_s, bool(api_key))
    max_retries = int(cfg.get("max_retries", 4))
    backoff_base = float(cfg.get("backoff_base_s", 0.5))
    backoff_max = float(cfg.get("backoff_max_s", 8.0))
    print(f"pacing: {1.0/floor_s:.1f} req/s "
          f"(documented ceiling {RPS_LIMIT_KEYED if api_key else RPS_LIMIT_ANON:.0f} req/s)",
          flush=True)

    ok = 0
    failed: list[tuple[str, int, int]] = []
    t_start = time.time()
    quota_hit = False
    req_total = 0

    with out.open(mode, newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if write_header:
            writer.writerow(["domain", "year", "quarter", "papers"])
        for slug in slugs:
            if quota_hit:
                break
            dom = all_domains[slug]
            topic_ids = [t.split("/")[-1] for t in dom["openalex_topic_ids"]]
            dom_ok = 0
            dom_skipped = 0
            for (y, q) in quarters:
                if (slug, y, q) in done:
                    dom_ok += 1
                    continue
                start, end = quarter_bounds(y, q)
                url = build_url(topic_ids, start, end, api_key)
                try:
                    count = fetch_count(
                        url, max_retries=max_retries, backoff_base=backoff_base,
                        backoff_max=backoff_max, floor_s=floor_s,
                        show_headers=(req_total == 0),
                    )
                except QuotaExhausted:
                    quota_hit = True
                    dom_skipped += 1
                    break
                req_total += 1
                if count is None:
                    failed.append((slug, y, q))
                    continue
                writer.writerow([slug, y, q, count])
                fh.flush()
                dom_ok += 1
                ok += 1
            complete = dom_ok >= len(quarters)
            print(f"[{slug}] {dom_ok}/{len(quarters)} quarters "
                  f"{'COMPLETE' if complete else 'PARTIAL'}"
                  f" ({ok} this run, {ok + len(done)} total)", flush=True)

    elapsed = time.time() - t_start
    print(f"\ndone in {elapsed:.0f}s: {ok} fetched, {len(done)} pre-existing, "
          f"{len(failed)} failed -> {out}")
    if quota_hit:
        print("\nQUOTA EXHAUSTED - OpenAlex polite pool is 1000 credits/day "
              "(1 per request). Partial progress is saved; re-run with "
              "--resume after the daily reset.", file=sys.stderr)
    if failed:
        print("unresolved (omitted, not zeroed):", file=sys.stderr)
        for f in failed[:20]:
            print(f"  {f}", file=sys.stderr)
        if len(failed) > 20:
            print(f"  ... and {len(failed) - 20} more", file=sys.stderr)
    return 1 if (failed or quota_hit) else 0


if __name__ == "__main__":
    raise SystemExit(main())
