---
title: "project"
type: codex-project-workspace
status: active
stage: P1.5-hardening-active
updated_at: "2026-04-16 00:40:24"
repo_path: "E:\\vibe coding\\project"
next_action: "Use the now-frozen Stage A readyz and worker-sampling threshold semantics to complete Stage B exit proof. Focus on the remaining degraded-scenario boundary proofs and observability truth only; do not open Stage C ranking/anomaly expansion yet."
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
- Verify: `git credential-manager github list` returned `Euroish`. GitHub API created `https://github.com/Euroish/reddit-monitoring-mvp`. Final `git push` succeeded and local `main` matches `origin/main`.
- Next: Open ChatGPT web, connect GitHub if needed, authorize `Euroish/reddit-monitoring-mvp`, then run repository analysis there against the private repo.

### 2026-04-15 17:52:55

- Scope: Closed the command-surface and state-source drift called out by `优化算法推进流程.md`. Phase-1 runtime defaults now fall back to `mock` unless `live` is explicit, both schedulers no longer run a cycle on boot by default, package scripts were narrowed to one official `worker:phase1:*` family with explicit fast/full test and typecheck lanes, startup/docs files were aligned to `Projects/project.md`, and the forbidden root planning triplet plus obsolete `src/workers/run-reddit-phase1-once.postgres*` entry wrappers were removed.
- Why now: Stage A still needs live calibration, but the repo was making routine iteration look heavier and more ambiguous than it really is. That risked wasting cycles on duplicate entrypoints, environment-shaped false failures, and duplicate status files instead of truth-layer work.
- Verify: `npm run typecheck:core` passed. `npm run test:unit` passed with `61/61`. `npm run typecheck` passed. `npm run test` passed with `97/97`.
- Next: Use the cleaned mock-first command surface to continue Stage A live verification only where it adds truth, especially checking whether `provider_data_stalled` appears in real HTTP runs and whether any remaining `readyz` thresholds still need tightening before freeze.

### 2026-04-15 19:31:15

- Scope: Closed the remaining repo-level algorithm workflow gap from `算法工作推进建议.md` by adding `skills/algorithm-dev-suite/SKILL.md` as the single project-facing algorithm entrypoint. Updated `skills/README.md`, `00_START_HERE.md`, and `README.md` so algorithm work now routes through one suite before fanning out to `reddit-monitoring`, `data-algo-social`, `reddit-trend-algo`, `data-algo`, and `data-algo-system`.
- Why now: The repo already had multiple algorithm-related skills, but no unified entry comparable to `frontend-dev-suite`. Without a suite layer, future algorithm skill installs would keep fragmenting task routing and force repeated re-interpretation of stage boundaries.
- Verify: Confirmed `algorithm-dev-suite` is referenced from startup and routing docs via `rg -n "algorithm-dev-suite" skills README.md 00_START_HERE.md`. No application code changed, so no additional typecheck/test run was needed for this round.
- Next: When you install more algorithm skills, keep them behind `algorithm-dev-suite` as primary or secondary branches instead of exposing each new skill directly in startup docs.

### 2026-04-15 19:36:51

- Scope: Executed the next skill-installation requirements from `skill安装.md` at the project-local level. Added `signal-metric-design`, `synthetic-case-lab`, `read-model-contract-guard`, and `worker-boundary-for-algorithm` under `skills/`, then wired them into `algorithm-dev-suite` so the suite now governs metric definition, synthetic-case validation, outward contract stability, and worker-boundary discipline for future algorithm tasks.
- Why now: The suite entrypoint existed, but it still lacked the narrow guard skills that actually keep algorithm work from drifting into blind parameter tuning, insufficient test coverage, silent API contract changes, or worker/scheduler rewrites.
- Verify: Confirmed all four new skills exist under `skills/` and that `algorithm-dev-suite` references them via `rg -n "signal-metric-design|synthetic-case-lab|read-model-contract-guard|worker-boundary-for-algorithm" skills`.
- Next: If you want these changes published, commit and push them. For future external skill installs, attach them under `algorithm-dev-suite` rather than exposing them as new startup entrypoints.

### 2026-04-15 19:41:29

