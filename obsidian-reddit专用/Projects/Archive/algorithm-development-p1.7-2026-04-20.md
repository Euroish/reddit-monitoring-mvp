---
title: "algorithm-development-p1.7-2026-04-20"
type: codex-project-archive
status: archived
archived_at: "2026-04-20 14:20:00"
source: "Projects/project.md"
---
# Algorithm Development P1.7 Archive

This archive preserves the algorithm-development state that was active before the project focus moved to frontend product-shell development.

## Product Positioning

- This repo remains one product; it is not split into a collector-only repo and a separate analytics repo.
- `P1` remains the data plane and truth layer. `P2` remains website-facing analytics consumption.
- Acquisition now has two lanes: baseline connector lane (existing TypeScript HTTP/APIFY path) and Scrapling lane (Python adaptive scraping lane).

## Current Decision

- Keep current `http + scrapling` controlled-promotion plus algorithm/read-model outputs as the verified baseline.
- Treat `P1.7` as complete for implementation scope; changes here are now maintenance/calibration only unless a new requirement explicitly reopens the phase.
- Use the next cycle for product-shell progress (`P2`-facing auth/session and deployment hardening), while preserving current fact/read-model/API and provider-policy behavior.

## Why This Decision

- The repo already has verified acquisition evidence (`shadow compare`, `promotion verify`, provider routing, fallback truth); the missing product layer is explainable daily facts and read models.
- The user-provided algorithm specs are now explicit enough to replace connector-first staging with a stricter algorithm-first execution order: facts -> scoring -> APIs -> provider policy.
- Product value depends on answering `what is trending`, `why`, and `which posts drive it`; current window-only scoring is not enough without daily facts, query trends, and explain payloads.
- Current architecture boundaries already support this tighter flow: `docs/architecture.md` keeps runtime/provider choice separate from scoring, and the current scheduler still materializes trend/keyword outputs directly from collection-side persistence, so the next correction is flow discipline rather than a rewrite.
- The previous flow became too contract-heavy for routine execution; reducing non-essential gates will improve throughput without weakening correctness if code/tests remain the primary proof.
- Deep Scrapling work still matters, but it should stabilize the algorithm pipeline instead of blocking all higher-level product work.

## P1.7 Scope

- Add a canonical day-level fact layer for subreddit heat, volume, qualified-post counts, and short-window momentum.
- Replace fixed quality thresholds with subreddit-tier-aware plus percentile-aware qualification rules.
- Upgrade keyword trends from auto-token MVP output into dual-track `auto keyword + explicit query` read models.
- Add driver-post and anomaly layers with explain payloads that can power product APIs directly.
- Institutionalize Scrapling through provider-routing/promotion policy only after the algorithm fact pipeline is stable.

## P1.7 Must Fix First

- `subreddit_daily_fact` must become the canonical base for 30-day heat views, 15-day qualified-post trends, and downstream keyword normalization.
- `subreddit-tiering` and `quality-threshold` services must eliminate fixed-threshold drift across `micro/small/mid/large` communities.
- Scheduler/job order must become explicit and idempotent: `collect -> daily facts -> trend points -> keyword/drivers -> anomalies`.
- Product APIs and downstream scoring must stop mixing raw snapshots and fact/read-model sources for the same metric.
- `/readyz` must report algorithm materialization health from the same persisted truth path, not only provider transport health.
- New read-model repository/API contracts must expose product outputs instead of leaking provider/runtime internals.

## P1.7 Must Not Do

- No UI-first expansion before stable fact tables and read-model APIs exist.
- No provider-policy rewrite that delays R1-R4 algorithm delivery.
- No threshold/formula changes without explain payloads, tests, and algorithm versioning.
- No breaking contract rewrite; schema work stays additive (`daily fact`, `growth fact`, `anomaly event`).

## P1.7 Exit Gate

- Subreddit heat APIs return continuous 30-day daily facts with `heat_price`, `post_volume`, `qualified_post_volume`, `ema7`, and `ema30`.
- The 15-day quality trend uses tier-aware + percentile-aware qualification instead of fixed thresholds.
- Keyword trends support explicit user query and auto-keyword discovery with 30-day explainable heat.
- Driver-post and anomaly feeds are queryable with explain payloads, not just aggregate scores.
- Read models are single-sourced from fact/materialized layers, so the same page cannot return conflicting values from raw snapshots vs aggregated tables.
- Scrapling promotion/routing is codified in runtime and `/readyz` reflects real provider plus algorithm-materialization health.
- `npm run algo:phase1` plus targeted new unit/integration suites pass for each completed round.

## Change Policy

- Allowed: additive fact/event tables, scoring services, read-model APIs, bounded provider-policy integration, focused cross-layer refactors that unblock the current slice, tests, docs.
- Forbidden: unrelated refactors, new source expansion, API-breaking changes, broad rewrites that are not required by the current slice.
- Each round should end with runnable code, focused tests, and explicit verify evidence; process/docs updates are secondary unless explicitly requested.
- Every new scoring/output path must carry `algorithm_version`; user-facing scores/events must also carry `explain_payload`.

## Architecture Guardrails

- Write-path order stays fixed: collection persists raw/normalized/snapshot truth first, then materialized facts, then product read models.
- Read-path discipline stays fixed: product APIs read from fact/materialized layers, not directly from raw snapshots as the primary result source.
- Canonical-source discipline stays fixed: once a metric is promoted into `subreddit_daily_fact` or another fact table, later services and APIs use that layer unless an explicit conversion layer is documented.
- Observability is co-delivered: provider health remains required, and algorithm/materialization health joins `/readyz` from `R1` onward.
- Versioning is mandatory: scoring formulas, thresholds, and merge rules change only under explicit `algorithm_version` updates with bounded regression coverage.

## Algorithm Development Plan

- Round R1 `daily fact foundation` (complete): add `subreddit_daily_fact`, `subreddit-tiering.service`, `quality-threshold.service`, `subreddit-daily-heat.service`, reorder scheduler materialization around the daily fact layer, declare the day-level canonical metric source, and expose the first subreddit heat read model/API plus algorithm-materialization readiness evidence.
- Round R2 `keyword trend upgrade`: settle `query normalization v2` (`lowercase`, phrase handling, token overlap, alias boundary, subreddit-scoped vs global query semantics) inside code/tests, convert keyword processing to `explicit query + auto keyword` dual track, use tier-aware qualification, and output 30-day keyword heat plus breakout markers from fact/materialized inputs only.
- Round R3 `driver-post layer`: add `post_growth_fact`, velocity-based driver scoring, same-age cohort normalization (`1h/6h/24h` minimum buckets), driver labels, and subreddit/keyword driver APIs.
- Round R4 `anomaly layer`: add raw `anomaly_event` detection plus merged/consumer-facing anomaly incidents, settle dedupe/merge rules across `volume`, `quality`, `keyword`, and `driver` signals in code/tests, and expose explainable anomaly feeds.
- Round R5 `provider policy institutionalization`: move Scrapling into `fetch-execution-engine + provider-routing-policy`, keep shadow compare as a standing sample, and wire provider-promotion decisions to the observability contract that earlier rounds already started using.
- Execution rule: rounds define default priority, but bounded pull-forward work is allowed when it is required to complete the active slice cleanly.
- Execution rule: do not block implementation on separate contract-writing if code/tests can safely settle the rule and preserve continuity.
