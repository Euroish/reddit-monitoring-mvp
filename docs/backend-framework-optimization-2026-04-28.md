# Backend Framework Optimization

Date: 2026-04-28

## Goal

Analyze `obsidian-reddit专用/Projects/后端功能分析.md` against the current backend, then design a framework that is closer to the codebase reality instead of following the note literally.

The target is not "rename everything". The target is also not "freeze the program too early". The target is:

- keep the current modular-monolith boundary
- reduce request-time assembly cost
- make materialization deterministic and incremental
- make read models first-class output instead of side effects
- keep future feature additions cheap and localized

## Current Diagnosis

The repo already has the right macro shape:

- `raw event` exists
- `normalized entity` exists
- `fact/materialized layer` exists
- `read model service` exists

Verified from current code:

- architecture boundaries: `docs/architecture.md`
- normalized post entity: `src/domain/entities/content.ts`
- latest/window engagement: `src/domain/entities/post-engagement.ts`
- daily fact materialization: `src/jobs/build-subreddit-daily-facts.job.ts`
- growth fact materialization: `src/jobs/build-post-growth-facts.job.ts`
- market read model assembly: `src/application/services/market-workbench-read-model.service.ts`
- target read model assembly: `src/application/services/target-workbench-read-model.service.ts`
- scheduler + touched-target materialization orchestration: `workers/reddit-phase1-scheduler.ts`

So the main problem is not "missing layers". The problem is that the derived layers are still partially mixed:

1. Some jobs still depend on `latest` engagement rows for historical derivation.
2. Request handlers/read-model services still assemble many cross-repository slices on demand.
3. Materialization is target-driven, but the invalidation unit is not explicit enough at `target + day/window`.
4. "Facts" and "serving projections" are both materialized, but they do not yet share one strict dependency pipeline.

## Design Position

For this product, the backend should be treated as an **AP-leaning analytics pipeline**:

- availability is more important than strict read-after-write
- correctness comes from deterministic replay/materialization
- API should serve stable projections, not ad hoc joins

This matches both:

- `data-algo-system`: incremental materialization, partitioning by `targetId + day/window`, cache/projection thinking
- `data-algo-social`: social signal collection -> normalization -> fact build -> ranking/serving

At the same time, the framework should stay **evolution-first**:

- allow new fact types and new projections without rewriting old pipelines
- allow new API features to depend on projections instead of cross-layer joins
- keep a small set of stable contracts, but avoid freezing product behavior too early

## Recommended Backend Shape

Use four planes, but tighten the contract between them.

### 1. Evidence Plane

Purpose: preserve collector truth and replay capability.

Tables / structures:

- `raw_reddit_event`
- `collection_job`
- provider health / crawl cursor

Rules:

- append-only for evidence
- no product logic here
- every fetch produces a deterministic replay envelope

### 2. Canonical Entity Plane

Purpose: store stable source-agnostic entities.

Tables / structures:

- `monitor_target`
- `account`
- `content`

Recommendation:

- keep `content` as the storage name for now
- in application/read-model code, treat it semantically as `RedditPost`
- do not spend effort on broad renaming unless a second content kind is added

This is lower risk than a repo-wide rename and preserves current verified work.

The simplification principle is:

- keep storage names stable
- simplify flow contracts
- let feature growth happen by adding new fact builders or projections
- avoid letting every new feature create its own custom data path

### 3. Observation / Fact Plane

Purpose: persist time-scoped measurements and derived facts that are reusable.

Split this plane into two subtypes.

#### 3A. Observation Facts

Raw but normalized measurements:

- `metrics_snapshot`
- `post_engagement_latest`
- `post_engagement_window`
- recommended addition: `post_engagement_daily`

Why add `post_engagement_daily`:

- current jobs use `latest` rows for derivation, which is fine for near-real-time views but weak for historical rebuilds
- daily derivations should depend on a day-bounded observation table, not an ever-moving latest pointer
- this reduces recomputation ambiguity and makes backfill replays safer

Recommended key:

- `(target_id, content_id, day)`

Recommended in-memory DS during build:

- `Map<contentId, DailyObservationAccumulator>`
- `Map<day, ContentId[]>`

#### 3B. Derived Facts

Stable materialized analytics:

- `subreddit_daily_fact`
- `subreddit_trend_point`
- `keyword_trend_daily`
- `post_growth_fact`
- `anomaly_event`

Recommendation:

- keep these as the only inputs for higher-level product scoring
- avoid letting read models fall back to `latest` except for explicitly real-time widgets

### 4. Serving Projection Plane

Purpose: directly support API DTOs and web pages.

Current code builds these mostly in-memory inside read-model services. That is acceptable for target detail, but too expensive as the market board grows.

Recommended split:

- `target detail` can keep service-side assembly for now
- `market board` should gain a dedicated projection table or persisted snapshot

Recommended projection examples:

- `market_target_status_projection`
- `target_workbench_summary_projection`
- optional later: `keyword_query_projection`

The old note suggested adding a market-specific model. That recommendation is still correct, but it should be framed as a **serving projection**, not another domain entity.

## Optimized Flow

```text
Scheduler
  -> Collection Job
  -> Connector Fetch
  -> Raw Event Persist
  -> Canonical Entity Upsert
  -> Observation Upsert
  -> Materialization Manifest Emit
  -> Fact Builders in dependency order
  -> Serving Projection Refresh
  -> API reads projection/fact only
```

Refine it into a strict pipeline:

### Step 1. Collect

Input:

- `targetId`
- `crawlMode`
- provider routing context

Output:

- raw envelope
- normalized post/account rows
- observation rows

### Step 2. Build `TouchedScope`

After each collection run, compute a small invalidation object:

```ts
interface TouchedScope {
  targetId: string;
  touchedContentIds: string[];
  affectedDays: string[];
  affectedWindows: Array<{
    granularity: "15m" | "1h" | "6h" | "1d";
    start: string;
    end: string;
  }>;
  reasons: Array<"new_content" | "engagement_update" | "coverage_update" | "about_update">;
}
```

This is the missing backbone. The current scheduler tracks touched targets, but not a compact invalidation scope.

Recommended DS:

- `Set<string>` for `affectedDays`
- `Set<string>` for `touchedContentIds`
- `Map<targetId, TouchedScope>`

This is simple and gives deterministic downstream work.

### Step 3. Materialization Manifest

Persist one manifest row per target run:

```ts
interface MaterializationManifest {
  runId: string;
  targetId: string;
  affectedDays: string[];
  affectedWindows: string[];
  priority: "realtime" | "normal" | "backfill";
  status: "queued" | "running" | "done" | "failed";
}
```

This avoids hidden coupling where every scheduler pass decides again what to rebuild.

### Step 4. Fact Build Order

Enforce one dependency order:

1. observation aggregation
2. `subreddit_daily_fact`
3. `keyword_trend_daily`
4. `post_growth_fact`
5. `subreddit_trend_point`
6. `anomaly_event`
7. serving projections

Reason:

- `subreddit_daily_fact` is the day bucket foundation
- `trend_point` and `anomaly_event` should not be rebuilt before lower facts stabilize
- serving projections should be the last mile only

### Step 5. Projection Refresh

Do not let market APIs recompute broad board state from many repositories on every request once target count grows.

Recommended projection:

```ts
interface MarketTargetStatusProjection {
  targetId: string;
  canonicalName: string;
  status: "active" | "paused";
  latestObservedDay?: string;
  latestHeatIndex?: number;
  latestTrendScore?: number;
  coverageStatus?: string;
  liveFetchStatus?: "fresh" | "stale" | "error";
  backfillStatus?: "missing" | "progressing" | "covered" | "limited";
  lastMaterializedAt: string;
}
```

This is a serving projection, not a replacement for facts.

## Long-Term Safety Rules

These rules matter more than any single table addition if the project will keep growing.

### 1. New features can only enter in two ways

- add a new derived fact
- add a new serving projection

Avoid a third path where a feature reads raw tables directly and builds private business logic in the API layer.

### 2. Keep collection and product logic separated

Collector code may evolve often because providers, retries, rate limits, and anti-bot behavior change.

Product code should mostly depend on:

- canonical entities
- observations
- derived facts
- serving projections

This separation is what prevents long-term operational instability.

### 3. Make every expensive computation replayable

If a feature depends on a non-trivial computation, it should be rebuildable from persisted lower layers.

That means:

- no hidden in-memory state
- no one-off API-time scoring as the only source of truth
- no algorithm state that cannot be replayed from evidence/facts

### 4. Prefer additive evolution over structural rewrites

When adding a feature, ask:

- can this be a new fact table?
- can this be a new projection?
- can this reuse `TouchedScope` and the existing materialization protocol?

If yes, do that before considering renames or broad refactors.

## Data Structure Recommendations

These are the highest-value DS-level changes for the current codebase.

### A. `Map`-first aggregation, not repeated array joins

Prefer:

- `Map<targetId, ...>`
- `Map<contentId, ...>`
- `Map<day, ...>`
- `Set<day>`

This aligns with existing service/job style and avoids repeated `O(n*m)` scans during materialization.

### B. Partition all rebuild work by `targetId + day/window`

Do not use only `targetId` as the recomputation unit.

Best practical partition keys:

- daily facts: `targetId + day`
- growth facts: `targetId + observedAt bucket`
- trend points: `targetId + windowStart + granularity`
- projections: `targetId`

This keeps backfill and live refresh compatible.

### C. Separate `latest`, `window`, `daily`

Keep all three because they solve different read/write paths:

- `latest`: cheap realtime detail
- `window`: short-horizon velocity math
- `daily`: historical rebuild and product facts

The old analysis was directionally right here.

### D. Promote projections over request-time fan-in

For low-cardinality detail pages, service assembly is acceptable.

For market/global boards, prefer projection tables or persisted snapshots because:

- latency is predictable
- DTO shape is stable
- frontend does not depend on backend doing many repository joins live

### E. Add materialization watermarks

Per target, track:

- `lastCollectedAt`
- `lastObservationMaterializedAt`
- `lastProjectionMaterializedAt`
- `algorithmVersion`

This makes readiness and stale-data diagnosis easier than inferring from mixed tables.

## What Not To Do

To stay inside scope and avoid false complexity:

- do not rename `content` table/repository across the repo now
- do not introduce microservices
- do not add Redis/Kafka just to formalize the pipeline
- do not build a generic DAG engine
- do not move all target read models into persisted projections immediately
- do not freeze product semantics before real usage proves them stable

The repo is still a modular monolith. The right move is to make the monolith stricter, not more distributed.

## Recommended Implementation Order

### P0

- keep current module boundaries
- introduce `TouchedScope` in scheduler/materialization path
- introduce `MaterializationManifest`
- make downstream jobs consume explicit affected day/window ranges

### P1

- add `post_engagement_daily`
- switch historical fact builders to prefer daily engagement observations

### P2

- add `market_target_status_projection`
- make market board read path prefer projection instead of wide fan-in assembly

### P3

- add per-target materialization watermark/state table
- surface these states in `readyz` and ops views

## Final Recommendation

Do not treat the old note as a request for large-scale renaming or early structure freeze. Treat it as a signal that the project needs one stronger backend contract:

`collection output -> touched scope -> fact pipeline -> serving projection`

That is the smallest change that improves:

- determinism
- rebuild safety
- read latency
- maintainability
- feature extensibility

without invalidating the current architecture.
