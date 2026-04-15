# Architecture Sketch

## Goal

Provide a buildable architecture for a **Reddit-only monitoring MVP** that can later add TikTok without rewriting the product core.

## Design principles

- Start as a **modular monolith**
- Keep the **API stateless**
- Move collection and heavy processing to **async jobs / workers**
- Treat every platform as a **connector / adapter**
- Persist both **raw payloads** and **normalized entities**
- Store **metrics snapshots**, not only latest values

## Phase 1 architecture

### 1. API / product layer
Responsibilities:
- search monitored objects
- show trend views
- show growth ranking
- show anomaly results
- manage watchlists / subscriptions later

Rules:
- no platform-specific logic in controllers
- only call application services / use cases

### 2. application layer
Responsibilities:
- orchestration
- use cases
- validation
- job dispatching
- read models for product features

Examples:
- sync subreddit snapshots
- compute anomaly score
- list fastest-growing posts
- build trend timeline

### 3. domain / normalized model
Core entities:
- `source`
- `monitor_target`
- `content`
- `account`
- `topic`
- `metrics_snapshot`
- `collection_job`
- `alert_event`

Purpose:
- isolate product logic from Reddit response shape
- prepare future TikTok connector compatibility

### 4. connector layer
Phase 1:
- `reddit_connector`

Phase 2:
- `tiktok_connector`

Connector responsibilities:
- auth / API client
- pagination
- rate-limit handling
- retries
- raw response capture
- mapping external fields to internal normalized objects

Rule:
- connector returns either raw payloads or normalized mapping input
- it does not own scoring, ranking, or product rules

### 5. storage layer
Use at least three logical stores / tables:

#### raw
Store original external responses for:
- audit
- replay
- remapping after model changes
- debugging connector failures

Examples:
- `raw_reddit_posts`
- `raw_reddit_comments`

#### normalized
Store source-agnostic entities:
- `content`
- `account`
- `topic`
- `monitor_target`

#### snapshots
Store time-based metric observations:
- `metrics_snapshot`

This is the key product layer for:
- trend change
- growth ranking
- anomaly alert

### 6. worker / async layer
Responsibilities:
- scheduled collection
- backfill
- retry
- enrichment
- snapshot generation
- alert evaluation

Suggested jobs:
- `collect_subreddit_posts`
- `collect_post_metrics`
- `collect_comment_metrics`
- `normalize_raw_payloads`
- `compute_growth_ranking`
- `detect_anomalies`

## Data flow

1. scheduler creates collection job
2. worker calls `reddit_connector`
3. raw payload is stored
4. mapper normalizes payload into internal entities
5. snapshot rows are appended
6. ranking / anomaly jobs compute derived results
7. API reads from normalized + snapshot tables

## Why this is enough now

This keeps the system small because:
- one repo
- one deployable app
- one worker process
- one database

But it still keeps boundaries clear enough to split later.

## Split-later candidates

If scale grows, split these first:

### candidate 1: collection workers
Reason:
- external API limits / retries / schedules differ by source

### candidate 2: ranking / anomaly engine
Reason:
- compute-heavy, async-friendly, independent from CRUD APIs

### candidate 3: alert delivery
Reason:
- notifications and delivery channels evolve separately

## Minimum directory shape

```text
src/
  api/
  application/
  domain/
  connectors/
    reddit/
    tiktok/      # later
  workers/
  storage/
  jobs/
  tests/
docs/
  architecture-sketch.md
  mvp-brief.md
  data-model.md
  collection-strategy.md
```

## Architecture guardrails

- do not put Reddit field names deep into product logic
- do not skip raw payload storage
- do not keep only latest metrics
- do not introduce microservices in MVP
- do not design TikTok deeply before Reddit MVP is proven