- Scope: Closed the remaining "too many run modes" issue for algorithm work. Added one explicit algorithm command surface in `package.json` (`algo:fast`, `algo:phase1`, `algo:full`, `algo:live:verify`), removed duplicate/explicit live aliases that were inflating the visible mode set, rewrote `README.md` to expose only the algorithm default path plus a pointer to `docs/operations-runbook.md`, and aligned `00_START_HERE.md`, `algorithm-dev-suite`, `execution-kickoff`, and the runbook to the same command policy.
- Why now: The prior repair made defaults safer, but it still left too many worker/api/db/live commands visible in the repo front door. That meant Codex could still spend effort on command selection instead of algorithm scope.
- Verify: `npm run algo:fast` passed. `npm run algo:full` passed with `97/97`.
- Next: Keep routine algorithm work on `algo:*` only. Treat worker, scheduler, API, DB, and other ops commands as manual runbook operations unless a task explicitly requires that boundary.

### 2026-04-15 20:22:20

- Scope: Added a shared `readyz` observability helper and wired `scripts/verify-phase1-postgres.ts` to emit the same readiness degradation snapshot as `/readyz`. This turned `npm run algo:live:verify` into a one-command Stage A calibration check instead of requiring manual SQL/API follow-up. The live run against the provided PostgreSQL database showed `provider_stale_head_elevated:http`, but not `provider_data_stalled:http`; the active `http` cursor was fresh, and the only cursor-stall reason came from older `reddit` live cursors already persisted in the database.
- Why now: `project.md` still required an answer to whether combined `provider_data_stalled` actually appears in real HTTP runs. The old live verify command recorded counts and jobs, but it did not surface the threshold result that Stage A needed to freeze.
- Verify: `npm run algo:phase1` passed with `19/19`. `npm run algo:full` passed with `97/97`. Live `npm run algo:live:verify` with `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring` and `REDDIT_HTTP_TRANSPORT=powershell` returned `readiness.degradedReasons = ["provider_stale_head_elevated:http","provider_cursor_stalled:reddit"]` and did not emit `provider_data_stalled:http`.
- Next: Decide whether the old `reddit` live cursors should be cleaned or explicitly excluded from future freeze checks. If not, Stage A threshold semantics for current `http` live traffic can stay as-is because the combined stale-head-plus-cursor-stall condition is not happening on the active provider.

### 2026-04-15 20:30:18

- Scope: Closed the legacy-cursor noise gap in `readyz`. Live cursor-stall evaluation now only participates in freeze-time degradation checks for providers that have current lookback-window live provider-health evidence; when no live provider-health evidence exists, the old cursor-only behavior remains as fallback. Added a focused integration case that proves stale legacy `reddit` cursors no longer contaminate current `http` live readiness output.
- Why now: Stage A had one remaining ambiguity after the previous live calibration: the active `http` provider was fresh, but old persisted `reddit` live cursors were still making `/readyz` look partially stalled. That prevented a clean threshold-freeze verdict for the actual live provider path.
- Verify: `npm run algo:phase1` passed with `19/19`. `npm run algo:full` passed with `98/98`. Live `npm run algo:live:verify` with `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring` and `REDDIT_HTTP_TRANSPORT=powershell` returned `readiness.degradedReasons = ["provider_stale_head_elevated:http"]`, `cursorStallRate = 0`, and no `provider_cursor_stalled:reddit` or `provider_data_stalled:http`.
- Next: Freeze the current Stage A semantics for duplicate-heavy stale-head, cursor-stall, provider-switch, and `readyz` together, then move into Stage B exit proof. Do not open Stage C website-facing ranking/anomaly expansion until that proof is complete.

### 2026-04-15 20:36:31

- Scope: Froze the Stage A `readyz` threshold contract into one shared constants module and added exact-boundary regression tests for the two most drift-prone semantics: stale-head now remains explicitly `>= duplicate 0.55 && >= lag 5400s`, while cursor stall remains explicitly `> 900s` rather than `>=`. This keeps the live-proofed thresholds explainable and reusable before Stage B exit proof expands the degraded-scenario matrix.
- Why now: The active `http` path had already been calibrated live, but the threshold contract still lived as scattered literals. Without freezing those boundaries in one place plus exact-edge tests, later cleanup could silently change the meaning of the same Stage A signals.
- Verify: `npm run algo:phase1` passed with `19/19`. `npm run algo:full` passed with `100/100`. New integration coverage now proves exact-threshold stale-head degradation and exact-threshold cursor freshness alongside the earlier stale-head, combined data-stalled, and legacy-cursor-noise cases.
- Next: Stay in Stage B. Use the frozen threshold contract to prove the remaining degraded scenarios and exit-gate evidence, not to widen into Stage C ranking/anomaly work.

