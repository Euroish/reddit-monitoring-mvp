"""CLI entrypoint for inspecting open-corpus-v1 archives and pushing samples via POST /v1/sources/:id/ingest."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .batcher import chunk_ingest_items
from .client import post_ingest_batch
from .ledger import IngestLedger
from .mapper import map_selection
from .packages import discover_packages, summarize_packages
from .query import ALL_SCOPES, QuerySpec, select_archive_threads


def _add_package_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--archive-root", type=Path, help="Root directory containing monthly open-corpus-v1 packages")
    parser.add_argument("--package-dir", type=Path, help="Single monthly package directory")
    parser.add_argument("--months", default="", help="Comma-separated YYYY-MM months to include")


def _add_query_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--query", default="", help="Boolean search query for FTS5 + DuckDB")
    parser.add_argument("--subreddits", default="", help="Comma-separated subreddits (lowercase normalized)")
    parser.add_argument("--from", dest="from_iso", default=None, help="Inclusive UTC ISO start (created_utc >= from)")
    parser.add_argument("--to", dest="to_iso", default=None, help="Exclusive UTC ISO end (created_utc < to)")
    parser.add_argument("--min-score", type=int, default=None, help="Minimum post score")
    parser.add_argument("--min-comments", type=int, default=None, help="Minimum reported_comments")
    parser.add_argument("--limit", type=int, default=50, help="Maximum matched root posts (default 50)")
    parser.add_argument("--max-comments-per-post", type=int, default=15, help="Top comments per post (0 disables comments)")
    parser.add_argument("--scopes", default="title,body,comments_text", help="Comma-separated search scopes")
    parser.add_argument("--allow-unscoped", action="store_true", help="Allow querying without --query or --subreddits")


def _build_packages_and_spec(args: argparse.Namespace) -> tuple[list[Any], QuerySpec]:
    months = [m.strip() for m in args.months.split(",") if m.strip()] if args.months else []
    packages = discover_packages(args.archive_root, package_dir=args.package_dir, months=months)
    subreddits = tuple(s.strip().lower() for s in args.subreddits.split(",") if s.strip())
    scopes = tuple(s.strip() for s in args.scopes.split(",") if s.strip()) or ALL_SCOPES
    spec = QuerySpec(
        query=args.query,
        subreddits=subreddits,
        from_iso=args.from_iso,
        to_iso=args.to_iso,
        min_score=args.min_score,
        min_comments=args.min_comments,
        limit=args.limit,
        include_comments=args.max_comments_per_post > 0,
        max_comments_per_post=max(0, args.max_comments_per_post),
        scopes=scopes,
        allow_unscoped=bool(args.allow_unscoped),
    )
    return packages, spec


def _cmd_inspect(args: argparse.Namespace) -> int:
    months = [m.strip() for m in args.months.split(",") if m.strip()] if args.months else []
    packages = discover_packages(args.archive_root, package_dir=args.package_dir, months=months)
    print(json.dumps({"packages": summarize_packages(packages)}, ensure_ascii=False, indent=2))
    return 0


def _cmd_query(args: argparse.Namespace) -> int:
    packages, spec = _build_packages_and_spec(args)
    selection = select_archive_threads(packages, spec)
    preview = [
        {
            "month": p["month"],
            "contentKey": p["content_key"],
            "community": p["community"],
            "score": p["score"],
            "reportedComments": p["reported_comments"],
            "createdUtc": p["created_utc"],
            "title": p["title"],
        }
        for p in selection.posts[: args.sample]
    ]
    print(json.dumps({"stats": selection.stats, "samplePosts": preview}, ensure_ascii=False, indent=2))
    return 0


def _cmd_push(args: argparse.Namespace) -> int:
    packages, spec = _build_packages_and_spec(args)
    selection = select_archive_threads(packages, spec)
    fetched_at = args.fetched_at or datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    items, map_stats = map_selection(
        selection.posts,
        selection.comments,
        source_id=args.source_id,
        fetched_at_iso=fetched_at,
    )
    if args.max_total_items and len(items) > args.max_total_items:
        raise ValueError(f"Selected {len(items)} items exceeds --max-total-items={args.max_total_items}; tighten filters")

    batches = chunk_ingest_items(
        items,
        source_id=args.source_id,
        max_items=args.batch_size,
        max_body_bytes=args.max_body_bytes,
    )
    summary: dict[str, Any] = {
        "dryRun": bool(args.dry_run),
        "sourceId": args.source_id,
        "queryStats": selection.stats,
        "mapStats": map_stats,
        "batchCount": len(batches),
        "batchBytes": [len(b.body_bytes) for b in batches],
    }
    if args.dry_run:
        if items:
            summary["sampleItem"] = items[0]
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    token = os.environ.get(args.token_env, "").strip()
    if not token:
        raise RuntimeError(f"Missing machine ingest token in environment variable {args.token_env}")
    if not args.api_url:
        raise ValueError("--api-url is required when pushing without --dry-run")

    ledger = IngestLedger(args.ledger_path)
    results: list[dict[str, Any]] = []
    totals = {"added": 0, "updated": 0, "accepted": 0, "skippedResume": 0, "batchesSent": 0}
    try:
        for i, batch in enumerate(batches):
            if args.resume and not args.force:
                prev = ledger.get_succeeded(args.source_id, batch.content_fingerprint)
                if prev is not None:
                    totals["skippedResume"] += 1
                    results.append({"batchIndex": batch.index, "skipped": True, **prev})
                    continue

            ledger.record(
                source_id=args.source_id,
                content_fingerprint=batch.content_fingerprint,
                idempotency_key=batch.idempotency_key,
                request_sha256=batch.request_sha256,
                item_count=len(batch.items),
                status="pending",
            )
            resp = post_ingest_batch(
                api_base_url=args.api_url,
                source_id=args.source_id,
                token=token,
                body_bytes=batch.body_bytes,
                idempotency_key=batch.idempotency_key,
            )
            ledger.record(
                source_id=args.source_id,
                content_fingerprint=batch.content_fingerprint,
                idempotency_key=batch.idempotency_key,
                request_sha256=batch.request_sha256,
                item_count=len(batch.items),
                status="succeeded",
                job_id=resp.job_id,
                added=resp.added,
                updated=resp.updated,
                accepted=resp.accepted,
            )
            totals["batchesSent"] += 1
            totals["added"] += resp.added
            totals["updated"] += resp.updated
            totals["accepted"] += resp.accepted
            results.append({
                "batchIndex": batch.index,
                "status": resp.status,
                "jobId": resp.job_id,
                "added": resp.added,
                "updated": resp.updated,
                "accepted": resp.accepted,
                "idempotencyKey": batch.idempotency_key,
            })
            if i < len(batches) - 1 and args.min_interval_ms > 0:
                time.sleep(args.min_interval_ms / 1000.0)
    finally:
        ledger.close()

    summary["totals"] = totals
    summary["batches"] = results
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="zst-archive", description="R4 offline open-corpus-v1 query & push plugin")
    sub = parser.add_subparsers(dest="command", required=True)

    p_inspect = sub.add_parser("inspect", help="Inspect available open-corpus-v1 packages")
    _add_package_args(p_inspect)
    p_inspect.set_defaults(func=_cmd_inspect)

    p_query = sub.add_parser("query", help="Preview matched posts and comment counts from local archives")
    _add_package_args(p_query)
    _add_query_args(p_query)
    p_query.add_argument("--sample", type=int, default=5, help="Sample posts to display")
    p_query.set_defaults(func=_cmd_query)

    p_push = sub.add_parser("push", help="Map selected archive threads and push via POST /v1/sources/:id/ingest")
    _add_package_args(p_push)
    _add_query_args(p_push)
    p_push.add_argument("--source-id", required=True, help="Target push collection_source UUID")
    p_push.add_argument("--api-url", default="", help="API base URL (e.g. http://127.0.0.1:3000 or https://host/api)")
    p_push.add_argument("--token-env", default="ARCHIVE_INGEST_TOKEN", help="Env var holding Bearer ingest key")
    p_push.add_argument("--batch-size", type=int, default=100, help="Max items per POST /ingest request (1..100)")
    p_push.add_argument("--max-body-bytes", type=int, default=850_000, help="Max JSON bytes per batch (<= 1048576)")
    p_push.add_argument("--max-total-items", type=int, default=2000, help="Guardrail cap on total items pushed per run")
    p_push.add_argument("--min-interval-ms", type=int, default=600, help="Delay between batch POSTs to respect rate limits")
    p_push.add_argument("--fetched-at", default=None, help="Optional fixed UTC ISO timestamp for deterministic replay")
    p_push.add_argument("--ledger-path", type=Path, default=Path("plugins/zst-archive/ingest_ledger.sqlite"))
    p_push.add_argument("--resume", action=argparse.BooleanOptionalAction, default=True, help="Skip batches already succeeded in ledger")
    p_push.add_argument("--force", action="store_true", help="Send batches even if recorded in local ledger")
    p_push.add_argument("--dry-run", action="store_true", help="Do not call API; print mapping/chunking plan and sample item")
    p_push.set_defaults(func=_cmd_push)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
