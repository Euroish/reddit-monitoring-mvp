---
title: "project"
type: codex-project-workspace
status: active
stage: coverage-gated-total-truth
updated_at: "2026-04-27 15:15:00"
repo_path: "E:\\vibe coding\\project"
next_action: "Implement the smallest coverage/provenance slice: separate total-eligible `new` listing evidence from discovery/supplemental evidence, then gate `Total New Posts` / `Qualified Posts` behind complete coverage while exposing observed counts for partial/source-limited days."
tags:
- codex
- workspace
- reddit
- http
- scrapling
---
# project

## Summary

- Repository: `E:\vibe coding\project`
- Authority: `project.md` is the only execution state source.
- Archive: old route notes and exported analysis files are historical inputs only after reconciliation; they do not constrain execution.
- Product truth: current product is a bounded monitored Reddit analytics workbench. It may show `Total New Posts` only for target/range/day data with complete coverage proof; otherwise it must show observed counts and coverage status.

## Current Decision

- Mainline is coverage-gated Reddit analysis, not blind retrospective 15-day history recovery and not a blanket "all listings max 1000 posts" rule.
- Reddit `/new` pagination has practical horizon limits that vary by subreddit activity, cursor behavior, page budget, live accumulation, and supplement sources. Small subreddits may be complete for 15 days; high-volume subreddits may only be complete after continuous live monitoring from activation time.
- Every monitored target needs an activation boundary. Data after activation can become commercial-grade total only if live windows remain continuous; data before activation remains backfill-proven total only when coverage reaches the requested start, otherwise observed.
- Missed scheduler windows, failed collection windows, cursor stalls, and rate-limit gaps must degrade coverage. A day cannot stay `complete` if the collection evidence has a continuity gap that could hide posts.
- `new` listing evidence is the only channel eligible for total post-volume analysis. `top` / `hot` / search / manual supplement evidence is discovery-only unless a future source can prove time-contiguous completeness.
- `Total New Posts` and `Qualified Posts` remain the product-facing default labels when coverage is complete. For incomplete, partial, or source-limited ranges, the same raw counts must be labeled observed and not exported as true total.
- Normal runtime path is `http` primary plus `scrapling` fallback capability only.
- Legacy `apify` main-path code is removed because it had become drift-heavy and no longer belongs to the active requirements.
- Automatic collection must remain storage-safe:
  - duplicate `content` rows must stay impossible
  - repeated listing observation must not keep inflating `metrics_snapshot`
  - `raw_reddit_event` and `metrics_snapshot` must have bounded retention
- Missing or uncovered history must remain `missing` / `source_limited`, never fake zero.
- `activity_index` / `activity_confidence` may exist as secondary diagnostics, but they must not replace raw post-count defaults unless the product explicitly changes KPI semantics.

## Requirement Status

- Already materially present:
  - subreddit trend/workbench
  - target detail with driver posts
  - global observed-corpus keyword query
  - subreddit keyword overlay / keyword heat
- Still unfinished:
  - collection provenance or equivalent source semantics that distinguish total-eligible `new_listing` evidence from discovery-only supplement evidence
  - day/range coverage facts that can prove `complete`, `partial`, `source_limited`, or `unknown`
  - live continuity evidence: activation time, expected windows, collected windows, missed windows, and degradation reasons
  - daily facts/read models that split complete total counts from observed counts instead of overloading one field
  - coverage acceptance fixtures for small, medium, and high-volume subreddits so AskReddit/Overwatch/small-subreddit behavior stays explainable
  - old daily trend, comparison, export, and UI surfaces aligned to coverage-gated total semantics
  - all-target catalog/list path after core data semantics are stable
  - active-lane code/data-structure simplification after coverage truth is fixed

## Explicit Task Stack

- `P0.1` Add collection provenance or equivalent fields so posts/facts know whether they came from total-eligible `new_listing` collection or discovery-only supplement collection.
- `P0.2` Exclude `top` / `hot` / search / manual supplement posts from total daily post-volume calculations. They may remain available for driver posts, keyword discovery, and examples.
- `P0.3` Add per-target/day or per-range coverage facts with `complete`, `partial`, `source_limited`, and `unknown` status plus a concrete basis such as `live_continuous`, `backfill_reached_day_start`, `iteration_budget_exhausted`, or `cursor_saturated`.
- `P0.4` Split post-count semantics in daily facts/read models: complete total counts are nullable unless coverage is complete; observed counts remain available for partial/source-limited ranges.
- `P0.5` Add live continuity accounting: target activation time, expected collection windows, successful windows, missed/failed windows, and rate-limit/degraded reasons. Coverage must downgrade when a gap can hide posts.
- `P0.6` Add regression fixtures/tests for three real product cases: small subreddit complete historical coverage, medium subreddit continuing backfill after budget exhaustion, and high-volume subreddit total only since uninterrupted monitoring activation.
- `P1.1` Update API/UI display rules so complete coverage defaults to `Total New Posts` / `Qualified Posts`, while incomplete coverage defaults to observed labels with coverage badges and no fake zero.
- `P1.2` Change bounded backfill semantics so `iteration_budget_exhausted` means continue/schedule more work, not a final proof of source limitation.
- `P1.3` Add operational observability for commercial use: per-target freshness, last successful crawl, missed-window count, source-limited count, and storage growth/retention status.
- `P2.1` Bring old daily trend, comparison, keyword, export, and report surfaces into the same coverage-gated truth model.
- `P2.2` Add the all-target catalog/list path only after the core total/observed semantics are stable.
- `P3.1` Simplify duplicated data-quality DTOs and provider branching only where it directly supports the active coverage/provenance lane.

