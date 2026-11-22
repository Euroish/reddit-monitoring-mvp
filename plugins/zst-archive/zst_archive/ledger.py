"""Local SQLite checkpoint ledger for idempotent resume of R4 archive push batches."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class IngestLedger:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path.resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingest_batch_ledger (
                source_id TEXT NOT NULL,
                content_fingerprint TEXT NOT NULL,
                idempotency_key TEXT NOT NULL,
                request_sha256 TEXT NOT NULL,
                item_count INTEGER NOT NULL,
                status TEXT NOT NULL,
                job_id TEXT,
                added INTEGER,
                updated INTEGER,
                accepted INTEGER,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (source_id, content_fingerprint)
            )
            """
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def get_succeeded(self, source_id: str, content_fingerprint: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            """
            SELECT idempotency_key, job_id, added, updated, accepted, updated_at
            FROM ingest_batch_ledger
            WHERE source_id = ? AND content_fingerprint = ? AND status = 'succeeded'
            """,
            (source_id, content_fingerprint),
        ).fetchone()
        if row is None:
            return None
        return {
            "idempotencyKey": row[0],
            "jobId": row[1],
            "added": row[2],
            "updated": row[3],
            "accepted": row[4],
            "updatedAt": row[5],
        }

    def record(
        self,
        *,
        source_id: str,
        content_fingerprint: str,
        idempotency_key: str,
        request_sha256: str,
        item_count: int,
        status: str,
        job_id: str | None = None,
        added: int | None = None,
        updated: int | None = None,
        accepted: int | None = None,
    ) -> None:
        now_iso = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        self.conn.execute(
            """
            INSERT INTO ingest_batch_ledger (
                source_id, content_fingerprint, idempotency_key, request_sha256,
                item_count, status, job_id, added, updated, accepted, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (source_id, content_fingerprint) DO UPDATE SET
                idempotency_key = excluded.idempotency_key,
                request_sha256 = excluded.request_sha256,
                item_count = excluded.item_count,
                status = excluded.status,
                job_id = COALESCE(excluded.job_id, ingest_batch_ledger.job_id),
                added = COALESCE(excluded.added, ingest_batch_ledger.added),
                updated = COALESCE(excluded.updated, ingest_batch_ledger.updated),
                accepted = COALESCE(excluded.accepted, ingest_batch_ledger.accepted),
                updated_at = excluded.updated_at
            """,
            (
                source_id,
                content_fingerprint,
                idempotency_key,
                request_sha256,
                item_count,
                status,
                job_id,
                added,
                updated,
                accepted,
                now_iso,
            ),
        )
        self.conn.commit()
