"""Tier C drill-down sampler — resumable (PROJECT_MASTER_PLAN.md fast-track).

Per domain (19; quantum_computing excluded — full corpus on disk):
  recent.jsonl.gz    2,000 most-recent works  (10 pages, publication_date:desc)
  top_cited.jsonl.gz 2,000 top-cited works    (10 pages, cited_by_count:desc)

Resume logic: a domain is skipped when both files exist with ≥1900 lines.
Request accounting: exactly 20 pages max per domain, no double pages.
Progress:jid raw/samples/tier_c_stats.json rewritten after every domain.
"""

import gzip
import http.client
import json
import ssl
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import yaml  # noqa: E402

SELECT = ("id,doi,title,publication_date,publication_year,cited_by_count,"
          "type,primary_location,authorships,abstract_inverted_index,topics,"
          "keywords,open_access,referenced_works")
OUT = REPO / "raw" / "samples"
UA = "biblio-trend/0.1 (mailto:dharaneeshgv@gmail.com)"


def get(url: str) -> dict:
    """GET with one hardening retry — transient network cuts (Errno 101,
    IncompleteRead, ssl timeout) killed ~1 of every 3 sampler sessions."""
    last: Exception | None = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
                ConnectionError, json.JSONDecodeError, http.client.HTTPException,
                ssl.SSLError, OSError) as e:
            if attempt == 2:
                raise
            last = e
            time.sleep(min(60.0, 10.0 * (attempt + 1)))
    raise last  # pragma: no cover


def count_lines(p: Path) -> int:
    try:
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            return sum(1 for _ in fh)
    except FileNotFoundError:
        return 0


def fetch_sorted(base_filter: str, sort: str, n_pages: int = 10) -> list[dict]:
    cursor, got = "*", []
    for _ in range(n_pages):
        u = (f"https://api.openalex.org/works?filter={urllib.parse.quote(base_filter, safe=',:|')}"
             f"&sort={sort}&per-page=200&select={urllib.parse.quote(SELECT, safe=',')}"
             f"&cursor={urllib.parse.quote(cursor)}&mailto=dharaneeshgv@gmail.com")
        d = get(u)
        got.extend(d.get("results", []))
        cursor = (d.get("meta") or {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(0.45)
    return got


def save(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.rename(path)


def main() -> int:
    doms = yaml.safe_load((REPO / "config/domains.yaml").read_text())["domains"]
    stats_path = OUT / "tier_c_stats.json"
    stats = json.loads(stats_path.read_text()) if stats_path.exists() else {}
    done, reqs = 0, 0
    try:
        for d in doms:
            slug = d["domain_slug"]
            if slug == "quantum_computing":
                continue
            rec_p, top_p = OUT / slug / "recent.jsonl.gz", OUT / slug / "top_cited.jsonl.gz"
            if count_lines(rec_p) >= 1900 and count_lines(top_p) >= 1900:
                done += 1
                continue
            base = (f"topics.id:{'|'.join(t.split('/')[-1] for t in d['openalex_topic_ids'])},"
                    f"from_publication_date:2000-01-01,to_publication_date:2025-12-31")
            if count_lines(rec_p) < 1900:
                save(rec_p, fetch_sorted(base, "publication_date:desc")); reqs += 10
                time.sleep(0.45)
            if count_lines(top_p) < 1900:
                save(top_p, fetch_sorted(base, "cited_by_count:desc")); reqs += 10
                time.sleep(0.45)
            stats[slug] = {"recent": count_lines(rec_p), "top_cited": count_lines(top_p)}
            stats_path.write_text(json.dumps(stats, indent=1))
            done += 1
            print(f"[tier-c] {slug}: recent {stats[slug]['recent']} + top {stats[slug]['top_cited']} "
                  f"({done}/19 domains this session, ~{reqs} reqs)", flush=True)
    finally:
        stats_path.write_text(json.dumps(stats, indent=1))
        print(f"[tier-c] FINISHED: {len(stats)}/19 domains total, ~{reqs} reqs this session", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
