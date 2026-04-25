# Operations Runbook (Reddit MVP Phase 1)

## Purpose

Run one safe end-to-end Reddit collection cycle with PostgreSQL, then verify writes.

## Prerequisites

- Node.js and npm installed
- reachable PostgreSQL instance
- network path can reach Reddit endpoints

Required env:
- `DATABASE_URL`

Optional env:
- `REDDIT_ACCESS_TOKEN` (OAuth mode)
- `REDDIT_USER_AGENT` (custom user-agent)
- `REDDIT_RUN_SUBREDDIT` (default: `machinelearning`)
- `REDDIT_HTTP_TRANSPORT` (`auto` default; on Windows use `powershell` if Node HTTP traffic is being reset while PowerShell requests still work)
- `REDDIT_HTTP_PROXY` (optional dedicated collector egress, e.g. `http://127.0.0.1:1080` or `socks5h://127.0.0.1:1080` for a local sing-box mixed/SOCKS inbound)
- `REDDIT_HTTP_PROXY_FAILOVER_COMMAND` (optional absolute path to a root-owned host-local command that switches the collector proxy node and restarts only the collector service; the connector triggers it at most once per proxied Reddit request)
- `REDDIT_LIVE_PROVIDER` (`http` default, `apify`, or `scrapling`)
- `REDDIT_SCRAPLING_PRIMARY_SUBREDDITS` (comma list for target-level promotion, e.g. `machinelearning,datascience`; promoted targets use `scrapling` primary while others keep `REDDIT_LIVE_PROVIDER`)
- `REDDIT_SCRAPLING_PROFILE` (`http` default, `dynamic`, `stealth`)
- `REDDIT_SCRAPLING_PYTHON` (Python executable path; default `python`)
- `REDDIT_SCRAPLING_BRIDGE_SCRIPT` (override bridge script path; default `scripts/scrapling_reddit_bridge.py`)
- `REDDIT_SCRAPLING_TIMEOUT_MS` (default follows `REDDIT_HTTP_TIMEOUT_MS`; `http` profile will auto-fallback to PowerShell transport on fetch failure and expose `x-scrapling-fallback`)
- `REDDIT_SCRAPLING_MAX_RETRIES` (default `2`)

If you use Scrapling provider, install Python dependency first:

```bash
pip install "scrapling[fetchers]"
```

## Network prerequisite for live mode

If your environment uses a local proxy/VPN client and live Reddit calls are unstable (`ECONNRESET`, connect timeout), prefer a dedicated collector egress before full-machine routing:

```bash
REDDIT_HTTP_PROXY=http://127.0.0.1:1080 REDDIT_HTTP_TRANSPORT=fetch REDDIT_LIVE_PROVIDER=http npm run worker:phase1:once
```

Use `http://127.0.0.1:1080` when sing-box exposes a `mixed` inbound. Use `socks5h://127.0.0.1:1080` only when the inbound is SOCKS-only.

Keep subscription URLs and node credentials in `/etc/sing-box` or another host-only secret location. Do not commit them to this repo.

If automatic node switching is enabled, keep the failover command outside the repo, owned by root, and callable only through a narrow sudoers rule. It must not enable TUN or change the default route; it should only refresh/select a collector node and restart the local collector proxy.

This was the confirmed fix in the current environment.

## First-time bootstrap

```bash
npm install
npm run algo:fast
npm run db:migrate
```

Expected migration result:
- `001_reddit_mvp_init.sql`
- `002_repository_query_indexes.sql`

## Run one collection cycle (PostgreSQL)

`npm run worker:phase1:once` defaults to mock mode. Use it for safe DB-path validation first.

```bash
npm run worker:phase1:once
```

Optional live run:

```bash
set REDDIT_RUN_MODE=live&& npm run worker:phase1:once
```

Manual one-shot chain (migrate + run once):

```bash
npm run phase1:manual-run
```

Deterministic verification chain with DB summary (defaults to mock mode):

```bash
npm run verify:phase1:postgres
```

Optional live verification:

```bash
npm run algo:live:verify
```

Scrapling bridge verification (single about-page request through Scrapling provider):

```bash
set REDDIT_LIVE_PROVIDER=scrapling&& npm run algo:scrapling:verify
```

