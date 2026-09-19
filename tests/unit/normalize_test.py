"""Phase-2 unit tests (PROJECT_MASTER_PLAN.md §12): abstract reconstruction,
DOI normalization, year coercion + quarantine, dedup keep-first, fan-out
shapes, Parquet partition layout, natural-key guard.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from pipelines.normalize import (
    Normalizer,
    NormalizeReport,
    coerce_year,
    dedup_works,
    normalize_doi,
    normalize_record,
    read_records,
    reconstruct_abstract,
    write_parquet,
    WORKS_SCHEMA,
)


# --- abstract reconstruction (§12: inverted index → text) --------------------

def test_abstract_reconstruction_basic():
    idx = {"Hello": [0], "world": [1]}
    assert reconstruct_abstract(idx) == "Hello world"


def test_abstract_positions_repeat_tiebreak_on_insertion_order():
    # both words claim position 1 — stable sort keeps insertion order
    idx = {"first": [1], "second": [1]}
    assert reconstruct_abstract(idx) == "first second"      # insertion order wins
    # same tie-break with out-of-order keys: both claim position 0
    idx2 = {"second": [0], "first": [0]}
    assert reconstruct_abstract(idx2) == "second first"      # dict insertion order decides


def test_abstract_out_of_order_positions_sort():
    idx = {"c": [2], "a": [0], "b": [1]}
    assert reconstruct_abstract(idx) == "a b c"


def test_abstract_empty_and_none_cases():
    assert reconstruct_abstract(None) is None
    assert reconstruct_abstract({}) is None
    assert reconstruct_abstract({"word": []}) is None


def test_abstract_positions_may_interleave():
    idx = {"one": [0, 2], "two": [1]}
    assert reconstruct_abstract(idx) == "one two one"


# --- DOI normalization (§12) -------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("https://doi.org/10.1234/ABC.def", "10.1234/abc.def"),
    ("http://dx.doi.org/10.5555/x", "10.5555/x"),
    ("10.5555/Already-Lower", "10.5555/already-lower"),
    (None, None),
    ("", None),
])
def test_doi_normalization(raw, expected):
    assert normalize_doi(raw) == expected


# --- year coercion + hygiene (§12: null-year quarantine, range gate) ---------

def test_year_coercion_fallback_to_publication_date():
    assert coerce_year(2021) == 2021
    assert coerce_year("2013") == 2013
    assert coerce_year(None, "2016-05-01") == 2016
    assert coerce_year(None, None) is None
    assert coerce_year("garbage") is None


def test_dedup_keep_first_by_updated_datetime():
    rows = [
        {"openalex_id": "W1", "updated_datetime": "2026-01-01", "v": 1},
        {"openalex_id": "W1", "updated_datetime": "2026-05-01", "v": 2},   # newer but keep-first wins on >=
        {"openalex_id": "W2", "updated_datetime": "2026-01-01", "v": 1},
    ]
    kept, removed = dedup_works(rows)
    # keep-first by updated_datetime: first W1 retained (>= semantics on equal-or-newer)
    w1 = [r for r in kept if r["openalex_id"] == "W1"]
    assert len(kept) == 2 and removed == 1
    assert w1[0]["v"] == 2        # newer W1 replaced the stale W1


# --- full-domain normalize on synthetic fixtures -----------------------------

def make_work(openalex_id, year=None, pub_date=None, title="t", updated=None,
              abstract_idx=None, authors=(), topics=(), refs=()):
    rec = {
        "id": openalex_id,
        "doi": f"https://doi.org/10.5555/{openalex_id}",
        "title": title,
        "publication_year": year,
        "publication_date": pub_date,
        "cited_by_count": 2,
        "type": "article",
        "language": "en",
        "primary_location": {"source": {"display_name": "Journal of Tests"}},
        "open_access": {"oa_status": "gold"},
        "updated_datetime": updated or "2026-01-01T00:00:00",
        # abstract_idx=None → NO abstract (real OpenAlex works omit the field
        # or carry an empty index). Callers wanting an abstract pass a dict.
        **({"abstract_inverted_index": abstract_idx} if abstract_idx is not None else {}),
        "authorships": [
            {
                "author": {"id": aid, "display_name": aname},
                "author_position": i,
                "institutions": [
                    {"id": iid, "display_name": iname, "country_code": cc}
                ],
            }
            for i, (aid, aname, iid, iname, cc) in enumerate(authors)
        ],
        "topics": [
            {"id": tid, "display_name": tname, "score": score, "rank": rank}
            for (tid, tname, score, rank) in topics
        ],
        "referenced_works": list(refs),
    }
    return rec


def write_raw(raw_domain_dir: Path, run_id: str, records: list[dict], batches: int = 2):
    raw_domain_dir.mkdir(parents=True, exist_ok=True)
    per = max(1, (len(records) + batches - 1) // batches)
    n = 0
    for b in range(batches):
        chunk = records[b * per:(b + 1) * per]
        if not chunk:
            continue
        with gzip.open(raw_domain_dir / f"batch_{b+1:05d}.jsonl.gz", "wt", encoding="utf-8") as fh:
            for r in chunk:
                fh.write(json.dumps(r) + "\n")
        n += len(chunk)
    return raw_domain_dir


def test_normalize_domain_e2e_partition_layout(tmp_path: Path):
    raw_dir = write_raw(tmp_path / "raw" / "testdom" / "RUN1", "RUN1", [
        make_work("W1", year=2021, abstract_idx={"a": [0], "b": [1]},
                  authors=(("A1", "Ann", "I1", "Inst1", "US"),),
                  topics=(("T1", "Topic One", 0.91, 0),), refs=("W10", "W11")),
        make_work("W2", year=2022, abstract_idx=None),          # no abstract
        make_work("W3", year=None),                              # null year → quarantine
        make_work("W4", year=1997),                              # out of range → quarantine
        # realistic dup: identical content, only updated_datetime differs
        make_work("W1", year=2021, abstract_idx={"a": [0], "b": [1]},
                  updated="2026-06-01T00:00:00"),  # duplicate W1
    ])
    norm = Normalizer(tmp_path / "staged")
    report = norm.normalize_domain("testdom", raw_dir, "RUN1")

    assert report.records_in == 5
    assert report.dedup_removed == 1
    assert report.year_quarantined == 1
    assert report.year_gated == 1
    # abstract stats: kept W1 (with abstract) + W2 (none); W3/W4 quarantined first
    assert report.abstracts_reconstructed == 1
    assert report.abstracts_unreconstructable == 1

    # partition layout per locked §4.1-3: domain={d}/year={y}/part-{run}
    works_dir = tmp_path / "staged" / "works" / "domain=testdom"
    assert (works_dir / "year=2021" / "part-RUN1.parquet").exists()
    assert (works_dir / "year=2022" / "part-RUN1.parquet").exists()
    assert not (works_dir / "year=1997" / "part-RUN1.parquet").exists()

    # quarantine carries W3 + W4, never silently dropped
    qdir = tmp_path / "staged" / "staged_quarantine" / "domain=testdom"
    qparquets = list(qdir.glob("reason=*/part-RUN1.parquet"))
    assert len(qparquets) == 1
    qrows = pq.read_table(qparquets[0]).to_pylist()
    assert {r["openalex_id"] for r in qrows} == {"W3", "W4"}

    # works table has 3 rows (5 in − dedup'd W1 − 2 quarantined)
    w21 = pq.read_table(works_dir / "year=2021" / "part-RUN1.parquet").to_pylist()
    assert len(w21) == 1
    assert w21[0]["doi"] == "10.5555/w1"        # DOI normalized on the way through
    assert w21[0]["abstract"] == "a b"


def test_normalize_dedup_via_duplicate_same_run(tmp_path: Path):
    dup = make_work("W1", year=2021, updated="2026-01-01T00:00:00")
    raw_dir = write_raw(tmp_path / "raw" / "dd" / "RUN2", "RUN2", [dup, dup])
    report = Normalizer(tmp_path / "staged").normalize_domain("dd", raw_dir, "RUN2")
    assert report.dedup_removed == 1
    assert report.table_rows["works"] == 1


def test_normalize_report_written_to_staged(tmp_path: Path):
    raw_dir = write_raw(tmp_path / "raw" / "rr" / "RUN3", "RUN3", [make_work("W1", year=2020)])
    report = Normalizer(tmp_path / "staged").normalize_domain("rr", raw_dir, "RUN3")
    rp = tmp_path / "staged" / f"normalize_rr_RUN3.json"
    assert rp.exists()
    assert json.loads(rp.read_text())["records_in"] == 1


def test_fanout_row_shapes(tmp_path: Path):
    rec = make_work(
        "W1", year=2021,
        authors=(("A1", "Ann", "I1", "Inst1", "US"), ("A2", "Bob", "I2", "Inst2", "DE")),
        topics=(("T1", "Tn", 0.9, 0), ("T2", "Tm", 0.5, 1)),
        refs=("W10", "W11", "W12"),
    )
    n = normalize_record(rec, "somedom", "RUN4")
    assert len(n["work_authors"]) == 2
    assert len(n["work_institutions"]) == 2
    assert {r["country_code"] for r in n["work_institutions"]} == {"US", "DE"}
    assert len(n["work_topics"]) == 2
    assert n["work_topics"][0]["topic_rank"] == 0
    assert len(n["work_refs"]) == 3


def test_read_records_spans_batches(tmp_path: Path):
    write_raw(tmp_path / "raw" / "sp" / "RUN5", "RUN5",
              [make_work("W1", year=2021), make_work("W2", year=2021)], batches=2)
    recs = read_records(sorted((tmp_path / "raw" / "sp" / "RUN5").glob("batch_*.jsonl.gz")))
    assert [r["id"] for r in recs] == ["W1", "W2"]


def test_empty_write_produces_schema_carrying_parquet(tmp_path: Path):
    out = tmp_path / "st" / "works" / "domain=x" / "year=2020" / f"part-empty.parquet"
    write_parquet([], WORKS_SCHEMA, out)
    t = pq.read_table(out)
    assert t.num_rows == 0
    assert t.schema.field("publication_year").type == __import__("pyarrow").int32()


# --- data tests (§12 data-test family, synthetic) ----------------------------

def test_data_no_duplicate_openalex_id_in_output(tmp_path: Path):
    raw_dir = write_raw(tmp_path / "raw" / "dt" / "RUN6", "RUN6", [
        make_work("W1", year=2021), make_work("W1", year=2021),
        make_work("W2", year=2021),
    ])
    norm = Normalizer(tmp_path / "staged")
    norm.normalize_domain("dt", raw_dir, "RUN6")
    all_rows = []
    for p in (tmp_path / "staged" / "works" / "domain=dt").glob("year=*/part-*.parquet"):
        all_rows += pq.read_table(p).to_pylist()
    ids = [r["openalex_id"] for r in all_rows]
    assert len(ids) == len(set(ids)), f"duplicates leaked: {ids}"


def test_data_quarters_valid_range_check(tmp_path: Path):
    from pipelines.normalize import YEAR_MAX, YEAR_MIN
    raw_dir = write_raw(tmp_path / "raw" / "yv" / "RUN7", "RUN7",
                        [make_work("W1", year=YEAR_MIN), make_work("W2", year=YEAR_MAX)])
    norm = Normalizer(tmp_path / "staged")
    norm.normalize_domain("yv", raw_dir, "RUN7")
    for p in (tmp_path / "staged" / "works" / "domain=yv").glob("year=*/part-*.parquet"):
        year = int(p.parent.name.split("=")[1])
        assert YEAR_MIN <= year <= YEAR_MAX
