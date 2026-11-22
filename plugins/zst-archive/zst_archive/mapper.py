"""Map open-corpus-v1 Parquet rows into TypeBox-compliant NormalizedContentItem objects."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

NATIVE_ID_RE = re.compile(r"^[a-z0-9]{1,32}$")
MAX_TITLE_BYTES = 4096
MAX_TEXT_BYTES = 65536


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def truncate_utf8_bytes(value: str | None, max_bytes: int) -> str | None:
    """Truncate text so its UTF-8 encoded length never exceeds max_bytes."""
    if value is None:
        return None
    raw = value.encode("utf-8")
    if len(raw) <= max_bytes:
        return value
    suffix = "..."
    suffix_bytes = len(suffix.encode("utf-8"))
    if max_bytes <= suffix_bytes:
        return raw[:max_bytes].decode("utf-8", errors="ignore")
    trimmed = raw[: max_bytes - suffix_bytes].decode("utf-8", errors="ignore")
    return trimmed + suffix


def epoch_to_iso_utc(epoch: int | None) -> str | None:
    if epoch is None:
        return None
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def parse_reddit_external_id(content_key: str, *, expected_kind: str) -> str | None:
    """Convert open-corpus content_key/comment_id ('reddit:post:abc') into 't3_abc' / 't1_abc'."""
    prefix = f"reddit:{expected_kind}:"
    if not isinstance(content_key, str) or not content_key.startswith(prefix):
        return None
    native = content_key[len(prefix):].strip().lower()
    if not NATIVE_ID_RE.match(native):
        return None
    return ("t3_" if expected_kind == "post" else "t1_") + native


def _evidence_key(month: str, external_id: str, snapshot_fields: dict[str, Any]) -> str:
    digest = hashlib.sha256(canonical_json(snapshot_fields).encode("utf-8")).hexdigest()[:16]
    return f"open-corpus-v1:{month}:{external_id}:{digest}"


def map_post_row(row: dict[str, Any], *, source_id: str, fetched_at_iso: str) -> dict[str, Any] | None:
    ext_id = parse_reddit_external_id(str(row.get("content_key") or ""), expected_kind="post")
    if ext_id is None:
        return None
    native_id = ext_id[3:]
    community = str(row.get("community") or "unknown").strip().lower() or "unknown"
    title = truncate_utf8_bytes((row.get("title") or "").strip() or None, MAX_TITLE_BYTES)
    raw_body = (row.get("body") or "").strip()
    text = truncate_utf8_bytes(raw_body or None, MAX_TEXT_BYTES)
    if title is None and text is None:
        return None

    score = int(row.get("score") or 0)
    reported_comments = int(row.get("reported_comments") or 0)
    month = str(row.get("month") or "unknown")
    author_key = (row.get("author_key") or "").strip() or None
    flair = (row.get("flair") or "").strip() or None
    domain = (row.get("domain") or "").strip() or None
    content_type = (row.get("content_type") or "").strip() or None

    evidence = _evidence_key(month, ext_id, {
        "title": title,
        "text": text,
        "score": score,
        "reported_comments": reported_comments,
        "is_truncated": bool(row.get("is_truncated")),
    })
    return {
        "platform": "reddit",
        "kind": "post",
        "externalId": ext_id,
        "title": title,
        "text": text,
        "url": f"https://www.reddit.com/r/{quote(community, safe='')}/comments/{native_id}/",
        "language": None,
        "author": (
            {"externalId": author_key, "handle": None, "displayName": None, "url": None}
            if author_key else None
        ),
        "publishedAt": epoch_to_iso_utc(row.get("created_utc")),
        "fetchedAt": fetched_at_iso,
        "availability": "available",
        "references": [],
        "media": [],
        "platformDetails": {
            "platform": "reddit",
            "community": community,
            "flair": flair,
            "nsfw": False,
            "extensions": {
                "archivePolicy": "open-corpus-v1",
                "archiveMonth": month,
                "contentType": content_type,
                "domain": domain,
                "isTruncated": bool(row.get("is_truncated")),
            },
        },
        "observation": {
            "sourceId": source_id,
            "provider": "external_ingest",
            "sourceObservedAt": None,
            "fetchedAt": fetched_at_iso,
            "timeBasis": "archive_initial",
            "maturity": "initial",
            "metrics": {
                "reddit.score": score,
                "reddit.num_comments": reported_comments,
            },
            "evidenceKey": evidence,
        },
    }


def map_comment_row(row: dict[str, Any], *, source_id: str, fetched_at_iso: str) -> dict[str, Any] | None:
    ext_id = parse_reddit_external_id(str(row.get("comment_id") or ""), expected_kind="comment")
    root_ext_id = parse_reddit_external_id(str(row.get("post_content_key") or ""), expected_kind="post")
    if ext_id is None or root_ext_id is None:
        return None
    comment_native = ext_id[3:]
    post_native = root_ext_id[3:]
    community = str(row.get("community") or "unknown").strip().lower() or "unknown"
    text = truncate_utf8_bytes((row.get("body") or "").strip() or None, MAX_TEXT_BYTES)
    if text is None:
        return None

    parent_raw = str(row.get("parent_key") or "")
    parent_comment = parse_reddit_external_id(parent_raw, expected_kind="comment")
    parent_post = parse_reddit_external_id(parent_raw, expected_kind="post")
    if parent_comment is not None:
        reply_ref = {"kind": "comment", "externalId": parent_comment, "relation": "reply_to"}
    elif parent_post == root_ext_id:
        reply_ref = {"kind": "post", "externalId": parent_post, "relation": "reply_to"}
    else:
        reply_ref = {"kind": "post", "externalId": root_ext_id, "relation": "reply_to"}

    score = int(row.get("score") or 0)
    month = str(row.get("month") or "unknown")
    author_key = (row.get("author_key") or "").strip() or None
    evidence = _evidence_key(month, ext_id, {"text": text, "score": score, "is_op": bool(row.get("is_op"))})

    return {
        "platform": "reddit",
        "kind": "comment",
        "externalId": ext_id,
        "title": None,
        "text": text,
        "url": f"https://www.reddit.com/r/{quote(community, safe='')}/comments/{post_native}/comment/{comment_native}/",
        "language": None,
        "author": (
            {"externalId": author_key, "handle": None, "displayName": None, "url": None}
            if author_key else None
        ),
        "publishedAt": epoch_to_iso_utc(row.get("created_utc")),
        "fetchedAt": fetched_at_iso,
        "availability": "available",
        "references": [
            {"kind": "post", "externalId": root_ext_id, "relation": "thread_root"},
            reply_ref,
        ],
        "media": [],
        "platformDetails": {
            "platform": "reddit",
            "community": community,
            "flair": None,
            "nsfw": False,
            "extensions": {
                "archivePolicy": "open-corpus-v1",
                "archiveMonth": month,
                "isOp": bool(row.get("is_op")),
            },
        },
        "observation": {
            "sourceId": source_id,
            "provider": "external_ingest",
            "sourceObservedAt": None,
            "fetchedAt": fetched_at_iso,
            "timeBasis": "archive_initial",
            "maturity": "initial",
            "metrics": {"reddit.score": score},
            "evidenceKey": evidence,
        },
    }


def map_selection(
    posts: list[dict[str, Any]],
    comments: list[dict[str, Any]],
    *,
    source_id: str,
    fetched_at_iso: str,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Map selected posts and comments keeping each post ahead of its comments."""
    comments_by_post: dict[tuple[str, int], list[dict[str, Any]]] = {}
    skipped = 0
    for row in comments:
        mapped = map_comment_row(row, source_id=source_id, fetched_at_iso=fetched_at_iso)
        if mapped is None:
            skipped += 1
            continue
        comments_by_post.setdefault((str(row["month"]), int(row["post_doc_id"])), []).append(mapped)

    items: list[dict[str, Any]] = []
    mapped_posts = 0
    mapped_comments = 0
    for row in posts:
        mapped_post = map_post_row(row, source_id=source_id, fetched_at_iso=fetched_at_iso)
        if mapped_post is None:
            skipped += 1
            continue
        items.append(mapped_post)
        mapped_posts += 1
        child_comments = comments_by_post.get((str(row["month"]), int(row["doc_id"])), [])
        items.extend(child_comments)
        mapped_comments += len(child_comments)

    return items, {
        "mappedPosts": mapped_posts,
        "mappedComments": mapped_comments,
        "mappedTotal": len(items),
        "skippedInvalid": skipped,
    }
