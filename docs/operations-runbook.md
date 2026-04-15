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

## Network prerequisite for live mode

If your environment uses a local proxy/VPN client and live Reddit calls are unstable (`ECONNRESET`, connect timeout), enable full-tunnel/TUN routing before running the worker.

This was the confirmed fix in the current environment.

## First-time bootstrap

```bash
npm install
npm run typecheck:core
npm run test:unit
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
npm run worker:phase1:once:live
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
npm run verify:phase1:postgres:live
```

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
- `RAW_EVENT_RETENTION_DAYS` (default `30`)
- `RAW_EVENT_PRUNE_BATCH_SIZE` (default `5000`)
- `RAW_EVENT_PRUNE_LOOP=true` (keep deleting in batches until caught up)

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
- Action: enable TUN/full-tunnel mode and retry.
- Windows fallback: if PowerShell can reach Reddit but Node live traffic still resets, set `REDDIT_HTTP_TRANSPORT=powershell` and rerun.

## Working policy

- Routine edit loop: `typecheck:core` plus the narrowest relevant test script.
- Full `typecheck` / `test`: use before freeze, handoff, or when the change spans multiple layers.
- Live worker/API verification: manual only, because database, auth, network, and proxy state can fail independently of code correctness.

4. Live run gets `401/403`
- Cause: token/user-agent policy issue.
- Action: verify `REDDIT_ACCESS_TOKEN` and `REDDIT_USER_AGENT`, or run without token in public mode.
