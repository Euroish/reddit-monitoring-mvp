---
title: "project"
type: codex-project-workspace
status: active
stage: P1.7-algorithm-productization
updated_at: "2026-04-16 21:24:04"
repo_path: "E:\\vibe coding\\project"
next_action: "Start `R2` by implementing query-normalization v2 and the explicit-query plus auto-keyword dual-track materialization on top of tier-aware `subreddit_daily_fact`, then add API/read-model tests proving 30-day keyword heat remains explainable and single-sourced."
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
- Status: active
- Product: `http-first analytics engine (Reddit currently primary source)`
- Product goal: build a durable analytics product around pluggable HTTP acquisition, truthful observability, and explainable ranking/read models
- Phase: `P1.7 algorithm productization active`
- Authority: `project.md` is the single execution source

## Product Positioning

- This repo remains one product; it is not split into a collector-only repo and a separate analytics repo.
- `P1` remains the data plane and truth layer. `P2` remains website-facing analytics consumption.
- Acquisition now has two lanes: baseline connector lane (existing TypeScript HTTP/APIFY path) and Scrapling lane (Python adaptive scraping lane).

## Current Decision

- Treat current `http + scrapling` controlled-promotion evidence as the acquisition baseline, not the primary workstream.
- Shift active work to product-grade algorithm delivery: `subreddit_daily_fact`, tier-aware quality rules, 30-day keyword/query trends, driver-post scoring, and anomaly events.
- Execute work in dependency-ordered rounds (`R1-R5`) so each round lands a complete `migration -> repository -> job -> read model/API -> tests -> verify evidence` slice.
- Treat the algorithm plan as a priority order, not a pause gate: Codex should ship the smallest complete slice that safely advances the current round.
- Keep deep Scrapling integration in scope, but institutionalize it through provider-routing policy after the core algorithm facts exist.

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

## Current Focus

- Round `R1` is active: establish `subreddit_daily_fact`, subreddit tiering, quality thresholds, and day-level heat materialization.
- Implement the full `R1` vertical slice in code first, then keep only the minimal writeback needed to preserve state continuity.
- Settle scheduler/materialization order, day-level formulas, and readiness wiring in code + tests inside the same slice instead of treating them as separate pause points.
- Move algorithm observability forward with the first fact layer instead of waiting until provider-policy work is complete.
- Keep current controlled-promotion evidence as the acquisition baseline and limit Scrapling changes to work that unblocks algorithm rounds.

## Change Policy

- Allowed: additive fact/event tables, scoring services, read-model APIs, bounded provider-policy integration, focused cross-layer refactors that unblock the current slice, tests, docs.
- Forbidden: unrelated refactors, new source expansion, API-breaking changes, broad rewrites that are not required by the current slice.
- Each round should end with runnable code, focused tests, and explicit verify evidence; process/docs updates are secondary unless explicitly requested.
- Every new scoring/output path must carry `algorithm_version`; user-facing scores/events must also carry `explain_payload`.

## Autonomous Execution Policy

- Default mode is `inspect briefly -> implement -> test -> write back`, not `inspect -> restate plan -> wait`.
- Codex may cross storage/domain/job/api/test boundaries inside the active round when that is the shortest correct path to a complete slice.
- Contract notes are lightweight: settle rules in code/tests when safe, and document only what must remain durable across sessions.
- Ask for user input only on true blockers: irreversible product/schema choices, destructive actions, missing external dependencies/credentials, or direct conflicts with user edits.

## Architecture Guardrails

- Write-path order stays fixed: collection persists raw/normalized/snapshot truth first, then materialized facts, then product read models.
- Read-path discipline stays fixed: product APIs read from fact/materialized layers, not directly from raw snapshots as the primary result source.
- Canonical-source discipline stays fixed: once a metric is promoted into `subreddit_daily_fact` or another fact table, later services and APIs use that layer unless an explicit conversion layer is documented.
- Observability is co-delivered: provider health remains required, and algorithm/materialization health joins `/readyz` from `R1` onward.
- Versioning is mandatory: scoring formulas, thresholds, and merge rules change only under explicit `algorithm_version` updates with bounded regression coverage.

## Algorithm Development Plan

