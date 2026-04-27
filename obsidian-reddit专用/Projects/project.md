---
title: "project"
type: codex-project-workspace
status: active
stage: collector-storage-truth
updated_at: "2026-04-27 02:46:11"
repo_path: "E:\\vibe coding\\project"
next_action: "Keep the harness narrow and move to the next slice: add a real all-target catalog/list path, then align the remaining daily-trend and workbench surfaces to the same `missing` / `source_limited` truth model already exposed through live coverage state."
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
- Planning harness: exactly these three active markdowns constrain scope:
  - `obsidian-reddit专用/Projects/数据库优化与重复命中分析.md`
  - `obsidian-reddit专用/Projects/reddit-monitoring-mvp-optimal-plan.md`
  - `obsidian-reddit专用/Projects/开发方案分析.md`
- Product truth: current product is a bounded monitored Reddit analytics workbench, not whole-Reddit discovery and not guaranteed full-history recovery.

## Current Decision

- Mainline is `live-observed` collection, not retrospective 15-day history recovery.
- Normal runtime path is `http` primary plus `scrapling` fallback capability only.
- Legacy `apify` main-path code is removed because it had become drift-heavy and no longer belongs to the active requirements.
- Automatic collection must remain storage-safe:
  - duplicate `content` rows must stay impossible
  - repeated listing observation must not keep inflating `metrics_snapshot`
  - `raw_reddit_event` and `metrics_snapshot` must have bounded retention
- Missing or uncovered history must remain `missing` / `source_limited`, never fake zero.

## Requirement Status

- Already materially present:
  - subreddit trend/workbench
  - target detail with driver posts
  - global observed-corpus keyword query
  - subreddit keyword overlay / keyword heat
- Still unfinished:
  - all-target catalog/list path instead of only top-page slices
  - old daily trend surfaces aligned to `missing` / `source_limited`
  - active-lane code/data-structure simplification after storage truth is fixed

## Explicit Task Stack

- `P1.3` Add a real target catalog/list path for all recorded or monitored subreddit targets. Do not make the current `slice(0, 8)` top-page boards the only browse surface.
- `P2.1` Unify API/UI semantics so missing or uncovered days stay `null` plus `missing` / `source_limited`, never fake zero.
- `P2.2` Keep keyword and market-facing product surfaces inside observed-corpus truth. No whole-Reddit wording without a real discovery/history layer.
- `P2.3` Bring the older subreddit daily trend surfaces into the same truth model as workbench responses.
- `P3.1` Simplify data structure and code only where it directly supports the active lane: reduce duplicated DTO/data-quality shapes, trim provider branching, and shrink storage/write-path complexity after `P0` is stable.

## Guardrails

- Allowed:
  - collector/storage truth fixes
  - retention/prune automation
  - favorite-target scheduling
  - coverage/data-quality contract fixes
  - smallest UI/API changes needed to expose honest observed-corpus semantics
- Forbidden:
  - new provider expansion
  - broad architecture rewrites
  - dashboard expansion outside current requirements
  - whole-Reddit wording without a real discovery layer
  - backfill-first sequencing as the default runtime path
  - cleanup that touches many layers before collector/storage truth is fixed

## Startup Rules

- Live startup pair: `00_START_HERE.md` and `obsidian-reddit专用/Projects/project.md`.
- Do not use `planning-with-files` in this repo.
- Do not create or maintain `task_plan.md`, `findings.md`, or `progress.md`.
- Keep summaries short and execution-oriented.
- When drift appears between old notes and current code, current code plus the three-file planning harness wins.

## Activity Log

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
