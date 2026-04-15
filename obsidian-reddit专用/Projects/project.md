---
title: "project"
type: codex-project-workspace
status: active
stage: P1.5-hardening-active
updated_at: "2026-04-15 16:30:54"
repo_path: "E:\\vibe coding\\project"
next_action: "Finish Stage A algorithm close-out by validating when combined `provider_data_stalled` appears in live runs, then freeze duplicate-heavy stale-head, cursor-stall, provider-switch, and readyz thresholds together before any Stage C ranking/anomaly expansion."
tags:
- codex
- workspace
- reddit
- p1.5
---
# project

## Summary

- Repository: `E:\vibe coding\project`
- Status: active
- Product: `reddit analytics website`
- Product CN label: `reddit 综合数据分析网站`
- Product goal: build a durable Reddit analytics product around subreddit / keyword / market / pulse views
- Phase: `P1.5 hardening active`
- Authority: `project.md` is the single execution source

## Product Positioning

- This repo is one product, not a collector-only repo and not a one-off dashboard.
- `P1` is the data plane. `P2` is the website-facing analytics and consumer layer.
- Current mainline remains: `data truth -> observability truth -> website analytics reliability`

## Current Decision

- Keep the product identity fixed as a Reddit analytics website.
- Keep `P2` codepaths as website consumer / validation layers, not a separate product track.
- Continue `P1.5 hardening` until collection truth and observability truth are stable.
- Treat `http` as the primary live collection path for current verification work; keep `apify` narrowed to fallback and comparison.

## Why This Decision

- The highest risk is still truth loss in the collection layer, not missing website surface area.
- The website already consumes `P1` trend / keyword / query outputs, so removing or bypassing `P2` would remove product-side validation.
- A stable `P1` data plane is the prerequisite for trustworthy subreddit analytics, keyword analytics, and market views.

## P1.5 Scope

- Collection truth: `crawlMode`, `cursor`, `provider`, `fallback` semantics stay consistent.
- Observability truth: `duplicate`, `lag`, `diff`, `fallback`, `degraded`, and cursor-stall metrics stay honest.
- Safe algorithm upgrades are allowed when they remain contract-safe, testable, and bounded.
- Regression guardrails must expand with every truth-layer fix.

## P1.5 Must Fix First

- No false pagination under `apify -> http` fallback.
- No duplicate-rate distortion under all-duplicate or filtered windows.
- No backfill tail-loop after EOF.
- `readyz` and provider health must expose real evidence for cursor stall / provider switch / fallback elevation.

## P1.5 Must Not Do

- No removal of `P2` tables, API, or consumer paths.
- No breaking API changes.
- No uncontrolled framework rewrite.
- No large speculative algorithm rewrite without bounded verification.

## P2 Policy During Freeze

- Allowed: read-only validation, bugfixes, compatibility fixes, tests, docs.
- Forbidden: new features, new recall pools, new precision loops, new product expansion.
- Exit condition: all `P1.5` gates pass.

## P1.5 Exit Gate

- Provider / cursor / fallback semantics are unified.
- Backfill can be shown to advance and stop cleanly at EOF.
- Duplicate / lag / diff / fallback metrics stay stable under degraded scenarios.
- Key regression scenarios are covered:
  - empty page
  - all-duplicate page
  - rate limit
  - timeout
  - circuit open
  - fallback
  - cursor stall
  - provider switch
- `typecheck`, `test`, and relevant smoke / verify commands pass.

## Current Focus

- Fix risks where the system appears healthy but underlying data truth is distorted.
- Upgrade live HTTP observability without breaking contracts.
- Keep the website-facing analytics layer aligned with actual collection truth.
- Keep all changes explainable, bounded, and regression-backed.

## Change Policy

- `P1.5` allows: bugfix, observability correction, contract tightening, small tuning, bounded algorithm upgrade, tests, docs.
- `P1.5` forbids: uncontrolled refactor, `P2` feature mixing, API breaking changes.
- Each round should still converge on one main truth-layer theme.

