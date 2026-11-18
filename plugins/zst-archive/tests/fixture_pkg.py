"""Synthetic open-corpus-v1 monthly package builder for tests."""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

POST_SCHEMA = pa.schema([
    ("doc_id", pa.uint32()),
    ("content_key", pa.string()),
    ("created_utc", pa.int64()),
    ("community", pa.string()),
    ("author_key", pa.string()),
    ("score", pa.int32()),
    ("reported_comments", pa.int32()),
    ("content_type", pa.string()),
    ("domain", pa.string()),
    ("flair", pa.string()),
    ("title", pa.string()),
    ("body", pa.string()),
    ("is_truncated", pa.bool_()),
])

COMMENT_SCHEMA = pa.schema([
    ("comment_id", pa.string()),
    ("post_doc_id", pa.uint32()),
    ("parent_key", pa.string()),
    ("created_utc", pa.int64()),
    ("author_key", pa.string()),
    ("score", pa.int32()),
    ("is_op", pa.bool_()),
    ("body", pa.string()),
])

WORD_RE = re.compile(r"[^\W_]{2,40}", re.UNICODE)


def _index_tokens(text: str) -> str:
    return " ".join(WORD_RE.findall((text or "").lower()))


def create_synthetic_package(root: Path, month: str = "2026-10") -> Path:
    pkg_dir = root / month
    (pkg_dir / "base").mkdir(parents=True, exist_ok=True)
    (pkg_dir / "corpus").mkdir(parents=True, exist_ok=True)
    (pkg_dir / "index").mkdir(parents=True, exist_ok=True)

    posts = [
        {
            "doc_id": 1,
            "content_key": "reddit:post:abc101",
            "created_utc": 1791000000,
            "community": "localllama",
            "author_key": "deadbeef00000001",
            "score": 120,
            "reported_comments": 18,
            "content_type": "text",
            "domain": "self.localllama",
            "flair": "Discussion",
            "title": "Coding agent latency and DuckDB benchmark",
            "body": "Comparing coding agent workflows using local Parquet storage.",
            "is_truncated": False,
        },
        {
            "doc_id": 2,
            "content_key": "reddit:post:abc102",
            "created_utc": 1791100000,
            "community": "programming",
            "author_key": "deadbeef00000002",
            "score": 45,
            "reported_comments": 6,
            "content_type": "text",
            "domain": "self.programming",
            "flair": "",
            "title": "Unrelated " + ("中文测试标题" * 400),
            "body": "正文超限测试 " * 8000,
            "is_truncated": False,
        },
        {
            "doc_id": 3,
            "content_key": "reddit:post:BAD_ID",
            "created_utc": 1791200000,
            "community": "localllama",
            "author_key": None,
            "score": 999,
            "reported_comments": 50,
            "content_type": "text",
            "domain": "self.localllama",
            "flair": "",
            "title": "Invalid base36 coding agent row",
            "body": "Should be skipped cleanly by mapper.",
            "is_truncated": False,
        },
    ]

    comments = [
        {
            "comment_id": "reddit:comment:com201",
            "post_doc_id": 1,
            "parent_key": "reddit:post:abc101",
            "created_utc": 1791000500,
            "author_key": "deadbeef00000003",
            "score": 42,
            "is_op": False,
            "body": "Top community comment mentioning coding agent throughput.",
        },
        {
            "comment_id": "reddit:comment:com202",
            "post_doc_id": 1,
            "parent_key": "reddit:comment:com201",
            "created_utc": 1791000900,
            "author_key": "deadbeef00000001",
            "score": 12,
            "is_op": True,
            "body": "OP reply clarifying exact phrase DuckDB benchmark setup.",
        },
        {
            "comment_id": "reddit:comment:com203",
            "post_doc_id": 1,
            "parent_key": "",
            "created_utc": 1791001200,
            "author_key": None,
            "score": 8,
            "is_op": False,
            "body": "Orphan parent fallback check.",
        },
    ]

    pq.write_table(pa.Table.from_pylist(posts, schema=POST_SCHEMA), pkg_dir / "corpus" / "posts.parquet")
    pq.write_table(pa.Table.from_pylist(comments, schema=COMMENT_SCHEMA), pkg_dir / "corpus" / "comments.parquet")

    comments_by_post: dict[int, list[str]] = {}
    for c in comments:
        comments_by_post.setdefault(int(c["post_doc_id"]), []).append(str(c["body"]))

    for shard_id in range(4):
        db = pkg_dir / "index" / f"fts_{shard_id}.sqlite"
        conn = sqlite3.connect(str(db))
        conn.execute(
            "CREATE VIRTUAL TABLE docs USING fts5(title, body, comments_text, content='', detail=none, tokenize='unicode61')"
        )
        for p in posts:
            if int(p["doc_id"]) % 4 == shard_id:
                ctext = " \n ".join(comments_by_post.get(int(p["doc_id"]), []))
                conn.execute(
                    "INSERT INTO docs(rowid, title, body, comments_text) VALUES (?, ?, ?, ?)",
                    (int(p["doc_id"]), _index_tokens(p["title"]), _index_tokens(p["body"]), _index_tokens(ctext)),
                )
        conn.commit()
        conn.close()

    manifest = {
        "policy_version": "open-corpus-v1",
        "month": month,
        "counts": {"posts_rows": len(posts), "comments_rows": len(comments)},
        "total_bytes": 12345,
    }
    (pkg_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return pkg_dir
