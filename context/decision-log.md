# DECISION LOG

## Decision 1: `metrics_snapshot` uniqueness and metric control are enforced in PostgreSQL

### Decision
Use two partial unique indexes for `metrics_snapshot` uniqueness:
- target-level unique key when `content_id IS NULL`
- content-level unique key when `content_id IS NOT NULL`

Use PostgreSQL enum `metric_name_enum` plus scope check constraint:
- target-level metrics must have `content_id IS NULL`
- content-level metrics must have `content_id IS NOT NULL`

### Why
This prevents duplicate snapshot rows in nullable-key cases and prevents metric name/scope drift at the database boundary.

### Tradeoff
Changing metric taxonomy requires migration updates (enum/check edits), not just application-code changes.

### Date
2026-04-08

## Decision 2: Allowed scope of `stableUuidFromString` is limited

### Decision
`stableUuidFromString` is allowed only for:
- `reddit:target:*`
- `reddit:account:*`
- `reddit:content:*`
- `job:*`

Function now enforces this scope at runtime and throws for out-of-scope prefixes.

### Why
Deterministic IDs are needed for idempotent upsert and replay-safe pipelines, but they must not leak into security-sensitive or randomness-required identity domains.

### Tradeoff
Adding new deterministic-ID domains requires explicit prefix policy updates.

### Date
2026-04-08

## Decision 3: Live Reddit connector runtime policy is fixed for MVP

### Decision
Connector runtime defaults:
- auth:
  - public mode (no token) -> `https://www.reddit.com`
  - OAuth mode (token provided) -> `https://oauth.reddit.com`
- timeout: 12s
- retries: max 3
- retryable status: `408`, `429`, `500`, `502`, `503`, `504`
- retryable errors: network `TypeError`, timeout abort
- backoff: exponential (`500ms` base, `10s` cap) with `+-20%` jitter
- `Retry-After` header and rate-limit reset window override delay when present

### Why
This keeps connector behavior predictable and resilient without introducing external infra (queues/circuit breakers/proxies) in MVP.

### Tradeoff
Policy is conservative; under severe network instability, collection latency can increase before jobs fail.

### Date
2026-04-08

## Decision 4: Reddit source row uses fixed seeded UUID in MVP

### Decision
Seed `source` table with fixed Reddit source row in migration:
- `id = 11111111-1111-1111-1111-111111111111`
- `code = reddit`

PostgreSQL repositories use this fixed `source_id` mapping for Reddit entities.

### Why
Keeps repository SQL simple and deterministic in Reddit-only phase, avoiding per-write source lookup joins.

### Tradeoff
If source-ID strategy changes later (multi-source expansion), repositories and migration path must be updated.

### Date
2026-04-08

## Decision 5: Live connectivity root cause is environment networking, not system design

### Decision
Treat intermittent Reddit live failures (`ECONNRESET` / connect timeout) as environment/runtime networking behavior.
Record verified resolution in current environment: enabling TUN mode in Sakuracat restored stable Node-to-Reddit connectivity.

### Why
Validation showed:
- PostgreSQL path is healthy (connect/migrate/write/read succeed)
- architecture and connector logic run correctly when network path is stable
- failures correlated with network routing mode, not schema or code design

### Tradeoff
Live reliability depends on deployment/network routing configuration; operations runbook must explicitly document network prerequisites.

### Date
2026-04-10

## Decision 6: Repository read-path indexes are added via a new migration

### Decision
Add a new migration (`002_repository_query_indexes.sql`) for current read paths instead of editing baseline migration:
- `monitor_target (source_id, target_type, status, canonical_name)`
- `content (target_id, created_at_source DESC)`
- `metrics_snapshot (target_id, metric_name, snapshot_at)`

Also align canonical monitor-target lookup query with existing key shape by adding `target_type = 'subreddit'`.

### Why
Current repository query patterns should stay predictable as row counts grow, while preserving migration checksum policy.

### Tradeoff
Additional indexes increase write cost slightly, but keep Phase-1 query latency stable without architecture changes.

### Date
2026-04-10

## Decision 7: Five product open questions are formally closed for Phase 1

### Decision
Lock Phase-1 choices:
- first monitored object: `subreddit`
- first core value: `trend change`
- first presentation form: API-first trend board response
- API boundary:
  - `GET /healthz`
  - `POST /v1/targets/subreddit`
  - `POST /v1/runs/reddit-phase1`
  - `GET /v1/trends/subreddit/:subreddit`
