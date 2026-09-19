"""Phase 2 — Normalization (PROJECT_MASTER_PLAN.md §Phase 2).

Raw OpenAlex JSONL.gz batches → 7 clean Parquet tables, staged partitioned
by domain + year with run_id in the filename (locked §4.1-3):

  staged/{table}/domain={slug}/year={yyyy}/part-{run_id}.parquet

  works, work_authors, work_institutions, work_topics, work_keywords,
  work_refs, patents (Phase 3.5)

Hygiene rules (§Phase 2 + §12 data tests):
  * dedup on openalex_id — keep-first by updated_datetime
  * DOI normalization: lowercase, strip https://doi.org/ prefix
  * year coercion + range gate 2000-2025; null/invalid years quarantined
    (staged_quarantine/ works_without_year), never silently dropped
  * abstract reconstruction: inverted index {word: [pos,...]} → position-
    sorted join; repeated positions tie-break on insertion order (O(tokens))

Implementation note: pure-Python preprocessing, PyArrow Parquet writing.
DuckDB enters at the aggregate step (Phase 3) where partition-pruned
scans actually matter; per-record normalization is row-shape work that
DuckDB does not accelerate.
"""

from __future__ import annotations

import gzip
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

YEAR_MIN, YEAR_MAX = 2000, 2025
DOI_PREFIX_RE = re.compile(r"^https?://(dx\.)?doi\.org/", re.IGNORECASE)

WORKS_SCHEMA = pa.schema([
    ("openalex_id", pa.string()),
    ("doi", pa.string()),
    ("title", pa.string()),
    ("publication_date", pa.string()),
    ("publication_year", pa.int32()),
    ("cited_by_count", pa.int32()),
    ("type", pa.string()),
    ("language", pa.string()),
    ("primary_location_source", pa.string()),
    ("open_access_oa_status", pa.string()),
    ("domain_slug", pa.string()),
    ("run_id", pa.string()),
    ("abstract", pa.string()),
    ("updated_datetime", pa.string()),
])

WORK_AUTHORS_SCHEMA = pa.schema([
    ("openalex_id", pa.string()),
    ("author_id", pa.string()),
    ("author_position", pa.int32()),
    ("author_raw_name", pa.string()),
    ("domain_slug", pa.string()),
])

WORK_INSTITUTIONS_SCHEMA = pa.schema([
    ("openalex_id", pa.string()),
    ("author_id", pa.string()),
    ("institution_id", pa.string()),
    ("institution_name", pa.string()),
    ("country_code", pa.string()),
    ("domain_slug", pa.string()),
])

WORK_TOPICS_SCHEMA = pa.schema([
    ("openalex_id", pa.string()),
    ("topic_id", pa.string()),
    ("topic_name", pa.string()),
    ("topic_score", pa.float32()),
    ("topic_rank", pa.int32()),
    ("domain_slug", pa.string()),
])

WORK_KEYWORDS_SCHEMA = pa.schema([
    ("openalex_id", pa.string()),
    ("keyword_id", pa.string()),
    ("keyword_name", pa.string()),
    ("keyword_score", pa.float32()),
    ("domain_slug", pa.string()),
])

WORK_REFS_SCHEMA = pa.schema([
    ("openalex_id", pa.string()),
    ("referenced_work_id", pa.string()),
    ("domain_slug", pa.string()),
])


@dataclass
class NormalizeReport:
    domain: str
    run_id: str
    records_in: int = 0
    dedup_removed: int = 0
    year_quarantined: int = 0
    year_gated: int = 0           # valid but outside 2000-2025 (kept, quarantined)
    abstracts_reconstructed: int = 0
    abstracts_unreconstructable: int = 0
    dois_normalized: int = 0
    table_rows: dict = field(default_factory=dict)
    started_utc: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_utc: str | None = None
    finished: datetime | None = None

    def to_json(self) -> str:
        import json as _json
        return _json.dumps(self.__dict__, indent=2, sort_keys=True, default=str)


# --- pure transform helpers (unit-tested in isolation) ----------------------

def normalize_doi(doi: str | None) -> str | None:
    """Lowercase, strip https://doi.org/ (§Phase 2). None-safe."""
    if doi is None:
        return None
    cleaned = DOI_PREFIX_RE.sub("", doi.strip()).lower()
    return cleaned or None


def coerce_year(pub_year, pub_date: str | None = None) -> int | None:
    """int(pub_year) with fallback parsing from publication_date; None if uncoercible."""
    if pub_year is not None:
        try:
            return int(pub_year)
        except (TypeError, ValueError):
            pass
    if pub_date:
        m = re.match(r"^(\d{4})", str(pub_date))
        if m:
            return int(m.group(1))
    return None


