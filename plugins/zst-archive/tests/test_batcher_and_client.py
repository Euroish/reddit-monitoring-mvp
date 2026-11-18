from __future__ import annotations

import io
import json
import urllib.error
from email.message import Message
from pathlib import Path

from fixture_pkg import create_synthetic_package
from zst_archive.batcher import chunk_ingest_items
from zst_archive.cli import main as cli_main
from zst_archive.client import IngestHttpError
from zst_archive.ledger import IngestLedger
from zst_archive.mapper import map_selection
from zst_archive.packages import discover_packages
from zst_archive.query import QuerySpec, select_archive_threads


def test_chunker_dual_bounds_and_stable_fingerprint(tmp_path: Path) -> None:
    create_synthetic_package(tmp_path, "2026-10")
    pkgs = discover_packages(tmp_path)
    res = select_archive_threads(pkgs, QuerySpec(allow_unscoped=True, limit=10, max_comments_per_post=10))
    source_id = "22222222-2222-4222-8222-222222222222"

    items_1, _ = map_selection(res.posts, res.comments, source_id=source_id, fetched_at_iso="2026-11-18T00:00:00.000Z")
    items_2, _ = map_selection(res.posts, res.comments, source_id=source_id, fetched_at_iso="2026-11-19T00:00:00.000Z")

    batches_1 = chunk_ingest_items(items_1, source_id=source_id, max_items=2, max_body_bytes=75_000)
    batches_2 = chunk_ingest_items(items_2, source_id=source_id, max_items=2, max_body_bytes=75_000)

    assert len(batches_1) >= 3
    for b in batches_1:
        assert len(b.items) <= 2
        assert len(b.body_bytes) <= 75_000
    assert [b.content_fingerprint for b in batches_1] == [b.content_fingerprint for b in batches_2]


def test_cli_push_retries_429_and_resumes_from_ledger(tmp_path: Path, monkeypatch, capsys) -> None:
    create_synthetic_package(tmp_path / "arch", "2026-10")
    source_id = "33333333-3333-4333-8333-333333333333"
    ledger_path = tmp_path / "state" / "ledger.sqlite"
    received_calls: list[dict] = []
    attempt_counter = {"n": 0}

    class FakeResp:
        def __init__(self, status: int, body: bytes) -> None:
            self.status = status
            self._body = body

        def read(self) -> bytes:
            return self._body

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_urlopen(req, timeout=30.0):
        attempt_counter["n"] += 1
        if attempt_counter["n"] == 1:
            hdrs = Message()
            hdrs["Retry-After"] = "0"
            raise urllib.error.HTTPError(
                req.full_url,
                429,
                "Too Many Requests",
                hdrs,
                io.BytesIO(b'{"error":{"code":"http_429"}}'),
            )
        payload = json.loads(req.data.decode("utf-8"))
        headers_lower = {k.lower(): v for k, v in req.header_items()}
        received_calls.append({
            "url": req.full_url,
            "auth": headers_lower.get("authorization"),
            "idem": headers_lower.get("idempotency-key"),
            "count": len(payload["items"]),
        })
        resp_body = json.dumps({
            "jobId": f"00000000-0000-4000-8000-00000000000{len(received_calls)}",
            "added": len(payload["items"]),
            "updated": 0,
            "accepted": len(payload["items"]),
        }).encode("utf-8")
        return FakeResp(201, resp_body)

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("zst_archive.client.time.sleep", lambda _s: None)
    monkeypatch.setenv("TEST_ARCHIVE_TOKEN", "A" * 43)

    rc = cli_main([
        "push",
        "--archive-root", str(tmp_path / "arch"),
        "--subreddits", "localllama",
        "--source-id", source_id,
        "--api-url", "http://127.0.0.1:3000",
        "--token-env", "TEST_ARCHIVE_TOKEN",
        "--batch-size", "2",
        "--min-interval-ms", "0",
        "--ledger-path", str(ledger_path),
    ])
    assert rc == 0
    out1 = json.loads(capsys.readouterr().out)
    assert out1["totals"]["added"] == 4
    assert out1["totals"]["batchesSent"] == 2
    assert len(received_calls) == 2
    assert received_calls[0]["auth"] == "Bearer " + ("A" * 43)

    # Second invocation with resume skips already succeeded batches without HTTP calls
    rc2 = cli_main([
        "push",
        "--archive-root", str(tmp_path / "arch"),
        "--subreddits", "localllama",
        "--source-id", source_id,
        "--api-url", "http://127.0.0.1:3000",
        "--token-env", "TEST_ARCHIVE_TOKEN",
        "--batch-size", "2",
        "--min-interval-ms", "0",
        "--ledger-path", str(ledger_path),
    ])
    assert rc2 == 0
    out2 = json.loads(capsys.readouterr().out)
    assert out2["totals"]["skippedResume"] == 2
    assert out2["totals"]["batchesSent"] == 0
    assert len(received_calls) == 2

    ledger = IngestLedger(ledger_path)
    try:
        rows = ledger.conn.execute("SELECT COUNT(*) FROM ingest_batch_ledger WHERE status='succeeded'").fetchone()[0]
        assert rows == 2
    finally:
        ledger.close()


def test_non_retryable_409_fails_immediately(tmp_path: Path, monkeypatch) -> None:
    create_synthetic_package(tmp_path / "arch", "2026-10")
    source_id = "44444444-4444-4444-8444-444444444444"
    calls = {"n": 0}

    def fake_urlopen_409(req, timeout=30.0):
        calls["n"] += 1
        raise urllib.error.HTTPError(
            req.full_url,
            409,
            "Conflict",
            Message(),
            io.BytesIO(b'{"error":{"code":"http_409","message":"Ingest requires a push source"}}'),
        )

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen_409)
    monkeypatch.setenv("TEST_ARCHIVE_TOKEN", "B" * 43)

    rc = cli_main([
        "push",
        "--archive-root", str(tmp_path / "arch"),
        "--subreddits", "localllama",
        "--source-id", source_id,
        "--api-url", "http://127.0.0.1:3000",
        "--token-env", "TEST_ARCHIVE_TOKEN",
        "--ledger-path", str(tmp_path / "ledger.sqlite"),
    ])
    assert rc == 1
    assert calls["n"] == 1
