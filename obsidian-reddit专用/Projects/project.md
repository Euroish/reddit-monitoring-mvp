---
title: "project"
type: codex-project-workspace
status: active
stage: coverage-semantics-hardening-landed
updated_at: "2026-04-28 06:02:10"
repo_path: "/root/reddit-monitoring-mvp"
next_action: "Keep coverage semantics stable while adding only focused product surfaces; no remaining standalone export/report generator was found in the current repo."
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
- The advisory note `new analyse.md` was read on 2026-04-28 and reconciled as a secondary input, not an active execution source. Its useful signal is that the project is past the initial P0/P1 storage work and should now focus on proving the remaining coverage and output semantics against current code.
- `content` provenance and `total_eligible` now exist as the first landed P0 slice.
- The collection path now tags `new` listing posts as `new_listing` / `total_eligible=true` and `top` supplement posts as `top_supplement` / `total_eligible=false`.
- Candidate filters no longer shrink the content/total denominator; they still narrow analytics metric candidates.
- Daily facts now read only total-eligible content for observed post volume.
- Day-level coverage facts now materialize from total-eligible content, daily facts, and live/backfill cursor evidence.
- Target workbench, comparison workbench, and daily trend API/read-model semantics now expose complete totals only when coverage is complete and observed counts otherwise.
- Current repo search did not find a standalone export/report generator path. Treat any future export/report surface as required to reuse the same coverage semantics before release.

## Core Decision

- `new` listing evidence is the only total-volume candidate source because it is the time-ordered stream.
- `top` / `hot` / search / manual supplement evidence is discovery-only unless a future source can prove time-contiguous completeness.
- `content` remains an observed corpus. It must not be treated as a complete Reddit post table unless each counted row is total-eligible and the requested day/range has coverage proof.
- Candidate filters may support driver posts, keyword discovery, growth, anomaly, and qualified-signal work. They must not determine the denominator for total post volume.
- `iteration_budget_exhausted` means this run used its budget and should continue later; it is not final proof of source limitation.
- Missing history stays `missing`, `partial`, `source_limited`, or `unknown`. Never materialize uncovered days as fake zero.
- Small subreddits may become complete for a 15-day historical window if backfill reaches the day start or true terminal EOF. Medium/high-volume subreddits usually need uninterrupted live monitoring from activation time before totals are commercially defensible.

## Implementation Flow

Use this as a neutral harness for the next work slice. Current code evidence has priority over archived notes and advisory analysis.

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

- `P0.1` Done: Add `content` provenance and total-eligibility fields across domain, schema, Postgres repository, and in-memory/test repositories.
- `P0.2` Done: Split `collect-subreddit-new-posts.job.ts` page collection/write semantics so `new_listing` and `top_supplement` are no longer indistinguishable after ingestion.
- `P0.3` Done: Stop candidate filtering from shrinking the total-corpus denominator; keep filtering for analytics candidates and qualified/driver surfaces.
- `P0.4` Done: Update daily fact materialization to count only total-eligible `new` listing posts for observed volume.
- `P1.1` Done: Add coverage fact storage/read path with day granularity and concrete coverage status/basis.
- `P1.2` Done: Wire backfill progress and live/source-limited cursor evidence into coverage facts.
- `P1.3` Done: Added regression coverage for backfill-proven complete days, live-continuous complete days, missed live windows, iteration-budget continuation, and rate-limited live windows.
- `P2.1` Done: Update API contracts/read models/UI display rules for total-vs-observed semantics and coverage-aware chart/KPI behavior.
- `P2.2` Done: Target workbench, comparison read-model, and legacy daily trend API semantics are aligned. No standalone export/report generator exists in the current repo evidence.

## Next Slice Harness

- Objective: prevent remaining output paths from presenting observed or partial data as complete totals.
- Evidence to inspect first: coverage job resolver, comparison read model, daily insights/trend read models, API routes, export/report generation paths, and existing tests for these surfaces.
- Expected implementation order: add focused fixtures for missed live windows and source-limited continuation, then gate or relabel comparison/export/report totals using the same coverage semantics as target workbench.
- Stop condition: stop when the next output path would require a product choice about labels, retention, or historical completeness that cannot be inferred from current coverage facts.

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

### 2026-04-28 06:02:10

