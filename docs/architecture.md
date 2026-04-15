# Architecture (Supplement)

This file extends [architecture-sketch.md](./architecture-sketch.md) with concrete MVP decisions and implementation guardrails.

## MVP scope lock

- Source: `Reddit`
- Monitored object: `subreddit`
- Primary value: `trend change`
- Stage: `Reddit-only MVP`

Out of scope in this phase:
- TikTok connector
- cross-platform entity merge
- full anomaly engine
- alert delivery channels

## Module boundaries (modular monolith)

## `api`
- Owns request parsing, auth (later), and response shaping.
- Delegates write-path orchestration to `application/use-cases`.
- Delegates runtime wiring to `runtime/*`.
- Must not contain Reddit API fields or mapping logic.

## `application`
- Owns use-case orchestration and job dispatch.
- Coordinates connector + repositories + trend calculators.
- Owns product read-model assembly, write-trigger preparation, and durable queue dispatch.

## `domain`
- Owns source-agnostic entities and metric semantics.
- Owns trend calculation contracts (not transport details).

## `runtime`
- Owns composition-root concerns only:
  - env parsing
  - Postgres/repository bundle assembly
  - connector factory assembly
  - phase-1 run option resolution
- Must not own product scoring or read-model policy.

## `connectors/reddit`
- Owns Reddit API calls, pagination, rate-limit handling, and raw envelope creation.
- May map Reddit payload to normalized DTOs.
- Must not implement product ranking/business policy.
- Runtime defaults are fixed for MVP:
  - timeout 12s
  - max retries 3
  - exponential backoff (500ms base, 10s cap, +-20% jitter)
  - `Retry-After` and rate-limit reset headers override delay when present
  - public mode by default, OAuth mode when token is provided

## `storage`
- Owns persistence adapters for raw, normalized, and snapshots.
- Exposes repository interfaces consumed by `application`.

## `workers/jobs`
- Owns scheduled collection and async processing.
- Every job must be idempotent and resumable by cursor/dedupe key.

## Granularity Rules

- `domain/services/trend-scoring.service.ts` owns trend-score math and algorithm versioning.
- `workers/reddit-phase1.worker.ts` owns sampling-plan selection and collection orchestration.
- `application/services/*read-model*` owns website-facing aggregation and shaping from persisted truth.
- `readyz` / provider-health observability must report evidence from persisted queue/provider state, not inferred UI state.
- `runtime/*` may choose providers and defaults, but may not redefine scoring logic.

## Read/write paths

Write path (collection):
1. runtime composes repositories + connector factory + defaults
2. API sync path delegates to an `application` use-case and executes immediately
3. API async path delegates to an `application` use-case that enqueues durable `collection_job` rows
4. scheduler/worker claims runnable jobs from the queue
5. worker calls `reddit_connector`
6. store raw payload envelope
7. map to normalized entities
8. append metric snapshots and provider health evidence
9. scheduler materializes trend / keyword views for touched targets
10. mark job status and persist cursor

Read path (product):
1. API reads from normalized + snapshots
2. application builds trend timeline/read model
3. API returns product DTO (source-agnostic)

## Why this supplements the sketch

`architecture-sketch.md` defines direction.
This file adds:
- explicit scope lock (`subreddit + trend change`)
- non-goals for MVP containment
- strict module ownership to reduce coupling
- concrete read/write paths for implementation

## Evolution triggers (not now)

Split collector workers into a separate service only if any condition is true:
- sustained queue delay > 5 minutes
- rate-limit/retry complexity blocks API release cadence
- source count > 1 in production

## Deterministic ID policy (`stableUuidFromString`)

Allowed scope in MVP:
- deterministic IDs for source-derived entities:
  - `reddit:target:*`
  - `reddit:account:*`
  - `reddit:content:*`
- deterministic IDs for idempotent collection job keys:
  - `job:*`

Not allowed:
- user IDs / auth IDs
- externally exposed security tokens
- any identifier that must be random or unpredictable
