# Collection Strategy (Reddit-only MVP)

## Objective

Enable `subreddit trend change` with minimal, reliable collection.

## Target

- type: `subreddit`
- example: `r/machinelearning`

## Endpoints (Phase 1)

1. `GET /r/{subreddit}/about.json`
- purpose: subscribers / active user counters
- cadence: every 15 minutes

2. `GET /r/{subreddit}/new.json`
- purpose: new posts timeline
- cadence: every 5 minutes
- parameters: `limit`, `after`
- default `limit`: 50
- max pages per run (phase 1): 1

3. `GET /api/info.json?id=t3_*` (optional phase 1.5)
- purpose: refresh selected post metrics
- cadence: every 15 minutes for recent posts only

## Job pipeline

1. `collect_subreddit_about`
- fetch `about.json`
- persist raw event
- write target-level snapshot metrics

2. `collect_subreddit_new_posts`
- fetch `new.json` with cursor
- persist raw event
- upsert normalized `content` + `account`
- write post-level snapshot metrics

3. `build_subreddit_trend_points`
- aggregate snapshots by 15-minute window
- compute deltas vs previous window
- persist trend read model (or cache)

## Idempotency and retries

- each job uses `dedupe_key` = `{job_type}:{target_id}:{window_start}`
- canonical `window_start`: floor to 15-minute UTC boundary
- repeated runs in same window overwrite/upsert read model only
- raw events are append-only
- exponential backoff on 429/5xx

## Rate-limit policy

- per-target polling jitter: +/- 30 seconds
- cap concurrent Reddit calls per worker
- if 429 encountered:
  - persist retry metadata
  - postpone target next run by cooldown

## Live connector runtime policy (final)

- request mode:
  - no token: public mode (`https://www.reddit.com`)
  - with token: OAuth mode (`https://oauth.reddit.com`, `Authorization: Bearer <token>`)
- timeout: 12s per request
- retry policy:
  - retryable status: `408`, `429`, `500`, `502`, `503`, `504`
  - retryable error classes: network `TypeError`, timeout abort
  - max retries: `3` (total attempts up to 4)
- backoff policy:
  - exponential backoff base: `500ms`
  - backoff cap: `10s`
  - jitter: `+-20%`
  - if `Retry-After` exists, it overrides exponential backoff
  - if rate-limit remaining is low (`<=1`) and reset time exists, wait until reset window
- non-retryable failures:
  - `401`, `403`, `404`, validation errors, payload parsing errors

## Data retention (initial)

- `raw_reddit_event`: 30-90 days (configurable)
- `metrics_snapshot`: keep long-term
- `collection_job`: keep 90 days, archive failed jobs longer if needed

## Assumptions and risks

Assumptions:
- initial target count is small (< 50 subreddits)
- polling from public endpoints is enough for MVP signal

Risks:
- Reddit payload field changes break mapping
- high-frequency polling can hit rate limits
- trend quality depends on snapshot continuity

Mitigations:
- schema-safe raw storage for replay
- mapper versioning
- job health dashboard + late-run alerts
