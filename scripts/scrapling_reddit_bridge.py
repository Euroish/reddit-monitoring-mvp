#!/usr/bin/env python
"""Scrapling bridge for Reddit connector.

Reads one JSON request from stdin and writes one JSON response to stdout.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from typing import Any, Dict


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_headers(headers: Any) -> Dict[str, str]:
    if headers is None:
        return {}
    if isinstance(headers, dict):
        return {str(k).lower(): str(v) for k, v in headers.items()}
    output: Dict[str, str] = {}
    if hasattr(headers, "items"):
        for key, value in headers.items():
            output[str(key).lower()] = str(value)
    return output


def response_body_text(response: Any) -> str:
    body_text = getattr(response, "text", None)
    if isinstance(body_text, str):
        return body_text
    body_raw = getattr(response, "body", None)
    if isinstance(body_raw, bytes):
        return body_raw.decode("utf-8", errors="replace")
    if isinstance(body_raw, str):
        return body_raw
    return ""


def maybe_parse_json(body_text: str) -> Any:
    if not body_text:
        return None
    try:
        return json.loads(body_text)
    except Exception:
        return None


def maybe_parse_response_json(response: Any) -> Any:
    if not hasattr(response, "json"):
        return None
    try:
        return response.json()
    except Exception:
        return None


def fetch_with_scrapling(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        from scrapling.fetchers import DynamicFetcher, Fetcher, StealthyFetcher
    except ImportError as exc:
        return {
            "ok": False,
            "errorCode": "scrapling_not_installed",
            "errorMessage": str(exc),
            "fetchedAt": utc_now_iso(),
        }

    url = str(payload.get("url", ""))
    if not url:
        return {
            "ok": False,
            "errorCode": "invalid_request",
            "errorMessage": "Missing url",
            "fetchedAt": utc_now_iso(),
        }

    profile = str(payload.get("profile", "http")).strip().lower() or "http"
    timeout_ms = int(payload.get("timeoutMs", 12000))
    headers = payload.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    headers = {str(k): str(v) for k, v in headers.items()}

    try:
        if profile == "dynamic":
            response = DynamicFetcher.fetch(
                url,
                timeout=timeout_ms,
                headless=True,
                network_idle=True,
                extra_headers=headers,
            )
        elif profile == "stealth":
            response = StealthyFetcher.fetch(
                url,
                timeout=timeout_ms,
                headless=True,
                network_idle=True,
                solve_cloudflare=True,
                extra_headers=headers,
            )
        else:
            # Static Fetcher uses timeout in seconds.
            response = Fetcher.get(
                url,
                headers=headers,
                timeout=max(1, int(math.ceil(timeout_ms / 1000))),
            )
    except Exception as exc:
        return {
            "ok": False,
            "errorCode": "scrapling_fetch_error",
            "errorMessage": str(exc),
            "fetchedAt": utc_now_iso(),
        }

    status = int(getattr(response, "status", 0) or 0)
    response_headers = normalize_headers(getattr(response, "headers", {}))
    body_text = response_body_text(response)
    json_payload = maybe_parse_json(body_text)
    if json_payload is None:
        json_payload = maybe_parse_response_json(response)

    return {
        "ok": True,
        "status": status,
        "headers": response_headers,
        "bodyText": body_text,
        "json": json_payload,
        "fetchedAt": utc_now_iso(),
    }


def main() -> int:
    raw = sys.stdin.read()

    if not raw.strip():
        print(
            json.dumps(
                {
                    "ok": False,
                    "errorCode": "invalid_request",
                    "errorMessage": "Missing stdin payload",
                    "fetchedAt": utc_now_iso(),
                }
            )
        )
        return 0

    try:
        payload = json.loads(raw)
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "errorCode": "invalid_json",
                    "errorMessage": str(exc),
                    "fetchedAt": utc_now_iso(),
                }
            )
        )
        return 0

    if not isinstance(payload, dict):
        print(
            json.dumps(
                {
                    "ok": False,
                    "errorCode": "invalid_request",
                    "errorMessage": "Payload must be an object",
                    "fetchedAt": utc_now_iso(),
                }
            )
        )
        return 0

    result = fetch_with_scrapling(payload)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