- Round R1 `daily fact foundation` (active): add `subreddit_daily_fact`, `subreddit-tiering.service`, `quality-threshold.service`, `subreddit-daily-heat.service`, reorder scheduler materialization around the daily fact layer, declare the day-level canonical metric source, and expose the first subreddit heat read model/API plus algorithm-materialization readiness evidence.
- Round R2 `keyword trend upgrade`: settle `query normalization v2` (`lowercase`, phrase handling, token overlap, alias boundary, subreddit-scoped vs global query semantics) inside code/tests, convert keyword processing to `explicit query + auto keyword` dual track, use tier-aware qualification, and output 30-day keyword heat plus breakout markers from fact/materialized inputs only.
- Round R3 `driver-post layer`: add `post_growth_fact`, velocity-based driver scoring, same-age cohort normalization (`1h/6h/24h` minimum buckets), driver labels, and subreddit/keyword driver APIs.
- Round R4 `anomaly layer`: add raw `anomaly_event` detection plus merged/consumer-facing anomaly incidents, settle dedupe/merge rules across `volume`, `quality`, `keyword`, and `driver` signals in code/tests, and expose explainable anomaly feeds.
- Round R5 `provider policy institutionalization`: move Scrapling into `fetch-execution-engine + provider-routing-policy`, keep shadow compare as a standing sample, and wire provider-promotion decisions to the observability contract that earlier rounds already started using.
- Execution rule: rounds define default priority, but bounded pull-forward work is allowed when it is required to complete the active slice cleanly.
- Execution rule: do not block implementation on separate contract-writing if code/tests can safely settle the rule and preserve continuity.

## Process Flow Source

- Canonical algorithm flow: `project.md` (`R1-R5`).
- Supporting acquisition baseline: `docs/scrapling-integration-flow.md`.
- Architecture guardrails: `docs/architecture.md`.
- Keep this file as execution memory; store deep details in `docs/` and link from activity entries.

## Task Guide

- Write all state updates back to this file.
- Do not use `planning-with-files` in this repo.
- Do not create or maintain `task_plan.md`, `findings.md`, or `progress.md` in project root.
- Every task entry should include: `Scope`, `Why now`, `Verify`, `Next`.
- Keep this file ASCII-first or clean UTF-8 only; do not copy mojibake text forward.

## Activity Log

### 2026-04-16 21:24:04

- Scope: Finished the remaining `R1` fixed-threshold consumer in trend-point materialization. `src/jobs/build-subreddit-trend-points.job.ts` now reads per-day thresholds from `subreddit_daily_fact` and applies `score + comments` qualification per window day instead of the old fixed `score>=50` counter. Worker/scheduler now pass `subredditDailyFactRepository` into trend-point materialization so this path is active in both cycle and runnable-job replay. Added focused regression suite `tests/unit/build-subreddit-trend-points.job.test.ts` for day-fact override and legacy fallback behavior, and bumped trend algorithm version to `trend_v4_tier_quality_thresholds` for explicit threshold-rule versioning.
- Why now: The previous state had already moved daily facts and keyword daily materialization to tier-aware rules, but `subreddit_trend_point.highScorePostCount` still came from a fixed threshold path, leaving the 15-day quality signal inconsistent with the canonical day-fact contract.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/build-subreddit-trend-points.job.test.ts tests/unit/trend-scoring.service.test.ts` passed (`4/4`). Integration regression passed: `npx tsx --test tests/integration/reddit-phase1-cycle.test.ts` and `npx tsx --test tests/integration/api-server-trends.test.ts`. Real DB verification passed with `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, `REDDIT_RUN_MODE=live`, `REDDIT_RUN_SUBREDDIT=machinelearning`, `npm run verify:phase1:postgres`; persisted materialization remains healthy (`subreddit_daily_fact=46`, `keyword_trend_daily=17328`, `subreddit_trend_point=67`) with live `materializedPreview` outputs.
- Next: Move to `R2` query-trend upgrade: settle normalization v2 and explicit query semantics in code/tests, then extend materialization/API read models to dual-track `explicit query + auto keyword` outputs from persisted fact/materialized inputs.

### 2026-04-16 21:03:22