## Algorithm Development Plan

- Stage A `P1.5 close-out` (active): finish real-run calibration for duplicate-heavy stale-head behavior, cursor stall, provider switch, and `readyz` threshold alignment. Keep upgrades bounded, explainable, and contract-safe.
- Stage B `P1.5 exit proof`: lock threshold semantics, prove the required degraded scenarios under test and live verification, and stop changing the collection truth model unless a real regression is found.
- Stage C `P2 analytics algorithms` (after Stage B only): stabilize website-facing ranking and anomaly consumption, including market/growth ranking consistency, anomaly surfacing, and explain payload alignment with persisted truth.
- Stage D `product automation` (after Stage C basics): add alert evaluation policy first, then delivery/notification channels later. Do not treat delivery as part of the current close-out path.
- Planning rule: do not open Stage C or D work while Stage A/B still have truth-layer ambiguity.

## Task Guide

- Write all state updates back to this file.
- Do not use `planning-with-files` in this repo.
- Do not create or maintain `task_plan.md`, `findings.md`, or `progress.md` in project root.
- Every task entry should include: `scope`, `why now`, `verify`, `next`.
- If a task is `P2` feature work, defer it unless `P1.5` is closed.
- Keep this file ASCII-first or clean UTF-8 only. Do not copy mojibake text forward.

## Activity Log

### 2026-04-15 02:10

- Scope: Repaired remaining async architecture drift. `POST /v1/runs/reddit-phase1` async mode now enqueues durable `collection_job` rows instead of running inside the HTTP process. Request-scoped run hints persist on `collection_job.payload`, scheduler replay returns touched targets, and scheduler materializes trend / keyword views after queued collection work. The oversized in-memory fake repository file was also split into focused modules behind the same barrel path.
- Why now: The API still claimed accepted async execution while work depended on the web process. That was an architecture truth gap.
- Verify: `npm run typecheck` passed. `npm run test` passed with `86/86`.
- Next: Prove the queue + scheduler path reports honest observability evidence under real live HTTP runs.

### 2026-04-15 03:05

- Scope: Finished the remaining maintainability repair in the API integration test layer. The old `tests/integration/api-server.test.ts` monolith was removed and replaced by focused suites for `access`, `keyword-query`, `readyz`, `runs`, and `trends`, with shared helpers in `api-server.helpers.ts`.
- Why now: The runtime and dispatch paths were already repaired, but the oversized API test file still created refactor friction.
- Verify: `npm run typecheck` passed. `npm run test` passed with `86/86`.
- Next: Stay focused on `P1.5 observability truth`.

### 2026-04-15 11:35

- Scope: Continued `P1.5-2 observability truth` with provider-health transport evidence. Provider-health summaries now carry direct transport-failure counters (`error`, `rate_limit`, `timeout`, `circuit_open`) end-to-end; `readyz` exposes them as observability rates and degraded reasons alongside provider-switch share; and the http-first adaptive sampling path now consumes the same error evidence.
- Why now: Persisted provider degradation signals were only partially used. `readyz` could miss concrete transport-failure evidence even though it was already recorded.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/reddit-phase1-adaptive-sampling.test.ts` passed with `8/8`. `npx tsx --test tests/integration/api-server-readyz.test.ts` passed with `5/5`. `npm run test` passed with `88/88`.
- Next: Move from stored-signal calibration to real-run truth calibration.

### 2026-04-15 11:35:50

- Scope: Closed the missing cursor-stall observability gap. `collect_subreddit_new_posts` now persists live crawl-cursor snapshots for observability without changing head-repoll behavior; `readyz` now exposes `cursorStallRate` and `cursorLagSecondsMax` overall and by provider; and degraded reasons now include `provider_cursor_stalled:<provider>` when live cursor freshness exceeds the first-pass threshold.
- Why now: `project.md` still explicitly called out `cursor stall` as an uncovered proof point. Live collection was not persisting `crawl_cursor`, so `readyz` had no durable cursor signal to report.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts` passed with `7/7`. `npx tsx --test tests/integration/api-server-readyz.test.ts` passed with `7/7`. `npm run test` passed with `90/90`.
- Next: Keep `P1.5-2` open for real-run calibration.