Verify output includes:
- `provider` (`scrapling`)
- `fallbackTransport` (`null` on direct Scrapling fetch, `powershell` when fallback path is used)

Shadow parity comparison (`http` baseline vs `scrapling` shadow, writes snapshot to `docs/`):

```bash
set REDDIT_SHADOW_BASE_PROVIDER=http&& set REDDIT_SHADOW_PROVIDER=scrapling&& set REDDIT_SHADOW_SUBREDDITS=machinelearning,datascience&& npm run algo:shadow:compare
```

Optional shadow env:
- `REDDIT_SHADOW_ROUNDS` (default `1`)
- `REDDIT_SHADOW_POST_LIMIT` (default `25`)
- `REDDIT_SHADOW_ROUND_PAUSE_MS` (default `0`)
- `REDDIT_SHADOW_MIN_JACCARD` (default `0.35`)
- `REDDIT_SHADOW_MAX_EXTRACTED_DELTA_ABS` (default `10`)
- `REDDIT_SHADOW_REQUIRE_STATUS_MATCH` (default `true`)

Build promotion plan from accumulated shadow snapshots:

```bash
npm run algo:shadow:plan
```

This writes:
- `docs/shadow-promotion-plan-<timestamp>.json`
- `docs/shadow-promotion-plan-<timestamp>.md`

Optional promotion policy env:
- `REDDIT_SHADOW_PLAN_MAX_SNAPSHOTS` (default `20`)
- `REDDIT_SHADOW_PLAN_MIN_SAMPLES` (default `4`)
- `REDDIT_SHADOW_PLAN_MIN_BASELINE_SUCCESS_RATE` (default `0.99`)
- `REDDIT_SHADOW_PLAN_MIN_SHADOW_SUCCESS_RATE` (default `0.99`)
- `REDDIT_SHADOW_PLAN_MIN_GATE_PASS_RATE` (default `0.95`)
- `REDDIT_SHADOW_PLAN_MIN_JACCARD_P50` (default `0.95`)
- `REDDIT_SHADOW_PLAN_MIN_JACCARD_MIN` (default `0.9`)
- `REDDIT_SHADOW_PLAN_MAX_ABS_EXTRACTED_DELTA_P95` (default `3`)
- `REDDIT_SHADOW_PLAN_MAX_ABS_LAG_DELTA_SECONDS_P95` (default `120`)
- `REDDIT_SHADOW_PLAN_MAX_DURATION_RATIO_P95` (default `6`)

For controlled rollout after a bridge/network fix, build eligibility from the most recent stable window:

```bash
set REDDIT_SHADOW_PLAN_MAX_SNAPSHOTS=2&& npm run algo:shadow:plan
```

Apply controlled target-level promotion (promote only selected targets to Scrapling primary with HTTP fallback):

```bash
set REDDIT_LIVE_PROVIDER=http&& set REDDIT_SCRAPLING_PRIMARY_SUBREDDITS=machinelearning,datascience&& set REDDIT_CB_ROUTE_TO_FALLBACK=true&& npm run algo:live:verify
```

Multi-cycle controlled-promotion verifier (writes snapshot to `docs/` with readiness, provider health, and fallback evidence):

```bash
set REDDIT_LIVE_PROVIDER=http&& set REDDIT_SCRAPLING_PRIMARY_SUBREDDITS=machinelearning,datascience&& set REDDIT_CONTROLLED_PROMOTION_SUBREDDITS=machinelearning,datascience&& set REDDIT_CONTROLLED_PROMOTION_ROUNDS=2&& npm run algo:promotion:verify
```

Optional verifier env:
- `REDDIT_CONTROLLED_PROMOTION_SUBREDDITS` (default `machinelearning,datascience`)
- `REDDIT_CONTROLLED_PROMOTION_ROUNDS` (default `2`)
- `REDDIT_CONTROLLED_PROMOTION_PAUSE_MS` (default `1000`)

Notes:
- `REDDIT_LIVE_PROVIDER=http` keeps non-promoted targets on baseline HTTP.
- promoted targets in `REDDIT_SCRAPLING_PRIMARY_SUBREDDITS` route to Scrapling primary.
- fallback remains explicit via circuit-breaker route-to-fallback and is visible in verify output (`fallbackEvidence.providerFallbackCount` and `fallbackEvidence.scraplingFallbackTransportCounts`).