- Scope: Completed the keyword-materialization part of `R1` against the new day-fact rules and closed the real-DB verification loop. `src/jobs/build-subreddit-keyword-trend-daily.job.ts` now reads per-day thresholds and denominator hints from `subreddit_daily_fact`, but floors `sampledPosts` at the observed post count so persisted `mention_rate` and `qualified_mention_rate` can never exceed `1` when a lagging day fact undercounts the current live corpus. Added regression coverage in `tests/unit/build-subreddit-keyword-trend-daily.job.test.ts`, including the exact undercount failure shape exposed by Postgres.
- Why now: The previous `next_action` explicitly required two things to finish this slice: move keyword daily materialization onto the tier-aware day-fact path, and prove the result on the real PostgreSQL database instead of only in-memory tests. The first live verify pass immediately found a real integrity bug (`ck_keyword_trend_daily_rate_range`) with `sampled_posts=6` and `matched_posts=8`, so the correct next step was to fix that denominator floor before treating Postgres evidence as complete.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/build-subreddit-keyword-trend-daily.job.test.ts` passed (`3/3`). Regression checks passed: `npx tsx --test tests/integration/reddit-phase1-cycle.test.ts`, `npx tsx --test tests/integration/api-server-trends.test.ts`, `npx tsx --test tests/integration/api-server-readyz.test.ts`. Live persisted proof passed with `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, `REDDIT_RUN_MODE=live`, `REDDIT_RUN_SUBREDDIT=machinelearning`, `npm run verify:phase1:postgres`: counts now include `subreddit_daily_fact=46` and `keyword_trend_daily=17328`, `materializedPreview` returned 7 recent `dailyFacts` plus persisted `keywordRows` for `r/machinelearning`, and the rate-constraint failure is gone.
- Next: Keep `R1` narrow and finish the remaining downstream consumer: switch the 15-day qualified-post trend/materialized trend path off fixed thresholds onto the same tier-aware `subreddit_daily_fact` contract, then rerun `verify:phase1:postgres` to confirm `/v1/trends` and `/readyz` remain truthful from persisted fact/read-model sources.

### 2026-04-16 20:52:30

- Scope: Landed the `R1` daily-fact vertical slice in runtime code. Added additive schema `013_subreddit_daily_fact.sql`, new domain/storage contracts for `subreddit_daily_fact`, day-level materialization job `src/jobs/build-subreddit-daily-facts.job.ts`, supporting services (`subreddit-tiering`, `quality-threshold`, `subreddit-daily-heat`), scheduler/worker wiring so the order now includes daily facts before trend/keyword materialization, and daily API/readiness reads that use the persisted fact layer.
- Why now: The active project state explicitly required `subreddit_daily_fact` to become the canonical day-level source before continuing algorithm productization. Daily heat/readiness could not stay truthful while `/v1/trends/subreddit/:name/daily` still aggregated from `subreddit_trend_point` and `/readyz` had no persisted materialization signal.
- Verify: `npm run typecheck:core` passed. Targeted suites passed: `npx tsx --test tests/unit/build-subreddit-daily-facts.job.test.ts tests/unit/subreddit-daily-insights.service.test.ts tests/integration/api-server-trends.test.ts tests/integration/api-server-readyz.test.ts tests/integration/reddit-phase1-cycle.test.ts`. Regression gate `npm run algo:phase1` passed (`35/35`). With provided database env, `npm run db:migrate` applied `013_subreddit_daily_fact.sql` successfully.
- Next: Keep `R1` moving by replacing remaining fixed-threshold downstream consumers with the new tier-aware day-fact rules, starting with 15-day qualified-post trend handling and keyword daily materialization, then run one persisted live/materialized verification pass against local Postgres.

### 2026-04-16 20:23:25

- Scope: Reduced project-level execution friction so Codex can push code autonomously without bouncing between flow notes and guardrail restatements. Updated the repo-level `AGENTS.md` and the single-state `project.md` to make end-to-end slice execution the default behavior.
- Why now: The current `P1.7` process had become over-constrained: too many explicit freezes, planning rules, and contract checkpoints risked turning normal algorithm work into repeated interpretation instead of implementation. The user explicitly requested higher-autonomy execution with fewer idle loops.
- Verify: Updated `AGENTS.md` with an `Autonomy Default` section (`brief inspection -> direct implementation`, ask only on true blockers, docs/process as trailing work). Updated `obsidian-reddit专用/Projects/project.md` frontmatter, `Current Decision`, `Why This Decision`, `Current Focus`, `Change Policy`, `Autonomous Execution Policy`, `Architecture Guardrails`, and `Algorithm Development Plan` so the active process now prioritizes code/test evidence over extra pre-work while keeping the essential architecture constraints (`write/read path discipline`, `canonical source`, `algorithm_version`, `/readyz` observability). No application/runtime code changed in this step.
- Next: Execute `R1` directly in the codebase as the default autonomous slice: land `subreddit_daily_fact` end-to-end, wire scheduler/materialization/read-model paths around it, run focused tests, and only pause if a real blocker appears.

### 2026-04-16 20:20:12