### 2026-04-15 21:10:25

- Scope: Froze the remaining Stage A worker-side adaptive-sampling thresholds into `src/workers/reddit-phase1-thresholds.ts` and rewired `reddit-phase1.worker.ts` to consume the shared contract instead of scattered literals. Added exact-boundary unit coverage proving that `http` severe-transport still triggers at `timeoutRate >= 0.20` and provider-switch instability still triggers at `switchShare >= 0.20` with exact `switchInstability = 0.18`.
- Why now: `readyz` threshold semantics were already frozen, but the worker still carried parallel hard-coded boundaries. That left one last Stage A drift path where collection behavior could silently diverge from the observability contract during Stage B exit proof.
- Verify: Focused `npm test -- tests/unit/reddit-phase1-adaptive-sampling.test.ts` passed with `102/102`. `npm run algo:phase1` passed with `21/21`. `npm run algo:full` passed with `102/102`.
- Next: Keep Stage B narrow. Use the now-shared `readyz` plus worker threshold contract to finish degraded-scenario proof and exit-gate evidence; do not start Stage C ranking/anomaly expansion yet.

### 2026-04-15 21:18:23

- Scope: Added the missing Stage B `circuit_open` boundary proof on both sides of the truth layer. `api-server-readyz.test.ts` now proves `/readyz` keeps exact `circuitOpenRate = 0.08` below degraded status, while `reddit-phase1-adaptive-sampling.test.ts` proves the worker still escalates sampling at the same exact `http` severe-transport threshold. This turns `circuit_open` from an implemented-but-underspecified path into an explicit contract.
- Why now: The required degraded scenarios already covered fallback, timeout, stale-head, provider switch, and cursor stall with bounded tests, but `circuit_open` still lacked an exact-edge proof. That left a quiet regression path in Stage B where readiness and sampling could drift without a failing test.
- Verify: Focused `npm test -- tests/integration/api-server-readyz.test.ts tests/unit/reddit-phase1-adaptive-sampling.test.ts` passed with `104/104`. `npm run algo:phase1` passed with `22/22`. `npm run algo:full` passed with `104/104`.
- Next: Stay in Stage B. Continue closing any remaining degraded-scenario or exit-gate proof gaps, but do not widen into Stage C ranking/anomaly work yet.

### 2026-04-15 21:32:15

- Scope: Completed another Stage B boundary-proof round for product-grade algorithm hardening without changing threshold semantics. Added readyz exact-boundary regression coverage for strict-greater provider-health signals (`success/fallback/empty/diff/error/rate_limit/timeout/circuit_open`) and dominant provider-switch share at exact threshold, and added worker exact-boundary coverage for `rate_limit` and `error` severe-transport triggers at the frozen HTTP thresholds.
- Why now: Stage B still required remaining degraded-scenario boundary proofs so readiness and adaptive sampling cannot silently drift on exact edges.
- Verify: `npm test -- tests/integration/api-server-readyz.test.ts tests/unit/reddit-phase1-adaptive-sampling.test.ts` passed with `108/108`. `npm run algo:phase1` passed with `24/24`. `npm run algo:full` passed with `108/108`.
- Next: Keep Stage B narrow; continue only exit-gate and degraded-scenario truth proofs (including live verify evidence where needed), and do not open Stage C ranking/anomaly expansion yet.

### 2026-04-15 21:41:47

- Scope: Continued Stage B truth-layer proof within the algorithm framework. Added a new readyz integration scenario-matrix test that isolates each degraded provider-health signal in synthetic form (`fetch_success_low`, `fallback`, `empty_window`, `provider_diff`, `rate_limit`, `timeout`, `circuit_open`, `provider_switch`) and asserts exact degraded-reason outputs per scenario.
- Why now: Existing tests covered many signals, but several were bundled in mixed cases. Stage B exit proof still needed one isolated evidence layer showing each degraded scenario can be triggered and verified independently.
- Verify: `npx tsx --test tests/integration/api-server-readyz.test.ts` passed with `16/16`. `npm run algo:phase1` passed with `24/24`. `npm run algo:full` passed with `109/109`.
- Next: Keep Stage B narrow and continue only bounded exit-gate evidence (including live verify snapshots when needed); do not open Stage C ranking/anomaly expansion yet.