## Guardrails

- Allowed:
  - collector/storage truth fixes
  - retention/prune automation
  - favorite-target scheduling
  - coverage/data-quality contract fixes
  - smallest UI/API changes needed to expose coverage-gated total/observed semantics
- Forbidden:
  - new provider expansion
  - broad architecture rewrites
  - dashboard/catalog expansion before total/observed semantics are trustworthy
  - whole-Reddit wording without a real discovery layer
  - treating `top` / `hot` / search supplement data as total post-volume evidence
  - treating `iteration_budget_exhausted` as a final coverage conclusion
  - marking a day/range complete without activation/continuity evidence or backfill reaching the requested start
  - cleanup that touches many layers before coverage/provenance truth is fixed

## Startup Rules

- Live startup pair: `00_START_HERE.md` and `obsidian-reddit专用/Projects/project.md`.
- Do not use `planning-with-files` in this repo.
- Do not create or maintain `task_plan.md`, `findings.md`, or `progress.md`.
- Keep summaries short and execution-oriented.
- When drift appears between archived notes and current code, reconcile against current code and this file; do not re-open archived plans as active harnesses.

## Activity Log

### 2026-04-27 15:15:00

- Scope: Paused automatic Reddit collection before publishing the current code/state snapshot. Stopped and disabled `reddit-phase1-scheduler.service`; API and keyword refresh services were left running.
- Why now: The current product data truth work is being reset around coverage/provenance semantics. Continuing automatic collection while pushing the corrected state could keep generating data under the old incomplete semantics.
- Verify: `systemctl is-active reddit-phase1-scheduler.service` returned `inactive`; `systemctl is-enabled reddit-phase1-scheduler.service` returned `disabled`. `npm run typecheck` passed. `node --import tsx --test tests/unit/target-workbench-read-model.service.test.ts tests/integration/api-server-trends.test.ts` passed with 23 tests.
- Next: Commit and push the current restored post-count defaults plus project-state/archive cleanup to GitHub, then resume collection only after the next coverage/provenance slice is ready or explicitly requested.

### 2026-04-27 15:08:00

- Scope: Tightened the coverage-gated plan with the missing commercial-grade constraints: target activation boundaries, live continuity/missed-window degradation, operational freshness/retention observability, and regression fixtures for small, medium, and high-volume subreddit behavior.
- Why now: The previous state captured provenance and total/observed separation, but did not explicitly force the system to prove uninterrupted monitoring after activation. Without that, a UI could still label post counts as `Total` after silent scheduler or rate-limit gaps.
- Verify: Documentation-only refinement. No tests were run.
- Next: Treat `P0.1` through `P0.6` as the complete core slice before catalog/dashboard expansion.

### 2026-04-27 15:03:00

- Scope: Reconciled the latest root notes `核心问题分析.md` and `前端升级指标变更 (1).md` against the unarchived `Projects` notes, archived the reconciled Markdown files, and collapsed the execution state back into this file. Updated the active lane from simple observed-corpus wording to coverage-gated total/observed semantics: `new` listing evidence may support total counts only with coverage proof; supplement sources remain discovery-only; `activity_index` stays secondary.
- Why now: The old active planning harness had started pulling in conflicting claims: a too-simple "1000 listing limit" explanation, catalog-first frontend work, and default activity/confidence KPIs. The core issue is now narrower and more important: separate collection provenance, prove coverage, and prevent incomplete data from being labeled as total.
- Verify: Documentation-only reconciliation. `Projects` root now contains only `project.md`; the reconciled notes are under `obsidian-reddit专用/Projects/Archive/`. No tests were run for this state update. The previously restored post-count code changes and tests remain separate working-tree changes.
- Next: Implement `P0.1` through `P0.4` as the next development slice before adding catalog/dashboard expansion.

### 2026-04-27 12:40:00