- Scope: Refined the `P1.7` algorithm development flow from a feature-round outline into an architecture-guarded execution contract. Tightened `next_action`, `Current Decision`, `Must Fix First`, `Exit Gate`, `Current Focus`, and `Algorithm Development Plan`, and added explicit cross-round architecture guardrails.
- Why now: The new review note in `C:/Users/21274/Downloads/进一步优化.md` correctly identified several repo-level drift risks if `R1-R5` stayed too high-level: scheduler order could remain old-path, metrics could be mixed across raw snapshots and fact tables, keyword contracts could drift before freeze, driver scoring could bias toward fresh posts without age normalization, anomaly feeds could duplicate incidents, and algorithm readiness could lag provider readiness.
- Verify: Re-read current `project.md`, `docs/architecture.md`, `workers/reddit-phase1-scheduler.ts`, `src/workers/reddit-phase1.worker.ts`, `src/jobs/build-subreddit-trend-points.job.ts`, and `src/jobs/build-subreddit-keyword-trend-daily.job.ts` before update. Confirmed the current scheduler still materializes `trend points -> keyword daily` directly from persisted collection data, the architecture doc already requires read/write separation, and `/readyz` is already a persisted observability contract worth extending rather than replacing. No runtime/code files changed in this step.
- Next: Execute `R1` with the added architecture constraints: land `subreddit_daily_fact`, make it the canonical day-level metric source, reorder scheduler materialization around it, and surface algorithm-materialization health alongside existing provider readiness.

### 2026-04-16 20:11:44

- Scope: Reframed `project.md` from `P1.6 Scrapling integration` tracking into `P1.7 algorithm productization`, replacing the old `S0-S4` flow with a dependency-ordered `R1-R5` algorithm development plan grounded in the provided algorithm design notes.
- Why now: The acquisition lane already has verified HTTP/Scrapling evidence, while the user explicitly shifted priority to product-grade algorithm delivery: daily facts, tier-aware quality rules, keyword query trends, driver posts, and anomaly feeds.
- Verify: Updated frontmatter `stage`, `updated_at`, `next_action`; rewrote `Current Decision`, `Why This Decision`, `P1.7` scope/gates, `Current Focus`, `Change Policy`, `Algorithm Development Plan`, and `Process Flow Source` in `obsidian-reddit专用/Projects/project.md` using `C:/Users/21274/Downloads/Reddit数据分析算法设计.md` and `C:/Users/21274/Downloads/算法具体实现.md` as the design inputs. No code/runtime files changed in this step.
- Next: Execute Round `R1` end-to-end: add `subreddit_daily_fact`, tier-aware quality rules, daily heat materialization, and the first subreddit heat read model/API before opening keyword or anomaly work.

### 2026-04-16 18:23:30

- Scope: Completed the requested extra technical-candidate live windows and produced contrasted rollout evidence beyond tests. Executed repeated controlled-promotion runs for `python,javascript` and `programming,technology`, with per-target local readiness detail from snapshot cycles.
- Why now: Stage B evidence quality needed one more real run group so promotion decisions are based on repeatable target-local outcomes rather than a single technical sample.
- Verify: `npm run algo:promotion:verify` wrote `docs/live-controlled-promotion-2026-04-16T10-22-54-916Z.json` (`python,javascript`: `runCount=4`, `localTargetDegradedRuns=2`; `python` degraded with `provider_stale_head_elevated:scrapling`, `javascript` local ready) and `docs/live-controlled-promotion-2026-04-16T10-23-16-792Z.json` (`programming,technology`: `runCount=4`, `localTargetDegradedRuns=0`). Also retained prior technical pass snapshot `docs/live-controlled-promotion-2026-04-16T10-19-17-380Z.json` (`programming,technology`, `4/4` local ready).
- Next: Use `programming,technology` as the current technical positive-control pair, keep `python` and `machinelearning,datascience` in shadow, and implement the next algorithm round after receiving explicit user rules.

### 2026-04-16 18:17:54

- Scope: Implemented a bounded algorithm upgrade in `src/jobs/collect-subreddit-new-posts.job.ts` to reduce live overflow waste and stale-tail noise: live mode now stops overflow when (1) the head page is already stale (`freshestAgeSeconds > 5400`) or (2) deeper overflow pages are too old (`oldestAgeSeconds > 21600`). Added two integration proofs in `tests/integration/collect-subreddit-new-posts-p0.test.ts` for head-stale stop and deep-tail stop, and aligned existing overflow tests to fresh timestamp baselines.
- Why now: Stage B still needs higher-quality promotion evidence, but live overflow was spending budget on old pages that add little recall value while amplifying duplicate/lag noise.
- Verify: `npx tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts` passed (`10/10`, including new stop-rule cases). `npm run algo:phase1` passed (`35/35`). Live controlled snapshot `docs/live-controlled-promotion-2026-04-16T10-17-39-165Z.json` remains locally ready for `chatgpt,claudeai` (`localTargetDegradedRuns=0`).
- Next: Run repeated `algo:promotion:verify` windows for additional technical candidate sets (while `machinelearning,datascience` stays shadow) and continue narrowing duplicate/lag observability noise only where it distorts local rollout decisions.