def reconstruct_abstract(inverted_index: dict | None) -> str | None:
    """{word: [pos,...]} → original text (§Phase 2).

    Positions may repeat across words → stable sort, tie-break on
    insertion order (Python sorts are stable; key = position only).
    """
    if not inverted_index:
        return None
    pairs: list[tuple[int, int, str]] = []   # (pos, insertion_order, word)
    for order, (word, positions) in enumerate(inverted_index.items()):
        for pos in positions:
            pairs.append((pos, order, word))
    if not pairs:
        return None
    pairs.sort()                              # stable: pos, then insertion order
    return " ".join(word for _, _, word in pairs)


def year_bucket(year: int) -> str:
    return f"{year:04d}"


# --- record → table rows -----------------------------------------------------

def _inst_rows(rec: dict, openalex_id: str, domain_slug: str) -> list[dict]:
    rows = []
    for auth in rec.get("authorships") or []:
        author_id = ((auth.get("author") or {}).get("id"))
        for inst in auth.get("institutions") or []:
            rows.append({
                "openalex_id": openalex_id,
                "author_id": author_id,
                "institution_id": inst.get("id"),
                "institution_name": inst.get("display_name"),
                "country_code": inst.get("country_code"),
                "domain_slug": domain_slug,
            })
    return rows


def normalize_record(rec: dict, domain_slug: str, run_id: str) -> dict:
    """One OpenAlex work → row-dicts for the six table families."""
    openalex_id = rec.get("id")
    abstract = reconstruct_abstract(rec.get("abstract_inverted_index"))
    doi_raw = rec.get("doi")
    return {
        "work": {
            "openalex_id": openalex_id,
            "doi": normalize_doi(doi_raw),
            "title": rec.get("title"),
            "publication_date": rec.get("publication_date"),
            "publication_year": coerce_year(rec.get("publication_year"), rec.get("publication_date")),
            "cited_by_count": rec.get("cited_by_count"),
            "type": rec.get("type"),
            "language": rec.get("language"),
            "primary_location_source": ((rec.get("primary_location") or {}).get("source") or {}).get("display_name"),
            "open_access_oa_status": (rec.get("open_access") or {}).get("oa_status"),
            "domain_slug": domain_slug,
            "run_id": run_id,
            "abstract": abstract,
            "updated_datetime": rec.get("updated_datetime"),
        },
        "work_authors": [
            {
                "openalex_id": openalex_id,
                "author_id": (a.get("author") or {}).get("id"),
                "author_position": a.get("author_position"),
                "author_raw_name": (a.get("author") or {}).get("display_name"),
                "domain_slug": domain_slug,
            }
            for a in rec.get("authorships") or []
        ],
        "work_institutions": _inst_rows(rec, openalex_id, domain_slug),
        "work_topics": [
            {
                "openalex_id": openalex_id,
                "topic_id": t.get("id"),
                "topic_name": t.get("display_name"),
                "topic_score": t.get("score"),
                "topic_rank": t.get("rank"),
                "domain_slug": domain_slug,
            }
            for t in rec.get("topics") or []
        ],
        "work_keywords": [
            {
                "openalex_id": openalex_id,
                "keyword_id": k.get("id"),
                "keyword_name": k.get("display_name"),
                "keyword_score": k.get("score"),
                "domain_slug": domain_slug,
            }
            for k in rec.get("keywords") or []
        ],
        "work_refs": [
            {
                "openalex_id": openalex_id,
                "referenced_work_id": ref,
                "domain_slug": domain_slug,
            }
            for ref in rec.get("referenced_works") or []
        ],
    }


# --- dedup -------------------------------------------------------------------

def dedup_works(rows: list[dict]) -> tuple[list[dict], int]:
    """Dedup on openalex_id. Keep-first policy (§Phase 2): the first record
    in input order wins, except a strictly newer updated_datetime replaces
    it. Exactly one row per openalex_id is returned."""
    best: dict[str, dict] = {}
    for r in rows:
        key = r["openalex_id"]
        if key not in best:
            best[key] = r
            continue
        cur_ts = best[key].get("updated_datetime") or ""
        new_ts = r.get("updated_datetime") or ""
        if new_ts > cur_ts:
            best[key] = r
    kept = list(best.values())
    return kept, len(rows) - len(kept)


# --- writer ------------------------------------------------------------------

