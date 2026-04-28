---
title: "project"
type: codex-project-workspace
status: active
stage: coverage-provenance-core
updated_at: "2026-04-28 04:50:00"
repo_path: "/root/reddit-monitoring-mvp"
next_action: "Implement the smallest end-to-end coverage/provenance slice: tag `content` with collection provenance and total eligibility, keep `new` listing as the only total-volume candidate source, and make daily/read-model post counts split observed counts from coverage-proven totals."
tags:
- codex
- workspace
- reddit
- algorithm
- coverage
- provenance
---
# project

## Summary

- Authority: this file is the only active execution state source.
- Startup pair: `00_START_HERE.md` plus this file.
- Archive: Markdown notes under `obsidian-reddit专用/Projects/Archive/` are historical inputs only after reconciliation against current code and this file.
- Product truth: this is a bounded monitored Reddit analytics workbench. It may display `Total New Posts` / `Qualified Posts` only for target/day/range data with coverage proof. Otherwise the product must label the same raw counts as observed and expose coverage status.
- Runtime path: `http` primary plus `scrapling` fallback capability. Legacy Apify is not an active main path.

## Current Reconciled State

- The latest archived analysis note `Archive/算法与抓取代码分析 (1)-2026-04-28.md` matches the active design direction: the core problem is not "grab more pages"; it is missing provenance, missing day/range coverage proof, and overloading observed corpus counts as total counts.
- Current code still has no `content` provenance fields such as `discovery_source` or `total_eligible`.
- Current code still mixes `new` and `top` supplement pages in the collection path before content/fact materialization.
- Current daily facts still derive post volume from observed content counts, not from a coverage-gated total/observed split.
- Current coverage evidence exists mainly around `crawl_cursor` live/backfill status, not as a day-level or range-level fact that can control API/UI semantics.
- Current default UI labels have been restored to `Total New Posts` / `Qualified Posts`, but the data model still needs the backing proof system so those labels are only valid when coverage is complete.

## Core Decision

- `new` listing evidence is the only total-volume candidate source because it is the time-ordered stream.
- `top` / `hot` / search / manual supplement evidence is discovery-only unless a future source can prove time-contiguous completeness.
- `content` remains an observed corpus. It must not be treated as a complete Reddit post table unless each counted row is total-eligible and the requested day/range has coverage proof.
- Candidate filters may support driver posts, keyword discovery, growth, anomaly, and qualified-signal work. They must not determine the denominator for total post volume.
- `iteration_budget_exhausted` means this run used its budget and should continue later; it is not final proof of source limitation.
- Missing history stays `missing`, `partial`, `source_limited`, or `unknown`. Never materialize uncovered days as fake zero.
- Small subreddits may become complete for a 15-day historical window if backfill reaches the day start or true terminal EOF. Medium/high-volume subreddits usually need uninterrupted live monitoring from activation time before totals are commercially defensible.

## Optimal Implementation Plan

### P0: Provenance And Total Eligibility

- Add collection provenance to `content` and repository upserts:
  - `discovery_source`
  - `first_collection_mode`
  - `first_listing`
  - `first_time_range`
  - `first_collection_job_id`
  - `total_eligible`
- Split collection writes so `new` listing posts are written as `total_eligible=true`, while `top` supplement posts are written as `total_eligible=false`.
- Preserve supplement data for driver posts, keyword samples, and examples, but exclude it from post-volume totals.
- Ensure total-corpus ingestion is not blocked by score/comment candidate filters.

### P1: Coverage Facts

- Add day-level or range-level coverage facts for monitored targets.
- Required statuses: `complete`, `partial`, `source_limited`, `unknown`.
- Required basis examples: `live_continuous`, `backfill_reached_day_start`, `terminal_eof_reached`, `iteration_budget_exhausted`, `cursor_saturated`, `missed_live_window`, `rate_limited`.
- Add activation and continuity accounting: activation time, expected windows, successful windows, missed windows, failed/rate-limited windows, and degradation reason.
- Downgrade coverage whenever a collection gap could hide posts.

### P2: Facts, API, UI Semantics

- Split daily/read-model counts:
  - observed new posts
  - observed qualified posts
  - complete total new posts, nullable unless coverage is complete
  - complete qualified posts, nullable unless coverage is complete