### 2026-04-16 18:12:05

- Scope: Repaired controlled-promotion local readiness evaluation to avoid false local stale-head blocking when a target head is currently fresh. `scripts/live-controlled-promotion-verify.ts` now queries per-target latest content age, suppresses local `provider_stale_head_elevated:*` when `latestContentAgeSeconds <= 5400`, and writes richer per-cycle evidence (`targetFreshness`, `duplicatePostRate`, `ingestLagSeconds`, candidate/accepted counts). Then executed fresh promotion windows for both target sets and updated Stage B docs.
- Why now: Latest repeated verification unexpectedly marked even the hot positive-control set as locally degraded due high average lag over fetched pages, despite fresh target heads; this made Stage B local-vs-global rollout decisions noisy.
- Verify: `npm run algo:promotion:verify` with `REDDIT_SCRAPLING_PRIMARY_SUBREDDITS=chatgpt,claudeai` wrote `docs/live-controlled-promotion-2026-04-16T10-10-21-019Z.json` (`localTargetDegradedRuns=0`, `targetFreshness.latestContentAgeSeconds` about `1855`, stale-head suppressed locally). Same command with `REDDIT_SCRAPLING_PRIMARY_SUBREDDITS=machinelearning,datascience` wrote `docs/live-controlled-promotion-2026-04-16T10-10-55-835Z.json` (`localTargetDegradedRuns=4`, `provider_stale_head_elevated:scrapling`, `latestContentAgeSeconds` > `14900`). Regression gate `npm run algo:phase1` passed (`35/35`).
- Next: Keep `chatgpt,claudeai` as promoted positive control and `machinelearning,datascience` in shadow lane, then run repeated windows on additional technical sets to secure at least one technical local-pass set before Stage B exit.

### 2026-04-16 15:05:05

- Scope: Converted the separated global-vs-local promotion evidence into explicit target-level Stage B rollout criteria and updated integration flow docs to match current execution reality (including a `P/Stage/S` master flow map and current status).
- Why now: The latest verification snapshots already showed divergent local outcomes across target sets, but Stage B still needed a written, repeatable decision contract before opening Stage C.
- Verify: Added `docs/stageb-target-rollout-criteria.md` with concrete promotion/shadow rules and current decisions for `chatgpt,claudeai` vs `machinelearning,datascience`. Updated `docs/scrapling-integration-flow.md` to replace outdated S0-only next steps with current Stage B execution and flow map.
- Next: Run repeated `algo:promotion:verify` windows against both target sets using this criteria doc and close Stage B only after repeated local-pass evidence exists for both hot and technical sets.

### 2026-04-16 15:01:16

- Scope: Completed live controlled-promotion verification after adding global-vs-local readiness separation into `scripts/live-controlled-promotion-verify.ts`, and captured both target sets with the same 2-round method (`chatgpt,claudeai` and `machinelearning,datascience`).
- Why now: The current Stage B/P1.6 gate required proving whether degraded reasons come from promoted-target local Scrapling behavior or from global legacy `http` readiness noise before any threshold tuning.
- Verify: `npm run algo:promotion:verify` produced `docs/live-controlled-promotion-2026-04-16T06-59-02-278Z.json` (`chatgpt/claudeai`: `globalDegradedRuns=4`, `localTargetDegradedRuns=0`) and `docs/live-controlled-promotion-2026-04-16T07-00-52-231Z.json` (`machinelearning/datascience`: `globalDegradedRuns=4`, `localTargetDegradedRuns=4`, local reason `provider_stale_head_elevated:scrapling`). Regression check `npm run algo:phase1` passed with `35/35`.
- Next: Keep `chatgpt,claudeai` as promotion-positive candidates, keep `machinelearning,datascience` in shadow lane, and convert this separated evidence into explicit per-target Stage B exit criteria before opening Stage C work.

### 2026-04-16 14:45:44