def write_parquet(rows: list[dict], schema: pa.Schema, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        # write an empty (schema-carrying) table so the partition exists
        table = pa.Table.from_pylist([], schema=schema)
    else:
        table = pa.Table.from_pylist(rows, schema=schema)
    tmp = out_path.with_suffix(".parquet.tmp")
    pq.write_table(table, tmp, compression="zstd", use_dictionary=True)
    tmp.rename(out_path)


def read_records(batch_paths: list[Path]) -> list[dict]:
    records = []
    for path in sorted(batch_paths):
        opener = gzip.open if path.suffix == ".gz" else open
        with opener(path, "rt", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
    return records


TABLES = {
    "works": (WORKS_SCHEMA, lambda n: [n["work"]]),
    "work_authors": (WORK_AUTHORS_SCHEMA, lambda n: n["work_authors"]),
    "work_institutions": (WORK_INSTITUTIONS_SCHEMA, lambda n: n["work_institutions"]),
    "work_topics": (WORK_TOPICS_SCHEMA, lambda n: n["work_topics"]),
    "work_keywords": (WORK_KEYWORDS_SCHEMA, lambda n: n["work_keywords"]),
    "work_refs": (WORK_REFS_SCHEMA, lambda n: n["work_refs"]),
}


class Normalizer:
    def __init__(self, staged_dir: Path) -> None:
        self.staged_dir = staged_dir

    def normalize_domain(
        self,
        domain: str,
        raw_domain_dir: Path,
        run_id: str,
        quarantine_dir: Path | None = None,
    ) -> NormalizeReport:
        report = NormalizeReport(domain=domain, run_id=run_id)
        quarantine_dir = quarantine_dir or (self.staged_dir / "staged_quarantine")

        batch_paths = sorted(raw_domain_dir.glob("batch_*.jsonl.gz"))
        records = read_records(batch_paths)
        report.records_in = len(records)

        # pass 1: normalize + dedup (pre-year filtering — keep-first §Phase 2)
        normalized = [normalize_record(r, domain, run_id) for r in records]
        works, dedup_removed = dedup_works([n["work"] for n in normalized])
        # align fan-out rows to dedup'd works: keep only records whose work
        # row IS the dedup'd row (identity, not openalex_id — siblings die)
        kept_work_ids = {id(w) for w in works}
        normalized = [n for n in normalized if id(n["work"]) in kept_work_ids]
        report.dedup_removed = dedup_removed

        # pass 2: year hygiene — quarantine in-range-missing and out-of-range
        kept_normalized: list[dict] = []
        quarantined_works: list[dict] = []
        for n in normalized:
            y = n["work"]["publication_year"]
            if y is None:
                report.year_quarantined += 1
                quarantined_works.append(n["work"])
            elif y < YEAR_MIN or y > YEAR_MAX:
                report.year_gated += 1
                quarantined_works.append(n["work"])
            else:
                kept_normalized.append(n)

        # pass 3: abstract stats + DOI stats
        for n in kept_normalized:
            if n["work"]["abstract"]:
                report.abstracts_reconstructed += 1
            else:
                report.abstracts_unreconstructable += 1
            if n["work"]["doi"]:
                report.dois_normalized += 1

        # write works
        works_rows = [n["work"] for n in kept_normalized]
        staged_cls = TABLES
        for table_name, (schema, extract) in staged_cls.items():
            if table_name == "works":
                rows = works_rows
            else:
                rows = [r for n in kept_normalized for r in extract(n)]
            report.table_rows[table_name] = len(rows)
            # partition: works partitioned per row's year; others per run+domain
            if table_name == "works":
                by_year: dict[int, list[dict]] = {}
                for w in rows:
                    by_year.setdefault(w["publication_year"], []).append(w)
                for year, chunk in sorted(by_year.items()):
                    out = self.staged_dir / table_name / f"domain={domain}" / f"year={year}" / f"part-{run_id}.parquet"
                    write_parquet(chunk, schema, out)
            else:
                out = self.staged_dir / table_name / f"domain={domain}" / f"year={run_id[:4]}" / f"part-{run_id}.parquet"
                write_parquet(rows, schema, out)

        # quarantine partition (never silently dropped §Phase 2)
        if quarantined_works:
            qy = "null_year" if report.year_quarantined and not report.year_gated else "out_of_range"
            out = quarantine_dir / f"domain={domain}" / f"reason={qy}" / f"part-{run_id}.parquet"
            write_parquet(quarantined_works, WORKS_SCHEMA, out)

        report.finished_utc = datetime.now(timezone.utc).isoformat()
        (self.staged_dir / f"normalize_{domain}_{run_id}.json").write_text(
            report.to_json(), encoding="utf-8"
        )
        return report
