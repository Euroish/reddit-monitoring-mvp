"""Dynamic batch chunking respecting ING-01 limits (1..100 items, <= 1 MiB body)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

DEFAULT_MAX_ITEMS = 100
DEFAULT_MAX_BODY_BYTES = 850_000  # Safety ceiling under Fastify bodyLimit (1,048,576 bytes)


@dataclass(frozen=True)
class PreparedBatch:
    index: int
    items: list[dict[str, Any]]
    body_bytes: bytes
    content_fingerprint: str
    request_sha256: str
    idempotency_key: str


def _strip_fetched_at(item: dict[str, Any]) -> dict[str, Any]:
    copied = dict(item)
    copied.pop("fetchedAt", None)
    obs = dict(item["observation"])
    obs.pop("fetchedAt", None)
    copied["observation"] = obs
    return copied


def _finalize_batch(index: int, source_id: str, items: list[dict[str, Any]]) -> PreparedBatch:
    payload = {"items": items}
    body_text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    body_bytes = body_text.encode("utf-8")
    request_sha = hashlib.sha256(body_bytes).hexdigest()

    stable_payload = {"items": [_strip_fetched_at(it) for it in items]}
    stable_json = json.dumps(stable_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    fingerprint = hashlib.sha256(stable_json).hexdigest()

    idem_key = f"r4-{source_id[:8]}-{request_sha[:40]}"
    return PreparedBatch(
        index=index,
        items=items,
        body_bytes=body_bytes,
        content_fingerprint=fingerprint,
        request_sha256=request_sha,
        idempotency_key=idem_key,
    )


def chunk_ingest_items(
    items: list[dict[str, Any]],
    *,
    source_id: str,
    max_items: int = DEFAULT_MAX_ITEMS,
    max_body_bytes: int = DEFAULT_MAX_BODY_BYTES,
) -> list[PreparedBatch]:
    """Pack NormalizedContentItem[] into ING-01 compliant HTTP batches."""
    if not (1 <= max_items <= 100):
        raise ValueError("max_items must be between 1 and 100")
    if max_body_bytes > 1_048_576:
        raise ValueError("max_body_bytes cannot exceed server 1 MiB limit")

    batches: list[PreparedBatch] = []
    current: list[dict[str, Any]] = []
    # {"items":[]} wrapper overhead = 12 bytes
    current_bytes = 12

    for item in items:
        item_bytes = len(json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        if item_bytes + 12 > max_body_bytes:
            raise ValueError(f"Single item {item.get('externalId')} exceeds max_body_bytes ({item_bytes} bytes)")

        added_bytes = item_bytes + (1 if current else 0)
        if current and (len(current) >= max_items or current_bytes + added_bytes > max_body_bytes):
            batches.append(_finalize_batch(len(batches), source_id, current))
            current = [item]
            current_bytes = 12 + item_bytes
        else:
            current.append(item)
            current_bytes += added_bytes

    if current:
        batches.append(_finalize_batch(len(batches), source_id, current))
    return batches