- Scope: Added executable multi-cycle controlled-promotion verification script `scripts/live-controlled-promotion-verify.ts` with npm command `algo:promotion:verify`, then ran live verification on two target sets: (1) promoted `machinelearning,datascience` for 2 rounds, and (2) promoted hot targets `chatgpt,claudeai` for 2 rounds. Snapshots written to `docs/live-controlled-promotion-2026-04-16T06-43-26-776Z.json`, `docs/live-controlled-promotion-2026-04-16T06-44-24-787Z.json`, and `docs/live-controlled-promotion-2026-04-16T06-45-27-421Z.json`.
- Why now: Promotion needed repeatable live evidence over multiple cycles and subreddit sets (including popular targets), but the previous flow required manual one-shot runs and ad-hoc log parsing.
- Verify: `npm run algo:promotion:verify` completed successfully for all three runs. Summary for `machinelearning,datascience` set: `providersSeen=["scrapling"]`, `totalScraplingFallbackTransportCounts={"powershell":16}`, degraded reasons consistently `provider_stale_head_elevated:scrapling`. Mixed-set check including `programming` confirmed `providersSeen=["http","scrapling"]`. Hot-set `chatgpt,claudeai` run completed with promoted targets recorded under `scrapling` provider health and fallback transport evidence (`powershell`) captured each cycle. Regression gates still pass: `npm run typecheck`, `npm run algo:phase1` (`35/35`).
- Next: Keep using `algo:promotion:verify` as the default rollout evidence command and separate global legacy `http` degraded reasons from target-local promoted evidence before applying any stale-head threshold tuning.

### 2026-04-16 14:32:47

- Scope: Implemented controlled target-level Scrapling promotion in the runtime/worker path. Added `REDDIT_SCRAPLING_PRIMARY_SUBREDDITS` parsing in `src/runtime/reddit-phase1-runtime.ts`, enabled per-target provider routing in `src/workers/reddit-phase1.worker.ts`, and wired connector resolution by provider hint in `workers/reddit-phase1-once.ts` and `workers/reddit-phase1-scheduler.ts` (including runnable-job replay via job payload `providerHint`). Also extended `scripts/verify-phase1-postgres.ts` to emit fallback evidence (`providerFallbackCount`, `scraplingFallbackTransportCounts`) and updated runbook usage.
- Why now: The promotion plan already marked `machinelearning` and `datascience` as eligible, but the live execution path still used a single connector lane per cycle, so target-level promotion with explicit fallback was not enforceable in-framework.
- Verify: `npm run algo:phase1` passed (`35/35`, including new `tests/integration/reddit-phase1-provider-routing.test.ts` and runnable replay routing coverage). `npm run typecheck` passed. Updated docs: `docs/operations-runbook.md` now includes controlled promotion command and `REDDIT_SCRAPLING_PRIMARY_SUBREDDITS` semantics.
- Next: Execute live multi-cycle verification with database env set: run `algo:live:verify` under `REDDIT_LIVE_PROVIDER=http`, `REDDIT_SCRAPLING_PRIMARY_SUBREDDITS=machinelearning,datascience`, and confirm `/readyz` degraded reasons plus `fallbackEvidence` remain stable and explainable over repeated cycles.

### 2026-04-16 13:48:36

- Scope: Finished promotion-threshold execution end-to-end and repaired Scrapling bridge reliability for this environment. Added deterministic bridge fallback in `scripts/scrapling_reddit_bridge.py` (`scrapling http fetch -> powershell fallback`, plus `retries=0` on Scrapling fetchers), exposed fallback metadata in `scripts/verify-scrapling-bridge.ts`, fixed promotion report table header encoding in `scripts/build-shadow-promotion-plan.ts`, and refreshed runbook guidance.
- Why now: Promotion planning was blocked by Scrapling bridge timeout incidents; without a stable bridge lane, threshold conclusions were not rollout-safe.
- Verify: `npm run algo:live:verify` passed with provided `DATABASE_URL`. `npm run algo:scrapling:verify` now returns `status=200` with `fallbackTransport=powershell`. New parity snapshots passed: `docs/live-shadow-compare-2026-04-16T05-43-51-898Z.json` and `docs/live-shadow-compare-2026-04-16T05-46-53-400Z.json` (`4/4` gate pass each). Promotion plan from latest stable window (`REDDIT_SHADOW_PLAN_MAX_SNAPSHOTS=2`) produced eligible rollout list in `docs/shadow-promotion-plan-2026-04-16T05-47-07-395Z.json` (`datascience`, `machinelearning`). Regression gates passed: `npm run typecheck`, `npm run algo:full` (`130/130`).
- Next: Apply controlled target-level promotion to `scrapling` as primary for the eligible subreddits while keeping `http` fallback active, then continue collecting shadow snapshots and verify that `readyz` degradation remains explainable.

### 2026-04-16 13:02:19

- Scope: Resolved shorthand request `-last` by reading the single-state workspace file and retrieving the most recent activity entry.
- Why now: Quick state recall was needed without re-running prior verified implementation work.
- Verify: Checked local docs for a dedicated `-last` command (`rg -n -- "-last|last"`), then read `obsidian-reddit专用/Projects/project.md` and confirmed latest logged entry timestamp `2026-04-16 12:16:03`.
- Next: Continue from the current `next_action` unless a new explicit command overrides it.