### 2026-04-15 23:48:25

- Scope: Completed a bounded Stage B algorithm upgrade in worker sampling observability parity. `src/workers/reddit-phase1.worker.ts` now aligns duplicate-rate calculation with readyz semantics by falling back to `acceptedCount` when `candidateCount` is zero. Added regression coverage in `tests/unit/reddit-phase1-adaptive-sampling.test.ts` for the exact fallback edge (`candidateCount=0`, `acceptedCount>0`) and verified stale-head elevation still triggers.
- Why now: Stage B still targets degraded-scenario boundary truth, and this was a remaining drift path where worker sampling could underreact on historical/abnormal windows while readyz still reported duplicate-heavy stale-head evidence.
- Verify: `npm test -- tests/unit/reddit-phase1-adaptive-sampling.test.ts` passed with `110/110`. `npm run algo:phase1` passed with `25/25`.
- Next: Continue Stage B exit proof with bounded observability edges only (especially live verify snapshots for degraded reasons), and keep Stage C ranking/anomaly expansion closed.

### 2026-04-15 23:53:39

- Scope: Added Stage B readiness-observability failure-path proof in `tests/integration/api-server-readyz.test.ts`. New coverage now isolates each unavailable signal (`storage`, `queue`, `keyword session`, `provider health`, `crawl cursor`) with exact status/check transitions, and verifies fallback cursor-stall evidence is still exposed when provider-health observability is unavailable.
- Why now: The core degraded scenarios were already covered, but Stage B exit proof still lacked explicit evidence for observability-unavailable branches and their bounded readiness behavior.
- Verify: `npx tsx --test tests/integration/api-server-readyz.test.ts` passed with `18/18`. `npm run algo:phase1` passed with `25/25`. `npm run algo:full` passed with `112/112`.
- Next: Continue Stage B only; if needed, run one live `algo:live:verify` snapshot to confirm current degraded-reason surface in real HTTP mode still matches the now-complete synthetic proof set.

### 2026-04-15 23:57:34

- Scope: Upgraded worker adaptive sampling for product-grade stale-head recovery. Added severe stale-head thresholds in `src/workers/reddit-phase1-thresholds.ts` and updated `src/workers/reddit-phase1.worker.ts` so `http` live collection escalates directly to `boost` when both duplicate and lag are severely elevated, even under cooldown. Added exact-boundary and severe-path regression tests in `tests/unit/reddit-phase1-adaptive-sampling.test.ts`.
- Why now: Live verify on the provided PostgreSQL dataset still showed extreme stale-head (`duplicatePostRate=0.95`, very high ingest lag) where elevated-tier sampling is too conservative for freshness recovery expected from a high-quality analytics data plane.
- Verify: `npm test -- tests/unit/reddit-phase1-adaptive-sampling.test.ts` passed with `114/114`. `npm run algo:phase1` passed with `27/27`. `npm run algo:full` passed with `114/114`. Live `npm run algo:live:verify` (with `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`) now logs `reddit.sampling_plan.selected` with `tier: "boost"`, `limit: 40`, and reason `severe_stale_head` for the same severe stale-head pattern.
- Next: Keep Stage B narrow and gather one more live verify snapshot after another cycle to confirm stale-head recovery trend direction before considering threshold freeze or further tuning.


### 2026-04-16 00:21:38

- Scope: Ran a bulk live+backfill seed against `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring` and inserted 911 new `content` rows (124 -> 1035). Upgraded Stage B sampling-to-execution alignment by carrying `samplingTier` into `collect_subreddit_new_posts` payload/executor and enabling boost-tier live overflow expansion (4 pages, higher overflow budget). Hardened `scripts/live-multi-round-calibration.ts` to run cross-window (`REDDIT_MULTI_STEP_MINUTES`) and continue on per-run failures (`runOk/runError`) for uninterrupted large-round evidence collection.
- Why now: The task required 500-1000 row DB fill plus multi-round real-data algorithm tuning. Live calibration also exposed that transient connector timeouts could terminate long runs early, reducing evidence quality.
- Verify: `npx tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts` passed (8/8, including new boost-overflow coverage). `npm run algo:phase1` passed (27/27). `npm run algo:full` passed (115/115). Bulk fill snapshot saved at `docs/bulk-backfill-2026-04-16.json` (`insertedContentRows=911`). Multi-round calibration snapshots saved at `docs/live-multi-round-calibration-2026-04-16-post-opt-v2.json` (`runCount=20`, `failedRuns=12`, continued without abort).
- Next: Keep Stage B narrow and use the new calibration evidence to tune timeout/circuit thresholds and provider timeout handling so degraded stale-head recovery can run with fewer interrupted live rounds before final threshold freeze.


