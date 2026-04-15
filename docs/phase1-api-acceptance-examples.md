# Phase-1 API Acceptance Examples

## Purpose

Provide stable request/response examples for `Trend Board v0` acceptance checks.

## 1) Health

```bash
curl -i http://localhost:3000/healthz
```

Expected:
- HTTP `200`
- header `x-request-id` exists
- body fields: `ok=true`, `requestId`, `service`, `nowIso`

## 2) Readiness

```bash
curl -i http://localhost:3000/readyz
```

Expected:
- HTTP `200` (or `503` when not ready)
- header `x-request-id` exists
- body fields:
  - `ok`
  - `status` (`ready` / `degraded` / `not_ready`)
  - `checks.storage`
  - `checks.queue`
  - `queue.backlog`
  - `queue.running`
  - `activeSessions`

## 3) Seed subreddit target

```bash
curl -i -X POST http://localhost:3000/v1/targets/subreddit \
  -H "content-type: application/json" \
  -d '{"subreddit":"datascience"}'
```

Expected:
- HTTP `200`
- body fields: `ok=true`, `requestId`, `targetId`, `canonicalName="r/datascience"`

## 4) Trigger one Phase-1 run (mock)

```bash
curl -i -X POST http://localhost:3000/v1/runs/reddit-phase1 \
  -H "content-type: application/json" \
  -d '{"mode":"mock","subreddit":"datascience"}'
```

Expected:
- HTTP `200`
- body fields:
  - `ok=true`
  - `requestId`
  - `mode="mock"`
- `requestedCanonicalNames`
- `processedCanonicalNames`

## 5) Create keyword query session

```bash
curl -i -X POST http://localhost:3000/v1/keyword-queries \
  -H "content-type: application/json" \
  -d '{"query":"llm agent","limit":10}'
```

Expected:
- HTTP `200`
- body fields:
  - `ok=true`
  - `requestId`
  - `result.queryId`
  - `result.status` (`initial_ready`/`degraded`)
  - `result.coverageLevel`
  - `result.supportCount`
  - `result.confidenceLevel`
  - `result.mentionRate`
  - `result.qualifiedMentionRate`
  - `result.sourceType`
  - `result.dataQuality`
  - `result.samplePosts`
  - `result.pulsePoints5m`

## 6) Read trend board

```bash
curl -i "http://localhost:3000/v1/trends/subreddit/datascience?from=2026-04-10T10:00:00.000Z&to=2026-04-10T12:15:00.000Z&recentPostsLimit=10"
```

Expected:
- HTTP `200`
- body fields:
  - `ok=true`
  - `requestId`
  - `generatedAtIso`
  - `fromIso` / `toIso` aligned to 15-minute boundaries
  - `timeline` (`granularity`, `windowMinutes`, `comparison`, `pointCount`)
  - `summary` (`latestTrendDirection`, `latestTrendScore`, latest window range)
  - `topMovers` (delta-focused windows)
  - `recentAnomalies` (anomaly-focused windows)
  - `points[*].scoreComponents`
  - `recentPosts`

## 7) Validation error sample

```bash
curl -i "http://localhost:3000/v1/trends/subreddit/datascience?recentPostsLimit=100"
```

Expected:
- HTTP `400`
- body fields:
  - `ok=false`
  - `requestId`
  - `errorCode="invalid_query_param"`
  - `error`