- Scope: Restored the default product-facing workbench post metrics to `Total New Posts` and `Qualified Posts` without changing collector or daily-fact storage truth. Updated [target-workbench-read-model.service.ts](/root/reddit-monitoring-mvp/src/application/services/target-workbench-read-model.service.ts), [target-comparison-workbench-read-model.service.ts](/root/reddit-monitoring-mvp/src/application/services/target-comparison-workbench-read-model.service.ts), [urlState.ts](/root/reddit-monitoring-mvp/apps/web/src/features/workbench/model/urlState.ts), [chartOptions.ts](/root/reddit-monitoring-mvp/apps/web/src/features/workbench/model/chartOptions.ts), and [TargetDetail.tsx](/root/reddit-monitoring-mvp/apps/web/src/pages/TargetDetail.tsx) so activity/confidence remains available as secondary diagnostics but no longer drives default UI semantics.
- Why now: A newly uploaded audit note showed that current repo `main` had drifted into default `Activity Index / Activity Confidence / Observed New Posts` semantics even though the product core still expects raw post-count surfaces as the primary default. That drift would make local frontend work and future deploys diverge from the server's trusted `Total New Posts / Qualified Posts` behavior.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/unit/target-workbench-read-model.service.test.ts tests/integration/api-server-trends.test.ts` passed.
- Next: Keep the active lane narrow. Continue `P1.3` catalog/list work, but preserve raw post-count defaults unless a separate explicitly-approved product change redefines the primary KPI semantics.

### 2026-04-27 12:02:00

- Scope: Synced the latest verified code to GitHub `main` and created a complete-source branch `sync/full-source-from-server` from the current full server worktree so local frontend work can clone a complete repo state.
- Why now: The user wants to start frontend work locally, but the older remote snapshot had been incomplete. Pushing `main` first and then publishing a dedicated full-source branch removes that mismatch without changing server runtime behavior.
- Verify: `git push origin main` advanced `origin/main` to `cb281bc`. `git push -u origin sync/full-source-from-server` created and tracked the new branch at the same commit. `git branch -vv` shows both branches pointing at `cb281bc`.
- Next: Clone `sync/full-source-from-server` locally for frontend work, then keep UI changes on a separate frontend branch so the cloud server stays unchanged until it explicitly pulls those commits.

### 2026-04-27 02:46:11

- Scope: Landed the minimal `P1.2` slice without adding a new state system. Extended [crawl-cursor.ts](/root/reddit-monitoring-mvp/src/domain/entities/crawl-cursor.ts) and [021_live_crawl_cursor_coverage.sql](/root/reddit-monitoring-mvp/src/storage/schema/021_live_crawl_cursor_coverage.sql) with live coverage fields, taught [collect-subreddit-new-posts.job.ts](/root/reddit-monitoring-mvp/src/jobs/collect-subreddit-new-posts.job.ts) to persist requested live-window start plus listing-horizon and partial/source-limited status, and exposed that state through [target-workbench-read-model.service.ts](/root/reddit-monitoring-mvp/src/application/services/target-workbench-read-model.service.ts) and the target workbench API path in [create-api-server.ts](/root/reddit-monitoring-mvp/apps/api/src/create-api-server.ts).
- Why now: The harness was already narrowed to `P1.2+`. The cheapest path to honest live coverage semantics was to reuse `crawl_cursor` as the single per-target/run evidence store rather than introduce another table or planning layer.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts tests/unit/target-workbench-read-model.service.test.ts tests/integration/api-server-trends.test.ts tests/unit/reddit-phase1-runtime.test.ts` passed.
- Next: Keep the next slice small. Build `P1.3` all-target catalog/list and then align the remaining older daily-trend surfaces to the same `missing` / `source_limited` semantics already available in workbench responses.

### 2026-04-27 02:30:00

- Scope: Removed already-completed work from the live task lists and archived it instead of keeping it in the active queue. Kept `project.md` and `reddit-monitoring-mvp-optimal-plan.md` as execution-facing state, while treating `开发方案分析.md` as historical analysis rather than an active checklist.
- Why now: The user asked to delete or archive completed items. Leaving finished `P0` and `P1.1` work in current task sections would keep re-opening already-verified slices and encourage unnecessary code changes.
- Verify: `project.md` now only lists unfinished `P1.2+` work in the explicit task stack. `reddit-monitoring-mvp-optimal-plan.md` now archives completed `P0`/`P1.1` items instead of presenting them as still-open implementation tasks.
- Next: Keep execution narrow on `P1.2`, `P1.3`, and the remaining missing/source-limited semantics only.

### 2026-04-27 02:26:57

- Scope: Landed the first real `P1.1` slice for favorite-target live scheduling. Added deterministic 5-minute slot scheduling for favorite targets in [reddit-target-scheduling.ts](/root/reddit-monitoring-mvp/src/workers/reddit-target-scheduling.ts), wired [reddit-phase1.worker.ts](/root/reddit-monitoring-mvp/src/workers/reddit-phase1.worker.ts) to honor `monitor_target.config_json` favorite/cadence policy when no explicit target list is requested, and fixed [reddit-phase1-runtime.ts](/root/reddit-monitoring-mvp/src/runtime/reddit-phase1-runtime.ts) so env-seeded active targets no longer wipe existing monitor-target config.
- Why now: After closing `P0`, the next narrow blocker was that normal live collection still scanned every active target and the runtime kept overwriting `config_json`, which made per-target cadence impossible in practice.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/unit/reddit-target-scheduling.test.ts tests/unit/reddit-phase1-runtime.test.ts tests/integration/reddit-phase1-cycle.test.ts` passed.
- Next: Stay on truth semantics. Implement `P1.2` by recording requested live window, oldest/newest observed post, listing-horizon hit, and partial/source-limited status per run/target, then expose that state through the existing read path without fake completeness.