### 2026-04-15 12:05:00

- Scope: Rechecked live connectivity and cleaned the project memory file. Reconnect attempts were repeated through Node `fetch`, Node `https.request`, PowerShell `Invoke-WebRequest`, and `curl.exe`. At the same time, the old mojibake content in `project.md` was replaced with clean UTF-8 content.
- Why now: The previous writeback left readable structure but preserved historical mojibake text, and the live verification path still needed a fresh connectivity verdict before more algorithm work.
- Verify:
  - PowerShell `Invoke-WebRequest https://www.reddit.com/r/machinelearning/about.json` returned `200`.
  - Node `fetch` still failed with `ECONNRESET`.
  - Node `https.request` still failed with `ECONNRESET`.
  - `curl.exe` still failed with `Recv failure: Connection was reset`.
  - WinHTTP proxy is `Direct access (no proxy server)`.
- Next: Treat live Reddit failure as an environment/runtime routing issue again. Restore TUN/full-tunnel or equivalent Node-visible network routing first, then rerun `npm run verify:phase1:postgres` in live mode.

### 2026-04-15 12:20:00

- Scope: Repaired the live Reddit connection path inside the app/runtime layer. `RedditHttpConnector` now keeps `fetch` as the primary transport, but on Windows it will fall back to PowerShell `Invoke-WebRequest` when Node HTTP traffic fails with `ECONNRESET`. The runtime also now supports explicit `REDDIT_HTTP_TRANSPORT` selection (`auto`, `fetch`, `powershell`).

- Why now: The previous live calibration blocker was no longer algorithmic. PowerShell could already reach Reddit, while Node `fetch`, Node `https`, and `curl.exe` were all being reset. That meant the shortest correct repair was a bounded transport fallback in the connector instead of more observability work or more blind retries.

- Verify: `npm run typecheck` passed. Focused connector/runtime unit tests passed. `npm run verify:phase1:postgres` with `REDDIT_RUN_MODE=live` now succeeds against the provided local PostgreSQL database and records a real live collection cycle. `npm run test` passed with `93/93`.

- Next: Return to `P1.5-2` live calibration proper. Use the restored live path to inspect current real-run observability, especially cursor-stall truth, provider-switch sensitivity, duplicate rate realism, and whether any thresholds need tightening after observing real HTTP traffic.

### 2026-04-15 12:45:00

- Scope: Updated collaboration policy to stop planning-with-files for this repo and keep status tracking Obsidian-first in a single file.
- Why now: Repeated creation of task_plan.md / findings.md / progress.md caused duplicated state and unnecessary context overhead.
- Verify: AGENTS.md now explicitly disables planning-with-files, bans root planning triplet files, and enforces Projects/project.md as the single state source.
- Next: Continue P1.5 work with compact updates in this file only; store deep details in docs/ and link back when needed.

### 2026-04-15 12:41:00

- Scope: Calibrated adaptive sampling for the live HTTP path. `reddit-phase1.worker` now emits explicit `staleHeadPressure` and `switchInstability` signals, uses them in elevated/boost decisions, and covers the new stale-head and provider-switch cases with focused unit tests. Added a compact algorithm profile snapshot under `.algo-profile/`.
- Why now: A real live verify still showed `duplicate_rate` and `ingest_lag` heavily elevated while sampling stayed at the base tier. That meant the previous blended pressure model under-reacted to stale-head evidence.
- Verify: `npm run test` passed with `95/95`. Live `npm run verify:phase1:postgres` with `REDDIT_RUN_MODE=live` and `REDDIT_HTTP_TRANSPORT=powershell` now logs `tier: "elevated"` and `limit: 31` for the same duplicate-heavy stale-head pattern instead of staying at base.
- Next: Continue live calibration on `readyz` and worker evidence together; decide whether duplicate-heavy stale-head windows should also tighten degraded-threshold handling or cursor-stall messaging.