- Scope: Landed the coverage-semantics hardening slice. Coverage materialization now emits `live_continuous`, `missed_live_window`, `iteration_budget_exhausted`, and `rate_limited` evidence from existing cursor/provider-health inputs; comparison workbench and daily trend API outputs now gate complete totals on coverage facts while exposing observed counts separately.
- Why now: The remaining drift risk was that comparison or legacy daily trend paths could still present observed or partial rows as totals after target workbench had been fixed.
- Verify: Focused coverage/API tests passed. `npm run typecheck`, `npm run algo:fast`, `npm run algo:phase1`, `npm run algo:phase1:full`, `npm run algo:full`, and `npm run verify:repo` passed; full suite passed 309 tests. Web build retained the existing Vite chunk-size warning.
- Next: Keep new chart/export/report work behind the same coverage contract. No standalone export/report generator was found in the current repo evidence.

### 2026-04-28 05:46:43

- Scope: Read `new analyse.md`, reconciled it against `project.md` and current code evidence, archived it under `Projects/Archive/`, and updated `project.md` to use a neutral coverage-semantics hardening harness.
- Why now: The advisory analysis was directionally useful but overstated some alignment, especially comparison totals. The active state needed to separate landed target workbench semantics from remaining comparison/export/report verification.
- Verify: Documentation/state reconciliation only. Checked `00_START_HERE.md`, `project.md`, `new analyse.md`, `target-comparison-workbench-read-model.service.ts`, `target-workbench-read-model.service.ts`, `build-subreddit-collection-coverage.job.ts`, and `Projects` root contents. No tests were run.
- Next: Verify and harden missed live window/source-limited fixtures, comparison totals, and legacy export/report wording against coverage semantics.

### 2026-04-28 05:16:31

- Scope: Landed coverage facts and total-vs-observed read-model semantics. Added `subreddit_collection_coverage` storage, Postgres/in-memory repositories, a coverage materialization job, worker wiring, API repository wiring, contract fields for coverage status/basis/value semantics, observed count series, and UI defaults/KPIs that fall back to observed labels unless complete coverage is proven.
- Why now: P0 separated total-eligible `new` listing content from discovery supplements, but product totals still needed day-level proof before API/UI could honestly call counts complete totals.
- Verify: `npm run typecheck` passed. Focused coverage/read-model/API tests passed. `npm run algo:fast`, `npm run algo:phase1`, `npm run algo:phase1:full`, `npm run algo:full`, and `npm run verify:repo` passed; full test suite passed 304 tests. Web build completed with the existing Vite chunk-size warning.
- Next: Add deeper operational fixtures for missed live windows/source-limited continuation and align remaining export/report paths with coverage semantics.

### 2026-04-28 05:00:00

- Scope: Landed the P0 provenance/eligibility slice. Added content collection provenance and total eligibility fields, persisted them through Postgres and in-memory repositories, tagged `new` listing pages as total-eligible and `top` supplement pages as discovery-only, kept candidate filters out of the total-corpus denominator, and changed daily fact materialization to query only total-eligible content.
- Why now: The active blocker was that observed content, discovery supplements, and total-volume candidates were indistinguishable. Without this separation, coverage facts and UI/API total-vs-observed semantics would still be built on contaminated counts.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts tests/unit/build-subreddit-daily-facts.job.test.ts` passed with 26 tests. `npm run algo:fast`, `npm run algo:phase1`, and `npm run algo:phase1:full` passed.
- Next: Implement `P1.1` coverage fact storage/read path and wire live/backfill continuity evidence into it before changing API/UI totals.

### 2026-04-28 04:50:00

- Scope: Reconciled `算法与抓取代码分析 (1).md` and the archived project notes into a compact current-state `project.md`; updated the active stage to coverage/provenance core; converted the latest algorithm/crawl analysis into the active optimal plan; archived the uploaded analysis note so `Projects` root returns to a single active state file.
- Why now: The new analysis confirmed the same unresolved core issue from current code evidence: `content` lacks provenance/total eligibility, supplement listings can contaminate total volume, and daily/read-model counts need coverage proof before the product can honestly show totals.
- Verify: Documentation/state reconciliation only. Checked `00_START_HERE.md`, current `project.md`, the uploaded analysis note, archived reference notes, `skills/algorithm-dev-suite/SKILL.md`, `docs/architecture-sketch.md`, and code search for `discovery_source`, `total_eligible`, coverage, candidate filtering, and `total_new_posts`. Confirmed `Projects` root contains only `project.md`. No tests were run.
- Next: Implement `P0.1` through `P0.4` as the next smallest vertical slice before API/UI expansion.
