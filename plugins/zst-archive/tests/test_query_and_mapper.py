from __future__ import annotations

from pathlib import Path

from fixture_pkg import create_synthetic_package
from zst_archive.mapper import MAX_TEXT_BYTES, MAX_TITLE_BYTES, map_selection
from zst_archive.packages import discover_packages
from zst_archive.query import QuerySpec, select_archive_threads


def test_discover_and_phrase_query(tmp_path: Path) -> None:
    create_synthetic_package(tmp_path, "2026-10")
    pkgs = discover_packages(tmp_path, months=["2026-10"])
    assert len(pkgs) == 1
    assert pkgs[0].month == "2026-10"

    res = select_archive_threads(
        pkgs,
        QuerySpec(
            query='"coding agent" AND benchmark',
            subreddits=("localllama",),
            min_score=100,
            max_comments_per_post=5,
        ),
    )
    assert len(res.posts) == 1
    assert res.posts[0]["content_key"] == "reddit:post:abc101"
    # OP comment ordered first despite lower score, followed by higher score comments
    assert [c["comment_id"] for c in res.comments] == [
        "reddit:comment:com202",
        "reddit:comment:com201",
        "reddit:comment:com203",
    ]


def test_mapper_enforces_prefixes_bytes_and_deterministic_evidence(tmp_path: Path) -> None:
    create_synthetic_package(tmp_path, "2026-10")
    pkgs = discover_packages(tmp_path)
    res = select_archive_threads(pkgs, QuerySpec(allow_unscoped=True, limit=10, max_comments_per_post=10))

    source_id = "11111111-1111-4111-8111-111111111111"
    items_a, stats = map_selection(
        res.posts,
        res.comments,
        source_id=source_id,
        fetched_at_iso="2026-11-18T00:00:00.000Z",
    )
    items_b, _ = map_selection(
        res.posts,
        res.comments,
        source_id=source_id,
        fetched_at_iso="2026-11-19T12:34:56.000Z",
    )

    assert stats["skippedInvalid"] == 1  # reddit:post:BAD_ID skipped cleanly
    assert stats["mappedPosts"] == 2
    assert stats["mappedComments"] == 3

    by_id = {it["externalId"]: it for it in items_a}
    assert "t3_abc101" in by_id
    assert "t1_com201" in by_id
    assert by_id["t1_com202"]["references"] == [
        {"kind": "post", "externalId": "t3_abc101", "relation": "thread_root"},
        {"kind": "comment", "externalId": "t1_com201", "relation": "reply_to"},
    ]
    # Empty parent_key falls back safely to thread_root
    assert by_id["t1_com203"]["references"] == [
        {"kind": "post", "externalId": "t3_abc101", "relation": "thread_root"},
        {"kind": "post", "externalId": "t3_abc101", "relation": "reply_to"},
    ]
    assert by_id["t3_abc101"]["observation"]["sourceObservedAt"] is None
    assert by_id["t3_abc101"]["observation"]["timeBasis"] == "archive_initial"
    assert by_id["t3_abc101"]["observation"]["provider"] == "external_ingest"

    # UTF-8 CJK truncation stays strictly within byte caps
    long_post = by_id["t3_abc102"]
    assert len(long_post["title"].encode("utf-8")) <= MAX_TITLE_BYTES
    assert len(long_post["text"].encode("utf-8")) <= MAX_TEXT_BYTES

    # Deterministic evidenceKey ignores fetchedAt changes
    assert items_a[0]["observation"]["evidenceKey"] == items_b[0]["observation"]["evidenceKey"]
