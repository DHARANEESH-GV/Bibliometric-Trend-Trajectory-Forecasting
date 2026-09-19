"""OpenAlex cursor-paginated works fetcher (PROJECT_MASTER_PLAN.md §Phase 1).

Design invariants (testable — see tests/unit/pagination_test.py):
  * cursor semantics: cursor=* on first call, opaque next_cursor after;
    walk exits when next_cursor is null OR the domain cap dimensions fire.
  * field projection: every request carries the full select= list — the
    payload matures ~10x smaller than unprojected responses.
  * polite pool: mailto + User-Agent on every request; a minimum floor
    between page requests regardless of measured latency.
  * raw is atomic: one JSONL.gz object per page — a crash mid-walk leaves
    only complete objects; resume replays from the checkpointed cursor.
  * manifest per run: query semantics, page count, byte totals,
    timestamps — the replayability contract for Phase 2.
  * 429/5xx: exponential backoff with jitter honoring Retry-After when
    present; a run exceeding max_run_hard_failures hard-fails loudly.
"""

from __future__ import annotations

import gzip
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "https://api.openalex.org"
MAILTO = "dharaneeshgv@gmail.com"
USER_AGENT = f"biblio-trend/0.1 (mailto:{MAILTO})"

SELECT_FIELDS = [
    "id", "doi", "title", "publication_date", "publication_year",
    "cited_by_count", "type", "language", "primary_location",
    "authorships", "abstract_inverted_index", "topics", "keywords",
    "open_access", "referenced_works",
]


@dataclass
class PoliteSleeper:
    """Enforces a time floor between requests, whatever latency does."""
    floor_s: float = 0.12
    _last: float = field(default=0.0, repr=False)

    def wait(self) -> None:
        delta = time.monotonic() - self._last
        if delta < self.floor_s:
            time.sleep(self.floor_s - delta)
        self._last = time.monotonic()
        self.calls = getattr(self, "calls", 0) + 1


@dataclass
class BackoffPolicy:
    base_s: float = 0.5
    max_s: float = 8.0
    max_retries: int = 4
    jitter_s: float = 0.25

    def next_wait(self, attempt: int, retry_after: float | None) -> float:
        if retry_after is not None:
            return min(max(retry_after, 0.1), 900.0)
        raw = min(self.base_s * (2 ** attempt), self.max_s)
        return raw + random.uniform(0, self.jitter_s)


@dataclass
class RunLimits:
    """Exit dimensions for a walk (§Phase 1: null cursor ∨ caps)."""
    batch_size: int = 200
    per_domain_record_cap: int = 500_000
    raw_bytes_cap_per_domain: int = 2 * 1024 * 1024 * 1024
    max_pages_per_run: int | None = None     # smoke-test dimension
    max_records_per_run: int | None = None   # smoke-test dimension


@dataclass
class RunManifest:
    source: str
    domain: str
    run_id: str
    mode: str
    query_semantics: dict
    started_utc: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_utc: str | None = None
    pages_fetched: int = 0
    records_fetched: int = 0
    records_capped: int = 0
    raw_bytes_total: int = 0
    requests_made: int = 0
    retried_requests: int = 0
    exit_reason: str | None = None

    def to_json(self) -> str:
        return json.dumps(self.__dict__, indent=2, sort_keys=True)


def build_query(
    topic_ids: list[str],
    mode: str,
    range_start: str | None,
    range_end: str | None,
    batch_size: int,
) -> dict:
    """Request params for a page — pure function so tests can pin semantics.

    Semantics per locked decision §4.1-1:
      backfill / reconciliation → from/to_publication_date
      incremental               → from/to_created_date
    """
    filters = [f"topics.id:{'|'.join(topic_ids)}"]
    if mode == "incremental":
        date_field = "from_created_date"
    else:
        date_field = "from_publication_date"
    if range_start:
        filters.append(f"{date_field}:{range_start}")
    if range_end:
        filters.append(f"to_{date_field.split('_', 1)[1]}:" if False else f"to_{date_field.split('from_', 1)[1]}:{range_end}")
    return {
        "filter": ",".join(filters),
        "select": ",".join(SELECT_FIELDS),
        "per-page": str(batch_size),
        "mailto": MAILTO,
    }


class OpenAlexClient:
    def __init__(
        self,
        polite: PoliteSleeper | None = None,
        backoff: BackoffPolicy | None = None,
        base_url: str = BASE_URL,
        urlopen=None,                       # injectable for tests
    ) -> None:
        self.polite = polite or PoliteSleeper()
        self.backoff = backoff or BackoffPolicy()
        self.base_url = base_url.rstrip("/")
        self._urlopen = urlopen or urllib.request.urlopen
        self.retry_after_seen: float | None = None

    def fetch_page(self, query: dict, cursor: str) -> dict:
        """GET one page; returns parsed JSON. Retries per BackoffPolicy."""
        params = dict(query)
        params["cursor"] = cursor
        url = f"{self.base_url}/works?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"
        last_error: Exception | None = None
        self.retry_after_seen = None
        for attempt in range(self.backoff.max_retries + 1):
            self.polite.wait()
            try:
                if attempt > 0:
                    pass  # counted by caller via fetch_page wrapper below
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with self._urlopen(req, timeout=60) as resp:
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < self.backoff.max_retries:
                    retry_after = None
                    ra = e.headers.get("Retry-After") if e.headers else None
                    if ra is not None:
                        try:
                            retry_after = float(ra)
                        except ValueError:
                            retry_after = None
                    self.retry_after_seen = retry_after
                    time.sleep(self.backoff.next_wait(attempt, retry_after))
                    self.retried_made = getattr(self, "retried_made", 0) + 1
                    last_error = e
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt < self.backoff.max_retries:
                    time.sleep(self.backoff.next_wait(attempt, None))
                    self.retried_made = getattr(self, "retried_made", 0) + 1
                    last_error = e
                    continue
                raise
        raise last_error  # type: ignore[misc]