### 2026-04-16 12:16:03

- Scope: Ran S1 shadow parity on a broader live sample set (`machinelearning,datascience`, 2 rounds) using the new `algo:shadow:compare` pipeline to validate non-single-point behavior.
- Why now: Single-subreddit one-round evidence was not enough for promotion-gate confidence.
- Verify: `npm run algo:shadow:compare` completed and wrote `docs/live-shadow-compare-2026-04-16T04-15-55-498Z.json`. Summary: `4/4` comparisons passed gate, average overlap `jaccard=1`, extracted delta `0`, lag delta `0`; both lanes had `successRate=1`.
- Next: Convert current parity snapshots into explicit promotion criteria and rollout candidate list, then keep running shadow snapshots as regression evidence before promoting any target.

### 2026-04-16 12:14:57

- Scope: Implemented S1 shadow parity pipeline as executable code instead of manual ad-hoc checks. Added `src/application/services/shadow-parity.service.ts` (parity math + gate evaluation), new runnable script `scripts/live-shadow-compare.ts`, new command `npm run algo:shadow:compare`, unit coverage `tests/unit/shadow-parity.service.test.ts`, and runbook usage/env documentation updates.
- Why now: Project state required side-by-side `http` vs `scrapling` evidence before provider promotion. Existing tooling only verified single Scrapling connectivity and could not quantify parity quality.
- Verify: `npx tsx --test tests/unit/shadow-parity.service.test.ts` passed (`3/3`). `npm run typecheck` passed. Live run `npm run algo:shadow:compare` succeeded and wrote `docs/live-shadow-compare-2026-04-16T04-14-33-511Z.json` with one-target sample (`machinelearning`) showing gate pass (`jaccard=1`, extracted delta `0`, lag delta `0`). `npm run algo:full` passed with `128/128`.
- Next: Execute S1 at scale (multiple subreddit sets + rounds), then convert observed parity distributions into explicit per-target promotion thresholds and fallback policies.

### 2026-04-16 12:07:36

- Scope: Completed runtime dependency activation for the new resident Scrapling lane and fixed bridge JSON extraction edge-case for Reddit JSON endpoints. Installed `scrapling[fetchers]` into the current Python environment and updated `scripts/scrapling_reddit_bridge.py` to parse JSON via `response.json()` fallback when body text is empty.
- Why now: The framework integration was code-complete, but live verification still failed because Scrapling was not installed and JSON endpoint parsing used a text-only path.
- Verify: `python -m pip install "scrapling[fetchers]"` succeeded (`scrapling 0.4.6`). `npm run algo:scrapling:verify` now succeeds with `status=200`, `provider=scrapling`, endpoint `/r/machinelearning/about.json`.
- Next: Execute S1 shadow lane and store parity snapshots under `docs/` for selected targets before any provider promotion.

### 2026-04-16 12:03:54

- Scope: Landed first persistent framework-level Scrapling integration instead of docs-only planning. Added `src/connectors/reddit/reddit-scrapling.connector.ts` (new live provider), Python bridge `scripts/scrapling_reddit_bridge.py`, runtime/env wiring (`REDDIT_LIVE_PROVIDER=scrapling` and `REDDIT_SCRAPLING_*` controls), provider-selection updates in connector factory, backfill cursor-provider fallback alignment for `scrapling`, and adaptive-sampling provider-profile alignment (`scrapling` treated as http-primary thresholds). Added verification command `npm run algo:scrapling:verify` and updated runbook. Added focused unit tests for provider resolution/runtime passthrough/new connector behavior.
- Why now: The objective changed to “Scrapling as resident acquisition capability with maximal in-framework fusion”. Existing state had only strategy docs and no executable provider lane.
- Verify: `npm run algo:phase1` passed. `npx tsx --test tests/unit/create-reddit-connector.test.ts tests/unit/reddit-scrapling.connector.test.ts` passed. `npm run algo:full` passed with `125/125`. `npm run algo:scrapling:verify` executed and failed with `scrapling_not_installed` (bridge error path works as designed). Official Scrapling signatures/capabilities used for implementation were verified from project README + source/docs (Fetcher GET path, Dynamic/Stealth fetch APIs, and Python 3.10+ requirement) before coding.
- Next: Install Scrapling fetcher dependency (`pip install "scrapling[fetchers]"`) and rerun `algo:scrapling:verify`; then execute S1 shadow lane with parity snapshots before any primary-provider promotion.

### 2026-04-16 11:51:00