### 2026-04-27 02:19:45

- Scope: Closed the `P0` collector/storage truth slice on the reduced `http + scrapling` path. Added live-window acceptance and active-post metric gating in [collect-subreddit-new-posts.job.ts](/root/reddit-monitoring-mvp/src/jobs/collect-subreddit-new-posts.job.ts), centralized retention pruning in [retention-prune.ts](/root/reddit-monitoring-mvp/src/ops/retention-prune.ts), reused that logic from the prune scripts, and scheduled bounded raw-event / metrics retention from [reddit-phase1-scheduler.ts](/root/reddit-monitoring-mvp/workers/reddit-phase1-scheduler.ts).
- Why now: `project.md` explicitly prioritized `P0.1` through `P0.4` before any favorite-target cadence or coverage work. The runtime needed to stop accepting stale live posts, stop rewriting metrics for long-old posts, and make retention an automatic default path instead of a manual script-only operation.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts` passed.
- Next: Implement `P1.1` and `P1.2` narrowly: read favorite/cadence policy from `monitor_target.config_json`, schedule the 8-hour lane honestly, then expose requested-window / observed-window / source-limited live coverage state.

### 2026-04-27 01:44:01

- Scope: Re-checked drift against current requirements and deleted the legacy Apify main-path code plus the large outdated execution state that was no longer helping agents. Collapsed `project.md` into a short current-state file, removed the Apify connector and its unit coverage, and updated runtime/provider/test/docs surfaces to the retained `http + scrapling` path.
- Why now: The user explicitly asked to remove stale and distracting content, including code, that pulls execution away from current needs. The old state file had become too historical, and the Apify branch was no longer part of the active runtime requirements.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/unit/create-reddit-connector.test.ts tests/unit/reddit-phase1-runtime.test.ts tests/unit/reddit-phase1-adaptive-sampling.test.ts` passed. `node --import tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts tests/integration/reddit-phase1-cycle.test.ts tests/integration/api-server-readyz.test.ts` passed. Remaining `apify` text in the repo is now limited to legacy/archival references such as `legacy_apify` test fixtures and explicit notes that the old path was removed.
- Next: Stay narrow. Do not reopen provider expansion or broad cleanup. Implement `P0.1`, `P0.2`, `P0.3`, and `P0.4` directly on the reduced runtime path.

### 2026-04-27 01:35:06

- Scope: Re-checked drift against current requirements and removed the legacy Apify main-path code from the runtime/connector layer. Also re-centered project state on collector/storage truth instead of product-breadth history.
- Why now: Apify code, old provider branches, and long historical state had become agent-unfriendly drift. Current requirements are narrower: safe automatic collection, storage control, favorite-target scheduling, honest coverage semantics, and only then targeted simplification.
- Verify: Removed [reddit-apify.connector.ts](/root/reddit-monitoring-mvp/src/connectors/reddit/reddit-apify.connector.ts); updated live provider typing and runtime wiring to `http | scrapling`; removed Apify-only unit coverage; adjusted collector/provider fallback logic and related tests away from Apify as a first-class lane.
- Next: Run the collector/storage truth slice next: `P0.1`, `P0.2`, `P0.3`, and `P0.4`.

### 2026-04-27 01:32:33

- Scope: Reconciled the six product requirements from the archived backfill-analysis note against current code so only unfinished items remain in the active queue.
- Why now: Current work needed a clean distinction between already-built product capabilities and still-open collector/storage/catalog gaps.
- Verify: Confirmed that trend/workbench, driver-post drill-down, global observed-corpus keyword query, and subreddit-scoped keyword overlays are already materially present; added only unfinished gaps to the active task stack.
- Next: Keep execution on the unfinished collector/storage/scheduling/catalog requirements only.