### 2026-04-16 00:24:58

- Scope: Added connector reliability control for large live rounds: `createRedditConnectorFromEnv` now supports `REDDIT_HTTP_TIMEOUT_MS` and passes it into `RedditHttpConnector`. Added runtime unit coverage for timeout passthrough. Re-ran cross-window calibration with `REDDIT_HTTP_TIMEOUT_MS=30000` and captured a clean no-abort sample.
- Why now: The previous large-round calibration showed frequent `Timed out after 12000ms` interruptions (12/20 failed runs), which degraded algorithm evidence quality.
- Verify: `npm run algo:phase1` passed (28/28, including new timeout-override test). `docs/live-multi-round-calibration-2026-04-16-timeout30s.json` shows `runCount=10`, `failedRuns=0` under the same subreddit set and cross-window stepping.
- Next: Use the stable 30s timeout lane for next Stage B live snapshots, then decide whether remaining `jobPostLimit` mismatch evidence needs a bounded dedupe/payload freshness fix before final threshold freeze.


### 2026-04-16 00:31:52

- Scope: Executed two sequential live calibration rounds per request: Round 1 on `startups,security,sysadmin,webdev,javascript,reactjs,node,aws,dotnet,golang`; Round 2 switched to 10 hot subreddits `askreddit,worldnews,news,funny,pics,gaming,movies,todayilearned,science,technology`. Outputs saved to `docs/live-multi-round-calibration-2026-04-16-round1-tech-set.json` and `docs/live-multi-round-calibration-2026-04-16-round2-hot-set.json`.
- Why now: User requested post-round subreddit-switch validation to expand live evidence breadth and compare technical-community vs hot-feed behavior under the same Stage B pipeline.
- Verify: Both runs completed with `runCount=10`, `failedRuns=0` (using `REDDIT_HTTP_TIMEOUT_MS=30000` and `REDDIT_CB_TIMEOUT_MS=30000`). Content rows increased from `2042` to `2399` after the two rounds.
- Next: If continuing calibration, keep this two-stage pattern and aggregate multi-run deltas (duplicate/lag/new_posts) into one comparison snapshot before threshold-freeze decisions.


### 2026-04-16 00:40:24

- Scope: Completed a bounded Stage B algorithm upgrade for live cold-start sampling. Added `coldStart.extraPosts` thresholds (`http=8`, `generic=4`) in `src/workers/reddit-phase1-thresholds.ts`, and updated `resolvePostSamplingLimit` in `src/workers/reddit-phase1.worker.ts` to emit a logged warmup decision (`cold_start_warmup`) when both recent trend points and live health evidence are absent. Added unit coverage in `tests/unit/reddit-phase1-adaptive-sampling.test.ts` for both http-primary and generic cold-start paths.
- Why now: Live comparison snapshots showed hot-set runs with high `newPosts15m` but missing sampling decision observability (`tier=null`) and conservative first-run limits (`jobPostLimit=16`), which weakens early-window recall and evidence quality.
- Verify: `npx tsx --test tests/unit/reddit-phase1-adaptive-sampling.test.ts` passed (20/20). `npm run algo:phase1` passed (30/30). Validation run `docs/live-multi-round-calibration-2026-04-16-cold-start-warmup-verify.json` now shows `tierNull=0`, `avgLimit=24`, `avgJobLimit=24`, and warmup-applied decisions across the full cold-start set.
- Next: Keep this as the first partial upgrade. Next bounded optimization should target timeout-heavy long-tail subreddits (`television/soccer/nba` in this run) by separating connector-timeout resilience tuning from sampling-threshold tuning, then re-check staged evidence before threshold freeze.
