#!/usr/bin/env python
"""Scrapling bridge for Reddit connector.

Reads one JSON request from stdin and writes one JSON response to stdout.
"""

from __future__ import annotations

import json
import math
import subprocess
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


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def fetch_with_powershell(url: str, timeout_ms: int, headers: Dict[str, str]) -> Dict[str, Any]:
    user_agent = headers.get("User-Agent") or headers.get("user-agent") or "reddit-monitoring-mvp/0.1"
    accept = headers.get("Accept") or headers.get("accept") or "application/json"
    timeout_seconds = max(1, int(math.ceil(timeout_ms / 1000)))
    command = (
        "$ErrorActionPreference='Stop';"
        f"$url={ps_quote(url)};"
        f"$ua={ps_quote(user_agent)};"
        f"$accept={ps_quote(accept)};"
        f"$timeout={timeout_seconds};"
        "$resp=Invoke-WebRequest -Uri $url -Headers @{ 'User-Agent'=$ua; 'Accept'=$accept } "
        "-Method Get -TimeoutSec $timeout;"
        "$headers=@{}; foreach($k in $resp.Headers.Keys) { $headers[$k.ToLowerInvariant()] = [string]$resp.Headers[$k] };"
        "$result=[ordered]@{ ok=$true; status=[int]$resp.StatusCode; headers=$headers; bodyText=[string]$resp.Content };"
        "$result | ConvertTo-Json -Compress -Depth 8"
    )

    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            timeout=timeout_seconds + 3,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "errorCode": "powershell_fetch_timeout",
            "errorMessage": f"PowerShell fetch timed out after {timeout_seconds}s",
            "fetchedAt": utc_now_iso(),
        }
    except Exception as exc:
        return {
            "ok": False,
            "errorCode": "powershell_fetch_error",
            "errorMessage": str(exc),
            "fetchedAt": utc_now_iso(),
        }

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or f"exit={completed.returncode}"
        return {
            "ok": False,
            "errorCode": "powershell_fetch_error",
            "errorMessage": message,
            "fetchedAt": utc_now_iso(),
        }

    output = completed.stdout.strip()
    if not output:
        return {
            "ok": False,
            "errorCode": "powershell_fetch_error",
            "errorMessage": "PowerShell fetch returned empty output",
            "fetchedAt": utc_now_iso(),
        }

    try:
        parsed = json.loads(output)
    except Exception as exc:
        return {
            "ok": False,
            "errorCode": "powershell_fetch_error",
            "errorMessage": f"Invalid PowerShell JSON: {exc}",
            "fetchedAt": utc_now_iso(),
        }

    if not isinstance(parsed, dict):
        return {
            "ok": False,
            "errorCode": "powershell_fetch_error",
            "errorMessage": "PowerShell fetch output is not an object",
            "fetchedAt": utc_now_iso(),
        }

    status = int(parsed.get("status", 0) or 0)
    response_headers = normalize_headers(parsed.get("headers", {}))
    response_headers["x-scrapling-fallback"] = "powershell"
    body_text = str(parsed.get("bodyText", ""))
    return {
        "ok": True,
        "status": status,
        "headers": response_headers,
        "bodyText": body_text,
        "json": maybe_parse_json(body_text),
        "fetchedAt": utc_now_iso(),
    }


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
                retries=0,
                retry_delay=0,
                headless=True,
                network_idle=True,
                extra_headers=headers,
            )
        elif profile == "stealth":
            response = StealthyFetcher.fetch(
                url,
                timeout=timeout_ms,
                retries=0,
                retry_delay=0,
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
                retries=0,
                retry_delay=0,
            )
    except Exception as exc:
        if profile == "http":
            fallback_result = fetch_with_powershell(url, timeout_ms, headers)
            if fallback_result.get("ok"):
                return fallback_result
            return {
                "ok": False,
                "errorCode": "scrapling_fetch_error",
                "errorMessage": (
                    f"{exc}; powershell fallback failed: "
                    f"{fallback_result.get('errorMessage', 'unknown')}"
                ),
                "fetchedAt": utc_now_iso(),
            }
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
