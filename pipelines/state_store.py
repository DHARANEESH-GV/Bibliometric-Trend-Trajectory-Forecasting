"""Pipeline state store — local mirror of the DDB `pipeline_state` table.

DDB shape (locked §10): PK = `{source}#{domain}`
  attributes: cursor, last_run_id, last_run_timestamp, mode, status,
              pages_fetched, record_count, byte_total, version

Local implementation: JSON file per `{source}#{domain}` key under
`.state/pipeline_state/`. The Phase 7 AWS swap-out replaces this module's
internals with boto3 conditional-update semantics — the interface the
fetcher depends on (get/put with mode + cursor durability) does not change.

The `version` attribute exists for the DDB conditional-update pattern
(safe against concurrent invocations); locally it increments per put.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


class StateStore:
    def __init__(self, state_dir: Path, source: str = "openalex") -> None:
        self.state_dir = Path(state_dir)
        self.source = source
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def _key_path(self, domain: str) -> Path:
        # DDB PK mirror: `{source}#{domain}` — filesystem-safe encoding
        return self.state_dir / f"{self.source}#{domain}.json"

    def _pk(self, domain: str) -> str:
        return f"{self.source}#{domain}"

    def get(self, domain: str) -> dict | None:
        path = self._key_path(domain)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def put(self, domain: str, **attrs) -> dict:
        path = self._key_path(domain)
        current = self.get(domain) or {}
        record = {
            "PK": self._pk(domain),
            "cursor": attrs.get("cursor", ""),
            "mode": attrs.get("mode", ""),
            "last_run_id": attrs.get("last_run_id", ""),
            "last_run_timestamp": attrs.get(
                "last_run_timestamp", datetime.now(timezone.utc).isoformat()
            ),
            "status": attrs.get("status", "in_progress"),
            "pages_fetched": attrs.get("pages_fetched", 0),
            "record_count": attrs.get("record_count", 0),
            "byte_total": attrs.get("byte_total", 0),
            "version": int(current.get("version", 0)) + 1,
        }
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(record, indent=2, sort_keys=True), encoding="utf-8")
        tmp.rename(path)
        return record

    def mark_complete(self, domain: str, run_id: str) -> dict:
        current = self.get(domain) or {}
        return self.put(
            domain,
            cursor="",                      # consumed → re-walk starts fresh
            mode=current.get("mode", ""),
            last_run_id=run_id,
            status="complete",
            pages_fetched=current.get("pages_fetched", 0),
            record_count=current.get("record_count", 0),
            byte_total=current.get("byte_total", 0),
        )