The live verify output includes the same readiness degradation summary used by `/readyz`, so Stage A checks can confirm whether `provider_data_stalled:*` appears without starting the API separately.

Start API:

```bash
npm run app:api
```

Minimal CLI presentation layer:

```bash
npm run trend:board:summary
```

Optional env overrides:
- `TREND_SUBREDDIT`
- `TREND_FROM`
- `TREND_TO`
- `TREND_RECENT_POSTS_LIMIT`
- `PG_CONNECTION_TIMEOUT_MS` (PostgreSQL connect timeout, default `10000`)
- `PG_IDLE_TIMEOUT_MS` (PostgreSQL idle timeout, default `30000`)
- `PG_QUERY_TIMEOUT_MS` (PostgreSQL query timeout, default `30000`)

Raw event retention cleanup:

```bash
npm run ops:prune:raw-events
```

Optional cleanup env:
- `RAW_EVENT_RETENTION_DAYS` (default `7`)
- `RAW_EVENT_PRUNE_BATCH_SIZE` (default `5000`)
- `RAW_EVENT_PRUNE_LOOP=true` (keep deleting in batches until caught up)

Metrics snapshot retention cleanup:

```bash
npm run ops:prune:metrics-snapshots
```

Optional cleanup env:
- `METRICS_SNAPSHOT_RETENTION_DAYS` (default `30`)
- `METRICS_SNAPSHOT_PRUNE_BATCH_SIZE` (default `10000`)
- `METRICS_SNAPSHOT_PRUNE_LOOP=true` (keep deleting in batches until caught up)

API notes:
- `GET /v1/trends/subreddit/:subreddit` supports optional `from` / `to` ISO params.
- time range limit: max 24 hours.
- server aligns `from` and `to` to 15-minute UTC boundaries.
- server returns `requestId` in body and `x-request-id` header.
- `recentPostsLimit` query param is validated in range `1-50`.

## Quick data checks (PostgreSQL)

```sql
SELECT COUNT(*) FROM raw_reddit_event;
SELECT COUNT(*) FROM content;
SELECT COUNT(*) FROM metrics_snapshot;
SELECT COUNT(*) FROM subreddit_trend_point;
```

For a successful live run, all four tables should increase from zero over time.

## Troubleshooting

1. Migration fails with checksum mismatch
- Cause: an already-applied migration file was edited.
- Action: revert the edited migration content and create a new numbered migration file.

2. `DATABASE_URL is required for PostgresClient`
- Cause: env var not set in current shell.
- Action: set `DATABASE_URL` and rerun.

3. Live run fails with network errors (`ECONNRESET`, timeout)
- Cause: outbound routing/proxy path instability.
- Action: first set `REDDIT_HTTP_PROXY` to the local sing-box mixed/SOCKS inbound and retry the provider smoke; if that still fails, enable TUN/full-tunnel mode and retry.
- Windows fallback: if PowerShell can reach Reddit but Node live traffic still resets, set `REDDIT_HTTP_TRANSPORT=powershell` and rerun.

4. Scrapling shadow lane fails with bridge timeouts
- Cause: `scrapling[fetchers]` HTTP path cannot reach Reddit in current runtime while host PowerShell path is still reachable.
- Action: rerun `npm run algo:scrapling:verify` and check `fallbackTransport`; if it is `powershell`, keep `REDDIT_SCRAPLING_PROFILE=http` and continue parity sampling.

## Working policy

- Routine algorithm edit loop: `algo:fast`, then `algo:phase1` (unit-only truth-layer quick gate) when the change touches truth-layer behavior.
- Run `algo:phase1:full` only when phase1 worker/runtime/api boundaries or phase1 integration behavior are touched.
- Full pre-close gate: `algo:full`.
- Live worker/API verification: manual only, because database, auth, network, and proxy state can fail independently of code correctness.

5. Live run gets `401/403`
- Cause: token/user-agent policy issue.
- Action: verify `REDDIT_ACCESS_TOKEN` and `REDDIT_USER_AGENT`, or run without token in public mode.
