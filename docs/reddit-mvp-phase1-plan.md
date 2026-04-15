# Reddit-only MVP Phase 1 Plan

## Phase objective

Finish architecture and skeleton that can immediately enter implementation for `subreddit trend change`.

## Week 1 scope

## Day 1: lock scope and contracts
- finalize `mvp-brief.md`
- finalize `data-model.md`
- finalize connector interfaces
- define one seed target list for dev/test

Exit criteria:
- docs reviewed
- no open scope ambiguity on object/value

## Day 2: storage and job skeleton
- create DB migration skeleton for core tables
- create repository interfaces (no heavy SQL optimization yet)
- define `collection_job` lifecycle transitions

Exit criteria:
- schema can be applied locally
- job status flow is testable with fixtures

## Day 3: Reddit connector skeleton
- implement HTTP client wrapper + auth/rate-limit policy shell
- implement raw envelope capture contract
- implement payload mapper shell (`raw -> normalized DTO`)

Exit criteria:
- connector can fetch one subreddit and persist raw response

## Day 4: collection workflow skeleton
- implement `collect_subreddit_about` job shell
- implement `collect_subreddit_new_posts` job shell
- upsert normalized entities + append snapshots

Exit criteria:
- one manual run creates raw + normalized + snapshot rows

## Day 5: trend read model skeleton
- implement `build_subreddit_trend_points` shell
- expose one read API contract for trend timeline
- add integration tests for end-to-end happy path

Exit criteria:
- API can return trend data for seeded subreddit

## Deliverables by end of phase

- architecture supplement
- data model and collection strategy docs
- connector/domain interface skeleton
- runnable job skeleton with seeded target
- smoke-tested API read contract

## Deferred to Phase 2

- growth ranking
- anomaly scoring
- notification delivery
- TikTok connector

