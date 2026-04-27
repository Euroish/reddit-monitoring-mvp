---
title: "project"
type: codex-project-workspace
status: active
stage: collector-storage-truth
updated_at: "2026-04-27 01:44:01"
repo_path: "E:\\vibe coding\\project"
next_action: "Continue the collector/storage truth slice from the now-trimmed runtime: implement live-window acceptance, suppress stale-post metric writes, automate raw-event and metrics retention, then wire favorite-target 8-hour scheduling and honest coverage semantics on top of the reduced `http + scrapling` path."
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
  - live-window acceptance for automatic collection
  - stale-post metric suppression
  - prune automation as default ops path
  - favorite-target 8-hour scheduling via `monitor_target.config_json`
  - explicit live coverage/source-limited state
  - all-target catalog/list path instead of only top-page slices
  - old daily trend surfaces aligned to `missing` / `source_limited`
  - active-lane code/data-structure simplification after storage truth is fixed

## Explicit Task Stack

- `P0.1` Implement live-window acceptance in [collect-subreddit-new-posts.job.ts](/root/reddit-monitoring-mvp/src/jobs/collect-subreddit-new-posts.job.ts) with default `REDDIT_LIVE_WINDOW_HOURS=8` and `REDDIT_LIVE_WINDOW_OVERLAP_MINUTES=30`.
- `P0.2` Stop stale-post metric growth: write content-level metrics only for newly accepted posts, or inside a short bounded active-post window such as `REDDIT_ACTIVE_POST_TRACKING_HOURS=48`.
- `P0.3` Automate retention for `raw_reddit_event` and `metrics_snapshot` using the existing prune scripts and runtime/deploy scheduling.
- `P0.4` Preserve duplicate-post safety under automation: keep `content` dedupe intact and ensure repeated listing hits do not translate into unbounded write amplification.
- `P1.1` Move normal collection to favorite-target 8-hour scheduling. Short term may use env-selected targets; long term must read `monitor_target.config_json` and respect per-target cadence/favorite policy.
- `P1.2` Add explicit live coverage/source-limit state for each run: requested window start, oldest/newest observed post, listing-horizon hit, partial status.
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
