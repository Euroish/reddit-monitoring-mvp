"""HTTP client for authenticated POST /v1/sources/:id/ingest and GET /v1/source-jobs."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class IngestHttpError(RuntimeError):
    def __init__(self, status: int, body_text: str) -> None:
        self.status = status
        self.body_text = body_text
        super().__init__(f"HTTP {status}: {body_text}")


@dataclass(frozen=True)
class IngestResponse:
    status: int
    job_id: str
    added: int
    updated: int
    accepted: int


def _parse_retry_after(header_value: str | None, fallback_s: float) -> float:
    if not header_value:
        return fallback_s
    try:
        return max(0.5, min(60.0, float(header_value)))
    except ValueError:
        return fallback_s


def post_ingest_batch(
    *,
    api_base_url: str,
    source_id: str,
    token: str,
    body_bytes: bytes,
    idempotency_key: str,
    timeout_s: float = 30.0,
    max_retries: int = 4,
) -> IngestResponse:
    url = f"{api_base_url.rstrip('/')}/v1/sources/{source_id}/ingest"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
        "Accept": "application/json",
    }

    for attempt in range(max_retries + 1):
        req = urllib.request.Request(url, data=body_bytes, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                status = int(resp.status)
                data = json.loads(resp.read().decode("utf-8"))
                return IngestResponse(
                    status=status,
                    job_id=str(data["jobId"]),
                    added=int(data["added"]),
                    updated=int(data["updated"]),
                    accepted=int(data["accepted"]),
                )
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            if exc.code in (429, 502, 503, 504) and attempt < max_retries:
                delay = _parse_retry_after(exc.headers.get("Retry-After"), min(30.0, 1.5 * (2 ** attempt)))
                time.sleep(delay)
                continue
            raise IngestHttpError(int(exc.code), err_body) from exc
        except urllib.error.URLError as exc:
            if attempt < max_retries:
                time.sleep(min(15.0, 1.0 * (2 ** attempt)))
                continue
            raise IngestHttpError(0, str(exc.reason)) from exc

    raise IngestHttpError(0, "Exhausted ingest retries")


def get_source_jobs(
    *,
    api_base_url: str,
    token: str,
    job_ids: list[str],
    timeout_s: float = 15.0,
) -> dict[str, Any]:
    """Query GET /v1/source-jobs?ids=... (up to 100 job IDs per request)."""
    if not job_ids:
        return {"jobs": []}
    if len(job_ids) > 100:
        raise ValueError("GET /v1/source-jobs accepts at most 100 IDs at once")
    ids_param = ",".join(job_ids)
    url = f"{api_base_url.rstrip('/')}/v1/source-jobs?ids={ids_param}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise IngestHttpError(int(exc.code), exc.read().decode("utf-8", errors="replace")) from exc