- Scope: Reframed project execution from `P1.5 hardening` to `P1.6 HTTP + Scrapling integration`. Rewrote top-level project policy (`Summary`, `Current Decision`, `Scope`, `Exit Gate`, staged algorithm plan) and added canonical flow doc `docs/scrapling-integration-flow.md` to define additive integration (`connector -> jobs -> health -> sampling`) with Node/Python bridge, shadow rollout, and parity-first promotion.
- Why now: Product priority changed to HTTP scraping and explicit Scrapling integration. Existing project state was still optimized for late-stage Reddit-only hardening and did not provide a direct execution model for cross-runtime acquisition integration.
- Verify: Updated frontmatter (`stage`, `next_action`, `updated_at`) and strategy sections in `obsidian-reddit专用/Projects/project.md`. Added and reviewed `docs/scrapling-integration-flow.md` with staged checklist (`S0-S3`), runtime routing policy, observability mapping, and verification gates. External capability assumptions were grounded against Scrapling official README/docs before writeback.
- Next: Execute Stage `S0 contract freeze` immediately: define concrete bridge schema + error taxonomy, then add fixture-based mapper tests before enabling any runtime provider switch.

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

- Scope: Read `Projects/绠楁硶琛ュ厖.md`, reconciled it against the current repo state, and converted the loose timeline discussion into an explicit four-stage algorithm plan in this file. The plan now separates `P1.5` truth-layer close-out from later `P2` ranking/anomaly work and from still-later alert automation.
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

- Scope: Closed the command-surface and state-source drift called out by `浼樺寲绠楁硶鎺ㄨ繘娴佺▼.md`. Phase-1 runtime defaults now fall back to `mock` unless `live` is explicit, both schedulers no longer run a cycle on boot by default, package scripts were narrowed to one official `worker:phase1:*` family with explicit fast/full test and typecheck lanes, startup/docs files were aligned to `Projects/project.md`, and the forbidden root planning triplet plus obsolete `src/workers/run-reddit-phase1-once.postgres*` entry wrappers were removed.
- Why now: Stage A still needs live calibration, but the repo was making routine iteration look heavier and more ambiguous than it really is. That risked wasting cycles on duplicate entrypoints, environment-shaped false failures, and duplicate status files instead of truth-layer work.
- Verify: `npm run typecheck:core` passed. `npm run test:unit` passed with `61/61`. `npm run typecheck` passed. `npm run test` passed with `97/97`.
- Next: Use the cleaned mock-first command surface to continue Stage A live verification only where it adds truth, especially checking whether `provider_data_stalled` appears in real HTTP runs and whether any remaining `readyz` thresholds still need tightening before freeze.

### 2026-04-15 19:31:15

- Scope: Closed the remaining repo-level algorithm workflow gap from `绠楁硶宸ヤ綔鎺ㄨ繘寤鸿.md` by adding `skills/algorithm-dev-suite/SKILL.md` as the single project-facing algorithm entrypoint. Updated `skills/README.md`, `00_START_HERE.md`, and `README.md` so algorithm work now routes through one suite before fanning out to `reddit-monitoring`, `data-algo-social`, `reddit-trend-algo`, `data-algo`, and `data-algo-system`.
- Why now: The repo already had multiple algorithm-related skills, but no unified entry comparable to `frontend-dev-suite`. Without a suite layer, future algorithm skill installs would keep fragmenting task routing and force repeated re-interpretation of stage boundaries.
- Verify: Confirmed `algorithm-dev-suite` is referenced from startup and routing docs via `rg -n "algorithm-dev-suite" skills README.md 00_START_HERE.md`. No application code changed, so no additional typecheck/test run was needed for this round.
- Next: When you install more algorithm skills, keep them behind `algorithm-dev-suite` as primary or secondary branches instead of exposing each new skill directly in startup docs.

### 2026-04-15 19:36:51

- Scope: Executed the next skill-installation requirements from `skill瀹夎.md` at the project-local level. Added `signal-metric-design`, `synthetic-case-lab`, `read-model-contract-guard`, and `worker-boundary-for-algorithm` under `skills/`, then wired them into `algorithm-dev-suite` so the suite now governs metric definition, synthetic-case validation, outward contract stability, and worker-boundary discipline for future algorithm tasks.
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

### 2026-04-16 11:43:28

- Scope: Verified local Python runtime availability for this workspace and confirmed whether `Python 3.10+` is present.
- Why now: User asked if this project can use Python 3.10+ and whether the environment is already installed.
- Verify: `python --version` -> `Python 3.14.3`. `py -0p` lists `3.14`, `3.13t`, `3.13`. `where.exe python` resolves to `C:\Python314\python.exe` plus additional Python executables on `PATH`.
- Next: Python requirement is satisfied; proceed with `python` (or pin explicitly with `py -3.14`) for any scripts in this repo.
