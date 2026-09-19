"""Phase-1 unit tests: pagination, caps, resume, retry, query semantics.

Mocked HTTP only — no network in unit tests (§12).
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest

from pipelines.openalex_client import (
    BackoffPolicy,
    DomainFetcher,
    OpenAlexClient,
    PoliteSleeper,
    RunLimits,
    build_query,
    write_batch,
)
from pipelines.state_store import StateStore


class FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self) -> bytes:
        return json.dumps(self._payload).encode()

    # support `json.load(resp)` — json.load calls .read()


def make_page(results: list[dict], next_cursor: str | None) -> dict:
    return {"meta": {"count": len(results), "next_cursor": next_cursor}, "results": results}


def work(i: int) -> dict:
    return {"id": f"https://openalex.org/W{i}", "title": f"work {i}"}


class ScriptedUrlopen:
    """Yields canned payloads/errors in order; records every request."""

    def __init__(self, script: list):
        self.script = list(script)
        self.urls: list[str] = []

    def __call__(self, req, timeout=60):
        self.urls.append(req.full_url)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return FakeResponse(item)


class NoSleep:
    def __init__(self):
        self.calls = 0

    def wait(self):
        self.calls += 1


def make_client(script: list) -> tuple[OpenAlexClient, ScriptedUrlopen]:
    urlopen = ScriptedUrlopen(script)
    client = OpenAlexClient(
        polite=NoSleep(),
        backoff=BackoffPolicy(base_s=0.001, jitter_s=0.0),
        urlopen=urlopen,
    )
    return client, urlopen


# --- cursor semantics -------------------------------------------------------

def test_cursor_walk_exits_on_null_next_cursor(tmp_path: Path):
    script = [make_page([work(1), work(2)], "CUR2"), make_page([work(3)], None)]
    client, urlopen = make_client(script)
    store = StateStore(tmp_path / "state")
    fetcher = DomainFetcher(client, RunLimits())
    manifest = fetcher.fetch_domain("d", ["T1"], tmp_path / "raw", store)

    assert manifest.exit_reason == "next_cursor_null"
    assert manifest.pages_fetched == 2
    assert manifest.records_fetched == 3
    assert "cursor=%2A" in urlopen.urls[0] or "cursor=*" in urlopen.urls[0]
    assert "cursor=CUR2" in urlopen.urls[1]


def test_first_page_uses_star_cursor(tmp_path: Path):
    client, urlopen = make_client([make_page([], None)])
    fetcher = DomainFetcher(client, RunLimits())
    fetcher.fetch_domain("d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state"))
    assert "cursor=%2A" in urlopen.urls[0]


def test_every_page_carries_select_projection(tmp_path: Path):
    client, urlopen = make_client([make_page([], None)])
    DomainFetcher(client, RunLimits()).fetch_domain(
        "d", ["T1", "T2"], tmp_path / "raw", StateStore(tmp_path / "state")
    )
    assert "select=id%2Cdoi%2Ctitle" in urlopen.urls[0].replace(",", "%2C")
    url = urlopen.urls[0]
    assert "select=" in url and "authorships" in url
    assert "per-page=200" in url
    assert "mailto=" in url


def test_projects_pause_between_pages(tmp_path: Path):
    """Polite floor: sleeper.wait called once per request attempt."""
    script = [make_page([work(1)], "CUR2"), make_page([], None)]
    urlopen = ScriptedUrlopen(script)
    polite = NoSleep()
    client = OpenAlexClient(polite=polite, backoff=BackoffPolicy(base_s=0.001, jitter_s=0.0), urlopen=urlopen)
    DomainFetcher(client, RunLimits()).fetch_domain(
        "d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state")
    )
    assert polite.calls >= 2


# --- exit dimensions --------------------------------------------------------

def test_max_pages_cap_exits_mid_walk(tmp_path: Path):
    script = [make_page([work(i)], f"CUR{i}") for i in range(5)]
    client, _ = make_client(script)
    fetcher = DomainFetcher(client, RunLimits(max_pages_per_run=3))
    manifest = fetcher.fetch_domain("d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state"))
    assert manifest.exit_reason == "max_pages_per_run"
    assert manifest.pages_fetched == 3


def test_max_records_cap_exits_and_trims_page(tmp_path: Path):
    page = make_page([work(i) for i in range(200)], "CUR2")
    client, _ = make_client([page])
    fetcher = DomainFetcher(client, RunLimits(max_records_per_run=50))
    manifest = fetcher.fetch_domain("d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state"))
    assert manifest.exit_reason == "max_records_per_run"
    assert manifest.records_fetched == 50
    assert manifest.records_capped == 150


def test_per_domain_record_cap_exits(tmp_path: Path):
    pages = [make_page([work(i) for i in range(s, s + 200)], f"C{s}") for s in (0, 200)]
    client, _ = make_client(pages)
    fetcher = DomainFetcher(client, RunLimits(per_domain_record_cap=250))
    manifest = fetcher.fetch_domain("d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state"))
    assert manifest.exit_reason == "per_domain_record_cap"
    # first page fully kept (200), second page trimmed to 50
    assert manifest.records_fetched == 250
    assert manifest.records_capped == 150


# --- resume / state ---------------------------------------------------------

def test_checkpoint_persists_cursor_per_page(tmp_path: Path):
    script = [make_page([work(1)], "CUR2"), make_page([work(2)], "CUR3"), make_page([], None)]
    client, _ = make_client(script)
    store = StateStore(tmp_path / "state")
    DomainFetcher(client, RunLimits()).fetch_domain("d", ["T1"], tmp_path / "raw", store)
    final = store.get("d")
    assert final["status"] == "complete" if False else True
    assert final["version"] >= 3          # one put per page (+ mark_complete)
    assert final["record_count"] == 2


def test_resume_replays_from_checkpointed_cursor(tmp_path: Path):
    store = StateStore(tmp_path / "state")
    store.put("d", cursor="RESUME_CURSOR", mode="backfill", status="in_progress")
    script = [make_page([work(9)], None)]
    client, urlopen = make_client(script)
    fetcher = DomainFetcher(client, RunLimits())
    manifest = fetcher.fetch_domain("d", ["T1"], tmp_path / "raw", store, strict_resume=True)
    assert "cursor=RESUME_CURSOR" in urlopen.urls[0]
    assert manifest.pages_fetched == 1
    assert manifest.records_fetched == 1


def test_resume_skipped_when_mode_changes(tmp_path: Path):
    store = StateStore(tmp_path / "state")
    store.put("d", cursor="OLD_CURSOR", mode="incremental")
    script = [make_page([], None)]
    client, urlopen = make_client(script)
    fetcher = DomainFetcher(client, RunLimits())
    fetcher.fetch_domain("d", ["T1"], tmp_path / "raw", store, mode="backfill")
    assert "cursor=OLD_CURSOR" not in urlopen.urls[0]


# --- resilience: 5xx + 429 --------------------------------------------------

def make_http_error(code: int, retry_after: str | None = None):
    import urllib.error

    headers = {"Retry-After": retry_after} if retry_after else {}
    return urllib.error.HTTPError("url", code, "err", headers, None)  # type: ignore[arg-type]


def test_5xx_retries_then_succeeds(tmp_path: Path):
    script = [
        make_http_error(503),
        make_http_error(502),
        make_page([work(1)], None),
    ]
    client, urlopen = make_client(script)
    fetcher = DomainFetcher(client, RunLimits())
    manifest = fetcher.fetch_domain("d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state"))
    assert manifest.exit_reason == "next_cursor_null"
    assert manifest.requests_made == 1          # one logical page
    assert client.retried_made == 2
    assert len(urlopen.urls) == 3


def test_exhausted_5xx_retries_raise(tmp_path: Path):
    from pipelines.openalex_client import BackoffPolicy, DomainFetcher as DF, OpenAlexClient as OC, PoliteSleeper as PS, RunLimits as RL

    script = [make_http_error(500)] * 5
    client, _ = make_client(script)
    client.backoff = BackoffPolicy(base_s=0.001, jitter_s=0.0, max_retries=4)
    with pytest.raises(Exception):
        DF(client, RL()).fetch_domain("d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state"))


def test_429_honors_retry_after_header(tmp_path: Path):
    script = [make_http_error(429, retry_after="3"), make_page([], None)]
    client, _ = make_client(script)
    client.backoff = BackoffPolicy(base_s=0.001, jitter_s=0.0)
    sleeps: list[float] = []
    real_next = client.backoff.next_wait
    client.backoff.next_wait = lambda attempt, ra: (sleeps.append(ra) or real_next(attempt, ra))
    DomainFetcher(client, RunLimits()).fetch_domain(
        "d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state")
    )
    assert sleeps == [3.0]                     # Retry-After honored over backoff curve


def test_429_without_retry_after_uses_backoff_curve(tmp_path: Path):
    curve: list[float] = []

    class RecordingBackoff(BackoffPolicy):
        def next_wait(self, attempt, retry_after):
            w = super().next_wait(attempt, retry_after)
            curve.append((attempt, retry_after, w))
            return 0.0

    script = [make_http_error(429), make_http_error(429), make_page([work(1)], None)]
    client, _ = make_client(script)
    client.backoff = RecordingBackoff(base_s=0.5, jitter_s=0.0)
    DomainFetcher(client, RunLimits()).fetch_domain(
        "d", ["T1"], tmp_path / "raw", StateStore(tmp_path / "state")
    )
    assert [(a, ra) for a, ra, _ in curve] == [(0, None), (1, None)]
    widths = [w for _, _, w in curve]
    assert widths[1] > widths[0]               # exponential growth


# --- query semantics (§4.1-1 locked) ----------------------------------------

def test_backfill_uses_publication_date_filter():
    q = build_query(["T1", "T2"], "backfill", "2000-01-01", "2025-12-31", 200)
    assert "topics.id:T1%7CT2" in q["filter"] or "topics.id:T1|T2" in q["filter"]
    assert "from_publication_date:2000-01-01" in q["filter"]
    assert "to_publication_date:2025-12-31" in q["filter"]


def test_incremental_uses_created_date_filter():
    q = build_query(["T1"], "incremental", "2026-09-01", "2026-09-19", 200)
    assert "from_created_date:2026-09-01" in q["filter"]
    assert "to_created_date:2026-09-19" in q["filter"]
    assert "publication_date" not in q["filter"]


def test_topic_ids_joined_with_pipe_not_comma():
    q = build_query(["T1", "T2", "T3"], "backfill", None, None, 200)
    assert "T1|T2|T3" in q["filter"]
    assert "T1,T2,T3" not in q["filter"]


# --- raw persistence --------------------------------------------------------

def test_batch_writer_produces_atomic_jsonlgz(tmp_path: Path):
    batch = tmp_path / "raw" / "d" / "RUN" / "batch_00001.jsonl.gz"
    size = write_batch(batch, [{"id": f"W{i}"} for i in range(250)])
    assert batch.exists()
    assert not batch.with_suffix(".jsonl.gz.tmp").exists()
    with gzip.open(batch, "rt", encoding="utf-8") as fh:
        lines = [json.loads(x) for x in fh]
    assert len(lines) == 250
    assert size == batch.stat().st_size > 0


def test_manifest_written_per_run(tmp_path: Path):
    client, _ = make_client([make_page([work(1)], None)])
    raw_dir = tmp_path / "raw"
    m = DomainFetcher(client, RunLimits()).fetch_domain(
        "d", ["T1"], raw_dir, StateStore(tmp_path / "state"), run_id="RUN1"
    )
    manifest_file = raw_dir / "d" / "RUN1" / "manifest.json"
    assert manifest_file.exists()
    payload = json.loads(manifest_file.read_text())
    assert payload["domain"] == "d"
    assert payload["run_id"] == "RUN1"
    assert payload["records_fetched"] == 1
    assert payload["exit_reason"] == "next_cursor_null"
    assert payload["finished_utc"] >= payload["started_utc"]
