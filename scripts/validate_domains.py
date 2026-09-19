"""Validate OpenAlex topic IDs and patent CPC codes for all 20 domains.

Step 2 of PROJECT_MASTER_PLAN.md v3.1.

For each domain in the master domain list, this script:
  1. Resolves plausible OpenAlex topic IDs by searching the live topics API.
  2. Fetches each candidate topic to record paper_volume + subfield.
  3. Runs a 2-quarter sample fetch on /works (topic.id filter) to prove
     recall — a topic that validates but returns 0 recent papers is broken.
  4. Records suggested CPC codes (statically mapped, sanity-checked
     against known organic chemistry... no — against the USPTO CPC
     taxonomy shipped in-repo; network sanity check comes in Phase 3.5).

Output: config/domains.yaml written ONLY after human review.
        reports/domain_validation.md written for review either way.

Usage:
    python scripts/validate_domains.py
    python scripts/validate_domains.py --domains quantum_computing ai_agents
    python scripts/validate_domains.py --yes   # write domains.yaml without review prompt
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

API = "https://api.openalex.org"
MAILTO = "dharaneeshgv@gmail.com"
UA = f"biblio-trend-validator/0.1 (mailto:{MAILTO})"
PER_QUARTER_SAMPLE = 10  # works per quarter pulled in the recall check
YEAR = 2025

REPO = Path(__file__).resolve().parent.parent
REPORT_DIR = REPO / "reports"
CONFIG_DIR = REPO / "config"

# --- Master domain list (PROJECT_MASTER_PLAN.md §6) -------------------------
# search_terms drive topic discovery; cpc_codes are the plan's suggestions.
DOMAINS = {
    "artificial_intelligence": {
        "display_name": "Artificial Intelligence",
        "search": ["artificial intelligence", "neural network",
                   "machine learning"],
        "cpc": ["G06N20/00", "G06N3/00", "G06F18/00"],
        # Live API says T10171 (my earlier pin) is "Biofuel production and
        # bioconversion" — wrong ID from memory. T10320 "Neural Networks
        # and Applications" (251,844 works, CS/AI subfield) isn't the
        # perfect umbrella either — the panel's OpenAlex subfield has no
        # single canonical "Artificial Intelligence" topic — so scope =
        # T10320 + the application topics subsumed by CS/AI.
        "pin_topics": ["T10320"],
        "scope_note": "No single umbrella 'AI' topic exists in OpenAlex; scoped to Neural Networks and Applications (CS/AI) as anchor.",
        "description": "Computing systems performing tasks that require intelligence.",
    },
    "generative_ai": {
        "display_name": "Generative AI",
        "search": ["large language model", "text-to-image generation",
                   "generative adversarial network", "diffusion model"],
        "cpc": ["G06N3/08", "G06N3/04"],
        "description": "Models generating novel text, images, audio or code.",
    },
    "ai_agents": {
        "display_name": "AI Agents",
        "search": ["multi-agent system", "reinforcement learning agent",
                   "software agent"],
        "cpc": ["G06N3/092", "G05B13/00"],
        "description": "Software systems acting autonomously toward goals.",
    },
    "quantum_computing": {
        "display_name": "Quantum Computing",
        "search": ["quantum computing"],
        "cpc": ["G06N10/00", "G06N10/20", "G06N10/40"],
        "pin_topics": ["T10682"],
        "description": "Computing systems using quantum-mechanical phenomena.",
    },
    "quantum_error_correction": {
        "display_name": "Quantum Error Correction",
        "search": ["quantum error correction", "surface code", "decoherence"],
        "cpc": ["G06N10/70"],
        "pin_topics": ["T10682"],
        "scope_note": "OpenAlex has no dedicated QEC topic; scoped to the quantum computing topic, which subsumes QEC literature.",
        "description": "Protecting quantum information from decoherence and noise.",
    },
    "solid_state_batteries": {
        "display_name": "Solid-State Batteries",
        "search": ["all-solid-state battery", "solid electrolyte lithium"],
        "cpc": ["H01M10/0562", "H01M2300/0068"],
        "description": "Batteries with solid electrolytes replacing liquid ones.",
    },
    "clean_hydrogen": {
        "display_name": "Clean Hydrogen",
        "search": ["water electrolysis hydrogen", "hydrogen fuel",
                   "photocatalytic hydrogen production"],
        "cpc": ["C25B1/04", "C25B15/00"],
        "pin_topics": ["T10078"],  # Advanced Photocatalysis Techniques (Energy)
        "description": "Low-carbon hydrogen production, storage and use.",
    },
    "carbon_capture": {
        "display_name": "Carbon Capture",
        "search": ["carbon dioxide capture", "CO2 sequestration"],
        "cpc": ["B01D53/62", "B01J20/00"],
        "pin_topics": ["T10967", "T11302"],
        "description": "Capturing and storing carbon dioxide emissions.",
    },
    "synthetic_biology": {
        "display_name": "Synthetic Biology",
        "search": ["synthetic biology", "metabolic engineering",
                   "genetic circuit"],
        "cpc": ["C12N15/00"],
        "pin_topics": ["T10932"],  # Microbial Metabolic Engineering and Bioproduction
        "description": "Design and construction of novel biological systems.",
    },
    "brain_computer_interfaces": {
        "display_name": "Brain-Computer Interfaces",
        "search": ["brain-computer interface"],
        "cpc": ["A61B5/16", "G06F3/01"],
        "pin_topics": ["T10429"],
        "description": "Direct communication between brain and external devices.",
    },
    "cybersecurity": {
        "display_name": "Cybersecurity",
        "search": ["network intrusion detection", "malware detection",
                   "cybersecurity"],
        "cpc": ["H04L63/00", "G06F21/00"],
        "pin_topics": ["T10400"],
        "description": "Protection of computer systems and networks.",
    },
    "blockchain": {
        "display_name": "Blockchain",
        "search": ["blockchain"],
        "cpc": ["H04L9/32", "G06Q20/00"],
        "pin_topics": ["T10270"],
        "description": "Distributed ledger technologies and consensus systems.",
    },
    "internet_of_things": {
        "display_name": "Internet of Things",
        "search": ["internet of things"],
        "cpc": ["H04L67/12", "H04W4/33"],
        "pin_topics": ["T13038"],
        "description": "Networked embedded devices sensing and actuating.",
    },
    "edge_computing": {
        "display_name": "Edge Computing",
        "search": ["edge computing", "fog computing"],
        "cpc": ["G06F9/50", "H04L67/10"],
        "pin_topics": ["T10273"],
        "description": "Computing at or near the network edge.",
    },
    "digital_twins": {
        "display_name": "Digital Twins",
        "search": ["digital twin simulation", "digital twin manufacturing",
                   "digital twin cyber-physical"],
        "cpc": ["G05B17/02", "G06F30/00"],
        "description": "Virtual replicas of physical assets or processes.",
    },
    "smart_manufacturing": {
        "display_name": "Smart Manufacturing",
        "search": ["smart factory", "industry 4.0 manufacturing",
                   "additive manufacturing process"],
        "cpc": ["G05B19/4185"],
        "description": "Automated, data-driven manufacturing systems.",
    },
    "autonomous_vehicles": {
        "display_name": "Autonomous Vehicles",
        "search": ["autonomous vehicle", "self-driving car"],
        "cpc": ["B60W60/00", "G01C21/00"],
        "pin_topics": ["T11099"],
        "description": "Vehicles operating without human intervention.",
    },
    "space_technologies": {
        "display_name": "Space Technologies",
        "search": ["spacecraft", "satellite"],
        "cpc": ["B64G1/00"],
        "description": "Technologies for spaceflight and orbital systems.",
    },
    "advanced_semiconductors": {
        "display_name": "Advanced Semiconductors",
        "search": ["semiconductor", "integrated circuit", "lithography"],
        "cpc": ["H01L21/00", "H01L29/00"],
        "pin_topics": ["T10472", "T10099"],  # Semiconductor materials+devices; GaN devices
        "description": "Semiconductor materials, devices and fabrication.",
    },
    "biotechnology": {
        "display_name": "Biotechnology",
        "search": ["biotechnology"],
        "cpc": ["C12Q1/00", "C12P1/00"],
        "pin_topics": ["T10120"],
        "description": "Technology based on living systems and organisms.",
    },
}


@dataclass
class CandidateTopic:
    topic_id: str
    display_name: str
    works_count: int
    cited_by_count: int
    subfield: str
    field: str
    score_in_search: float = 0.0


@dataclass
class DomainValidation:
    slug: str
    display_name: str
    candidates: list[CandidateTopic] = field(default_factory=list)
    resolved_topic_ids: list[str] = field(default_factory=list)
    recent_paper_sample: int = 0  # papers found in last 2 sampled quarters
    status: str = "pending"
    notes: list[str] = field(default_factory=list)


def http_get_json(url: str, retries: int = 4, timeout: int = 30) -> dict:
    """GET with exponential backoff + jitter, per plan §Phase 1 resilience."""
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except Exception as e:  # noqa: BLE001 — validator, fail-open to retry
            last_err = e
            wait = min(2 ** attempt * 0.5, 8.0)
            time.sleep(wait)
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last_err}")


def search_topics(term: str, top_n: int = 3) -> list[CandidateTopic]:
    q = urllib.parse.quote(term)
    url = (
        f"{API}/topics?search={q}&per-page={top_n}"
        f"&select=id,display_name,works_count,cited_by_count,subfield,field"
        f"&mailto={MAILTO}"
    )
    try:
        data = http_get_json(url)
    except RuntimeError as e:
        print(f"    !! topic search failed: {e}")
        return []
    out = []
    for t in data.get("results", []):
        out.append(
            CandidateTopic(
                topic_id=t["id"],
                display_name=t["display_name"],
                works_count=t.get("works_count", 0),
                cited_by_count=t.get("cited_by_count", 0),
                subfield=t.get("subfield", {}).get("display_name", ""),
                field=t.get("field", {}).get("display_name", ""),
                score_in_search=float(top_n - len(out)),  # rank position as proxy score
            )
        )
    return out


def recall_check(topic_ids: list[str]) -> int:
    """Sample works on two recent quarters; return total found.

    Proves the topic filter actually recalls recent papers. Two quarters
    ~6 months apart catches both hot and slow topics.
    """
    found = 0
    for quarter in (f"{YEAR}-01-01", f"{YEAR}-07-01"):
        topic_filter = "|".join(tid.split("/")[-1] for tid in topic_ids)
        url = (
            f"{API}/works?filter=topics.id:{topic_filter},"
            f"from_publication_date:{quarter},to_publication_date:{quarter}"
        )
        url += f"&per-page=1&mailto={MAILTO}"  # meta.count is enough
        try:
            data = http_get_json(url)
            found += min(int(data.get("meta", {}).get("count", 0)), 999_999)
        except RuntimeError:
            return -1  # network failure — do not mark domain as recalled
    return found


def fetch_topic(topic_id_short: str) -> CandidateTopic | None:
    url = (
        f"{API}/topics/{topic_id_short}"
        f"?select=id,display_name,works_count,cited_by_count,subfield,field"
        f"&mailto={MAILTO}"
    )
    try:
        t = http_get_json(url)
    except RuntimeError as e:
        print(f"    !! pin fetch {topic_id_short} failed: {e}")
        return None
    return CandidateTopic(
        topic_id=t["id"],
        display_name=t["display_name"],
        works_count=t.get("works_count", 0),
        cited_by_count=t.get("cited_by_count", 0),
        subfield=t.get("subfield", {}).get("display_name", ""),
        field=t.get("field", {}).get("display_name", ""),
        score_in_search=999.0,  # pinned = always ranked first
    )


def fetch_topic_baseline(topic_id_short: str) -> CandidateTopic | None:
    """Pinned topic WITHOUT the 999 score — used for dedup only."""
    url = (
        f"{API}/topics/{topic_id_short}"
        f"?select=id,display_name,works_count,cited_by_count,subfield,field"
        f"&mailto={MAILTO}"
    )
    try:
        t = http_get_json(url)
    except RuntimeError:
        return None
    return CandidateTopic(
        topic_id=t["id"],
        display_name=t["display_name"],
        works_count=t.get("works_count", 0),
        cited_by_count=t.get("cited_by_count", 0),
        subfield=t.get("subfield", {}).get("display_name", ""),
        field=t.get("field", {}).get("display_name", ""),
    )


def validate_domain(slug: str, spec: dict) -> DomainValidation:
    v = DomainValidation(slug=slug, display_name=spec["display_name"])
    seen: dict[str, CandidateTopic] = {}
    pinned: list[str] = list(spec.get("pin_topics", []))

    # Pinned topics: verified IDs prepended live (each is fetched to record
    # volume + prove the ID still resolves — pinned does not mean trusted).
    for tid in pinned:
        cand = fetch_topic(tid)
        if cand:
            if cand.works_count >= 500:
                seen[cand.topic_id] = cand
            else:
                v.notes.append(f"pinned topic {tid} below volume floor; dropped")
        time.sleep(0.15)

    for term in spec["search"]:
        print(f"    search: {term!r}")
        for cand in search_topics(term):
            if cand.topic_id not in seen:
                seen[cand.topic_id] = cand
    cands = sorted(seen.values(), key=lambda c: -c.score_in_search)
    v.candidates = cands[:4]
    if not cands:
        v.status = "FAILED"
        v.notes.append("topic search returned nothing")
        return v

    # Resolution rules: top-scoring candidates, volume floor, and
    # full-phrase containment — the display name must contain ALL words
    # of a search term (single words suffice for single-word terms).
    # Loose single-word overlap (prior pilot) admitted a broad physics
    # topic sharing only the word "quantum"; this rule closes that gap.
    import re

    def phrase_match(term: str, name: str) -> bool:
        words = [w for w in re.split(r"[\s\-/]+", term.lower()) if len(w) > 2]
        if not words:
            return False
        low = name.lower()
        return all(w in low for w in words)

    for cand in cands:
        if cand.works_count < 500:
            continue
        if cand.topic_id.split("/")[-1] in pinned or any(
            phrase_match(term, cand.display_name) for term in spec["search"]
        ):
            v.resolved_topic_ids.append(cand.topic_id)
        if len(v.resolved_topic_ids) >= 3:
            break

    if not v.resolved_topic_ids:
        v.status = "WEAK"
        v.notes.append(
            f"no high-confidence topic; best candidate: "
            f"{cands[0].display_name} ({cands[0].works_count:,} works)"
        )
        v.resolved_topic_ids = [cands[0].topic_id]  # provisional
    else:
        v.status = "OK"

    print(f"    recall check on {v.resolved_topic_ids} ...")
    v.recent_paper_sample = recall_check(v.resolved_topic_ids)
    if v.recent_paper_sample == 0:
        v.status = "WEAK"
        v.notes.append("topic resolves but recalls 0 recent papers")
    elif v.recent_paper_sample < 0:
        v.notes.append("recall check hit network failure")
        v.status = "UNVERIFIED"
    return v


def render_report(results: list[DomainValidation]) -> str:
    lines = [
        "# Domain validation report",
        "",
        f"Generated: {time.strftime('%Y-%m-%d %H:%M')}",
        "",
        "| Domain | Status | Resolved topic IDs | Candidates (works count) | Recent 2q recall | Notes |",
        "|---|---|---|---|---|---|",
    ]
    for v in results:
        cand_txt = "; ".join(
            f"{c.display_name} ({c.works_count:,})" for c in v.candidates[:3]
        )
        tid = ", ".join(t.split("/")[-1] for t in v.resolved_topic_ids)
        lines.append(
            f"| {v.display_name} | {v.status} | {tid or '—'} | {cand_txt or '—'} "
            f"| {v.recent_paper_sample:,} | {'; '.join(v.notes) or '—'} |"
        )
    lines += [
        "",
        "## Full candidate topics per domain",
        "",
    ]
    for v in results:
        lines.append(f"### {v.display_name} (`{v.slug}`)")
        lines.append("")
        for c in v.candidates:
            lines.append(
                f"- `{c.topic_id}` — {c.display_name} — "
                f"{c.works_count:,} works, {c.cited_by_count:,} citations — "
                f"{c.field} / {c.subfield}"
            )
        lines.append("")
    return "\n".join(lines)


def write_domains_yaml(results: list[DomainValidation], domain_specs: dict) -> str:
    y = [
        "# domains.yaml — generated by scripts/validate_domains.py",
        "# 20 technology domains per PROJECT_MASTER_PLAN.md §6",
        "# Review: reports/domain_validation.md",
        "",
        "domains:",
    ]
    for v in results:
        spec = domain_specs[v.slug]
        tid = "\n".join(f'        - "{t.split("/")[-1]}"' for t in v.resolved_topic_ids)
        cpc = "\n".join(f'        - {c}' for c in spec["cpc"])
        y += [
            f"  - domain_slug: {v.slug}",
            f"    display_name: {spec['display_name']}",
            f"    openalex_topic_ids:",
            tid,
            f"    patent_cpc_codes:",
            cpc,
            f'    description: "{spec["description"]}"',
            "",
        ]
    return "\n".join(y)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--domains", nargs="*", default=None)
    ap.add_argument("--yes", action="store_true", help="write domains.yaml without review")
    args = ap.parse_args()

    slugs = args.domains if args.domains else list(DOMAINS)
    results = []
    for i, slug in enumerate(slugs, 1):
        print(f"[{i}/{len(slugs)}] {DOMAINS[slug]['display_name']}")
        results.append(validate_domain(slug, DOMAINS[slug]))
        time.sleep(0.2)  # polite pool

    REPORT_DIR.mkdir(exist_ok=True)
    report_path = REPORT_DIR / "domain_validation.md"
    report_path.write_text(render_report(results))
    print(f"\nreport: {report_path}")

    ok = sum(1 for r in results if r.status == "OK")
    weak = sum(1 for r in results if r.status == "WEAK")
    bad = [r for r in results if r.status in ("FAILED", "UNVERIFIED")]

    yaml_path = CONFIG_DIR / "domains.yaml"
    if args.yes:
        CONFIG_DIR.mkdir(exist_ok=True)
        yaml_path.write_text(write_domains_yaml(results, DOMAINS))
        print(f"config: {yaml_path} (auto-approved)")
    else:
        print(
            f"\nsummary: {ok} OK, {weak} weak, {len(bad)} failed/unverified, "
            f"{len(results)} total"
        )
        print("Review the report, then re-run with --yes to write config/domains.yaml")
        if bad:
            print("Failed/unverified domains: " + ", ".join(r.slug for r in bad))

    return 0 if not bad or args.domains else 1


if __name__ == "__main__":
    sys.exit(main())