- manual trigger first:
  - seed target
  - run one collection cycle
  - read trend result

### Why
Removes remaining scope ambiguity and allows immediate implementation and verification loop.

### Tradeoff
Scheduler automation, ranking, and alerts remain out of Phase-1 path.

### Date
2026-04-10

## Decision 8: Start executable top-level skeleton now and keep connector boundary stable

### Decision
Create and use top-level directories:
- `apps/` for API entry
- `workers/` for worker entry
- `packages/` for shared contracts
- `scripts/` for manual operations
- `tests/` for integration checks

Keep `RedditConnector` as the stable boundary and add `RedditApifyConnector` placeholder to be activated after external API contract is provided.

### Why
Moves project from doc-prep to execution state while preserving minimal-change compatibility with current `src/` implementation.

### Tradeoff
Some wrappers temporarily delegate to existing internals until deeper module extraction is needed.

### Date
2026-04-10

## Decision 9: PostgreSQL write path uses batch upsert/insert with pre-deduplication

### Decision
For `account`, `content`, `metrics_snapshot`, and `subreddit_trend_point` repositories:
- deduplicate input rows by business key in memory first
- write in chunked batch SQL statements within a transaction
- keep existing conflict policies (`ON CONFLICT ... DO UPDATE` / `DO NOTHING`)

### Why
Improves runtime efficiency by reducing per-row DB round trips and avoids duplicate updates inside the same run.

### Tradeoff
Repository SQL is more complex than one-row statements, so helper utilities and focused unit tests were added.

### Date
2026-04-10

## Decision 10: Phase-1 API enforces strict input validation and aligned trend windows

### Decision
API behavior updated:
- subreddit input validation: `^[a-z0-9_]{3,21}$`
- run endpoint can execute only requested canonical target when provided
- trend read endpoint validates ISO params and range (`from <= to`, max 24h)
- trend read aligns `from/to` to 15-minute UTC boundaries

### Why
Improves precision (deterministic window boundaries) and efficiency (avoid accidental full-target runs and oversized trend scans).

### Tradeoff
Requests outside the validated constraints return `400`, requiring clients to normalize inputs.

### Date
2026-04-10

## Decision 11: Trend scoring schema is upgraded additively with experiment support

### Decision
Add migration `003_trend_algorithm_upgrade.sql` with two goals:
- additive columns on `subreddit_trend_point` for explainable scoring components and algorithm metadata
- new table `subreddit_trend_point_experiment` for storing multiple algorithm versions on the same time window

Also quarantine low-trust external skill content and keep project-local skill guidance in `skills/reddit-trend-algo/SKILL.md`.

### Why
Current MVP table shape is enough for Phase-1 trend output, but not enough for explainable scoring, parameter tuning, and A/B algorithm comparison.
An additive migration keeps existing write/read flows working without redesign.

### Tradeoff
Schema complexity increases (more columns + one extra table) before algorithm implementation is fully migrated to consume them.

### Date
2026-04-11

## Decision 12: Apify is the primary live provider with controlled HTTP fallback

### Decision
Provider runtime policy is now:
- live provider default: `apify`
- fallback provider: `http` (enabled by `APIFY_FALLBACK_TO_HTTP=true` by default)
- optional compare mode: `APIFY_COMPARE_WITH_HTTP=true` to run both providers and emit post-count diff telemetry

`RedditApifyConnector` is now a real actor-run + dataset adapter:
- starts actor run via configured run endpoint
- waits for terminal run status
- reads dataset items and maps into internal Reddit payload contracts
- classifies failures into stable taxonomy (`auth_config_error`, `rate_limit`, `provider_timeout`, `actor_invocation_error`, `dataset_empty`, `malformed_payload`)

### Why
Obsidian project decisions converged on "Apify as primary provider without breaking connector boundary". This keeps worker/mapper/repository flows unchanged while making provider behavior explicit and observable.

### Tradeoff
Actor input/output schema can still vary across Apify actors; runbook-level input tuning and compare-mode validation remain necessary before fully disabling HTTP fallback.

### Date
2026-04-13

## Template (for future decisions)

### Decision
<What was decided>

### Why
<Why this is the current best choice>

### Tradeoff
<What we are not doing because of this>

### Date
YYYY-MM-DD