- Keep `Total New Posts` / `Qualified Posts` as product-facing labels only when coverage is complete.
- For incomplete ranges, display observed labels and coverage badges; exports must not call partial/source-limited data total.
- Align old daily trend, comparison, keyword, export, and report paths after the core fact/read-model semantics are stable.

### P3: Operational Hardening

- Add regression fixtures for three product cases:
  - small subreddit: historical backfill reaches requested day start and can mark complete
  - medium subreddit: budget exhausted and continuation remains partial/progressing
  - high-volume subreddit: totals valid only after uninterrupted activation-time monitoring
- Add operational observability: per-target freshness, last successful crawl, missed-window count, source-limited count, storage growth, and retention status.
- Simplify duplicated DTO/provider branching only where it directly supports the coverage/provenance lane.

## Explicit Task Stack

- `P0.1` Add `content` provenance and total-eligibility fields across domain, schema, Postgres repository, and in-memory/test repositories.
- `P0.2` Split `collect-subreddit-new-posts.job.ts` page collection/write semantics so `new_listing` and `top_supplement` are no longer indistinguishable after ingestion.
- `P0.3` Stop candidate filtering from shrinking the total-corpus denominator; keep filtering for analytics candidates and qualified/driver surfaces.
- `P0.4` Update daily fact materialization to count only total-eligible `new` listing posts for observed volume, while leaving complete total fields nullable until coverage is complete.
- `P1.1` Add coverage fact storage/read path with day or range granularity and concrete coverage basis.
- `P1.2` Wire live continuity and backfill progress into coverage facts, including missed-window degradation.
- `P1.3` Add small/medium/high-volume regression fixtures for complete, partial/progressing, and activation-only total behavior.
- `P2.1` Update API contracts/read models/UI display rules for total-vs-observed semantics and coverage badges.
- `P2.2` Align legacy trend/comparison/export/report surfaces after the core truth model passes tests.

## Guardrails

- Allowed: collector/storage truth fixes, provenance fields, coverage facts, retention/prune automation, favorite-target scheduling, coverage/data-quality contract fixes, and the smallest UI/API updates needed to expose honest total/observed semantics.
- Forbidden: provider expansion, broad architecture rewrites, catalog/dashboard expansion before total/observed semantics are trustworthy, whole-Reddit wording, treating supplement listings as total evidence, treating `iteration_budget_exhausted` as final source limitation, or cleanup that touches many layers without improving coverage/provenance truth.
- Keep `activity_index` / `activity_confidence` as optional diagnostics. They do not replace raw post-count defaults unless the product explicitly changes KPI semantics.

## Verification Policy

- For algorithm/collection truth changes, start with `npm run algo:fast`.
- Run `npm run algo:phase1` when truth-layer behavior changes.
- Run `npm run algo:phase1:full` when collection/storage/API integration boundaries are touched.
- Run focused tests around any changed repository, job, read-model, or contract path before close-out.
- Documentation-only state updates do not require tests, but must leave `Projects` root containing only `project.md`.

## Activity Log

### 2026-04-28 04:50:00

- Scope: Reconciled `算法与抓取代码分析 (1).md` and the archived project notes into a compact current-state `project.md`; updated the active stage to coverage/provenance core; converted the latest algorithm/crawl analysis into the active optimal plan; archived the uploaded analysis note so `Projects` root returns to a single active state file.
- Why now: The new analysis confirmed the same unresolved core issue from current code evidence: `content` lacks provenance/total eligibility, supplement listings can contaminate total volume, and daily/read-model counts need coverage proof before the product can honestly show totals.
- Verify: Documentation/state reconciliation only. Checked `00_START_HERE.md`, current `project.md`, the uploaded analysis note, archived reference notes, `skills/algorithm-dev-suite/SKILL.md`, `docs/architecture-sketch.md`, and code search for `discovery_source`, `total_eligible`, coverage, candidate filtering, and `total_new_posts`. Confirmed `Projects` root contains only `project.md`. No tests were run.
- Next: Implement `P0.1` through `P0.4` as the next smallest vertical slice before API/UI expansion.