### 2026-04-15 13:05:00

- Scope: Read `Projects/算法补充.md`, reconciled it against the current repo state, and converted the loose timeline discussion into an explicit four-stage algorithm plan in this file. The plan now separates `P1.5` truth-layer close-out from later `P2` ranking/anomaly work and from still-later alert automation.
- Why now: The supplemental note correctly distinguished "near-done P1.5 algorithm hardening" from "full product-grade algorithm completion", but that distinction was not yet encoded in the project execution source. Without writing it here, later sessions could reopen `P2` algorithm work too early.
- Verify: Rechecked the current workspace state in `project.md`, the latest adaptive-sampling calibration entry, and supporting architecture docs that still mark ranking/anomaly/alert layers as later-stage responsibilities rather than current `P1.5` scope.
- Next: Execute Stage A only. Keep the next algorithm round focused on duplicate-heavy stale-head, cursor-stall, provider-switch, and `readyz` threshold convergence; defer Stage C ranking/anomaly expansion until Stage B exit proof passes.
 
### 2026-04-15 13:18:00
 
- Scope: Aligned `readyz` provider-health degradation with the live stale-head algorithm path. `create-api-server.ts` now emits `provider_stale_head_elevated:<provider>` when duplicate-heavy windows also carry high ingest lag, and the readyz integration suite now covers both the positive stale-head case and the negative all-duplicate-but-fresh case. Added a matching algorithm profile entry under `.algo-profile/`.
- Why now: Stage A still required `readyz` threshold alignment with duplicate-heavy stale-head calibration. The worker already reacted to that pattern, but readiness output could still look less explicit than the collector-side evidence.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/integration/api-server-readyz.test.ts` passed with `8/8`. `npm run test` passed with `96/96`.
- Next: Continue Stage A by checking whether live stale-head evidence should also interact with cursor-stall messaging or whether the two degraded paths should remain intentionally separate.

### 2026-04-15 13:36:00

- Scope: Finalized the `readyz` interaction rule between stale-head and cursor-stall evidence. `create-api-server.ts` now keeps `provider_stale_head_elevated:<provider>` and `provider_cursor_stalled:<provider>` as separate degraded reasons, but also emits `provider_data_stalled:<provider>` when both hit the same provider in one readiness sample. The integration suite now covers the stale-head-only case and the combined stale-head-plus-cursor-stall case.
- Why now: Stage A needed a higher-confidence "data truth stalled" signal without collapsing two different failure paths into one opaque threshold. The combined reason preserves debug visibility while giving downstream checks one explicit condition for the strongest evidence.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/integration/api-server-readyz.test.ts` passed with `9/9`. `npm run test` passed with `97/97`.
- Next: Use the restored live path to see whether `provider_data_stalled` appears under real HTTP collection and decide whether any Stage A thresholds still need tightening or whether `P1.5` can move toward freeze.

### 2026-04-15 16:30:02

- Scope: Initialized Git in `E:\vibe coding\project`, expanded `.gitignore` for local-only artifacts, created the private GitHub repository `Euroish/reddit-monitoring-mvp`, and pushed the current workspace to `origin/main`.
- Why now: The project needed a private remote so ChatGPT web can inspect the codebase through the GitHub connector without making the repository public.
- Verify: `git credential-manager github list` returned `Euroish`. GitHub API created `https://github.com/Euroish/reddit-monitoring-mvp`. Final `git push` succeeded and local `main` now matches `origin/main` at commit `131f9f9`.
- Next: Open ChatGPT web, connect GitHub if needed, authorize `Euroish/reddit-monitoring-mvp`, then run repository analysis there against the private repo.