@dataclass
class PageOutcome:
    cursor: str | None
    records_written: int
    bytes_written: int
    complete: bool          # full batch persisted
    exit_reason: str | None


def write_batch(batch_path: Path, records: list[dict]) -> int:
    """One JSONL.gz object per page — atomic write via temp + rename."""
    batch_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = batch_path.with_suffix(batch_path.suffix + ".tmp")
    payload = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records)
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as fh:
        fh.write(payload)
    tmp.rename(batch_path)
    return batch_path.stat().st_size


class DomainFetcher:
    """Walks one domain's works, persisting pages + checkpoints per page."""

    def __init__(self, client: OpenAlexClient, limits: RunLimits | None = None) -> None:
        self.client = client
        self.limits = limits or RunLimits()

    def fetch_domain(
        self,
        domain: str,
        topic_ids: list[str],
        raw_dir: Path,
        state_store,                        # pipelines.state_store.StateStore
        mode: str = "backfill",
        range_start: str | None = None,
        range_end: str | None = None,
        run_id: str | None = None,
        strict_resume: bool = True,
        max_consecutive_retry_pages: int = 1,
    ) -> RunManifest:
        now = datetime.now(timezone.utc)
        run_id = run_id or now.strftime("%Y%m%dT%H%M%SZ")
        query = build_query(topic_ids, mode, range_start, range_end, self.limits.batch_size)
        manifest = RunManifest(
            source="openalex", domain=domain, run_id=run_id, mode=mode,
            query_semantics=query,
        )
        state = state_store.get(domain)
        resume = bool(state and state.get("cursor") and state.get("mode") == mode)
        cursor = state["cursor"] if resume else "*"
        raw_run_dir = raw_dir / domain / run_id
        page_no = 0
        consecutive_retry_pages = 0

        while True:
            try:
                page_no += 1
                before = getattr(self.client, "retried_made", 0)
                data = self.client.fetch_page(query, cursor)
                retried_here = getattr(self.client, "retried_made", 0) - before
                print(
                    f"[{domain}] page {page_no}: {len(data.get('results', []))} works"
                    f" (retries on this page: {retried_here})",
                    file=sys.stderr, flush=True,
                )
                consecutive_retry_pages = 0
            except Exception as e:
                consecutive_retry_pages += 1
                print(
                    f"[{domain}] page {page_no} FAILED after retries: {e}",
                    file=sys.stderr, flush=True,
                )
                if consecutive_retry_pages > max_consecutive_retry_pages:
                    manifest.exit_reason = "hard_failure_after_checkpoint"
                    break
                raise                              # checkpoint protects resume
            results = data.get("results", [])
            meta_next = (data.get("meta") or {}).get("next_cursor")
            manifest.requests_made += 1

            capped_slice = list(results)
            if self.limits.max_records_per_run is not None:
                budget = self.limits.max_records_per_run - manifest.records_fetched
                if budget < len(capped_slice):
                    capped_slice = capped_slice[: max(budget, 0)]
            if self.limits.per_domain_record_cap is not None:
                budget = self.limits.per_domain_record_cap - manifest.records_fetched - manifest.records_capped
                if budget < len(capped_slice):
                    capped_slice = capped_slice[: max(budget, 0)]

            bytes_written = 0
            if capped_slice:
                batch_path = raw_run_dir / f"batch_{page_no:05d}.jsonl.gz"
                bytes_written = write_batch(batch_path, capped_slice)
            manifest.pages_fetched += 1
            manifest.records_fetched += len(capped_slice)
            manifest.records_capped += len(results) - len(capped_slice)
            manifest.raw_bytes_total += bytes_written

            # Checkpoint per low-batch dimension
            state_store.put(
                domain,
                cursor=meta_next if meta_next is not None else "",
                mode=mode,
                last_run_id=run_id,
                last_run_timestamp=now.isoformat(),
                pages_fetched=page_no,
                record_count=manifest.records_fetched + manifest.records_capped,
                byte_total=manifest.raw_bytes_total,
            )

            if meta_next is None:
                manifest.exit_reason = "next_cursor_null"
                break
            if self.limits.max_records_per_run is not None and manifest.records_fetched >= self.limits.max_records_per_run:
                manifest.exit_reason = "max_records_per_run"
                break
            if self.limits.max_pages_per_run is not None and page_no >= self.limits.max_pages_per_run:
                manifest.exit_reason = "max_pages_per_run"
                break
            if self.limits.raw_bytes_cap_per_domain is not None and manifest.raw_bytes_total >= self.limits.raw_bytes_cap_per_domain:
                manifest.exit_reason = "raw_bytes_cap"
                break
            if self.limits.per_domain_record_cap is not None and manifest.records_fetched + manifest.records_capped >= self.limits.per_domain_record_cap:
                manifest.exit_reason = "per_domain_record_cap"
                break
            if not results and meta_next is None:
                manifest.exit_reason = "no_results"
                break
            cursor = meta_next

        manifest.finished_utc = datetime.now(timezone.utc).isoformat()
        raw_run_dir.mkdir(parents=True, exist_ok=True)
        (raw_run_dir / "manifest.json").write_text(manifest.to_json(), encoding="utf-8")
        return manifest
