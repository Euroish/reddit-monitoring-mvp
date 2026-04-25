---
title: "project"
type: codex-project-workspace
status: active
stage: analytics-workbench-contract-v2
updated_at: "2026-04-25 04:00:39"
repo_path: "E:\\vibe coding\\project"
next_action: "Run a live r/nba or r/overwatch backfill from Ops, then inspect target workbench dataQuality.coverage for low_observed_post_density/front_loaded_backfill_sample before treating activity bars as trend evidence."
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
- Product: `Reddit analytics product shell on top of the verified HTTP/Scrapling data plane`
- Product goal: build a durable browser-facing analytics product with session auth, explainable read models, charted target details, query analysis, and protected Ops visibility
- Phase: `analytics workbench contract v2`
- Authority: `project.md` is the single execution source

## Product Hardening Focus

- The frontend product shell is complete and verified through real browser/API smoke.
- The Linux collection lane is restored: collector-only proxy, backend-triggered node failover, scheduler, API, and materialization are all active on the host.
- The latest verified scheduled cycle processed `r/askreddit`, `r/machinelearning`, `r/nba`, `r/pics`, `r/todayilearned`, and `r/worldnews` with zero failed targets and six materialized targets.
- `/readyz` is still degraded only because of 105 historical live `dead_letter` jobs from the pre-proxy failure window; this is operational cleanup debt, not the active provider blocker.
- The verified P1.7 algorithm/read-model/provider baseline remains stable unless a regression blocks product behavior.
- Archived algorithm-development state lives at `Projects/Archive/algorithm-development-p1.7-2026-04-20.md`.
- Phase E repo-side launch hardening is effectively saturated; keep it stable rather than extending it.
- Current priority is shifting from recovery to product analytics: turn the existing product shell and read models into a TradingView-like Reddit analytics workbench.
- W1 Target Workbench Contract is complete: `TargetWorkbenchResponse`, `GET /v1/workbench/target/:targetId`, focused API tests, compiled deployment, and live host smoke are verified.
- W2 Target Detail Workbench UI is complete locally: `/target/:targetId` consumes the workbench endpoint and renders series toggles, multi-series chart, driver posts, keyword heat, reliability, anomalies, and query-param keyword overlays.
- W4 Comparison Mode is complete locally: `TargetComparisonWorkbenchResponse`, `GET /v1/workbench/compare`, normalized multi-target read model, target-detail comparison chart, market-backed suggested comparison controls, API contract test, and browser smoke are verified.
- W5 Saved Workbench Contexts is complete locally: `saved_workbench_view`, user-owned save/list API, target-detail save current view control, recent saved context links, API auth coverage, and browser smoke are verified.
- Current route correction from `docs/codex-handoff-tradingview-workbench.md`: do not advance immediately into broad watchlist/preset work. The strongest next slice is W6 Chart DTO v2 and workbench module extraction so TradingView-like behavior is contract-backed instead of frontend-only chart assembly.
- W6 Chart DTO v2 is complete and live-verified: target/comparison workbench APIs accept `range` and `timeframe`, target responses expose backend-driven indicators, available timeframes/ranges, anomaly annotations, and data-quality metadata, the frontend chart/options/URL logic is extracted under `apps/web/src/features/workbench`, and the live host now serves the W6 target/comparison DTO endpoints plus updated web assets.
- GitHub `main` is synchronized at `6bcee8eeae7a87f8377aca25cef966a9ea910112` (`Build workbench chart DTO v2`).
- Browser-origin hotfix is applied on the host: `http://38.12.6.154` is now allowed by API CORS and Nginx `server_name`; API preflight for that origin is verified.
- `context/codex-issue.md` is advisory evidence for the next product direction: fix monitored/global semantics and coverage honesty first, then add bounded 15-day target backfill, then expand TradingView-like chart surfaces.
- Keep the completed frontend routes (`/login`, `/dashboard`, `/queries`, `/target/:targetId`, `/ops`) stable while extending API-backed workbench interactions.

## Product Positioning and Capacity Policy

- Product positioning: this product is a bounded Reddit monitored-analytics workbench, not an unbounded whole-Reddit crawler. The durable value is trend analysis over explicitly monitored subreddits, saved workbench context, comparisons, keyword overlays, anomaly markers, and honest coverage metadata.
- Small-server target: keep the default deployment viable on 2 CPU, 2GB RAM, and 40GB disk. Current Linux storage snapshot on 2026-04-24: `/dev/vda1` is 39G total, 13G used, 27G available, 32% used; PostgreSQL `reddit_monitoring` is 117MB; `/var/lib/postgresql` is 236MB; `/root/reddit-monitoring-mvp` is 348MB; `/opt/reddit-monitoring` is 335MB; `/var/cache/apt` is the largest cleanup candidate at about 1.2GB; journals are 82.8MB.
- Data retention stance: long-term retention belongs to materialized analytics facts (`subreddit_daily_fact`, `subreddit_trend_point`, `keyword_trend_daily`, `post_growth_fact`, anomaly/read-model rows). Raw Reddit payloads and high-frequency snapshots are operational evidence, not long-term product storage.
- Growth control: raw events should default to short retention (3-7 days on the small VPS), metrics snapshots should be retained or downsampled by age, and new-target 15-day backfill must be bounded by target count, pages/posts per target, concurrency, and retry budget.
- Product truth rule: UI/API labels must expose actual coverage. Rankings over monitored targets must be named as monitored rankings; keyword search over local indexed posts must expose observed-corpus coverage and degraded reasons; whole-Reddit claims require a future discovery/universe layer.
- Capacity gate before broader W7 charts: add table/index size observability, raw/snapshot retention defaults, and coverage states first. Only then expand TradingView-like surfaces so charts reflect materialized facts rather than hiding gaps in data coverage.

## Data Structure and Code Simplification Timing

- Immediate P0 cleanup is allowed only when it directly supports truth/capacity guardrails: naming monitored rankings honestly, adding coverage/degraded metadata, adding retention/size observability, and removing duplicate UI/read-model mapping created by those changes.
- Do not start broad repository cleanup before live W6 smoke and P0 analytics truth are complete; cosmetic shrinking would compete with the product correctness work.
- P1 backfill is the next structural proving ground. Keep implementation explicit enough to expose job payloads, quotas, materialization boundaries, and failure states. Avoid premature abstraction while backfill behavior is still being verified.
- The right larger cleanup gate is after P1 bounded 15-day backfill has passed tests and one live run: then consolidate repeated DTO/data-quality shapes, extract shared capacity/coverage helpers, prune duplicate chart option code, and simplify repository/query paths around the proven facts tables.
- W7 Market Board/Watchlist should start only after that post-P1 cleanup gate, so new charts reuse a stable compact workbench kernel instead of copying target-detail logic.

## Current Focus

- Keep live collection healthy while moving product architecture forward; old dead-letter jobs are cleanup debt unless fresh scheduled cycles fail.
- Use `docs/analytics-workbench-framework-2026-04-24.md` as the next product framework source after the product shell design.
- Use `docs/codex-handoff-tradingview-workbench.md` as the latest planning correction for the TradingView-like workbench direction.
- Optimize for the smallest analytics vertical slice: Chart DTO v2 contract additions, read-model metadata, API-backed range/timeframe controls, frontend workbench module extraction, and browser/API smoke evidence.
- Before adding broader chart surfaces, run the analytics truth gate: labels must match data coverage, local observed-corpus keyword results must expose coverage/degraded reasons, and empty/partial history must be visible rather than hidden by chart polish.

## TradingView-Like Top Page Decomposition

- Design cue: the current `https://www.tradingview.com/markets/` page on 2026-04-24 is organized as a broad markets landing page with a strong hero, grouped ranking sections, fast-scan strips, and drill-down links. Our equivalent must stay honest to monitored Reddit coverage rather than imply global Reddit coverage.
- M0 shell, using existing `GET /v1/trends/market` only: upgrade `/dashboard` into a Markets page with hero, monitored-scope framing, quick-scan heat strip, and grouped boards for heat, surge, and dispersion. No new backend contract required.
- M1 Market Board DTO v1: add a dedicated read model and endpoint for the top page so it stops overloading the generic market-trend contract. Required slices are market summary, breakout/anomaly rows, quick links into target detail, and data-quality/coverage metadata per section.
- M2 workflow objects on the top page: surface saved comparisons, recent saved workbench contexts, and watchlist presets as first-class cards instead of requiring navigation into target detail first.
- M3 interactive controls: add search, filter, sort, timeframe/range controls, and comparison launchers backed by stable API params rather than frontend-only reshaping.
- M4 data expansion gate: only after the monitored Markets page is contract-backed should bounded 15-day new-target backfill feed empty/partial/degraded/completed states for newly added targets. Do not present sparse targets as fully ranked.
- M5 breadth expansion: after M1-M4 stabilize, consider additional TradingView-like sections analogous to gainers, losers, sector buckets, or event rails, but only when corresponding Reddit read models and honest coverage labels exist.

## Change Policy

- Allowed: historical dead-letter cleanup/replay, analytics workbench framework/design, Chart DTO v2 contracts, target-detail read models, analytics truth/coverage fixes, bounded 15-day backfill design/implementation, focused product UI upgrades, and narrow runtime fixes only if live collection regresses.
- Forbidden: broad architecture rewrites, unrelated frontend polish, new provider experiments while the current collector lane is healthy, and launch-hardening expansion unrelated to product analytics.
- Each round should end with runnable code or an explicit design artifact, focused tests where code changes, and browser/API evidence for product-facing changes.

## Autonomous Execution Policy

- Default mode is `inspect briefly -> implement -> test -> write back`, not `inspect -> restate plan -> wait`.
- Linux truth overrides repo-side assumptions. When `Projects/test.md` or `Projects/第一次部署linux云服务器测试结果.md` exposes a live blocker, that blocker becomes the mainline until it is fixed or disproven.
- Codex may cross runtime/api/deploy/test boundaries inside the active round when that is the shortest correct path to restoring Linux data collection.
- Contract notes are lightweight: settle rules in code/tests when safe, and document only what must remain durable across sessions.
- Ask for user input only on true blockers: irreversible product/schema choices, destructive actions, missing external dependencies/credentials, or direct conflicts with user edits.

## Process Flow Source

- Archived algorithm flow: `Projects/Archive/algorithm-development-p1.7-2026-04-20.md`.
- Canonical post-P1.7 product shell design: `docs/product-shell-final-design-2026-04-20.md`.
- Canonical analytics workbench framework: `docs/analytics-workbench-framework-2026-04-24.md`.
- Supporting acquisition baseline: `docs/scrapling-integration-flow.md`.
- Architecture guardrails: `docs/architecture.md`.
- Keep this file as execution memory; store deep details in `docs/` and link from activity entries.

## Superseded Drift Notes

- Historical activity entries mention `docs/backend-rebuild-plan-2026-04-22.md`, but that file is not present in the current repo. Treat those mentions as historical context only.
- The active replacement for the missing TradingView-like analytics-module direction is `docs/analytics-workbench-framework-2026-04-24.md`.
- Historical entries that describe Linux as blocked by Reddit `403` are superseded by the 2026-04-24 07:15 scheduler cycle, which processed and materialized six targets with zero failed targets.

## Linux Truth Sources

- `Projects/第一次部署linux云服务器测试结果.md` is the canonical raw evidence for the first cloud-host failure.
- `Projects/test.md` is the canonical running log for the latest Linux validation attempts.
- If Linux evidence conflicts with local assumptions, follow Linux evidence and update this file immediately.

## Task Guide

- Write all state updates back to this file.
- Live startup files are `00_START_HERE.md` and `AGENTS.md`; they must point here, not to missing legacy paths.
- Do not use `planning-with-files` in this repo.
- Do not create or maintain `task_plan.md`, `findings.md`, or `progress.md` in project root.
- Do not depend on absent legacy files such as `PROJECT.md`, `context/decision-log.md`, or old Obsidian export paths. If a requested context file exists, read it as advisory evidence and reconcile it against the current repo; if it is missing, report it and continue from current repo evidence unless the task truly depends on that file.
- Every task entry should include: `Scope`, `Why now`, `Verify`, `Next`.
- Keep this file ASCII-first or clean UTF-8 only; do not copy mojibake text forward.

## Ongoing Development Flow

- Workspace rule: keep `obsidian-reddit专用/Projects/project.md` as the only active state source; treat any other `Projects` markdown file as archive/reference only.
- Slice rule: each dev cycle ships one smallest complete vertical slice. During analytics workbench planning, prefer the path `read-model contract -> API endpoint -> frontend integration -> browser/API smoke` over UI-only chart work.
- Verify rule: every slice must include at least `npm run typecheck` plus targeted test commands for changed boundaries; run `npm run algo:phase1` when the slice crosses scheduler/materialization/API seams.
- Evidence rule: store large verify artifacts under `docs/` and reference paths in the activity entry instead of pasting long logs. For product workbench changes, primary evidence should include API contract tests plus a browser smoke or screenshot-capable check.
- Writeback rule: after each slice, update frontmatter `updated_at` and `next_action`, then append one `Scope/Why now/Verify/Next` entry at the top of the activity log.
- Priority rule: keep live collection stable, then move product value forward through analytics workbench slices. If live collection regresses, runtime recovery temporarily retakes priority until one scheduled cycle succeeds again.
- Analytics truth rule: do not add charts ahead of data. Use the sequence `semantics/coverage -> bounded backfill/materialization -> API contract -> frontend chart/workflow`, with explicit data-quality states for empty, partial, degraded, and complete coverage.
- Capacity rule: every collection expansion must define retention, table/index growth expectations, and a small-VPS default budget before it becomes the default runtime path.
- Cleanup timing rule: broad data-structure/code simplification belongs after P1 backfill stabilization and before W7 chart breadth. Before then, only make cleanup changes that directly reduce risk or duplication in the active slice.

## Flow Reinforcement

- Do not re-open Linux runtime recovery unless a fresh scheduled cycle fails or provider smoke fails under the collector proxy.
- Do not let historical dead-letter jobs be mistaken for active provider failure; they are cleanup debt until new failures appear.
- Do not build TradingView-like UI ahead of contracts. Workbench features must be backed by persisted facts/read models and stable DTOs.
- Do not present monitored-target rankings or local observed-corpus keyword analysis as whole-Reddit coverage unless a real discovery/global universe layer exists.
- Architecture optimization is allowed only when it directly supports Chart DTO v2, indicator/panel composition, query overlays, comparison, or analysis workflow ergonomics.
- Next product sequence is live W6 Chart DTO v2 smoke, P0 analytics truth fixes, P1 bounded 15-day backfill for newly added targets, then W7 Market Board/Watchlist and W8 saved presets/context expansion. Watchlist remains important, but follows a stable chart/workbench kernel and honest coverage model.

## Activity Log

### 2026-04-25 04:00:39

- Scope: Made target workbench activity-series semantics honest for sparse 15-day backfills. `total_new_posts` now labels as observed collector sample volume, `qualified_post_count` labels as qualified observed posts, and `TargetWorkbenchResponse.dataQuality.coverage` exposes low-density days, minimum observed posts/day, observed total/median, and first-third concentration. Sparse front-loaded ranges such as an `r/nba` pattern now downgrade to `partial` with `low_observed_post_density` and `front_loaded_backfill_sample` reasons instead of looking like complete volume trends.
- Why now: Backfill can fetch posts across 15 days, but high-volume subreddits may only have 3-5 accepted observed posts/day in the tail. Presenting those bars as total subreddit volume would create false trend confidence.
- Verify: `node --import tsx --test tests/unit/target-workbench-read-model.service.test.ts tests/integration/api-server-trends.test.ts` passed (`19/19`). `npm run typecheck` passed.
- Next: Run a live `r/nba` or `r/overwatch` backfill from Ops and compare `/v1/workbench/target/:targetId` coverage metadata against the chart before using activity bars as trend evidence.

### 2026-04-25 03:41:40

- Scope: Fixed the Ops frontend control that still behaved like a shared `postLimit` field. Live and backfill now use separate state and separate input IDs: live remains capped at 200, while backfill defaults to 500 and renders with `max=1000`.
- Why now: The previous UI could still preserve a 200 live value when switching into backfill, making the newly added backfill API budget hard to use from the frontend.
- Verify: `npm run typecheck` and `npm run build:web` passed. Vite reported the existing large-chunk warning only.
- Next: Rebuild/redeploy the web asset bundle before testing the Ops page in browser; then run the `r/overwatch` live backfill smoke.

### 2026-04-25 03:38:08

- Scope: Removed the effective 200-post Ops/API ceiling from bounded backfill. The phase1 run contract now separates live `postLimit` from backfill controls (`backfillPostLimit`, `backfillMaxIterationsPerTarget`, `backfillTargetDays`), API validation allows bounded backfill budgets up to 1000 posts per cursor iteration, and Ops exposes those controls. API-triggered backfill now runs the synchronous bounded phase1 cycle even if async is requested, so it can advance cursor windows until coverage, EOF, or iteration budget instead of enqueueing one shallow collection job.
- Why now: High-volume subreddits such as `r/overwatch` can burn through 200 `/new` posts in only 2-3 days, while lower-volume subreddits can cover 15 days inside the same cap. The previous shared `postLimit <= 200` control made successful trends depend on subreddit posting velocity rather than requested backfill coverage.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/unit/reddit-phase1-runtime.test.ts tests/integration/api-server-runs.test.ts tests/integration/reddit-phase1-cycle.test.ts` passed (`23/23`). `npm run algo:fast`, `npm run algo:phase1`, `npm run algo:phase1:full`, and `npm run algo:full` all passed; final `algo:full` completed `279/279`.
- Next: Run a live `r/overwatch` backfill from Ops with `backfillPostLimit=500`, `backfillMaxIterationsPerTarget=24`, and `backfillTargetDays=15`, then inspect `/v1/workbench/target/overwatch` coverage versus `r/machinelearning`.

### 2026-04-25 03:24:25

- Scope: Tuned high-volume subreddit backfill for Reddit community behavior and exposed target coverage honesty in the workbench contract. Backfill candidate filters for mid/large subreddits now accept score-led or comment-led posts instead of requiring both, so game/media communities such as `r/overwatch` keep high-upvote low-comment candidates. `TargetWorkbenchResponse.dataQuality` now includes `materialized_observed_days` coverage, marks materialized zero-post days as `partial`/`empty` instead of false `complete`, and the target detail chart shows observed-day coverage and degraded reasons.
- Why now: `r/machinelearning` can show a trend with discussion-heavy posts, while `r/overwatch` is more likely to be source-limited by Reddit listing depth and score-led engagement. The previous code could both filter out useful score-led candidates and hide sparse observed days behind continuous zero-filled daily facts.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/unit/target-workbench-read-model.service.test.ts tests/integration/collect-subreddit-new-posts-p0.test.ts tests/integration/api-server-trends.test.ts` passed (`31/31`). `npm run algo:fast`, `npm run algo:phase1`, `npm run algo:phase1:full`, and `npm run algo:full` all passed; final `algo:full` completed `276/276`.
- Next: Run a live `r/overwatch` backfill/materialization smoke and inspect `/v1/workbench/target/overwatch` for observed-day coverage, partial/degraded reasons, and score-led driver posts versus `r/machinelearning`.

### 2026-04-25 00:20:00

- Scope: Fixed large-subreddit backfill source strategy so high-volume targets are no longer limited to `/new` only. Extended Reddit post-collection args/connectors to support bounded listing selection (`new` vs `top` with `week/month` windows), then changed `collectObservedPages()` to keep `/new` as the cursor source while adding a bounded `/top` supplement for first-pass high-volume backfill. Added an integration case proving an `r/overwatch`-like target can recover older qualified posts from `top/week` and `top/month` even when `/new` only exposes the newest few days.
- Why now: The user verified that `r/overwatch` still only showed about 3 days of history. Repository evidence plus Reddit listing behavior showed this was a source-ceiling problem, not just threshold tuning: high-volume subreddits can exhaust Reddit `/new` pagination before 15-day coverage is reachable.
- Verify: `node --import tsx --test tests/integration/reddit-phase1-cycle.test.ts tests/unit/reddit-apify.connector.test.ts tests/unit/reddit-scrapling.connector.test.ts` passed. `npm run typecheck`, `npm run algo:fast`, `npm run algo:phase1`, `npm run algo:phase1:full`, and `npm run algo:full` all passed; final `algo:full` completed `275/275`.
- Next: Expose this distinction in API/Ops as explicit backfill coverage state and degraded reason, e.g. `source_limited_new_listing`, `supplemented_with_top`, `partial`, `complete`, so operators can see when a target needed bounded older-signal recovery instead of assuming `/new` coverage is complete.

### 2026-04-24 18:14:20

- Scope: Prioritized product data functionality ahead of further frontend work. Added a dedicated market workbench data contract and backend read model: `MarketWorkbenchResponse`, `buildMarketWorkbenchReadModel()`, and `GET /v1/workbench/market` now expose monitored-market leaders plus breakout and anomaly sections assembled from existing trend points, post-growth facts, content rows, and anomaly events without changing schema or widening collection yet.
- Why now: The user explicitly asked to improve product data capabilities before doing more frontend. The smallest high-quality slice was to stop overloading the old generic market ranking endpoint and create a dedicated backend DTO that future Markets/TradingView-like surfaces can consume safely.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/api-server-trends.test.ts` passed (`17/17`), including the new market workbench contract test for leaders, breakouts, and anomalies.
- Next: Keep the same data-first path: extend `/v1/workbench/market` with workflow-object sections such as saved contexts/watchlist-ready rows and explicit empty/partial/degraded coverage states for newly added targets and future bounded backfill.

### 2026-04-24 18:01:51

- Scope: Re-prioritized the top-page direction around a TradingView-like monitored Markets experience. Updated the frontend shell so `/dashboard` now renders as a sectioned Markets board with a hero, monitored-scope summary cards, a heat strip, and grouped boards for heat, surge, and dispersion using the existing `GET /v1/trends/market` contract; also renamed the top-nav entry from `Dashboard` to `Markets` and updated browser smoke accordingly.
- Why now: The user explicitly asked to move the final top page toward `https://www.tradingview.com/markets/`, but not to jump straight into a full rebuild. The smallest compliant slice was to decompose that goal in `project.md` and ship the M0 shell on top of already-verified monitored-market data instead of inventing new backend surfaces first.
- Verify: `npm run typecheck` passed. `npm --prefix apps/web run build` passed with the existing large-chunk warning for `TargetDetail`. `SMOKE_API_PORT=3100 SMOKE_WEB_PORT=5174 npm run smoke:web` passed, including the new Markets heading, target drilldown, Ops, viewer guard, and mobile review.
- Next: Implement M1 Market Board DTO v1 so the top page can add breakout/anomaly/watchlist-style sections without overloading the generic `MarketTrendResponse`.

### 2026-04-24 17:56:26

- Scope: Completed the Ops-facing storage observability slice. Wired `GET /v1/ops/storage` into `apps/web/src/pages/Ops.tsx` with a storage footprint card, database/table size formatting, and graceful feature-not-ready handling; updated `scripts/smoke-web-product-shell.ts` plus its in-memory runtime so browser smoke now covers the storage panel instead of skipping it.
- Why now: With retention/pruning defaults and executable cleanup paths already in place, the remaining P0 gap was making the capacity signal visible in the actual product workflow before bounded new-target backfill starts.
- Verify: `npm run typecheck` passed. `npm --prefix apps/web run build` passed. `SMOKE_API_PORT=3100 SMOKE_WEB_PORT=5174 npm run smoke:web` passed, including `/ops` storage, owner flow, viewer guard, and mobile review.
- Next: Start P1 bounded 15-day backfill for newly added targets, beginning with the contract/job quotas and explicit degraded/failure states before any live rollout.

### 2026-04-24 17:52:50

- Scope: Completed the executable half of the P0 retention slice. Added `scripts/prune-metrics-snapshots.ts`, exposed `npm run ops:prune:metrics-snapshots`, aligned `scripts/prune-raw-events.ts` to the deployed small-VPS default of `7` days, and updated `docs/operations-runbook.md` so both raw-event and metrics-snapshot cleanup paths match `deploy/env/scheduler.env.example`.
- Why now: `project.md` already recorded the retention defaults at the env/runbook level, but the runtime cleanup path was incomplete and the raw-event script/docs still disagreed on the real default. Closing that gap keeps the bounded-storage policy honest before any Ops UI work or new-target backfill.
- Verify: `npm run typecheck` passed.
- Next: Surface `GET /v1/ops/storage` in the Ops experience with the current owner/admin guard, then use that storage view to guide bounded retention/backfill operations.

### 2026-04-24 15:05:38

- Scope: Made the smallest P0 follow-up change: wrote explicit small-VPS retention defaults for `raw_reddit_event` and `metrics_snapshot` into `deploy/env/scheduler.env.example` and `docs/deployment-runbook.md` so the bounded-storage policy is now part of the deploy/runtime contract instead of only project memory.
- Why now: The remaining token budget called for a narrow, low-risk change that still moves P0 capacity guardrails forward without opening another API/UI slice.
- Verify: Doc/env-only change; no code path changed.
- Next: When the next coding slice starts, implement the matching prune path for `metrics_snapshot` and then surface storage observability in Ops.

### 2026-04-24 15:04:42

- Scope: Closed the remaining W6 live-deployment gap and started P0 capacity guardrails. On the host, rebuilt the API and web bundles, synced `dist/` and `apps/web/dist/` into `/opt/reddit-monitoring/current`, restarted `reddit-api.service`, and verified the live W6 DTO v2 target/comparison endpoints. Then added storage observability as the first P0 capacity slice: `StorageObservabilityRepository`, Postgres/in-memory adapters, `GET /v1/ops/storage`, contract types, and auth coverage for owner/admin-only access.
- Why now: W6 was only complete locally; `project.md` still carried an explicit `live W6 smoke` gap before P0/backfill work. The strongest next P0 slice after closing that gap was table/index size observability, because it turns the small-VPS capacity discussion into a stable inspectable signal before retention defaults and bounded backfill.
- Verify: Live W6 host smoke passed with authenticated `GET /v1/workbench/target/machinelearning?range=7d&timeframe=1d&driverLimit=3&anomalyLimit=3` returning `ok=true`, target `r/machinelearning`, `timeframe=1d`, `rangePreset=7d`, expected series ids, `dataQuality=complete`, and `annotationCount=3`; authenticated `GET /v1/workbench/compare?targets=machinelearning,askreddit&series=heat_price,total_new_posts&range=30d&timeframe=1d` returned `ok=true`, `rangePreset=30d`, both targets, both requested series ids, and `comparisonCount=4`. Public host `http://38.12.6.154/target/machinelearning?range=7d&timeframe=1d` serves the updated web bundle. `node --import tsx --test tests/integration/api-server-auth.test.ts` passed (`14/14`). `npm run typecheck` passed. Live Postgres storage proof via the new repository path returned `databaseSizeBytes=128834583`, with largest tables `raw_reddit_event=51421184`, `post_growth_fact=22470656`, `metrics_snapshot=21987328`, `post_search_document=13172736`, and `keyword_trend_daily=2596864`.
- Next: Finish P0 capacity guardrails by adding retention/pruning defaults for `raw_reddit_event` and `metrics_snapshot`, then wire the new storage observability signal into the Ops experience before bounded 15-day new-target backfill.

### 2026-04-24 14:56:06

- Scope: Completed a narrow P0 analytics truth slice for monitored-market and query-coverage semantics. Added `coverage` metadata to `MarketTrendResponse` and `KeywordQueryView`, populated it in `apps/api/src/create-api-server.ts`, renamed dashboard language to monitored-market wording in `apps/web/src/pages/Dashboard.tsx`, and made `apps/web/src/pages/Queries.tsx` explicitly describe locally observed-corpus scope and counts instead of implying whole-Reddit coverage.
- Why now: `project.md` and `context/codex-issue.md` both put monitored/global semantics and coverage honesty ahead of broader chart expansion. This slice fixes the most visible product-language drift without widening collection or backfill scope yet.
- Verify: `node --import tsx --test tests/integration/api-server-keyword-query.test.ts tests/integration/api-server-trends.test.ts` passed. `npm run typecheck` passed. `npm --prefix apps/web run build` passed with only the existing large-chunk warning for `TargetDetail`.
- Next: Add P0 capacity guardrails in the same truth-first lane: structured table/index size observability plus retention/pruning defaults for `raw_reddit_event` and `metrics_snapshot`, then move into bounded 15-day new-target backfill.

### 2026-04-24 14:50:25

- Scope: Safely cleaned Linux package-cache waste and defined the cleanup/optimization timing gate. Ran an `apt-get clean`-only cleanup after simulation, leaving database files, repo files, deployment releases, logs, Playwright/VSCode caches, and untracked context files untouched.
- Why now: The server had a clear low-risk cleanup candidate (`/var/cache/apt` about 1.2GB), and the user asked when to optimize data structures and reduce code under the current design.
- Verify: Before cleanup, `/dev/vda1` was 39G total, 13G used, 27G available, 32% used, and `/var/cache/apt` was 1.2GB. After `apt-get clean`, `/dev/vda1` is 39G total, 11G used, 28G available, 29% used, and `/var/cache/apt` is 64K. `postgresql`, `reddit-api.service`, `reddit-phase1-scheduler.service`, and `nginx` all remained `active`. PostgreSQL query against `reddit_monitoring` succeeded (`119 MB`, `content=1912`).
- Next: Do only P0 risk-reducing cleanup while implementing analytics truth/capacity guardrails. Defer broader data-structure/code simplification until after P1 bounded 15-day backfill passes tests and one live run; perform that cleanup before W7 Market Board/Watchlist chart expansion.

### 2026-04-24 14:47:24

- Scope: Analyzed current Linux storage/capacity and wrote back the product positioning/capacity policy. Confirmed the server is currently storage-light and memory-stable, but the durable product must stay bounded to monitored analytics with materialized facts retained long-term and raw/high-frequency evidence pruned or downsampled.
- Why now: The user asked whether the framework can meet server-performance constraints while storing enough data for analysis. The answer depends on making monitored coverage, retention, and capacity guardrails explicit before expanding collection and chart surfaces.
- Verify: `df -hT` shows `/dev/vda1` at 39G total, 13G used, 27G available, 32% used. `du` shows `/var/lib/postgresql` 236MB, `/root/reddit-monitoring-mvp` 348MB, `/opt/reddit-monitoring` 335MB, `/var/cache/apt` about 1.2GB, and journals 82.8MB. PostgreSQL reports `reddit_monitoring` at 117MB; largest tables are `raw_reddit_event` 46MB, `post_growth_fact` 20MB, `metrics_snapshot` 20MB, and `post_search_document` 13MB. Row counts include `metrics_snapshot=75349`, `post_growth_fact=20033`, `raw_reddit_event=1219`, `content=1899`, `keyword_trend_daily=2293`, `subreddit_daily_fact=368`. `free -h` shows 1.9Gi RAM, 1.1Gi available, and 4.0Gi swap with 94Mi used.
- Next: After live W6 smoke, implement P0 analytics truth/capacity guardrails: monitored ranking labels, keyword coverage/degraded states, no/partial-history UI states, raw/snapshot retention defaults, and table/index size observability before broader W7 chart expansion or 15-day backfill defaults.

### 2026-04-24 14:39:18

- Scope: Corrected the Codex startup/development workflow and incorporated the advisory conclusions from `context/codex-issue.md`. Updated `00_START_HERE.md`, `prompts/codex-kickoff-minimal.md`, `AGENTS.md`, and this workspace so future sessions start from `obsidian-reddit专用/Projects/project.md`, treat context exports as advisory evidence, and apply an analytics truth gate before broader chart work.
- Why now: The current prompt surface had path drift (`PROJECT.md`, `context/decision-log.md`, and old Obsidian export paths are absent), and the new issue export correctly highlights the main product risk: adding more charts would hide data-coverage problems unless monitored/global semantics, keyword coverage states, and target-history backfill are handled first.
- Verify: Read `context/codex-issue.md` after it appeared as an untracked file; confirmed `.codex` is empty and `PROJECT.md`/`context/decision-log.md` are absent; reviewed startup references with `rg`; inspected the final diff for `00_START_HERE.md`, `prompts/codex-kickoff-minimal.md`, `AGENTS.md`, and this workspace.
- Next: Use the corrected startup flow for future Codex sessions. Product work should return to operator browser-login validation from `http://38.12.6.154` and live W6 Chart DTO v2 deploy-smoke, then run P0 analytics truth fixes before W7: monitored ranking labels, keyword coverage/degraded states, and clear no/partial-history states; bounded 15-day backfill follows as P1.

### 2026-04-24 13:54:57

- Scope: Synchronized the W5/W6 work to GitHub `main` as commit `6bcee8eeae7a87f8377aca25cef966a9ea910112` and fixed the operator browser-login blocker on the host. Added `http://38.12.6.154` to `API_CORS_ALLOW_ORIGINS`, added the same IP to Nginx `server_name`, moved accidental Nginx backup files out of `sites-enabled`, restarted `reddit-api.service`, reloaded Nginx, and reset the active production owner account password for manual validation without documenting the plaintext secret here.
- Why now: The user needed to validate the live frontend directly. The browser was loaded from `http://38.12.6.154`, while the API only allowed `http://103.172.183.79`, so `/api/auth/login` returned `cors_origin_not_allowed`; after CORS was fixed, the user tried the smoke-only `owner@example.com` account, which does not exist in the production database.
- Verify: GitHub push reported `73a5c94..6bcee8e main -> main`, then authenticated fetch confirmed local `HEAD` and `origin/main` both at `6bcee8eeae7a87f8377aca25cef966a9ea910112`. `nginx -t` passed after moving backup files. `systemctl is-active reddit-api.service` and `systemctl is-active nginx` both returned `active`. CORS preflight to `/auth/login` with `Origin: http://38.12.6.154` returned `204` with `Access-Control-Allow-Origin: http://38.12.6.154` and credentials enabled. A local login POST for the active owner returned `200 OK`.
- Next: Operator should refresh `http://38.12.6.154/login` and complete browser validation with the active owner account. After that, deploy/restart the W6 compiled API/static frontend on the host if needed and smoke the live DTO v2 endpoints before starting W7 Market Board/Watchlist.

### 2026-04-24 13:37:55

- Scope: Completed the local W6 Chart DTO v2/workbench extraction slice. Added `resolveWorkbenchDailyRange()` for API-backed `range=7d|30d|90d` plus `timeframe=1d`, extended `TargetWorkbenchResponse` and comparison range metadata, added backend-driven indicator definitions, available timeframes/ranges, anomaly annotations, and data-quality metadata. Extracted frontend chart rendering/options and URL state into `apps/web/src/features/workbench`, added target-detail range/timeframe controls, and kept existing target/comparison/keyword/saved-view workflows intact.
- Why now: The handoff correctly identified `TargetDetail.tsx` and the workbench DTO as the next structural bottleneck. This slice creates a stable chart/workbench kernel before broader Market Board/watchlist work.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/api-server-trends.test.ts` passed (`16/16`) with assertions for workbench metadata and range/timeframe params. `npm --prefix apps/web run build` passed with only the existing large-chunk warning. `SMOKE_API_PORT=3100 SMOKE_WEB_PORT=5174 npm run smoke:web` passed and now covers target range controls in addition to target chart, keyword overlay, comparison chart, saved workbench view, Ops, auth guards, and mobile responsive review. `npm run build:api` passed.
- Next: Deploy/restart the compiled API on the host and smoke `GET /v1/workbench/target/machinelearning?range=7d&timeframe=1d` plus `GET /v1/workbench/compare?...&range=30d&timeframe=1d`; after live DTO v2 is proven, begin W7 Market Board/Watchlist using the contract-backed chart kernel.

### 2026-04-24 13:25:11

- Scope: Re-read `docs/codex-handoff-tradingview-workbench.md` and adjusted the active development plan after W5. Promoted the next slice from deploy-smoke/watchlist presets to W6 Chart DTO v2 plus frontend workbench module extraction. The objective route is now: stable DTO/metadata first, API-backed range/timeframe controls second, reusable workbench chart/control module third, then Market Board/watchlist and saved presets after the chart kernel is stable.
- Why now: W1-W5 already prove target, comparison, keyword overlay, and saved context workflows. Moving straight into watchlists would add workflow breadth while `TargetDetail.tsx` still owns too much chart/control logic and the contract lacks explicit indicator, panel, annotation, range/timeframe, and data-quality metadata.
- Verify: Planning verification was source-based: read the handoff doc, current `project.md`, package scripts, and workbench-related API/frontend/test references. Live data validation passed from the deployed Linux env with `REDDIT_RUN_MODE=live REDDIT_CRAWL_MODE=incremental REDDIT_RUN_SUBREDDIT=machinelearning REDDIT_POST_LIMIT=25 npm run phase1:manual-run`; the run selected provider `http`, recorded 50 candidates, and completed `ok=true`. API readback also passed: authenticated `GET /v1/workbench/target/machinelearning?driverLimit=3&anomalyLimit=3` returned `ok=true`, target `r/machinelearning`, series `heat_price`, `ema_7`, `ema_30`, `total_new_posts`, `qualified_post_count`, three drivers, three anomalies, and reliability provider `http`. `/readyz` remains degraded only by the known 105 historical live dead-letter jobs.
- Next: Implement W6 as one vertical slice: extend contracts/read model without breaking existing API clients, add range/timeframe query params backed by server filtering, expose backend-driven indicator/panel metadata and neutral annotation/data-quality fields, extract `apps/web/src/features/workbench/*`, keep `/target/:targetId` route behavior stable, then verify with `npm run typecheck`, targeted API tests, web build, and browser smoke.

### 2026-04-24 12:48:46

- Scope: Completed W5 Saved Workbench Contexts as the next workflow-object slice. Added `saved_workbench_view` migration, domain entity/repository, in-memory and Postgres repositories, contract DTOs, `POST /v1/workbench/saved-views`, and `GET /v1/workbench/saved-views`. The target detail workbench can now save the current URL-backed target/comparison/keyword context and shows recent saved context links for return navigation.
- Why now: W4 made comparison usable, but repeat analyst workflows still disappeared after navigation. Saving the current workbench context is the smallest durable workflow object before broader watchlists or presets.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/api-server-auth.test.ts` passed outside the sandbox (`13/13`), including session-owned saved comparison context and bearer rejection. `node --import tsx --test tests/integration/api-server-trends.test.ts` passed outside the sandbox (`16/16`). `npm --prefix apps/web run build` passed with only the existing Vite large-chunk warning. `SMOKE_API_PORT=3100 SMOKE_WEB_PORT=5174 npm run smoke:web` passed outside the sandbox, covering target chart, keyword overlay, comparison chart, saved workbench view creation/list refresh, Ops, auth guards, and mobile responsive review.
- Next: Deploy-smoke the saved workbench views API plus `GET /v1/workbench/compare` on the live host, then extend workflow objects into watchlist presets.

### 2026-04-24 12:18:10

- Scope: Hardened the W4 comparison workflow using `awesome-design-md-main` design references. Read the Linear, Sentry, and ClickHouse `DESIGN.md` files and applied the relevant product-workbench patterns: compact dark toolbar controls, pill/chip target selection, dense analytical hierarchy, and responsive control wrapping. Updated `apps/web/src/pages/TargetDetail.tsx` so comparison can be started from market-backed suggested targets instead of only free-text `compare=` input, while preserving URL-backed state and the API-backed comparison read model. Updated `scripts/smoke-web-product-shell.ts` to click the suggested `r/machinelearning` comparison chip and assert selected/remove state plus the comparison chart.
- Why now: W4's first slice proved the comparison contract and chart. The remaining local UX gap was making comparison discoverable as an analysis workflow instead of a hidden query parameter or manual text field.
- Verify: `npm run typecheck` passed. `npm --prefix apps/web run build` passed with only the existing Vite large-chunk warning. Initial `npm run smoke:web` was blocked by sandbox IPC (`listen EPERM` on `/tmp/tsx-0/*.pipe`), then the same command passed outside the sandbox with `SMOKE_API_PORT=3100 SMOKE_WEB_PORT=5174`, covering target chart, keyword overlay, market-backed comparison chip, comparison chart, Ops, auth guards, and mobile responsive review. `ss -ltnp` outside the sandbox confirmed no `3100`/`5174` listeners remained.
- Next: Deploy-smoke `GET /v1/workbench/compare` on the live host, then start saved comparison/query contexts or watchlist presets as the next workflow-object slice.

### 2026-04-24 12:08:19

- Scope: Completed the W4 Comparison Mode vertical slice. Added `TargetComparisonWorkbenchResponse` and comparable series ids to `packages/contracts/src/http.ts`, implemented `buildTargetComparisonWorkbenchReadModel()` in `src/application/services/target-comparison-workbench-read-model.service.ts`, exposed `GET /v1/workbench/compare?targets=...&series=...`, and added a target-detail comparison workflow backed by the API instead of frontend joins. Extended `scripts/smoke-web-product-shell.ts` seed data and assertions so the browser smoke proves a two-target comparison chart.
- Why now: The active next action required a comparison read model/contract before multi-target UI. The smallest useful slice was a URL-backed comparison on the existing target workbench, using normalized index values from persisted daily facts.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/api-server-trends.test.ts` passed (`16/16`), including the new multi-target comparison contract test. `npm --prefix apps/web run build` passed with only the existing Vite large-chunk warning. `SMOKE_API_PORT=3100 SMOKE_WEB_PORT=5174 npm run smoke:web` passed after tightening the comparison text assertion and fixing mobile form overflow; the smoke covered target chart, keyword overlay, comparison chart, Ops, auth guards, and mobile responsive review. Confirmed smoke ports `3100` and `5174` were released.
- Next: Harden comparison ergonomics with explicit target selector/timeframe controls, or deploy-smoke `GET /v1/workbench/compare` on the live host before starting saved workflow objects.

### 2026-04-24 11:58:02

- Scope: Completed W3 Query Overlay verification. Confirmed the target workbench now exposes query-param keyword overlays through explicit UI controls in `apps/web/src/pages/TargetDetail.tsx`, preserves the URL-backed `keywords` state, shows query context and driver matches from the API-backed read model, and locks the browser path in `scripts/smoke-web-product-shell.ts`.
- Why now: W2 had already landed the workbench endpoint and target-detail UI, and the active next action was to turn the existing `?keywords=` path into a verifiable overlay workflow rather than leaving it implicit.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/api-server-trends.test.ts` passed (`15/15`), including the target workbench contract and existing scoped query filtering coverage. `npm --prefix apps/web run build` passed with only the existing Vite large-chunk warning. `SMOKE_API_PORT=3100 SMOKE_WEB_PORT=5174 npm run smoke:web` passed, covering owner login, queries, target workbench chart, keyword overlay toggle and URL update, Ops, logout, viewer guard, and mobile responsive review.
- Next: Start W4 Comparison Mode from `docs/analytics-workbench-framework-2026-04-24.md`: define the multi-target comparison contract/read model first, then add UI only after API tests prove the shape.

### 2026-04-24 10:02:56

- Scope: Completed W2 Target Detail Workbench UI. Updated `apps/web/src/pages/TargetDetail.tsx` to consume `GET /v1/workbench/target/:targetId`, render selectable workbench series, keyword overlays from `?keywords=...`, driver posts, keyword heat, reliability, and anomaly panels. Updated `scripts/smoke-web-product-shell.ts` with workbench seed data and assertions for chart/panels/keyword overlay/mobile overflow. Made `apps/web/vite.config.ts` and the smoke script support temporary API/web ports so browser verification does not collide with an already-running local API.
- Why now: `Projects/上次未完成任务.md` showed W2 was started but not finished after W1. The next safe slice was to finish the frontend integration against the already verified workbench contract and prove it in a browser.
- Verify: `npm run typecheck` passed. `npm --prefix apps/web run build` passed with only the existing Vite large-chunk warning. Installed missing local Playwright Chromium/runtime dependencies, then `SMOKE_API_PORT=3100 SMOKE_WEB_PORT=5174 npm run smoke:web` passed, covering owner login, queries, target workbench chart SVG, driver/keyword/reliability panels, keyword overlay URL, Ops, logout, viewer guard, and mobile responsive review. Confirmed temporary smoke ports `3100` and `5174` were released afterward.
- Next: Start W3 Query Overlay: add explicit target-workbench overlay controls/context on top of the existing `?keywords=` API path, then verify with API-backed browser smoke.

### 2026-04-24 07:25:39

- Scope: Completed W1 Target Workbench Contract. Added `TargetWorkbenchResponse` to `packages/contracts`, implemented `buildTargetWorkbenchReadModel()` to assemble daily facts, trend points, keyword overlays, driver posts, anomaly events, and provider reliability, and exposed `GET /v1/workbench/target/:targetId` from the API. Added focused integration coverage in `tests/integration/api-server-trends.test.ts`. Built API dist, synced it to `/opt/reddit-monitoring/current/dist`, and restarted `reddit-api.service`.
- Why now: After repairing project state drift, the next analytics-workbench slice needed a stable backend contract before any TradingView-like target UI work. This prevents UI-only chart logic and gives the frontend a single workbench DTO.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/api-server-trends.test.ts` passed (`15/15`). `npm run build:api` passed. Live host smoke with authenticated `GET /v1/workbench/target/askreddit?keywords=ai&driverLimit=5&anomalyLimit=5` returned `ok=true`, target `r/askreddit`, series ids `heat_price`, `ema_7`, `ema_30`, `total_new_posts`, `qualified_post_count`, plus one overlay, five drivers, five anomalies, and reliability provider `http`.
- Next: Start W2 UI integration: update `apps/web/src/pages/TargetDetail.tsx` to consume the workbench endpoint, add series toggles and driver/keyword/reliability panels, then verify with web build and browser smoke.

### 2026-04-24 07:18:42

- Scope: Repaired project state drift after live collection recovery. Promoted the active stage from `linux-runtime-recovery` to `analytics-workbench-planning`, replaced stale "restore collection first" language with the current host truth, added `docs/analytics-workbench-framework-2026-04-24.md` as the canonical next product framework, and updated `docs/product-shell-final-design-2026-04-20.md` status calibration so it no longer points at Phase E as the active stage.
- Why now: The user correctly noted that collection is basically implemented and asked to fix status/drift before moving toward a TradingView-like product. The old project state still described the pre-proxy failure where every target hit Reddit `403`, even though the current scheduler has processed and materialized targets successfully.
- Verify: `journalctl -u reddit-phase1-scheduler.service --since '2026-04-24 07:12:00'` shows the 07:15 cycle processed `r/askreddit`, `r/machinelearning`, `r/nba`, `r/pics`, `r/todayilearned`, and `r/worldnews`, with `failedTargets=[]`, `replayedJobs=6`, and `materializedTargets=6`. Authenticated `/readyz` reports only `dead_letter_jobs_present`, with queue backlog/scheduled/running all `0` and `deadLetter=105`. No code behavior changed in this slice.
- Next: Decide whether to replay or clear the 105 historical live dead-letter jobs from the pre-proxy failure window, then start W1 from the analytics workbench framework: `TargetWorkbenchResponse`, `GET /v1/workbench/target/:targetId`, and focused API tests.

### 2026-04-24 07:12:54

- Scope: Added backend-triggered, collector-only node failover while preserving SSH/server safety. `RedditHttpConnector` now accepts `REDDIT_HTTP_PROXY_FAILOVER_COMMAND`; when a proxied Reddit request returns a block/rate-limit/upstream failure status or proxy error, it runs the command at most once for that request and retries. Wired the env through `createRedditConnectorFromEnv`, documented it in env examples/runbook, and added regression tests. On the host, moved collector node selection into `/root/sing-box-collector/node.env`, created root-owned `/usr/local/sbin/reddit-collector-failover`, restricted candidate switching to the verified Turkey/Vietnam node pool, and granted the `reddit-monitoring` service user only that command via `/etc/sudoers.d/reddit-collector-failover`. Rebuilt API/worker dist and synced it into `/opt/reddit-monitoring/current/dist`, then restarted API and scheduler.
- Why now: The user wanted the backend to recover automatically when data collection fails, without risking server access. A full-machine VPN switch would threaten SSH; a root-owned local proxy failover keeps the default route unchanged and only restarts the collector proxy on `127.0.0.1:1080`.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/unit/reddit-http.connector.test.ts tests/unit/reddit-phase1-runtime.test.ts` passed (`19/19`). `npm run build:api` passed and compiled dist was synced to the running release. Host failover proof: forced `/root/sing-box-collector/node.env` to bad node index `91`, restarted `sing-box-collector.service`, then ran compiled `node /opt/reddit-monitoring/current/dist/scripts/linux-provider-smoke.js`; the first request triggered failover and the same smoke passed after selecting node index `101` (`iepl.vnz1.cat.bilibili.com`). Safety proof: default route remains `default via 10.0.196.1 dev ens17`, SSH still listens on `:22`, `sing-box` only listens on `127.0.0.1:1080`, and `sing-box-collector.service`, `reddit-api.service`, and `reddit-phase1-scheduler.service` are active.
- Next: Watch the next scheduled cycle under the new failover-enabled runtime and confirm normal target processing. If `/readyz` stays degraded only because of old dead-letter jobs, decide whether to replay/clear those historical jobs.

### 2026-04-24 06:55:38

- Scope: Completed the collector-only VPN/proxy deployment with the new subscription link. Stored the subscription only in `/root/.secrets/sing-box-subscription.url` with `600` permissions, installed sing-box `1.13.11`, upgraded `/root/sing-box-collector/build-config.mjs` for sing-box 1.13 DNS/inbound config rules, skipped subscription metadata nodes, added explicit node selection support, and pinned `sing-box-collector.service` to the verified Turkey IEPL node (`SING_BOX_NODE_INDEX=90`). Installed and enabled `sing-box-collector.service`, merged `REDDIT_LIVE_PROVIDER=http`, `REDDIT_HTTP_TRANSPORT=fetch`, and `REDDIT_HTTP_PROXY=http://127.0.0.1:1080` into both scheduler/API env files, then restarted API and scheduler so live runtime uses the collector proxy.
- Why now: The previous recovery state was blocked before host deployment. With the fresh user subscription, the server can now fetch nodes and run systemd, so the smallest useful slice was to finish the host-only proxy path and prove the Reddit provider/read-model path through it.
- Verify: `sing-box check -c /root/sing-box-collector/config.json` passed after the config migration. `systemctl status sing-box-collector.service` shows active and listening on `127.0.0.1:1080`. A proxied Reddit JSON GET returned real `about.json` content. `REDDIT_HTTP_TRANSPORT=fetch REDDIT_LIVE_PROVIDER=http timeout 60s npx tsx scripts/linux-provider-smoke.ts` passed. `timeout 180s npx tsx scripts/manual-phase1-run.ts` succeeded for live `r/machinelearning`, writing `25` content rows and `1` `subreddit_trend_point`; Postgres also shows one fresh `http/live` provider success. `reddit-api.service` and `reddit-phase1-scheduler.service` are active after restart. `/readyz` still reports degraded because old dead-letter jobs are present, not because the provider smoke failed.
- Next: Let the restarted scheduler complete the next interval under the new proxy env and check that scheduled target processing no longer returns Reddit `403`. Then either clear/replay the old dead-letter jobs or keep them as historical evidence, depending on whether Ops readiness should be green immediately.

### 2026-04-24 06:45:59

- Scope: Re-read the active project state for the requested VPN deployment, refreshed the user-provided subscription URL into `/root/.secrets/sing-box-subscription.url` with `600` permissions, and verified the prepared collector-only deployment files under `/root/sing-box-collector`. The intended path remains a local `sing-box` mixed proxy at `127.0.0.1:1080` for Reddit collection only, not host-wide TUN.
- Why now: The user asked to complete the VPN deployment with the current subscription. Before touching services, it was necessary to confirm whether this shell could reach the subscription endpoint, install `sing-box`, write `/etc/reddit-monitoring`, and talk to systemd.
- Verify: `/root/.secrets/sing-box-subscription.url` is present and root-only. `/root/sing-box-collector/deploy-on-host.sh`, `refresh-and-build.sh`, `build-config.mjs`, `sing-box-collector.service`, and `reddit-monitoring-proxy.env` are present with root-only permissions. Deployment cannot be completed inside this Codex sandbox: `refresh-and-build.sh` fails with `curl: (6) Could not resolve host`; direct `curl` to `1.1.1.1:443` cannot connect; `systemctl is-active ...` fails with `Failed to connect to bus: Operation not permitted`; writing `/etc/reddit-monitoring/*.env` backups fails with `Read-only file system`; and `sing-box` is not installed in this execution environment.
- Next: Use the existing host deployment script from a real root shell outside the sandbox: `/root/sing-box-collector/deploy-on-host.sh`. After it succeeds, confirm `ss -ltnp` shows `127.0.0.1:1080`, `curl --proxy http://127.0.0.1:1080 -I https://www.reddit.com/r/askreddit/about.json` returns a non-blocked response, then run the repository Linux provider smoke and one manual phase1 collection before enabling continuous scheduling.

### 2026-04-24 06:34:37

- Scope: Stored the user-provided VPN subscription URL outside the repo at `/root/.secrets/sing-box-subscription.url` with `600` permissions, created `/root/sing-box-collector` as the host-only collector proxy workspace, and added root-only helper files there: `refresh-and-build.sh`, `build-config.mjs`, `sing-box-collector.service`, and `reddit-monitoring-proxy.env`. No subscription URL or token was written into Git-tracked files.
- Why now: The user confirmed the route: Reddit collection needs VPN/TUN-like egress, while host administration should keep using the server's public IP. A collector-only local proxy preserves SSH/API/DB host routing and gives only the data acquisition layer a VPN exit.
- Verify: Directory and file permissions were set to root-only. A fetch attempt through `refresh-and-build.sh` currently fails at DNS resolution for the subscription domain (`curl: could not resolve host`), so node decoding/config validation is blocked until DNS/network resolution is available on the server.
- Next: Fix server DNS or run the refresh script in the real network environment, then install/copy the generated service to systemd, start the collector-only sing-box proxy, set `REDDIT_HTTP_PROXY=http://127.0.0.1:1080`, and verify Reddit provider smoke plus one manual collection run.

### 2026-04-24 06:30:47

- Scope: Added a dedicated collector egress path for Linux VPN/proxy recovery. `RedditHttpConnector` now supports `REDDIT_HTTP_PROXY` via a local curl-backed proxy runner while preserving the production `REDDIT_HTTP_TRANSPORT=fetch` contract, and `createRedditConnectorFromEnv` passes the proxy env into the HTTP connector. Documented the host-only sing-box mixed/SOCKS inbound pattern in env examples and the operations runbook so VPN subscription credentials stay out of Git.
- Why now: User verified that Reddit collection fails without VPN/TUN and offered the VPN subscription endpoint. The durable fix should not force SSH, API, Postgres, and all system traffic through an unstable full-machine TUN when only Reddit collection needs the alternate egress. A collector-scoped proxy gives the data plane the proven VPN path while reducing host instability.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/unit/reddit-http.connector.test.ts tests/unit/reddit-phase1-runtime.test.ts` passed. `npx tsx --test ...` was blocked in this sandbox by `listen EPERM` on `/tmp/tsx-0/*.pipe`, so the equivalent Node test runner entrypoint was used.
- Next: On Linux, configure sing-box with the user's subscription as a host-only secret and expose `127.0.0.1:1080` as a mixed inbound. Set `REDDIT_HTTP_PROXY=http://127.0.0.1:1080`, keep `REDDIT_LIVE_PROVIDER=http` and `REDDIT_HTTP_TRANSPORT=fetch`, then run `linux-provider-smoke` and `manual-phase1-run` before starting continuous scheduler operation.

### 2026-04-24 08:49:58

- Scope: Prepared the copied Linux project backup at `E:\vibe coding\backup\project linux\reddit-monitoring-mvp` for GitHub `main` as the rebuild handoff source. Kept the repo-root project contents as the upload boundary, preserved the latest Linux runtime recovery code/state, and added `.gitignore` coverage for `docs/tmp-sing-box-*.json` so temporary sing-box smoke configs containing proxy credentials do not enter Git.
- Why now: The original cloud server was reinstalled, so the next cloud-side Codex session needs one canonical GitHub source of truth plus current Obsidian state instead of a Windows backup directory with copied runtime artifacts.
- Verify: Reinstalled local Windows dependencies from the existing lockfiles, then ran `npx tsx --test tests/unit/reddit-provider-capability.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts`, `npm run typecheck`, and `npm --prefix apps/web run build`; all passed. Confirmed `docs/tmp-sing-box-socks-smoke.json` and `docs/tmp-sing-box-tun-smoke.json` contain proxy password material and are intentionally ignored rather than committed.
- Next: After pushing this backup commit to GitHub `main`, use that branch as the rebuilt-server deployment baseline. Restore host-only files under `/etc/reddit-monitoring` and `/etc/sing-box` from the operator's secure copy rather than from Git, then verify provider smoke, one manual collection run, API readiness, and trend freshness before enabling continuous scheduler operation.

### 2026-04-23 13:16:39

- Scope: Pushed verification one layer above networking and re-established a real Linux collection/read path. First proved that the repaired TUN works under the actual production env by running `scripts/linux-provider-smoke.ts` with `/etc/reddit-monitoring/scheduler.env`. Then verified a live write path with `scripts/manual-phase1-run.ts`, which now routes `r/machinelearning` directly to `http` instead of `scrapling` and completes successfully through the tunnel. After confirming that the previous `not_ready` state was caused only by the stale `REDDIT_LIVE_PROVIDER=scrapling` production env, updated `/etc/reddit-monitoring/api.env` and `/etc/reddit-monitoring/scheduler.env` to use `REDDIT_LIVE_PROVIDER=http`, restarted `reddit-api.service`, confirmed `/readyz` returns `ready`, confirmed `/v1/trends/subreddit/machinelearning` serves fresh data, and briefly started `reddit-phase1-scheduler.service` to verify the service now boots cleanly on Linux before stopping it again to avoid unintended background collection during this verification round.
- Why now: Once TUN and DNS were fixed, the remaining risk was no longer packet routing but whether the product-facing Linux runtime still had a hidden provider/config mismatch that would keep the system operationally blocked. It was necessary to verify the whole vertical slice above the tunnel: provider capability, one live cycle, database writes, materialized read data, API readiness, and scheduler bootstrap.
- Verify: `set -a && source /etc/reddit-monitoring/scheduler.env && set +a && timeout 45s npx tsx scripts/linux-provider-smoke.ts` -> passed for `provider=http`; `set -a && source /etc/reddit-monitoring/scheduler.env && set +a && timeout 120s npx tsx scripts/manual-phase1-run.ts` -> live run succeeded with `selectedProvider=http`; Postgres checks showed `monitor_target` contains active `r/machinelearning`, `raw_reddit_event` has rows, `content` has `50` posts, `subreddit_trend_point` has a fresh `6h` point, and `provider_health_window` now records a fresh `http/live` success row with `fallback_count=0`; `curl -H 'Authorization: Bearer ...' http://127.0.0.1:3000/readyz` -> `status: "ready"` with `defaultLiveProvider: "http"` and no degraded reasons; `curl -H 'Authorization: Bearer ...' http://127.0.0.1:3000/v1/trends/subreddit/machinelearning` -> `200` with fresh timeline and recent posts; `systemctl start reddit-phase1-scheduler` logged `scheduler.started` cleanly against the repaired baseline.
- Next: Keep the Linux network/provider baseline fixed as `sing-box TUN + http`. The next smallest slice is operational, not infrastructural: decide whether to enable the scheduler service for continuous collection, seed the full intended target set instead of the current single recovered subreddit, and verify repeated scheduled cycles plus freshness/read-model stability over at least one interval window.

### 2026-04-23 13:13:29

- Scope: Finished the Linux `sing-box` TUN DNS/routing repair so the host can run the Reddit provider smoke through the trojan tunnel instead of hanging on DNS. The key fix was to stop forwarding the synthetic TUN DNS target (`172.19.0.2:53`) as ordinary UDP and instead let sing-box classify and hijack DNS internally. Updated the temporary TUN smoke config at `docs/tmp-sing-box-tun-smoke.json` and the live host config at `/etc/sing-box/config.json` to add a remote DNS server (`1.1.1.1:853` via `proxy`), keep `default_domain_resolver=local`, and add route actions `sniff` plus `hijack-dns` ahead of the normal proxy final route. Also restarted `sing-box.service` after clearing the overlapping manual TUN process that had briefly kept `tun0` busy.
- Why now: The previous Linux blocker was no longer whether the Sakuracat node could reach Reddit, but whether host-wide TUN mode could resolve names and route traffic cleanly enough for the repo's real Linux smoke to run. Without closing that gap, the project would stay stuck between a proven SOCKS workaround and an unusable system tunnel.
- Verify: `sing-box check -c docs/tmp-sing-box-tun-smoke.json`; `timeout 35s sing-box run -c docs/tmp-sing-box-tun-smoke.json` showed DNS exchanges to `1.1.1.1:853` through `outbound/trojan[proxy]` instead of looping raw packets to `172.19.0.2:53`; `systemctl restart sing-box`; `journalctl -u sing-box -n 30 --no-pager` confirmed the service finally started `tun0`; `timeout 15s env REDDIT_HTTP_TRANSPORT=fetch REDDIT_LIVE_PROVIDER=http npx tsx scripts/linux-provider-smoke.ts` -> `{"event":"linux_provider_smoke.passed",...,"checks":["transport.fetch","provider.http","mode.runtime","provider_capability.runtime_ok"]}`.
- Next: Keep `sing-box.service` as the active Linux network path and move immediately into the next smallest live slice above networking: rerun the real provider/scheduler/data-collection path that used to fail on Linux while this tunnel is active, record the exact remaining runtime signature, and only then decide whether more provider/session tuning is needed.

### 2026-04-23 13:07:40

- Scope: Validated the user-provided Sakuracat subscription and proved that at least one current trojan node can bypass Reddit blocking on this server. Fetched the subscription, decoded 116 `trojan://` nodes, installed a temporary `sing-box` SOCKS smoke config at `docs/tmp-sing-box-socks-smoke.json`, and tested a current Hong Kong direct node (`175.29.22.246:48573`, TLS SNI `d.hkj1.cat.bilibili.com`). Through local SOCKS, `curl --socks5-hostname 127.0.0.1:1080` reached `api.ipify.org` and returned a changed exit IP, and the same proxy path reached `https://www.reddit.com/r/askreddit/about.json` with `HTTP/2 200` plus real subreddit JSON instead of the previous Reddit network-security block page. Also attempted to wire the same node into `/etc/sing-box/config.json` for host-wide TUN routing; TUN still starts, but system traffic currently stalls on DNS handling and makes host-level curls plus `scripts/linux-provider-smoke.ts` time out.
- Why now: After the earlier host work, the unresolved question was no longer whether Linux can create a TUN device, but whether the user’s low-cost VPN path can actually clear Reddit’s block from this exact server. It was important to separate `subscription works` from `Linux TUN integration works`, because those are different risks. A working SOCKS path is enough to prove the subscription is useful; a failing TUN path only means the current system-routing/DNS config still needs work.
- Verify: Subscription fetch returned base64 node list; decoded count `116` trojan nodes. Direct transport checks: `openssl s_client -connect 175.29.22.246:48573 -servername d.hkj1.cat.bilibili.com` and `openssl s_client -connect 45.67.201.210:20010 -servername hk.catxstar.com` both completed TLS handshake. SOCKS proof: `curl --socks5-hostname 127.0.0.1:1080 -4 https://api.ipify.org` -> `45.67.201.222`; `curl --socks5-hostname 127.0.0.1:1080 -I https://www.reddit.com/r/askreddit/about.json` -> `HTTP/2 200`; same path returned real AskReddit JSON. TUN proof remains partial: `sing-box run -c /etc/sing-box/config.json` still starts `tun0`, but host-wide `curl` and `bash -lc '... npx tsx scripts/linux-provider-smoke.ts'` time out instead of completing, and runtime logs show repeated DNS packets to `172.19.0.2:53` through the trojan outbound.
- Next: Keep the Sakuracat subscription. Do not discard the VPN idea. The next narrow slice is Linux routing/DNS only: either fix `sing-box` TUN DNS behavior so host-wide requests resolve and Reddit probe reaches `200`, or temporarily adapt the Reddit runtime to use the proven local SOCKS proxy path as a lower-risk bridge while TUN is unfinished. Do not re-enable schedulers until one of those two paths yields a successful live provider capability probe on Linux.

### 2026-04-23 12:49:58

- Scope: Verified that the rebuilt Linux server can support a TUN-based VPN path and prepared the host with a server-appropriate client implementation instead of a desktop GUI. Installed official `sing-box` `1.13.11` from the upstream package script, confirmed the packaged systemd service and config directory, and created a temporary smoke config at `docs/tmp-sing-box-tun-smoke.json` to validate `tun` startup without touching the production Reddit services. The smoke run successfully created `tun0`, which proves this host can run a TUN-mode client if we provide a real outbound node.
- Why now: User explicitly preferred the lower-cost VPN/TUN route over OAuth, Apify, or moving hosts. Before spending time on GUI clients like Nekoray or Qv2ray, the correct narrow slice was to prove whether the remote Linux server can even support a TUN-mode tunnel in a service-friendly way. If `/dev/net/tun`, capabilities, or runtime support had failed here, the VPN path would have been dead immediately.
- Verify: `test -c /dev/net/tun` -> present; `curl -fsSL https://sing-box.app/install.sh | sh` -> installed official `sing-box` `1.13.11`; `sing-box version`; `systemctl list-unit-files 'sing-box*'`; `sing-box check -c /root/reddit-monitoring-mvp/docs/tmp-sing-box-tun-smoke.json`; `timeout 8s sing-box run -c /root/reddit-monitoring-mvp/docs/tmp-sing-box-tun-smoke.json` -> logged `inbound/tun[tun-in]: started at tun0` and `sing-box started`; `ip link show tun0` during the smoke confirmed the interface was created. No real proxy routing test was possible yet because the host does not contain any reusable VLESS/VMess/Trojan subscription or node config.
- Next: Keep the VPN path only as an experiment until it proves it can clear Reddit blocking. The next required input is one real proxy node or subscription that works in your Windows TUN setup. Once provided, wire that outbound into `/etc/sing-box/config.json`, start `sing-box.service`, rerun `scripts/linux-provider-smoke.ts` through the tunnel, and compare the result against the current `network_policy_block`. Do not enable Reddit schedulers until that probe passes.

### 2026-04-23 12:48:31

- Scope: Added explicit Reddit network-policy block classification to the live provider capability path so rebuilt-host verification no longer treats host-level access denial as a generic provider failure. Updated `src/runtime/reddit-provider-capability.ts` to classify failure reasons and attach remediation hints, updated `scripts/linux-provider-smoke.ts` to surface `network_policy_block` directly in runtime output, and updated `workers/reddit-phase1-scheduler.ts` so a blocked unauthenticated `http` capability probe no longer performs a pointless same-host fallback probe to `scrapling`. Added focused regression coverage in `tests/unit/reddit-provider-capability.test.ts` and `tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts`.
- Why now: Direct Linux evidence on this rebuilt host is now stronger than the earlier generic `403` diagnosis. Raw `curl` requests to both `https://www.reddit.com/r/askreddit/about.json` and `https://old.reddit.com/r/askreddit/about.json` return Reddit block pages that explicitly say `You've been blocked by network security` / `whoa there, pardner!` and recommend logging in or using a developer token. Once that was proven, continuing to treat the failure as ordinary provider degradation or to keep probing `http -> scrapling` on the same host became low-value and misleading.
- Verify: `curl -I -A 'Mozilla/5.0 ... Chrome/135.0.0.0 ...' https://www.reddit.com/r/askreddit/about.json` -> `403`; `curl -s -A 'Mozilla/5.0 ... Chrome/135.0.0.0 ...' https://www.reddit.com/r/askreddit/about.json | sed -n '1,80p'` -> block page with `You've been blocked by network security`; `curl -s -A 'Mozilla/5.0 ... Chrome/135.0.0.0 ...' https://old.reddit.com/r/askreddit/about.json | sed -n '1,80p'` -> `whoa there, pardner!` / `blocked due to a network policy`; `npx tsx --test tests/unit/reddit-provider-capability.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts`; `npm run typecheck`; `bash -lc 'set -a && source /etc/reddit-monitoring/api.env && set +a && REDDIT_LIVE_PROVIDER=http REDDIT_HTTP_TRANSPORT=fetch npx tsx scripts/linux-provider-smoke.ts'` -> now fails as `network_policy_block` with remediation text instead of a generic provider error.
- Next: Do not enable schedulers yet. The next recovery slice must be access remediation, not more host prep: either supply Reddit OAuth/developer-token credentials to the live lane, configure a working Apify token/actor endpoint, or move traffic to a different egress IP and then rerun `linux-provider-smoke.ts` until `provider_capability.runtime_ok` passes.

### 2026-04-23 12:44:30

- Scope: Continued the rebuilt-host preparation far enough to remove Scrapling environment uncertainty and expose the true live provider boundary. Installed the missing Python/runtime layers uncovered during real Linux probing: `curl_cffi`, `playwright`, `msgspec`, `browserforge`, and `patchright`, then downloaded Playwright Chromium/FFmpeg/headless-shell and ran `playwright install-deps chromium` to pull in the required system libraries (`libnspr4`, `libnss3`, X/GTK/media dependencies, etc.). Re-ran live Scrapling capability probes after each step until the failure mode changed from missing modules and missing browser binaries to a real upstream response. The direct dynamic Scrapling probe now reaches Reddit and fails as `scrapling_bridge_error` with HTTP `403` instead of dying on host setup.
- Why now: After the previous host-bootstrap slice, the main unresolved question was whether Scrapling was actually blocked by Reddit or still blocked by this freshly rebuilt machine. That distinction matters before touching provider logic again. It is low value to keep modifying runtime heuristics while the host itself still cannot launch the Scrapling stack. The only correct next move was to clear the dependency chain until the Linux host could produce a real provider response.
- Verify: Installed/verified runtime pieces under `/opt/reddit-monitoring/venv`; `python -m playwright install chromium`; `python -m playwright install-deps chromium`; repeated Linux probes with `REDDIT_CB_ROUTE_TO_FALLBACK=false`. Progression of live failures on this host was: `scrapling_not_installed` -> missing `curl_cffi` -> missing `playwright` -> missing `msgspec` -> missing `browserforge` -> missing `patchright` -> missing Chromium binary -> missing `libnspr4.so` -> final real provider error `Scrapling request failed: code=scrapling_bridge_error, status=403, endpoint=/r/askreddit/about.json, message=unknown`. Direct dynamic probe and `node dist/scripts/linux-provider-smoke.js` now agree on the same live-blocked outcome.
- Next: Stop spending cycles on host dependency prep unless a new missing system dependency appears. The rebuilt machine is now prepared enough to prove the real blocker: provider access. The next narrow slice should target Reddit-facing mitigation only, such as Scrapling profile/session/header strategy, different probe target selection, or an alternate live provider path. Do not enable schedulers until one live capability probe passes.

### 2026-04-23 12:36:30

- Scope: Bootstrapped the rebuilt Linux host so development and deployment are no longer blocked by missing machine basics. Installed system prerequisites (`python-is-python3`, `python3-pip`, `python3-venv`, PostgreSQL 16, Nginx, build tools, rsync), enabled PostgreSQL and Nginx, created the `reddit-monitoring` system user, synced the repo to `/opt/reddit-monitoring`, installed production Node dependencies there with `npm ci --omit=dev`, created `/etc/reddit-monitoring/api.env` and `/etc/reddit-monitoring/scheduler.env`, created the `reddit_monitoring` PostgreSQL role and database, ran all SQL migrations successfully, installed the deployed Nginx and systemd units, and started the API successfully after correcting production cookie posture. Verified local and proxied health endpoints both return `200 OK`. Also created a Python venv for Scrapling and advanced the runtime dependency chain materially by installing `scrapling`, `curl_cffi`, `playwright`, `msgspec`, and `browserforge`.
- Why now: User clarified that the remote server had been rebuilt, so continuing to reason from the old deployment state would waste time. The actual blocker had shifted from repo code alone to missing host foundations: no PostgreSQL, no Nginx, no deployment paths, no env files, no Python alias/pip, no database, and no installed Scrapling runtime. Those had to be cleared before any Linux scheduler/provider evidence would be meaningful again.
- Verify: `systemctl --no-pager --type=service --state=running | rg 'postgres|nginx'`; `python --version`; `pip3 --version`; `psql --version`; `pg_isready`; synced code to `/opt/reddit-monitoring`; `node dist/src/storage/schema/run-migrations.js` under `/etc/reddit-monitoring/api.env` applied migrations `001` through `019`; `systemctl enable --now reddit-api`; `curl -i http://127.0.0.1:3000/healthz` -> `200`; `curl -i http://127.0.0.1/healthz` -> `200`; `curl -i http://127.0.0.1/readyz` -> `200 ready`. Current host-side provider truth after prep: `http` still fails real live capability with Reddit `403`; `scrapling` has moved past OS-level missing Python/pip but still fails the live probe on undeclared upstream runtime deps, most recently `No module named 'patchright'`.
- Next: Keep the next slice narrow and host-specific. Do not enable the schedulers yet. Either finish making Scrapling runnable on this host by resolving the remaining hidden Python runtime stack (currently blocked at `patchright` and likely browser/runtime expectations after that), or explicitly choose a different live-provider path for this rebuilt server. Only after one live provider can pass `node dist/scripts/linux-provider-smoke.js` should the schedulers be enabled and Linux collection evidence revisited.

### 2026-04-23 15:59:00

- Scope: Performed actual Linux-host verification on the current machine instead of stopping at repo-side inference, and then fixed a provider-capability probe blind spot exposed by that live run. Verified this shell is on Ubuntu (`Linux serwho43ee6k0ht`) but not on the currently deployed app host shape: there is no `/opt/reddit-monitoring`, no `/etc/reddit-monitoring`, no running API/scheduler service, and no deployment env files present. After rebuilding `dist`, ran real provider-capability probes from this Linux host and confirmed `http` still fails against `r/askreddit` with Reddit `403`. More importantly, direct probing showed the repo's capability path could mask a failing `scrapling` provider behind circuit-breaker fallback to `http`, which turned the raw Scrapling failure into another misleading `403`. Fixed that by adding `createRedditCapabilityProbeConnectorFromEnv()` in `src/runtime/reddit-phase1-runtime.ts`, using it from both `scripts/linux-provider-smoke.ts` and `workers/reddit-phase1-scheduler.ts`, and forcing capability probes to disable circuit-breaker fallback so they report the primary provider truth instead of a fallback result.
- Why now: User explicitly said we are already on Linux and should verify directly. That changed the highest-value next action from more local reasoning to host proof. The live run produced a stronger blocker diagnosis than the repo alone: on this host, `http` is still genuinely blocked by Reddit `403`, while `scrapling` is not currently usable because the Python module is missing. Until the probe path itself was made truthful, Linux logs could keep collapsing those into the same `403` symptom and mislead the scheduler fallback decision.
- Verify: `uname -a`; `hostname`; `ss -ltnp`; `ls -la /opt`; confirmed no `/opt/reddit-monitoring` or `/etc/reddit-monitoring` deployment paths on this machine. Repo/runtime verification passed: `npx tsx --test tests/unit/reddit-provider-capability.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts`; `npm run typecheck`; `npm run build:api`; `npm run validate:scope -- --json src/runtime/reddit-phase1-runtime.ts scripts/linux-provider-smoke.ts workers/reddit-phase1-scheduler.ts tests/unit/reddit-provider-capability.test.ts`. Live Linux probes after rebuild: `env REDDIT_HTTP_TRANSPORT=fetch REDDIT_LIVE_PROVIDER=http REDDIT_PROVIDER_CAPABILITY_REQUIRED=true REDDIT_PROVIDER_CAPABILITY_SUBREDDIT=AskReddit REDDIT_RUN_MODE=live node dist/scripts/linux-provider-smoke.js` -> failed with Reddit `403`; `env REDDIT_HTTP_TRANSPORT=fetch REDDIT_LIVE_PROVIDER=scrapling REDDIT_PROVIDER_CAPABILITY_REQUIRED=true REDDIT_PROVIDER_CAPABILITY_SUBREDDIT=AskReddit REDDIT_RUN_MODE=live REDDIT_SCRAPLING_PYTHON=python3 node dist/scripts/linux-provider-smoke.js` -> failed with `Scrapling request failed: code=scrapling_not_installed ... No module named 'scrapling'`. This is the current Linux truth.
- Next: Stop treating Scrapling fallback as host-ready. The next narrow runtime-recovery slice is host viability, not more routing heuristics: install/configure Scrapling on the real deployment host (or explicitly switch provider strategy), rerun the live capability probe until Scrapling itself passes without circuit-breaker fallback, then restart the scheduler and look for `scheduler.provider_capability.fallback_activated` plus actual live processing/materialization output. If the user points me at the real deployed host or deployment path, I can continue the host-side verification there directly.

### 2026-04-23 15:49:00

- Scope: Tightened the Linux fallback lane so scheduler-level `http -> scrapling` recovery cannot be silently undone by per-target provider routing during the same live cycle. Added `suppressHttpFallback` to `src/runtime/reddit-provider-routing-policy.ts`, wired it from env as `REDDIT_SUPPRESS_HTTP_FALLBACK`, and taught the routing policy to keep promoted targets on Scrapling instead of demoting them back to `http` when the only reason for fallback is degraded Scrapling transport or dynamic-profile exhaustion inside a cycle that already entered capability-triggered fallback. Updated `workers/reddit-phase1-scheduler.ts` so this guard is enabled automatically whenever `scheduler.provider_capability.fallback_activated` switches the live lane to Scrapling. Added regression coverage in `tests/unit/reddit-provider-routing-policy.test.ts` for both suppressed transport-degradation fallback and suppressed dynamic-exhausted fallback, while keeping the normal non-suppressed `http` demotion behavior intact outside that Linux-recovery path.
- Why now: After the previous scheduler fallback slice, the remaining repo-side hole was an intra-cycle routing contradiction: the scheduler could correctly activate Scrapling because `http` capability had already failed, but the target-level routing policy still had branches that could send promoted live targets straight back to `http` based on Scrapling health heuristics. On the Linux host that would recreate the proven `403 -> provider.circuit_open -> zero processed targets` path even though fallback activation itself looked successful in logs.
- Verify: `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts tests/integration/reddit-phase1-provider-routing.test.ts`; `npm run typecheck`; `npm run validate:scope -- --json src/runtime/reddit-provider-routing-policy.ts workers/reddit-phase1-scheduler.ts tests/unit/reddit-provider-routing-policy.test.ts`. All passed. Scope classifier result: `host verification deferred`.
- Next: Redeploy this batch to Linux, rerun `npm run db:migrate:compiled`, and verify that a live cycle now shows both `scheduler.provider_capability.fallback_activated` and real Scrapling-backed progress without an immediate route-back to `http`. If Linux still fails, record the exact remaining log signature in `Projects/test.md` and keep the next code slice constrained to that single live/runtime path.

### 2026-04-23 15:36:00

- Scope: Tightened the schema-migration execution path so Linux recovery is not blocked by migration transaction ambiguity while clearing historical `collection_job_status_check` drift. Updated `src/storage/schema/run-migrations.ts` to execute each SQL file directly instead of wrapping already-transactional migrations in an extra client transaction, and normalized `src/storage/schema/012_collection_job_payload.sql` plus `src/storage/schema/018_auth_core.sql` to use explicit `BEGIN/COMMIT` like the rest of the migration set. Added behavior-level coverage in `tests/unit/run-migrations.module.test.ts` to prove the runner now executes migration SQL before recording `schema_migration`, without reintroducing nested transaction handling.
- Why now: The active `next_action` explicitly named lingering historical `collection_job_status_check` drift as the next blocker if the Linux scheduler still failed after provider fallback. While checking that path, the repo still had a quieter failure mode in the migration runner itself: most migration files already self-managed transactions, so `run-migrations.ts` layering `withTransaction()` on top made host migration behavior less trustworthy exactly where we need deterministic cleanup on an existing Linux database.
- Verify: `npm run typecheck`; `npx tsx --test tests/unit/run-migrations.module.test.ts tests/unit/collection-job-status-migration.test.ts`; `npm run validate:scope -- --json src/storage/schema/run-migrations.ts src/storage/schema/012_collection_job_payload.sql src/storage/schema/018_auth_core.sql tests/unit/run-migrations.module.test.ts`. All passed. Scope classifier result: `host verification deferred`.
- Next: On Linux, rerun `npm run db:migrate:compiled` before restarting the scheduler/API batch, then verify both migration success and the previously requested live evidence: `scheduler.provider_capability.fallback_activated`, followed by non-empty live processing/materialization output. If the host still fails after that, capture the remaining log path in `Projects/test.md` and keep the next slice on that exact runtime lane.

### 2026-04-23 15:24:29

- Scope: Implemented the narrow Linux runtime recovery slice in `workers/reddit-phase1-scheduler.ts` so live scheduling no longer treats a failed `http` capability probe as a dead end when Scrapling is available. The scheduler now probes the configured live provider first, automatically probes `scrapling` when the configured provider is `http` and fails, switches the current live cycle to an effective `scrapling` provider when that fallback probe passes, and rewrites live runnable-job connector selection so queued/retry work does not keep hammering the broken `http` lane during the same cycle. Added focused regression coverage in `tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts` for both the fallback execution plan and the live runnable-job provider rewrite.
- Why now: The canonical Linux evidence in `Projects/第一次部署linux云服务器测试结果.md` shows the active blocker is not generic scheduler health but a specific live path: default `http` provider gets Reddit `403`, the circuit opens, and the cycle finishes with `processedCanonicalNames=[]` and `materializedTargets=0`. The smallest repo-side fix that can restore real collection is to recover that live lane onto Scrapling instead of continuing to burn the failed provider.
- Verify: `npx tsx --test tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts tests/integration/reddit-phase1-provider-routing.test.ts tests/unit/reddit-provider-capability.test.ts`; `npm run typecheck`; `npm run validate:scope -- --json workers/reddit-phase1-scheduler.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts`. All passed. Scope classifier result: `host verification deferred`.
- Next: Redeploy to Linux and verify the live host now logs `scheduler.provider_capability.fallback_activated` before collection, then confirm at least one target actually collects/materializes through Scrapling. If fallback activates but jobs still fail, clear the remaining `collection_job_status_check` historical drift on the host before widening scope.

### 2026-04-23 11:05:44

- Scope: Rewrote the active execution flow in `project.md` to stop the recent drift toward low-value local launch hardening and re-anchor the project on Linux runtime recovery. Updated the stage to `linux-runtime-recovery`, changed `Current Focus` and `Change Policy` to prioritize restoring data acquisition on the cloud host, added `Linux Truth Sources` plus `Flow Reinforcement`, and made the next action explicitly target the proven live `http` 403 -> `provider.circuit_open` failure path from `Projects/第一次部署linux云服务器测试结果.md`. Also recorded that repo-side launch work is now trailing/frozen unless it directly unblocks Linux recovery.
- Why now: The latest Linux evidence shows the real product blocker is no longer public-launch polish but the fact that the deployed system cannot collect fresh data. Keeping the old `public-launch-hardening` mainline active would continue to bias execution toward the wrong work.
- Verify: Re-read `Projects/project.md`, `Projects/test.md`, and `Projects/第一次部署linux云服务器测试结果.md`. Verified that Linux now proves: latest code is deployed, migration `019_collection_job_status_constraint_cleanup.sql` applied, Linux provider smoke passes, but the earlier raw server evidence still shows the true unresolved blocker path is live `http` collection failing with Reddit `403` followed by `provider.circuit_open`, leaving `processedCanonicalNames=[]` and `materializedTargets=0`.
- Next: Execute the next smallest runtime-recovery slice only: reproduce the failing live provider path from current Linux evidence, repair one minimal collector/runtime lane so at least one Linux live target can collect again, and re-verify that on the host before doing more launch hardening or broad architecture work.

### 2026-04-23 10:41:56

- Scope: Closed the remaining repo-side documentation acceptance gap for Phase E by adding an executable `Backup And Restore` section to `docs/deployment-runbook.md` and locking it with `tests/unit/public-launch-config.test.ts`. The runbook now covers the expected pre-deploy `pg_dump` backup step, release-pointer capture, restore into a separate database with `pg_restore`, and keeps rollback as a separate operational path. This satisfies the design-side `backup restore procedure documented` and `rollback procedure documented` acceptance items on the repo side.
- Why now: The code/test side of Phase E was already close to saturated, but the design acceptance still explicitly required backup/restore documentation. Leaving that gap open would make any claim of current-stage completion weak even if the runtime hardening itself was in place.
- Verify: `npx tsx --test tests/unit/public-launch-config.test.ts tests/unit/production-build-config.test.ts`; `npm run typecheck`; `npm run validate:scope -- --json docs/deployment-runbook.md tests/unit/public-launch-config.test.ts`. All passed. The classifier marks this batch as `host verification deferred`.
- Next: Stop local Phase E hardening here. The remaining acceptance item is host-only proof on the real deployment path, so the next meaningful action is a grouped Linux/public-host milestone rather than more repo-side work.

### 2026-04-23 10:39:21

- Scope: Fixed a real production-launch inconsistency in `apps/api/src/public-launch-config.ts`. The repo had started rejecting empty `API_CORS_ALLOW_ORIGINS` in production, but the deployment runbook explicitly allows same-origin deployments to leave CORS empty and rely on the Nginx `/api/` proxy path. The launch-config guard now keeps enforcing `API_SESSION_COOKIE_SECURE=true` plus exact-origin validation when origins are configured, while allowing the empty-origin same-origin deployment shape. Updated `tests/unit/public-launch-runtime-config.test.ts` to lock that behavior.
- Why now: This was a genuine deployment blocker, not just a documentation mismatch. Left unfixed, it would force a split-origin assumption into a codebase and runbook that still intentionally support same-origin production hosting.
- Verify: `npx tsx --test tests/unit/public-launch-runtime-config.test.ts tests/unit/public-launch-config.test.ts tests/unit/production-build-config.test.ts`; `npm run typecheck`; `npm run validate:scope -- --json apps/api/src/public-launch-config.ts tests/unit/public-launch-runtime-config.test.ts`. All passed. The classifier marks this slice as `repo-side complete`.
- Next: Avoid inventing more local launch-hardening work without evidence. The next meaningful step is either one last repo-side gap found from code/runtime evidence, or stopping here and saving effort for the next grouped Linux/public-host milestone.

### 2026-04-23 10:32:01

- Scope: Added the remaining repo-side exact-origin session/CORS regression coverage for representative product routes in `tests/integration/api-server-access.test.ts`. The new test logs in with a viewer session on an allowed browser origin, then verifies both `/v1/trends/market` and `POST /v1/keyword-queries` echo `Access-Control-Allow-Origin` with the exact origin and `Access-Control-Allow-Credentials: true` while still succeeding under session auth. This closes the product-route side of the launch-hardening CORS contract that was previously covered only for auth routes and launch smoke.
- Why now: `project.md` still pointed at any remaining exact-origin session assertions on product routes. After the previous slices, this was the narrowest remaining repo-side gap that could still hide a browser-launch regression without requiring another Linux/public-host cycle.
- Verify: `npx tsx --test tests/integration/api-server-access.test.ts tests/integration/api-server-auth.test.ts tests/integration/api-server-keyword-query.test.ts`; `npm run typecheck`; `npm run validate:scope -- --json tests/integration/api-server-access.test.ts`. All passed. The classifier marks this slice as `repo-side complete`.
- Next: Decide pragmatically whether there is another real repo-side launch gap left. If not, stop local launch hardening here and wait until the accumulated launch-boundary changes justify one intentional Linux/public-host milestone.

### 2026-04-22 22:27:26

- Scope: Added direct regression coverage for `smoke:public-launch` itself instead of relying only on adjacent API tests. `scripts/smoke-public-launch.ts` now exposes `runPublicLaunchSmoke()` while preserving the CLI entrypoint, and `tests/integration/smoke-public-launch.test.ts` spins up a local public-shape proxy (`/api/*` rewrite plus public `/readyz` denial) to prove the full smoke contract end to end, including the authenticated cookie/CORS assertions added in the previous slice. Also promoted this regression into the default local launch gate by adding it to `npm run verify:launch:local` and updating `tests/unit/production-build-config.test.ts`.
- Why now: The previous slice strengthened launch smoke behavior, but the repo still lacked a test that directly exercised the smoke script itself. That left a gap where the script could drift from the API assumptions and only be discovered when someone ran it manually against a host.
- Verify: `npx tsx --test tests/integration/smoke-public-launch.test.ts tests/unit/production-build-config.test.ts`; `npm run typecheck`; `npm run verify:launch:local`; `npm run validate:scope -- --json scripts/smoke-public-launch.ts tests/integration/smoke-public-launch.test.ts package.json tests/unit/production-build-config.test.ts`. All passed. The classifier marks this batch as `host verification deferred`.
- Next: Keep repo-side launch work narrow. The next useful local slice is any remaining exact-origin session assertions on product routes; otherwise stop here and wait until the accumulated launch-boundary changes justify one intentional Linux/public-host milestone.

### 2026-04-22 22:14:03

- Scope: Hardened `scripts/smoke-public-launch.ts` so the public-domain smoke now proves authenticated cookie/CORS behavior instead of only basic login success. When launch credentials are provided, the smoke now asserts `HttpOnly` + `Secure` + `SameSite=Lax` on login, verifies credentialed CORS headers on login, `/api/auth/me`, and logout when `PUBLIC_ALLOWED_ORIGIN` is set, and confirms logout clears the session cookie with `Max-Age=0`. Added matching integration coverage in `tests/integration/api-server-auth.test.ts` and updated `docs/deployment-runbook.md` plus `tests/unit/public-launch-config.test.ts`.
- Why now: The earlier server evidence showed that launch smoke was still too weak: it could say the public path looked good without proving the exact authenticated browser session contract that the product shell depends on. This slice closes that blind spot without paying another Linux round-trip.
- Verify: `npx tsx --test tests/integration/api-server-auth.test.ts tests/integration/api-server-access.test.ts tests/unit/public-launch-config.test.ts tests/unit/production-build-config.test.ts`; `npm run typecheck`; `npm run verify:launch:local`; `npm run validate:scope -- --json scripts/smoke-public-launch.ts tests/integration/api-server-auth.test.ts tests/unit/public-launch-config.test.ts docs/deployment-runbook.md`. All passed. The classifier marks this batch as `host verification deferred`.
- Next: Keep batching launch-boundary work locally first. The next useful repo-side slice is direct regression coverage for `smoke:public-launch` itself or any remaining exact-origin session assertions on product routes, then roll the accumulated launch changes into one intentional Linux/public-host milestone.

### 2026-04-22 22:02:02

- Scope: Added a production launch-config fail-fast guard for the API entrypoint so launch-critical settings are enforced by code instead of only by example env files and runbook text. Added `apps/api/src/public-launch-config.ts`, wired it into `apps/api/src/server.ts`, and added focused coverage in `tests/unit/public-launch-runtime-config.test.ts`. In `NODE_ENV=production`, API startup now rejects empty `API_CORS_ALLOW_ORIGINS`, wildcard origins, non-origin values like `https://example.com/app`, and `API_SESSION_COOKIE_SECURE=false`.
- Why now: The repo had already documented strict public launch posture, but the executable runtime still accepted misconfigured production startup. That leaves a class of launch failures to be found only after deploy. This slice moves those mistakes into local/CI failure instead of Linux debugging.
- Verify: `npx tsx --test tests/unit/public-launch-runtime-config.test.ts tests/unit/public-launch-config.test.ts tests/unit/production-build-config.test.ts`; `npm run typecheck`; `npm run verify:repo`; `npm run validate:scope -- --json apps/api/src/server.ts apps/api/src/public-launch-config.ts tests/unit/public-launch-runtime-config.test.ts`. All passed. The classifier marks this slice as `repo-side complete`.
- Next: Keep tightening launch safety on repo-verifiable boundaries first. The next useful slice is to strengthen `smoke:public-launch` so authenticated public-domain checks assert exact cookie/CORS behavior, then batch any remaining deploy/runtime changes before the next Linux milestone.

### 2026-04-22 23:02:12

- Scope: Optimized the development validation flow so Linux testing is no longer the default follow-up after every deployment-adjacent change. Added `src/shared/validation-scope.ts` plus `scripts/classify-validation-scope.ts`, which classify the current diff as `repo-side complete`, `host verification deferred`, or `host verification required now` based on touched boundaries like deploy files, migrations, public readiness/auth/cookie/CORS, and provider/Linux runtime code. Added `npm run verify:repo`, `npm run verify:launch:local`, and `npm run validate:scope`, and updated `docs/deployment-runbook.md` to make staged validation explicit instead of implicitly pushing every risky slice to immediate Linux proof.
- Why now: The current workflow was spending too much cycle time on low-yield Linux retests. The server findings prove Linux host validation still matters, but not after every small slice. What was missing was an objective repo-side rule for when host proof is deferred versus actually required now.
- Verify: `npm run typecheck`; `npx tsx --test tests/unit/validation-scope.test.ts tests/unit/production-build-config.test.ts`; `npm run verify:launch:local`. All passed. The new classifier correctly keeps pure web/test work at `repo-side complete`, marks deploy/runtime slices as `host verification deferred` by default, and escalates them to `host verification required now` only when explicitly run in milestone mode.
- Next: Use the new classifier on each slice and accumulate launch-boundary changes into batches. The next Linux run should happen only when `npm run validate:scope -- --milestone` is intentionally chosen for a grouped deployment batch, not as the automatic tail of every control-plane or readiness tweak.

### 2026-04-22 22:32:41

- Scope: Tightened API readiness semantics so production `/readyz` no longer treats missing live-provider proof as acceptable when launch config explicitly requires capability validation. `apps/api/src/create-api-server.ts` now passes an explicit provider-capability readiness requirement only when `REDDIT_PROVIDER_CAPABILITY_REQUIRED` is set in the API environment, and `apps/api/src/readyz-observability.ts` now returns `not_ready` with `provider_capability_unproven:<provider>` when active targets exist but the required live provider set still has no current proof in persisted live provider-health evidence. Also updated `deploy/env/api.env.example` and `docs/deployment-runbook.md` so production API config keeps this gate enabled by default.
- Why now: The raw Linux server evidence showed a real launch-safety bug even after the earlier P0 slice: `/readyz` could still report `ready` while provider viability had not yet been demonstrated. That leaves deployment automation and Ops with a false-positive readiness signal.
- Verify: `npm run typecheck`; `npx tsx --test tests/integration/api-server-readyz.test.ts tests/unit/public-launch-config.test.ts tests/unit/production-build-config.test.ts`; `npm run build`; `npm run smoke:compiled`. All passed. New readiness coverage proves two edges: with `REDDIT_PROVIDER_CAPABILITY_REQUIRED=true`, `/readyz` now returns `503/not_ready` plus `provider_capability_unproven:http` when no live provider evidence exists, and it returns `200/ready` again once live provider-health evidence is present.
- Next: Use this stricter contract on the Linux host. The first post-deploy check should now expect `/readyz` to stay blocked until either the live provider probe plus first live evidence complete or the provider lane is fixed. If Linux still fails after the probe/scheduler sequence, the next code slice should move into actual provider-lane remediation on the failing path rather than more readiness/control-plane work.

### 2026-04-22 22:12:54

- Scope: Completed the repo-side P0 control-plane hardening slice driven by the raw Linux server evidence. Added `auth:bootstrap-owner` / `auth:bootstrap-owner:compiled` with a real first-owner bootstrap path for an empty auth DB, added `src/storage/schema/019_collection_job_status_constraint_cleanup.sql` to remove legacy `collection_job_status_check`, moved `log_format` out of the Nginx `server` block so the template is valid in normal Nginx include layouts, and upgraded provider safety by introducing a real provider-capability probe shared by `scripts/linux-provider-smoke.ts` and `workers/reddit-phase1-scheduler.ts`. The scheduler now blocks live cycles when the configured provider cannot pass the probe, and the Linux scheduler example now defaults to `PHASE1_SCHEDULER_RUN_ON_START=false` plus `REDDIT_PROVIDER_CAPABILITY_REQUIRED=true`.
- Why now: The direct server log proved the failures were not theoretical: first deployment required manual SQL for owner creation, historical DBs could still trip `collection_job_status_check`, Nginx template placement was invalid for Ubuntu-style site includes, and a config-only green smoke allowed the live scheduler to boot straight into `http -> 403 -> circuit_open`.
- Verify: `npm run typecheck`; `npx tsx --test tests/unit/reddit-provider-capability.test.ts tests/unit/bootstrap-first-owner.use-case.test.ts tests/unit/collection-job-status-migration.test.ts tests/unit/production-build-config.test.ts tests/unit/public-launch-config.test.ts tests/unit/reddit-phase1-runtime.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts`; `npm run build`; `npm run smoke:compiled`. All passed. `smoke:compiled` now verifies `dist/scripts/bootstrap-first-owner.js` in addition to the existing compiled runtime entrypoints. The web build still reports the unchanged `TargetDetail` lazy chunk warning at `519.72 kB`; no regression was introduced by this slice.
- Next: Redeploy on the Linux host and prove the operational path end-to-end: migrate, bootstrap the first owner without manual SQL, run the live provider smoke without `--config-only`, and only then re-enable scheduler boot start. If the live probe still fails on Linux, the next code slice should be provider-lane remediation on the actual failing provider path rather than more control-plane work.

### 2026-04-22 21:17:02

- Scope: Read the cloud-server raw result artifact at `C:/Users/21274/Desktop/测试.md` and compared it against the repo-side assumptions that were previously inferred from partial deployment notes. Focused on whether the raw server output confirms or falsifies the current blocker diagnosis.
- Why now: User provided the direct server run output and asked to treat it as the source of truth. This is stronger evidence than a summarized findings note and is the right basis for deciding whether the current plan is still aligned with reality.
- Verify: Confirmed from the raw log that `/readyz` returned `status: "ready"` with all provider observability fields still null and `degradedReasons: []` before the collector proved viability; `smoke:public-launch` passed only `healthz.public_ok` and `readyz.not_public`; the first owner was created by direct SQL inserts into `app_user` and `app_user_password`; the scheduler started in `live` mode with `runOnBoot: true`; routing selected `http` for all targets; then live collection failed with repeated Reddit `403` HTML responses, followed by `[provider.circuit_open] live provider circuit is open`, and repeated `collection_job_status_check` constraint violations. `reddit-keyword-refresh` stayed at `processed: 0` without error throughout.
- Next: Keep the architecture direction, but tighten implementation priority: fix launch smoke blindness and provider preflight before touching scale/analytics work. The next correct code slice is still P0 control-plane correctness plus real provider capability gating, because the raw server evidence shows those are not theoretical gaps.

### 2026-04-22 21:18:42

- Scope: Re-evaluated whether the current backend recovery plan is enough to actually finish the project for the user's stated goal: redeploy on Linux, crawl at larger scale, and support much richer analytics/chart modules. Re-checked the current frontend target chart, API contracts, and backend plan, then expanded `docs/backend-rebuild-plan-2026-04-22.md` with an explicit answer and two missing workstreams: Linux scale-envelope/soak verification and a dedicated analytics-module platform for TradingView-like multi-timeframe, overlay, comparison, and reliability views.
- Why now: User clarified that success is not just "fix current faults", but "finish the project" so it can relaunch on Linux, crawl reliably at larger scale, and provide deeper analytical tooling rather than the current simple trend chart.
- Verify: Re-read `docs/backend-rebuild-plan-2026-04-22.md`, `apps/web/src/pages/TargetDetail.tsx`, `packages/contracts/src/http.ts`, and the current trend/chart-related API tests. Verified that the current target page is still a single ECharts line chart over `heatPrice/ema7/ema30`, while current contracts are richer than the UI but still not yet organized as a TradingView-like analytics module system.
- Next: Keep the execution order strict. First close P0 launch blockers, then implement provider capability gating plus Scrapling sidecar and Linux soak verification, and only after that move into chart DTO v2 plus analytics-module endpoints so frontend chart work becomes a rendering/integration task instead of backend guesswork.

### 2026-04-22 21:06:16

- Scope: Re-verified the deployment findings in `C:/Users/21274/Downloads/部署项目到服务器.md` against the current repo instead of relying on prior planning conclusions. Checked the Nginx template, auth/bootstrap path, schema migrations, scheduler defaults, Linux smoke script, and the existing tests that look related to those failures.
- Why now: User explicitly asked for a second verification pass on the problems seen during server testing. The goal was to separate "still true in the repo", "repo test blind spot", and "Linux-runtime-only evidence".
- Verify: Confirmed the repo still has `log_format` inside `deploy/nginx/reddit-monitoring.conf`, still has no owner bootstrap CLI in `package.json`, still requires `inviteCode` for `/auth/register` in `apps/api/src/create-api-server.ts`, still has no auth seed in `src/storage/schema/018_auth_core.sql`, still defaults Linux examples to `REDDIT_LIVE_PROVIDER=http` and `PHASE1_SCHEDULER_RUN_ON_START=true` in `deploy/env/scheduler.env.example`, and still starts the scheduler after only a config-level Linux smoke in `docs/deployment-runbook.md`. Re-checked `src/storage/schema/004_collection_job_reliability.sql`: it does contain generic status-constraint cleanup, but the repo still lacks a dedicated forward drift-fix migration and test for historical databases that already ended up with both `ck_collection_job_status` and `collection_job_status_check`. Also ran `npx tsx --test tests/unit/public-launch-config.test.ts tests/integration/collection-job-retry.test.ts` and `npx tsx scripts/linux-provider-smoke.ts --config-only`; they passed, which confirms the current tests do not cover the Ubuntu Nginx syntax bug, the historical DB constraint drift case, or real provider reachability.
- Next: Implement the repo-side fixes in this order: Nginx template correctness, first-owner bootstrap, legacy `collection_job_status_check` cleanup migration plus drift test, then provider-capability gating so Linux live scheduling cannot start from a config-only green state.

### 2026-04-22 20:58:43

- Scope: Read the server test summary from `C:/Users/21274/Downloads/部署项目到服务器.md`, rechecked the active backend architecture and runtime code, and produced a repo-grounded backend recovery plan at `docs/backend-rebuild-plan-2026-04-22.md`. The plan keeps the modular monolith, identifies the real backend blockers (bootstrap, provider viability, queue/schema drift, chart-thin read models), and explicitly moves the collector direction to a Scrapling-first acquisition lane without rewriting the entire backend around Scrapling's project structure.
- Why now: User reported that the deployed system exposed broader backend issues than launch hardening alone and asked for a backend plan using architecture, algorithm, and crawling-logic lenses. The follow-up direction was to consider the official Scrapling project as the likely solution path if quality is good.
- Verify: Re-read `docs/architecture.md`, `docs/scrapling-integration-flow.md`, `src/runtime/reddit-phase1-runtime.ts`, `src/runtime/reddit-fetch-execution-engine.ts`, `src/runtime/reddit-provider-routing-policy.ts`, `src/workers/reddit-phase1.worker.ts`, `src/domain/services/trend-scoring.service.ts`, `src/application/services/subreddit-trend-read-model.ts`, `src/jobs/build-subreddit-keyword-trend-daily.job.ts`, `src/storage/schema/001_reddit_mvp_init.sql`, `src/storage/schema/004_collection_job_reliability.sql`, and `src/storage/repositories/postgres/postgres-collection-job.repository.ts`, alongside the external server findings document. No code behavior claims in the plan are based on guesswork; the plan is tied to the current repo and deployment findings.
- Next: Execute the first backend slice only: P0 control-plane correctness (`owner bootstrap`, `collection_job` legacy-constraint cleanup, deploy/runtime template drift), then move immediately into provider capability gating and the Scrapling-first collector refactor before reopening trend/chart API work.

### 2026-04-21 17:38:36

- Scope: Completed the remaining repo-side Phase E public launch hardening slice without reopening UI scope. Added a compiled `smoke:public-launch` script for target-domain verification, hardened the Nginx template with explicit access/error logging plus request-id forwarding into the API, and updated the deployment runbook so public launch validation, `/readyz` exposure expectations, and current audit/access-log posture are executable and explicit.
- Why now: User asked to complete `Phase E: public launch hardening`. The remaining gap in `project.md` was deployment-side validation and rollout guidance, not more frontend work. The smallest complete slice was to make target-host validation and launch logging first-class in code/config/docs.
- Verify: `npm run typecheck`; `npm run build`; `npm run smoke:web`; `npx tsx --test tests/integration/api-server-auth.test.ts tests/integration/api-server-access.test.ts tests/unit/production-build-config.test.ts tests/unit/public-launch-config.test.ts`; `npm run smoke:compiled`. All passed. `smoke:compiled` now verifies `dist/scripts/smoke-public-launch.js` plus the `smoke:public-launch` package script. Browser smoke remained green with `{ "ok": true, "checked": ["owner session persistence", "queries", "target chart svg", "ops readiness", "ops trigger", "logout redirect", "viewer ops guard", "mobile responsive review"], "finalUrl": "http://127.0.0.1:5173/ops" }`. The build still shows the unchanged lazy `TargetDetail` chunk warning at `519.72 kB`.
- Next: Run `PUBLIC_BASE_URL=https://<real-domain> npm run smoke:public-launch` on or against the real host with launch credentials/origin values if available, then inspect `/var/log/nginx/reddit-monitoring.access.log`, `/var/log/nginx/reddit-monitoring.readyz.access.log`, and correlated API request logs before marking the deployment live-ready. Do not claim DB-backed audit persistence yet; `app_audit_log` is still schema-only.

### 2026-04-21 17:33:59

- Scope: Re-read the active Obsidian state source, confirmed that Phase D frontend shell work was already present in code, and re-validated the current worktree against the product-shell acceptance chain without widening scope. No new UI/API feature work was needed; the stage is complete in the checked tree.
- Why now: User explicitly asked to read `obsidian-reddit专用/Projects/project.md` and complete the frontend shell stage. The only safe way to close that request without duplicate implementation was to verify the stage against the current repo and acceptance criteria.
- Verify: `npm run typecheck`; `npm run lint:web`; `npm run build`; `npm run smoke:web`; `npx tsx --test tests/integration/api-server-auth.test.ts tests/integration/api-server-access.test.ts`. Smoke stayed green with `{ "ok": true, "checked": ["owner session persistence", "queries", "target chart svg", "ops readiness", "ops trigger", "logout redirect", "viewer ops guard", "mobile responsive review"], "finalUrl": "http://127.0.0.1:5173/ops" }`. Integration coverage remained green (`16/16`). Build still reports the existing lazy `TargetDetail` chunk warning at `519.72 kB`, with no regression.
- Next: Keep the frontend product shell frozen and continue only Phase E launch hardening on the target deployment: exact public origin/Cookie Secure wiring, `/readyz` exposure policy, and rollout logging notes.

### 2026-04-21 17:29:05

- Scope: Audited the active product-shell docs for state drift and updated the canonical frontend/product-shell documents so they no longer claim `apps/web` is missing or that the repo is still pre-Phase-D. Completed the current frontend hardening slice by tightening API launch posture in code and config: production server bootstrap now defaults CORS to explicit origins instead of `*`, production session cookies now honor `API_SESSION_COOKIE_SECURE` (defaulting to `true` under `NODE_ENV=production`), and query-route throttling now resolves session actors before consuming rate-limit buckets so browser users are limited per user rather than per shared IP. Added regression coverage for secure session cookies and session-user rate limiting.
- Why now: User asked to inspect docs, repair drift, and finish frontend product hardening. The active `next_action` in `project.md` specifically called for exact production CORS/cookie settings, session-aware rate limiting, and readiness exposure validation without reopening completed UI work.
- Verify: `npm run typecheck`; `npm run build`; `npm run lint:web`; `npm run smoke:web`; `npx tsx --test tests/integration/api-server-auth.test.ts tests/integration/api-server-access.test.ts`. Browser smoke remained green with `{ "ok": true, "checked": ["owner session persistence", "queries", "target chart svg", "ops readiness", "ops trigger", "logout redirect", "viewer ops guard", "mobile responsive review"], "finalUrl": "http://127.0.0.1:5173/ops" }`. New API regression coverage now proves `Secure` session cookies under hardened config and session-user-specific throttling. Build still shows the isolated lazy `TargetDetail` chunk warning at `519.72 kB`.
- Next: Keep the frontend product shell frozen and finish only deployment-side launch checks: validate the exact public origin and cookie settings on the target domain/host, confirm `/readyz` stays non-public outside localhost/authenticated Ops, and add any final rollout notes for access/audit logging if the host setup needs them.

### 2026-04-21 16:59:57

- Scope: Completed the remaining frontend product-shell acceptance work in `apps/web`. Added responsive/mobile-safe layout behavior across the shared shell, dashboard, queries, target detail, ops, and login. Added a guarded Phase 1 run trigger to the Ops page with typed request/response handling and queued-run feedback. Hardened frontend auth behavior so API `401` responses clear session state and redirect protected routes back to login. Expanded `npm run smoke:web` to verify owner session persistence, keyword queries, target chart SVG rendering, Ops readiness, Ops run trigger, logout redirect, viewer Ops guard, and mobile responsive overflow checks across the product-shell routes. Updated the deployment runbook to match the stronger smoke contract.
- Why now: `project.md` still listed mobile/responsive review as the final frontend-product-shell gap, and the Phase D design acceptance also required a verified Ops guard plus admin/owner run-trigger path before the shell could be considered complete.
- Verify: `npm run typecheck`; `npm run lint:web`; `npm run build`; `npm run smoke:web`; `npx tsx --test tests/integration/api-server-auth.test.ts tests/unit/production-build-config.test.ts`. Browser smoke result: `{ "ok": true, "checked": ["owner session persistence", "queries", "target chart svg", "ops readiness", "ops trigger", "logout redirect", "viewer ops guard", "mobile responsive review"], "finalUrl": "http://127.0.0.1:5173/ops" }`. Build still reports the isolated lazy `TargetDetail` chunk warning at `519.72 kB`; keep it visible for now.
- Next: Move to Phase E public launch hardening. Keep the completed product shell stable while tightening exact production cookie/CORS behavior, session-aware rate limiting, and external readiness exposure policy.

### 2026-04-20 16:45:50

- Scope: Added a durable `npm run smoke:web` browser/API smoke using Playwright, an in-memory seeded API server, and Vite. The smoke verifies login, dashboard, `/queries`, keyword-query creation, matching post navigation to target detail, target chart SVG rendering, and protected Ops readiness. Added the smoke command to the deployment runbook and production-build config test. Replaced `echarts-for-react` in `TargetDetail` with direct ECharts core imports plus SVGRenderer and removed unused `echarts-for-react`/`tslib` frontend dependencies.
- Why now: The active next action required a real browser/API smoke for the new `/queries` flow and a decision on deeper ECharts chunk cleanup after route-level lazy loading.
- Verify: `npm run typecheck`; `npm run lint:web`; `npm run build`; `npm run smoke:web`; `npx tsx --test tests/unit/production-build-config.test.ts`. Browser smoke result: `{ "ok": true, "checked": ["login", "dashboard", "queries", "target chart svg", "ops readiness"], "finalUrl": "http://127.0.0.1:5173/ops" }`. Build now reports main entry `221.62 kB`, `Queries` chunk `5.25 kB`, and lazy `TargetDetail` chunk `519.90 kB` instead of `1,134.09 kB`.
- Next: Run mobile/responsive browser review for the product-shell routes. The remaining Vite chunk warning is now marginal and isolated to the lazy target chart route; do not hide it by only raising the warning threshold.

### 2026-04-20 16:14:49

- Scope: Added the missing frontend `/queries` route in `apps/web` with a keyword-query form, typed `POST /v1/keyword-queries` API call, result summary, matching post list, subreddit target links, and responsive two-column layout. Added the `Queries` navigation entry, fixed Login label `htmlFor`/`id` accessibility, and lazy-loaded `TargetDetail` plus `Queries` so ECharts no longer ships in the first-load app entry.
- Why now: `project.md` listed the missing Queries route, Login accessibility cleanup, and ECharts first-load chunk cleanup as the next frontend product-shell slice after the browser smoke.
- Verify: `npm run lint:web`; `npm run typecheck`; `npm run build`; `npx tsx --test tests/integration/api-server-keyword-query.test.ts`. Build output now splits `apps/web` into a `221.62 kB` main entry, a `5.25 kB` `Queries` chunk, and a lazy `1,134.09 kB` `TargetDetail` chunk. Vite still warns because the lazy ECharts chunk is larger than 500 kB.
- Next: Run browser/API smoke for login -> dashboard -> queries -> target/ops with seeded API data, then decide whether to replace `echarts-for-react` usage with ECharts core imports to reduce the lazy `TargetDetail` chunk further.

### 2026-04-20 14:35:00

- Scope: Moved the active algorithm-development plan out of `project.md` into `Projects/Archive/algorithm-development-p1.7-2026-04-20.md`, refocused the project state on frontend product-shell development, and made `apps/web` part of the root production build path through `build:web`, `lint:web`, and the root `build` script. Updated the production-build config test and deployment runbook so web install/lint/build and `apps/web/dist` are explicit release steps. Ran a real browser/API smoke through Vite proxy with a temporary in-memory API seed for login, dashboard rankings, target chart SVG rendering, and Ops readiness. The smoke exposed that `/v1/ops/readyz` did not resolve session auth when bearer auth was not configured; fixed that backend path and added regression coverage.
- Why now: User asked to advance development with the current focus on frontend, and the frontend status analysis identified build/deploy integration as the next release-readiness gap after the initial shell landed.
- Verify: `npm run lint:web`; `npx tsx --test tests/integration/api-server-auth.test.ts tests/unit/production-build-config.test.ts`; `npm run typecheck`; `npm run build`; `npm test` (`225/225`). Browser smoke result: `{ ok: true, checked: ["login", "dashboard", "target chart svg", "ops readiness"], finalUrl: "http://127.0.0.1:5173/ops" }`. Root `npm run build` now runs both API compilation and `apps/web` production build. Vite still warns that the ECharts bundle chunk is `1,415.21 kB` minified.
- Next: Add the missing `queries` route from the product-shell design, then clean up frontend accessibility discovered during smoke (Login labels need `htmlFor`/`id`) and reduce the ECharts first-load chunk with route-level lazy loading.

### 2026-04-20 13:50:00

- Scope: Fixed the three Phase D review findings. `/v1/ops/readyz` now keeps the detailed readiness payload visible to authenticated owner/admin sessions by returning HTTP 200 even when the readiness status is `not_ready`, while public `/readyz` keeps the existing 503 health-check semantics. Added regression coverage for unauthenticated, viewer, bearer-token, admin, owner, and public `/readyz` behavior. Updated the deployment runbook so public `/readyz` is no longer listed as an external health check after Nginx restriction.
- Why now: User asked to fix the current review findings before continuing frontend development.
- Verify: `npx tsx --test tests/integration/api-server-auth.test.ts tests/integration/api-server-readyz.test.ts`; `npm run lint` in `apps/web`; `npm run build` in `apps/web`; root `npm run typecheck`; root `npm run build`; root `npm test` (`224/224`).
- Next: Run an end-to-end browser/API smoke through the Vite proxy or deployed Nginx shape, then continue Phase D UI work only after login, dashboard, target chart, and Ops readiness are verified live.

### 2026-04-20 13:35:00

- Scope: Reviewed Antigravity's second Phase D frontend/backend pass without changing app source. Rechecked the previous review blockers, the new `/v1/ops/readyz` backend path, Nginx `/api/` rewrite, and the ECharts `TargetDetail` route.
- Why now: User asked to continue inspection after Antigravity's second work round.
- Verify: `npm run lint` and `npm run build` in `apps/web` passed; root `npm run typecheck` and root `npm run build` passed; `npx tsx --test tests/integration/api-server-auth.test.ts tests/integration/api-server-access.test.ts tests/integration/api-server-readyz.test.ts` passed (`34/34`). `rg` found no test coverage for `/v1/ops/readyz`. Vite build warned the new JS chunk is `1,415.21 kB` minified after adding ECharts.
- Next: Add focused integration tests for `/v1/ops/readyz` owner/admin/viewer/bearer behavior, then adjust Ops/API handling so not-ready readiness payloads are still visible instead of collapsing into a generic fetch error.

### 2026-04-20 13:20:00

- Scope: Added ECharts-based trend visualization to the frontend shell. Implemented `TargetDetail.tsx` to render the 30-day target heat trend line chart using `echarts-for-react`. Linked the canonical names in the `Dashboard` heat/surge rankings directly to their respective `/target/:targetId` detail views. Resolved `tslib` peer dependency for `echarts-for-react`.
- Why now: Visualizing time-series trend data points was the next prioritized step for the `apps/web` product dashboard.
- Verify: Ran `npm run build` in `apps/web` which compiled successfully after installing `tslib`. The routing tree compiles and the application is structurally sound.
- Next: Test ECharts and frontend shell end-to-end by running backend API and Vite proxy server, then continue Phase D UI enhancements (e.g., adding Keyword pulse trends).

### 2026-04-20 13:16:00

- Scope: Fixed frontend shell review blockers before adding ECharts. Resolved ESLint errors in `AuthContext.tsx` (react-refresh export rules), `Login.tsx` (TypeScript any typing), and `components/ui/index.tsx` (unused className). Updated the Nginx configuration (`deploy/nginx/reddit-monitoring.conf`) to strip the `/api/` prefix to match the Vite proxy behavior. Protected the readiness endpoint by exposing `/v1/ops/readyz` in the backend with `admin`/`owner` capability checks, updating the `Ops` page to use it, and restricting direct external access to `/readyz` via Nginx `allow 127.0.0.1; deny all;`.
- Why now: Addressed review blockers flagged during the inspection of the Phase D frontend shell base framework to ensure code quality and secure access.
- Verify: Ran `npm run lint` and `npm run build` in `apps/web`; both passed cleanly. Ran `npm run typecheck` in the root repository; passed cleanly.
- Next: Continue Phase D: Add ECharts for trend data visualization in the dashboard, and refine Ops and Dashboard UI.

### 2026-04-20 13:10:00

- Scope: Reviewed Antigravity's Phase D frontend shell in `apps/web` without changing frontend source. Checked the new Vite/React app structure, API client, auth context/guards, dashboard/ops/login pages, Nginx proxy alignment, and repository verification gates.
- Why now: User asked to inspect the frontend base framework design before continuing Phase D.
- Verify: `npm run build` in `apps/web` passed; root `npm run typecheck` and root `npm run build` passed; `npm run lint` in `apps/web` failed with 3 ESLint errors; browser smoke opened `/login` through Vite and confirmed unauthenticated redirect, with expected `/api/auth/me` 502 because backend was not running.
- Next: Fix lint errors, align production `/api/*` proxy rewrite with Vite dev behavior, and decide whether `/readyz` must be server-side protected or Nginx-restricted before visual chart work.

### 2026-04-20 12:53:58

- Scope: Scaffolded the Phase D frontend shell in `apps/web` using Vite, React, TypeScript, TanStack Query, and React Router. Implemented the Linear design system (`index.css` and base UI components) for a dark-mode-native, developer-focused aesthetic. Built the `api/client.ts` with `credentials: include` for cookie session auth, and proxying to the local backend. Created `AuthContext`, `RequireAuth`, and `RoleGuard` to manage session state and capability protection. Developed initial structural pages: Layout, Login, Dashboard (market trends query), and Ops (readyz readiness query).
- Why now: The user approved the Phase D frontend implementation plan. With `P1.7` baseline frozen and auth/session core completed, the next logical step is to provide a user interface to visualize market trends and system ops.
- Verify: Ran `npm run build` within `apps/web`; the frontend builds successfully with no TypeScript errors (all imports and strict type checks passed).
- Next: Continue Phase D: Add ECharts for trend data visualization in the dashboard, and refine Ops and Dashboard UI.

### 2026-04-20 12:42:22

- Scope: Reviewed `Commit分析与架构设计_2026-04-20_12-27.md` as context only and produced the frontend architecture decision for the production analytics product. Recommended keeping the modular monolith plus new `apps/web` boundary, cookie session plus bearer compatibility, shared `packages/contracts` DTOs, and Nginx static-web/API proxy deployment; changed the external Markdown's generic capability/query/dashboard ideas into repo-specific route guards, runtime config, typed API client, query descriptors, dashboard block registry, and product-read-model modules; rejected JWT-first auth, frontend bearer storage, microservice/SSR/Kubernetes expansion, direct worker/runtime access from UI, and premature generic dataset/workspace abstractions.
- Why now: `P1.7` is frozen and commit `8a73f98` has already landed auth/session, invite/register/admin basics, compiled build smoke, and deployment templates; the remaining active product-shell work is frontend Phase D.
- Verify: Checked current `project.md`, `git show 8a73f98`, `package.json`, `apps/api/src/server.ts`, `apps/api/src/create-api-server.ts`, `apps/api/src/auth-guard.ts`, `apps/api/src/auth-cookie.ts`, `packages/contracts/src/http.ts`, `src/storage/schema/018_auth_core.sql`, `deploy/nginx/reddit-monitoring.conf`, `deploy/env/api.env.example`, `docs/deployment-runbook.md`, `docs/product-shell-final-design-2026-04-20.md`, and official Vite/TanStack/ECharts docs for the proposed frontend stack assumptions.
- Next: Start Phase D with the smallest complete vertical slice: `apps/web` Vite React TypeScript shell, `/runtime-config.json` or equivalent runtime config loader, `/api` client with `credentials: include`, `/auth/me` session bootstrap, role-to-capability guard, typed market dashboard query, and build/deploy wiring.

### 2026-04-20 11:36:23

- Scope: Fixed backend review findings before frontend: made invite registration atomic for Postgres through `createWithConsumedInvite`, wired in-memory auth repositories to the same atomic test path, added a 1MB JSON request-body cap with `413 request_body_too_large`, and covered both with tests.
- Why now: A backend inspection found that `/auth/register` could consume an invite before user/password creation completed, and API JSON body reads had no bounded size.
- Verify: `npm run typecheck`; `npx tsx --test tests/unit/register-app-user.use-case.test.ts tests/integration/api-server-auth.test.ts` (9/9); `npm test` (223/223); `npm run build`; `npm run smoke:compiled`; `npm run smoke:linux-provider` (Windows config-only).
- Next: Continue Phase D frontend shell work; remaining host-only check is the non-config-only Linux provider smoke on the deployment machine.

### 2026-04-20 11:29:36

- Scope: Completed product-shell Phase C deployment hardening with `tsconfig.build.json`, compiled `node dist/...` package scripts, deterministic compiled/Linux-provider smoke scripts, systemd/env/Nginx deploy templates, deployment runbook, and `tests/unit/production-build-config.test.ts`.
- Why now: Phase B auth/session was already verified; the remaining backend gate before frontend was proving the production API/scheduler/migration path does not depend on `tsx`.
- Verify: `npm run typecheck`; `npm run test:unit -- tests/unit/production-build-config.test.ts` (unit suite passed 147/147); `npm run build`; `npm run smoke:compiled`; `npm run smoke:linux-provider` (Windows config-only); `npm test` (221/221).
- Next: Enter Phase D frontend shell work (`apps/web` scaffold, login/auth state, dashboard/read-model pages) on top of the verified API and deploy baseline.

### 2026-04-20 11:17:20

- Scope: Implemented product-shell Phase B invite/register/admin basics on top of the verified auth/session core. Added `AppInvite` domain and repository contracts, Postgres and in-memory invite repositories, invite code creation with hash-only storage, `POST /auth/invites`, `POST /auth/register`, and `POST /auth/users/:id/activate`. Registration now creates `pending` users, invite exhaustion/expiry is rejected, and owner/admin or bearer access is required for invite creation and activation.
- Why now: Previous `next_action` required Phase B invite/register/admin basics after Phase A auth/session core passed.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/integration/api-server-auth.test.ts tests/integration/api-server-access.test.ts` passed. Full `npm test` passed (`219/219`).
- Next: Continue Phase C with production build/deployment hardening, starting with compiled API and scheduler build scripts before systemd/Nginx templates.

### 2026-04-20 11:10:55

- Scope: Implemented the product-shell Phase A auth/session core. Added `018_auth_core.sql`, `AppUser`/`AppSession` domain and repository contracts, Postgres and in-memory repositories, scrypt password hashing, SHA-256 session tokens, `/auth/login`, `/auth/logout`, `/auth/me`, session-or-bearer `/v1/*` access, and owner/admin role guard for ops write routes while preserving bearer compatibility.
- Why now: `project.md` pointed the next development slice at Phase A auth/session core from `docs/product-shell-final-design-2026-04-20.md`.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/integration/api-server-auth.test.ts tests/integration/api-server-access.test.ts` passed. Full `npm test` passed (`216/216`).
- Next: Continue Phase B with invite/register/admin basics, including hashed invite codes, expired/disabled/used-up invite rejection, pending-user login rejection, and minimal admin/owner creation path.

### 2026-04-20 10:54:46

- Scope: Cleaned the remaining active workflow drift in `project.md` after finalizing the product-shell design.
- Why now: User asked to fix drift before later Codex automation starts implementation.
- Verify: Re-read current `project.md` references to `next_action`, product-shell design, `Ongoing Development Flow`, and `post-P5` wording. Updated only the active slice/priority rules; left historical Activity Log entries unchanged as archival evidence.
- Next: Use `docs/product-shell-final-design-2026-04-20.md` as the development guide and start Phase A auth/session core with bearer compatibility and focused tests.

### 2026-04-20 10:47:51

- Scope: Finalized the post-P1.7 product-shell design as `docs/product-shell-final-design-2026-04-20.md` and marked the earlier framework doc as superseded.
- Why now: User asked to complete the final design so it can guide later development.
- Verify: Rechecked current evidence from `project.md`, `package.json`, `apps/api/src/server.ts`, `apps/api/src/create-api-server.ts`, `packages/contracts/src/http.ts`, `src/storage/schema`, `src/storage/repositories/postgres/postgres-repository-bundle.ts`, `docs/architecture.md`, and API access tests before writing the final design.
- Next: Implement Phase A from the final design: `018_auth_core.sql`, auth entities/repositories, login/logout/me, session-or-bearer guard, ops role guard, and focused compatibility tests.

### 2026-04-20 10:40:21

- Scope: Read `Projects/Archive` product-shell planning notes plus current `project.md`, then created `docs/product-shell-development-framework-2026-04-20.md` for the next development framework covering interaction UI, auth/session, and one-server Linux deployment.
- Why now: User asked to read the Archive state and design the development framework for the current repo stage.
- Verify: Confirmed local state from `package.json`, `apps/api/src/server.ts`, `apps/api/src/create-api-server.ts`, `src/storage/schema/run-migrations.ts`, `docs/architecture.md`, and directory scans: `apps/web` is absent, `/v1/` is bearer-protected, `/healthz` and `/readyz` exist, migrations run through `017`, and runtime has HTTP/APIFY plus Scrapling lanes.
- Next: Start the first product-shell vertical slice: add auth/session core with Postgres-backed sessions and preserve existing bearer-token script access; after that, harden compiled Linux deployment.

### 2026-04-19 20:48:10

- Scope: Executed a fresh user-requested crawl pass before ranking today's hottest subreddits. Ran live crawling with `scrapling` across all active Reddit targets (`53` subreddits) using elevated sampling (`REDDIT_POST_LIMIT=120`), including retries for transient connector failures on `r/dataisbeautiful` and `r/programming`.
- Why now: User asked to crawl first, then return today's top-5 hottest subreddits.
- Verify: Crawl completed full coverage after retries (`53/53` success). Day-level canonical heat query on `subreddit_daily_fact` for `2026-04-19` (`rows_today=53`) ranked top-5 by `heat_price`: `r/nba` (`63.687117`), `r/todayilearned` (`58.521812`), `r/askreddit` (`57.647834`), `r/worldnews` (`57.638904`), `r/pics` (`57.536364`).
- Next: Keep this "crawl first -> `subreddit_daily_fact` day ranking" path as the default for instant daily subreddit hotness checks.

### 2026-04-19 20:35:19

- Scope: Computed user-requested top-5 subreddits for today from persisted `keyword_trend_daily` using the same hot-keyword track (`track=auto_keyword`) and day scope (`2026-04-19`).
- Why now: User asked "前5 subreddit 是哪几个" right after today's top-keyword check.
- Verify: SQL aggregation (`SUM(keyword_heat)` by `target_id` joined to `monitor_target.canonical_name`) returned stable top-5: `r/python`, `r/camping`, `r/frugal`, `r/machinelearning`, `r/aws`.
- Next: Reuse this same day-level aggregation path for any follow-up leaderboard checks (overall or keyword-constrained).

### 2026-04-19 20:31:57

- Scope: Executed a user-requested "today top-3 hot keywords" verification run with adjustable crawl scale/range. Ran full active subreddit live crawl in four batches (`53/53` success) using `scrapling` and elevated live sampling (`REDDIT_POST_LIMIT=120`), then ran an additional high-volume calibration batch (`8/8` success, `REDDIT_POST_LIMIT=140`) on `worldnews/news/technology/askreddit/todayilearned/science/chatgpt/machinelearning` to test ranking stability.
- Why now: User asked for immediate crawl and today's top-3 keyword output, with permission to tune parameters until result is correct/stable.
- Verify: Before and after calibration, `2026-04-19` `keyword_trend_daily` (`track=auto_keyword`) top-3 stayed unchanged, confirming stability under larger sample refresh. Final stable top-3 by summed `keyword_heat`: `like` (`total_heat=10.808326`, `matched_posts=172`), `one` (`7.572069`, `126`), `something` (`7.261416`, `102`).
- Next: Keep this "full live refresh + focused calibration pass + stability recheck" pattern for on-demand keyword-rank checks while product-shell development remains primary.

### 2026-04-19 20:06:52

- Scope: Executed a user-requested `iran` 30-day heat trend crawl and check. Ran targeted multi-round backfill refresh on `r/worldnews` and `r/news` (`8 + 8` rounds) with `scrapling` and `REDDIT_POST_LIMIT=150`, then aggregated 30-day daily trend from persisted `content` (`sampled_posts`, `matched_posts`, `mention_rate`, volume-adjusted `heat_index`) using keyword boundary match for `iran`.
- Why now: User requested immediate crawl-based 30-day trend verification for `iran`.
- Verify: Backfill rounds succeeded end-to-end and recorded multi-page observability (`requestCount=2`, `candidateCount=150` per round). 30-day aggregation returned `sampled_posts_30d=5598`, `matched_posts_30d=242`, `mention_rate_30d=0.04323`; peak heat day was `2026-04-11` (`heat_index=53.3884`, `matched_posts=22`, `sampled_posts=223`). Exported daily inspection file `docs/iran-30d-trend-2026-04-19.csv`.
- Next: Reuse the same targeted backfill + daily aggregation flow for any requested keyword spot-check while continuing post-`P1.7` product-shell work.

### 2026-04-19 19:54:41

- Scope: Completed a user-requested `chatgpt` 30-day trend check with fresh collection evidence. Ran 10 consecutive `backfill` rounds on `r/chatgpt` using `scrapling` with `REDDIT_POST_LIMIT=150` (time-shifted by 16 minutes per round to avoid same-window dedupe), then aggregated daily observed posts from `content` over the latest 30 days and computed `matched_posts`, `sampled_posts`, `mention_rate`, and a volume-adjusted heat index.
- Why now: User asked how 30-day trend can be produced under page limits and requested an immediate inspection dataset/chart for `chatgpt`.
- Verify: Collection run emitted per-round provider observability with multi-page behavior (`requestCount=2`, `candidateCount=150` in backfill runs). 30-day SQL aggregation returned `sampled_posts_30d=4373`, `matched_posts_30d=938`, `mention_rate_30d=0.214498`, with clear rise after `2026-04-11` and high-intensity days `2026-04-16` to `2026-04-19`; exported daily check file `docs/chatgpt-30d-trend-2026-04-19.csv`.
- Next: Keep the same verification pattern for future keyword checks (`targeted backfill refresh + daily aggregation`) while continuing post-`P1.7` product-shell development.

### 2026-04-19 19:45:36

- Scope: Completed DB-backed live verification for the single-job multi-page backfill fix using Scrapling on `r/preppers` with `REDDIT_POST_LIMIT=150` and explicit run time override (`nowIso=2026-04-19T11:50:00.000Z`), after code + test patch.
- Why now: Needed production-truth confirmation that the patch actually突破 `candidateCount=100` and not only test fixtures.
- Verify: `npx tsx -e "runPhase1OnceWithPostgres({ nowIso: '2026-04-19T11:50:00.000Z' })"` logged `provider_observability requestCount=2 candidateCount=150 acceptedCount=150` for `provider=scrapling mode=backfill`; Postgres query on `provider_health_window` confirmed latest `window_start=2026-04-19T11:50:00.000Z` row has `request_count=2` and `candidate_count=150`.
- Next: Keep this pagination behavior as the maintenance baseline and proceed with post-`P1.7` product-shell backlog; reuse the same DB-backed check when raising limits again.

### 2026-04-19 19:42:56

- Scope: Patched `collectObservedPages` to break the single-page ceiling when request limits exceed Reddit page size. Added provider-aware page-size handling (`http/scrapling/reddit` capped at 100 per page), corrected overflow continuation checks to use actual page request size, and enabled backfill mode to continue paging within a single job until requested limit is satisfied or cursor ends. Added integration coverage in `tests/integration/collect-subreddit-new-posts-p0.test.ts` for `backfill + scrapling + limit=150` to verify two-page collection in one run.
- Why now: User explicitly asked to modify code to突破单页上限 after observing `candidateCount=100` under high-limit runs.
- Verify: `npm test -- tests/integration/collect-subreddit-new-posts-p0.test.ts` passed (`212/212` in current suite run), including the new high-limit backfill pagination test; `npm run typecheck` passed.
- Next: Run one live DB-backed verification on a real promoted subreddit with `REDDIT_POST_LIMIT_BOOST=150` and `REDDIT_LIVE_PROVIDER=scrapling` to confirm provider observability shows `requestCount>1` and `candidateCount>100` in a single backfill job.

### 2026-04-19 19:36:46

- Scope: Executed a live runtime calibration check for higher post sampling limits with Scrapling (`base=70`, `boost=150`) without changing code defaults. Ran `worker:phase1:once` on `r/preppers` in both live and backfill modes with `REDDIT_LIVE_PROVIDER=scrapling` / `REDDIT_SCRAPLING_PROFILE=dynamic`, then verified persisted job payload and provider observability.
- Why now: User requested raising baseline/boost limits and explicitly using Scrapling.
- Verify: Live run logged `selectedProvider=scrapling`, `sampling_plan tier=elevated`, `limit=78`, and `provider_observability provider=scrapling candidateCount=78 acceptedCount=78`. Backfill run (boost path) persisted `collection_job.payload.postLimit=150`, `samplingTier=boost`, `providerHint=scrapling`; runtime produced `provider_observability provider=scrapling candidateCount=100 acceptedCount=100` (provider-side page cap observed).
- Next: Keep defaults unchanged in code for now; when high-throughput collection is needed, apply these env overrides per run profile and use multi-round/backfill windows to accumulate larger effective recall.

### 2026-04-19 17:38:51

- Scope: Executed a user-requested live keyword trend check for `jackery` on local Postgres. Ran live phase1 crawling on relevant subreddits (`solarpower,camping,preppers,buyitforlife,vandwellers,frugal,deals,survival,hiking,backpacking`) plus a focused `preppers` rerun. Created/validated keyword query session, switched session text to `global:jackery` for global read-model materialization, and re-ran phase1 to materialize `keyword_trend_daily` explicit-query rows.
- Why now: User explicitly asked to crawl and return the recent heat trend for `jackery`.
- Verify: `npx tsx workers/reddit-phase1-once.ts` succeeded for all listed subreddits in live mode (`DATABASE_URL=postgresql://postgres:***@localhost:5432/reddit_monitoring`). DB query confirmed matched content: `/r/preppers/comments/1sljeii/...` (`created_at_source=2026-04-14T19:47:49Z`, `first_seen_at=2026-04-19T09:33:44Z`). API `POST /v1/keyword-queries` returned `supportCount=1` and `status=initial_ready`. After rerun/materialization, API `GET /v1/trends/keywords/jackery/daily` returned one non-zero day with `matchedPosts=1`, `sampledPosts=7`, `mentionRate=0.142857`, `keywordHeat=0.169071`, `queryScope=global`.
- Next: Keep post-`P1.7` product-shell development as primary track, and reuse this lightweight live-crawl + keyword-read flow for on-demand keyword checks.

### 2026-04-19 15:15:19

- Scope: Closed all remaining `P1.7` work by finishing the provider-policy abstraction hardening and executing the full exit-gate verification sweep across unit/integration/full regression and DB-backed truth-path checks. Flipped frontmatter stage to `P1.7-complete` and moved focus to post-`P1.7` product-shell backlog while freezing the current algorithm/provider-policy baseline.
- Why now: User requested completing all `P1.7` work; previous `next_action` explicitly left only the final exit-gate verification and stage flip.
- Verify: `npm run algo:phase1` passed (`31/31` phase1 unit). `npm run algo:phase1:full` passed (phase1 unit + integration green). `npx tsx --test tests/integration/api-server-readyz.test.ts tests/integration/api-server-trends.test.ts` passed (`36/36`). `npm run algo:full` passed (`211/211`). DB-backed checks passed with `DATABASE_URL=postgresql://postgres:***@localhost:5432/reddit_monitoring`: `npm run algo:promotion:verify` wrote `docs/live-controlled-promotion-2026-04-19T07-14-19-108Z.json` (`runCount=2`, `failedCycleCount=0`), and `npx tsx scripts/verify-phase1-postgres.ts` output was captured to `docs/verify-phase1-postgres-2026-04-19T15-14-27.log` with `ok=true` and readiness truth-path output present.
- Next: Start post-`P1.7` product shell implementation (`auth/session` + deployment hardening) and keep periodic lightweight promotion verifies as maintenance guards.

### 2026-04-19 15:06:38

- Scope: Completed the post-`P5` `P1.7` provider-policy abstraction hardening slice by introducing typed `selectedProvider` routing output in `src/runtime/reddit-provider-routing-policy.ts` and propagating it through `src/runtime/reddit-fetch-execution-engine.ts` and `src/workers/reddit-phase1.worker.ts`. Kept `providerHint` for compatibility, but execution/sampling now prioritizes `selectedProvider` so routing decisions are no longer coupled to hint-string semantics. Also made routing summary count by `selectedProvider`.
- Why now: `next_action` explicitly required strengthening provider-policy abstraction beyond provider-hint routing while keeping existing read-model/API contracts stable.
- Verify: `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts tests/integration/reddit-phase1-provider-routing.test.ts` passed (`20/20`). `npm run typecheck` passed.
- Next: Run one P1.7 exit-gate verification sweep across `npm run algo:phase1` + DB-backed promotion/readyz checks, then decide whether stage can move from `P1.7-algorithm-productization` to closure/post-phase focus.

### 2026-04-19 14:58:42

- Scope: Completed the first post-`P5` `P1.7` read-model/API slice for global keyword trends. Added a dedicated `resolveGlobalKeywordDailyRange` path and wired `/v1/trends/keywords/:query/daily` to 30-day semantics (default trailing 30 days; reject ranges over 30 inclusive days). Added unit coverage in `tests/unit/api-validation.test.ts` and integration coverage in `tests/integration/api-server-trends.test.ts` for default 30-day behavior.
- Why now: `next_action` explicitly targeted the remaining global keyword 30-day read-model/API gap after `P5` closure; this was the smallest complete vertical slice to advance `P1.7` without touching unrelated areas.
- Verify: `npx tsx --test tests/unit/api-validation.test.ts tests/integration/api-server-trends.test.ts` passed (`25/25`). `npm run typecheck` passed.
- Next: Continue post-`P5` `P1.7` with provider-policy abstraction hardening beyond provider-hint routing, keeping current global-keyword 30-day and anomaly contract outputs stable.

### 2026-04-19 14:39:04

- Scope: Finalized `P5` contract-adoption closure by migrating the remaining inline run-trigger integration response typings in `tests/integration/api-server-runs.test.ts` to package contracts (`TriggerPhase1RunResponse`, `ApiErrorResponse`) and tightening the crawlMode assertion to validate forwarding semantics without brittle fixed call-count coupling.
- Why now: A post-change sweep still showed residual `postJson<{...}>` usage in `api-server-runs`; closing it was required to claim full `P5` downstream contract adoption with minimal precise edits.
- Verify: `npx tsx --test tests/integration/api-server-runs.test.ts tests/integration/api-server-access.test.ts tests/integration/api-server-keyword-query.test.ts tests/integration/api-server-readyz.test.ts tests/integration/api-server-trends.test.ts` passed (`43/43`). `npm run typecheck` passed. `rg -n -F "getJson<{" tests/integration` and `rg -n -F "postJson<{" tests/integration` returned no matches.
- Next: Keep `P5` closed and start the first post-`P5` vertical slice on global keyword 30-day read-model/API completion with contracts + targeted tests.

### 2026-04-19 14:36:35

- Scope: Completed the remaining `P5` downstream contract-adoption slice by replacing ad-hoc inline integration response typings in `tests/integration/api-server-access.test.ts`, `tests/integration/api-server-keyword-query.test.ts`, and `tests/integration/api-server-readyz.test.ts` with package contracts (`ApiErrorResponse`, `ApiHealthResponse`, `ApiReadinessResponse`, `CreateSubredditTargetResponse`, `CreateKeywordQueryResponse`, `GetKeywordQueryResponse`, `MarketTrendResponse`).
- Why now: User requested finishing `P5` with minimal precise changes; after anomaly and non-anomaly trend-path migration, these integration consumers were the remaining inline-typing boundary.
- Verify: `npx tsx --test tests/integration/api-server-access.test.ts tests/integration/api-server-keyword-query.test.ts tests/integration/api-server-readyz.test.ts tests/integration/api-server-trends.test.ts` passed (`40/40`). `npm run typecheck` passed. `rg -n -F "getJson<{" tests/integration/api-server-access.test.ts tests/integration/api-server-keyword-query.test.ts tests/integration/api-server-readyz.test.ts tests/integration/api-server-trends.test.ts` and `rg -n -F "postJson<{" tests/integration/api-server-access.test.ts tests/integration/api-server-keyword-query.test.ts tests/integration/api-server-readyz.test.ts tests/integration/api-server-trends.test.ts` returned no matches.
- Next: Keep `P5` closed and start the next vertical slice on global keyword 30-day read-model/API completion with contracts + targeted tests.

### 2026-04-19 14:31:30

- Scope: Completed the non-anomaly trend-path contract-adoption slice in `tests/integration/api-server-trends.test.ts` by replacing ad-hoc inline response typings with package contracts for trend/daily/global-keyword/market/driver plus related seed/run and error responses (`SubredditTrendResponse`, `SubredditDailyTrendResponse`, `GlobalKeywordDailyTrendResponse`, `MarketTrendResponse`, `SubredditDriverPostsResponse`, `CreateSubredditTargetResponse`, `TriggerPhase1RunResponse`, `ApiErrorResponse`).
- Why now: The active `next_action` required finishing non-anomaly trend-path downstream contract adoption after anomaly success/error/eventId/explain contracts were already stabilized.
- Verify: `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`13/13`). `npm run typecheck` passed. `rg -n -F "getJson<{" tests/integration/api-server-trends.test.ts` and `rg -n -F "postJson<{" tests/integration/api-server-trends.test.ts` returned no matches, confirming no remaining inline response generics in this integration consumer file.
- Next: Extend the same contract-adoption cleanup to remaining non-anomaly integration consumers outside `api-server-trends` (especially `keyword-query`/`access`/`readyz` response typings) with focused tests per file.

### 2026-04-19 14:26:06

- Scope: Closed the active anomaly-path contract-adoption dev slice by auditing downstream anomaly consumers and confirming that anomaly success/error response usage is now contract-driven (`SubredditAnomalyFeedResponse`, `SubredditAnomalyIncidentFeedResponse`, `ApiErrorResponse`) without remaining local ad-hoc response typings.
- Why now: Frontmatter `next_action` still pointed to anomaly-path typing cleanup, so this slice had to be explicitly verified and marked complete before moving to the next contract-adoption boundary.
- Verify: Searched anomaly endpoint consumers via `rg -n "anomalies(/incidents)?" -g "*.ts"` and inspected `tests/integration/api-server-trends.test.ts` anomaly blocks; all anomaly `getJson` response generics now use package contracts and no anomaly-path inline response shape remains.
- Next: Continue P5 downstream contract adoption on non-anomaly trend endpoints by replacing remaining ad-hoc inline response typings with package contracts in the same integration-consumer layer.

### 2026-04-19 14:16:52

- Scope: Continued `P5` contract adoption on anomaly consumer paths by replacing anomaly endpoint error-response ad-hoc typings with `ApiErrorResponse` in `tests/integration/api-server-trends.test.ts`. This complements the prior success-response migration to `SubredditAnomalyFeedResponse` / `SubredditAnomalyIncidentFeedResponse`.
- Why now: The anomaly path still had mixed typing discipline (success typed via contracts, errors typed inline), which left consumer-side drift risk for error payload fields.
- Verify: `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`13/13`). `npm run typecheck` passed.
- Next: Keep scanning downstream anomaly consumers and remove any remaining ad-hoc type definitions so all anomaly API usage is contract-driven end-to-end.

### 2026-04-19 14:09:42

- Scope: Continued `P5` downstream adoption by switching anomaly endpoint integration consumers from ad-hoc inline response typings to canonical contract types in `tests/integration/api-server-trends.test.ts`. Imported and used `SubredditAnomalyFeedResponse` / `SubredditAnomalyIncidentFeedResponse` directly, and updated assertions to read typed explain payload fields without local cast-shaped wrappers.
- Why now: The previous slices established `eventId` and explain payload contract versions; this step ensures downstream usage is enforced by shared contracts instead of drift-prone local test shapes.
- Verify: `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`13/13`). `npm run typecheck` passed.
- Next: Continue replacing any remaining ad-hoc consumer typing around anomaly responses with contract imports in downstream paths, while keeping lightweight `R5` verify snapshots as stability guard evidence.

### 2026-04-19 14:06:55

- Scope: Completed the paused `R5` lightweight promoted-target stability verify work by executing `scripts/live-controlled-promotion-verify.ts` with a minimal one-cycle promoted run (`python`) against local Postgres.
- Why now: The previous `next_action` explicitly left this verify as a paused environment-dependent item; closing it removes uncertainty before continuing `P5` contract adoption work.
- Verify: Command succeeded and wrote `docs/live-controlled-promotion-2026-04-19T06-06-35-432Z.json` with `runCount=1`, `failedCycleCount=0`, `providersSeen=["scrapling"]`, cycle routing class `scrapling_dynamic_escalation`, `providerHealth.requestCount=6`, `successCount=6`, `localTargetReadinessStatus=ready`, and only global degraded reason `algorithm_daily_fact_stale`.
- Next: Keep this snapshot as the current lightweight `R5` guard evidence and continue enforcing anomaly `eventId` + explain contract usage in downstream consumer paths.

### 2026-04-19 12:49:09

- Scope: Continued `P5` downstream contract tightening by introducing stable anomaly `eventId` across read paths. Added shared `buildAnomalyEventId/parseAnomalyEventId` utility, included `eventId` in anomaly feed read model and HTTP response, and made incident `sourceEvents.eventId` reuse the same builder to guarantee cross-endpoint consistency. Kept explicit explain contracts active (`anomaly_feed_explain_v1`, `anomaly_incident_explain_v1`) and aligned HTTP contract types accordingly.
- Why now: After locking explain payload schemas, cross-endpoint linkage still relied on implicit tuple matching; adding a stable `eventId` removes consumer ambiguity and makes feed-to-incident traceability deterministic.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/anomaly-event-id.test.ts tests/unit/subreddit-anomaly-feed-read-model.service.test.ts tests/unit/subreddit-anomaly-incident-read-model.service.test.ts tests/unit/build-anomaly-events.job.test.ts tests/unit/build-anomaly-events-thresholds.test.ts` passed (`10/10`). `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`13/13`), including new `eventId` and explain-contract assertions on anomaly endpoints.
- Next: Execute one lightweight promoted-target `R5` verify snapshot once `DATABASE_URL` is available in the shell, then keep enforcing anomaly contract usage in any downstream consumer that still treats explain payloads as untyped blobs.

### 2026-04-19 12:43:36

- Scope: Completed `P5` slice 3 (`cross-endpoint anomaly consistency + explain payload contract tightening`). Added shared severity resolver (`src/application/services/anomaly-severity.ts`) used by both anomaly feed and incident read models, standardized anomaly feed explain payload to `anomaly_feed_explain_v1` with stable fields plus `details`, and standardized incident explain payload to `anomaly_incident_explain_v1` with explicit `mergeStrategy`, `mergeBoostBySignalType`, and typed `sourceEvents` (`eventId`, severity, algorithmVersion). Tightened HTTP contracts for anomaly feed/incidents explain payload shapes in `packages/contracts/src/http.ts`.
- Why now: After finishing directional quality and weighted merge scoring, the remaining `P5` gap was contract drift risk between `/anomalies` and `/anomalies/incidents`; both needed explicit explain schemas so downstream consumers can parse fields deterministically.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/subreddit-anomaly-feed-read-model.service.test.ts tests/unit/subreddit-anomaly-incident-read-model.service.test.ts tests/unit/build-anomaly-events.job.test.ts tests/unit/build-anomaly-events-thresholds.test.ts` passed (`8/8`). `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`13/13`), including new explain-payload assertions on anomaly feed and incident endpoints.
- Next: Run one lightweight promoted-target `R5` stability verify snapshot, then continue with downstream consumer tightening for anomaly contract fields so new explain payload schemas are used end-to-end.

### 2026-04-19 12:35:27

- Scope: Completed `P5` hardening slices 1 and 2 in code. Upgraded anomaly defaults to `anomaly_event_v2_tier_directional_quality`, added tier-adaptive quality score gates and tier baseline floors, split quality anomaly keys into `quality_up` / `quality_down`, and added weighted incident merge boosts by signal type instead of fixed per-signal increments.
- Why now: Current backlog explicitly required reducing fixed-threshold drift and directional ambiguity in quality anomaly output, plus replacing fixed incident merge boost so different signal reliabilities are reflected in merged incidents.
- Verify: `npx tsx --test tests/unit/build-anomaly-events.job.test.ts tests/unit/build-anomaly-events-thresholds.test.ts tests/unit/subreddit-anomaly-incident-read-model.service.test.ts` passed (`7/7`). `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`13/13`). `npm run typecheck` passed.
- Next: Implement `P5` slice 3 by enforcing anomaly feed/incident explain-payload consistency contracts across read models and API responses, then keep periodic promoted Scrapling stability verifies as a lightweight guard.

### 2026-04-19 12:26:22

- Scope: Organized the Obsidian `Projects` workspace for single-source execution and set the post-R5 development workflow. Updated frontmatter and `Current Focus` to move active work to `P5` hardening slices, added a dedicated `Ongoing Development Flow` section, and archived side-note docs out of the root `Projects` directory.
- Why now: `Projects` contained multiple side-note files that could cause state drift, while current execution priority needed to move from completed `R5` baseline work to the next algorithm/read-model hardening path.
- Verify: `project.md` now carries the active workflow contract and next action; side-note documents are moved under `obsidian-reddit专用/Projects/Archive/`; root `Projects` is reduced to the active state file plus archive folder.
- Next: Start `P5` slice 1 in code (`tier-adaptive thresholds + quality direction split`), ship with focused tests, and write back evidence paths in the next activity entry.

### 2026-04-19 12:13:10

- Scope: Closed the remaining `R5` observability consistency gap so `/readyz` and controlled-promotion verify use aligned Scrapling dynamic recovery semantics. Updated `apps/api/src/readyz-observability.ts` to suppress Scrapling `provider_stale_head_elevated` and `provider_cursor_stalled/provider_data_stalled` degraded reasons when dynamic profile evidence is strong and transport is healthy. Added integration coverage in `tests/integration/api-server-readyz.test.ts`. Also aligned `scripts/live-controlled-promotion-verify.ts` local-target readiness evaluator to the same suppression rule so verify output no longer diverges from `/readyz`.
- Why now: The prior `R5` routing path was stable (`dynamicRoute` high, `fallback` low), but observability still emitted sticky stale/stalled reasons for Scrapling despite continuous dynamic run-local activity, leaving one last productization inconsistency.
- Verify: `npx tsx --test tests/integration/api-server-readyz.test.ts` passed (`22/22`). `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`16/16`). `npm run typecheck` passed. Live verifies: `docs/live-controlled-promotion-2026-04-19T04-11-13-358Z.json` shows `dynamicRoute=8/8`, `fallbackRoute=0/8`, global degraded reasons only `algorithm_daily_fact_stale`; `docs/live-controlled-promotion-2026-04-19T04-13-02-514Z.json` shows `localTargetDegradedRuns=0` with no local stale/stalled Scrapling reasons.
- Next: Treat `R5` as complete for this phase and move active implementation to remaining algorithm/read-model delivery backlog while retaining periodic promoted Scrapling stability verification.

### 2026-04-19 10:36:29

- Scope: Continued `R5` routing calibration and eliminated stale-head-driven fallback lock-in on promoted dynamic paths. In `src/runtime/reddit-provider-routing-policy.ts`, narrowed `dynamic_exhausted` trigger from `(empty OR stale_head)` to `empty` only, and required recovery-window confirmation for `dynamic_exhausted` before demotion; retained dynamic steady-state path. Added/updated unit coverage in `tests/unit/reddit-provider-routing-policy.test.ts` for: empty-window exhausted fallback, sparse exhausted sample suppression, and recovery-window deferral reason.
- Why now: Latest live run (`...02-30-47-196Z`) regressed to `fallbackRoute=8/8` despite `runLocalScraplingEvidence=8/8` and healthy transport; evidence showed stale-head was dominating demotion even when dynamic collection was active.
- Verify: `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`16/16`). `npm run typecheck` passed. New live verify output `docs/live-controlled-promotion-2026-04-19T02-35-25-517Z.json` shows `failedCycleCount=0`, `runExecution.executedJobCount>0` for all cycles, `runLocalScraplingEvidence.requestCount>0` in `8/8`, `dynamicRoute=8/8`, and `fallbackRoute=0/8`.
- Next: Keep promoted stepped runs as a stability check and then tune `/readyz` stale-head/cursor-stall degradation logic for Scrapling so observability no longer reports persistent stale/stalled state when dynamic run-local evidence is continuously non-empty.

### 2026-04-19 10:00:16

- Scope: Continued `R5` routing-productization with targeted anti-lock calibration. Added `scraplingDynamicExhaustedMinRequestCount` in `src/runtime/reddit-provider-health-thresholds.ts`; updated `src/runtime/reddit-provider-routing-policy.ts` so `dynamic_exhausted` fallback uses this dedicated sample gate and added dynamic steady-state routing (`scrapling_dynamic_steady_state`) when dynamic profile evidence is ready and not exhausted. Also kept earlier verify reliability/hard-error fixes active (`REDDIT_CONTROLLED_PROMOTION_MAX_WINDOW_SHIFT_COUNT` and Scrapling multiline `set-cookie` header sanitization).
- Why now: Latest runs still showed fallback re-lock on `dynamic_exhausted_http_fallback` despite transport being healthy; we needed to keep dynamic windows alive without relaxing session-key reuse thresholds.
- Verify: `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`15/15`). `npm run typecheck` passed. Live promoted verify output `docs/live-controlled-promotion-2026-04-19T01-59-48-909Z.json` shows `failedCycleCount=0`, `runExecution.executedJobCount>0` for all cycles, `runLocalScraplingEvidence.requestCount>0` in `8/8` cycles, `dynamic` route profile in `5/8`, and fallback at `3/8`.
- Next: Keep stepped evidence running and further calibrate stale-head-triggered `dynamic_exhausted` fallback (decay/recovery or cursor-stall conditioning) to reduce fallback share below `3/8` without regressing current 8/8 run-local Scrapling activity.

### 2026-04-19 09:54:19

- Scope: Continued `R5` lock-in reduction with three bounded fixes. (1) `scripts/live-controlled-promotion-verify.ts` now supports `REDDIT_CONTROLLED_PROMOTION_MAX_WINDOW_SHIFT_COUNT` (default `96`) and fails fast when no fresh dedupe window is available, preventing silent `executedJobCount=0` runs. (2) `src/connectors/reddit/reddit-scrapling.connector.ts` now drops multiline/`set-cookie` bridge headers before `new Headers(...)`, removing dynamic-path `Headers.append ... invalid header value` failures; added unit coverage in `tests/unit/reddit-scrapling.connector.test.ts`. (3) `src/runtime/reddit-provider-routing-policy.ts` now uses dynamic profile for recovery probes and gates `scrapling_dynamic_exhausted_http_fallback` behind minimum transport sample count; added focused unit cases in `tests/unit/reddit-provider-routing-policy.test.ts`.
- Why now: Promoted-step evidence still had two blockers after earlier recovery rules: verify cycles could be no-op due window collisions, and dynamic Scrapling runs were intermittently aborted by invalid multiline headers; both masked real routing behavior and kept fallback decisions noisy.
- Verify: Unit+type gates passed (`npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts tests/unit/reddit-scrapling.connector.test.ts`, `npm run typecheck`). New DB-backed verify outputs: `docs/live-controlled-promotion-2026-04-19T01-49-55-343Z.json`, `...01-52-05-669Z.json`, `...01-53-56-261Z.json`. Latest 8-cycle run shows `failedCycleCount=0`, `runExecution.executedJobCount>0` across all cycles, `runLocalScraplingEvidence.requestCount>0` in `6/8` cycles, `dynamic` route profile in `4/8`, and fallback reduced to `3/8`.
- Next: Keep stepped promoted evidence running and calibrate the `dynamic_exhausted` stale-head branch (decay/recovery window) so fallback does not re-lock after dynamic windows, while preserving current transport safeguards and unchanged session-key reuse threshold.

### 2026-04-19 09:44:27

- Scope: Extended `R5` transport recovery calibration in `src/runtime/reddit-provider-routing-policy.ts` with a bounded probe-unlock rule: when lookback transport is degraded but the short recovery window has zero Scrapling samples, keep promoted Scrapling via `scrapling_recovery_probe_no_recent_transport_samples` instead of staying hard-demoted to `http`. Added regression coverage in `tests/unit/reddit-provider-routing-policy.test.ts`. Executed two DB-backed promoted verify runs after the patch: `docs/live-controlled-promotion-2026-04-19T01-42-30-181Z.json` and `docs/live-controlled-promotion-2026-04-19T01-44-08-317Z.json`.
- Why now: The first post-patch live run still showed sticky `scrapling_http_fallback` with zero run-local Scrapling traffic; without a probe-unlock path, the recovery gate cannot self-heal once fallback suppresses new Scrapling evidence.
- Verify: `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`12/12`). `npm run typecheck` passed. Live verify (`4` stepped cycles) now shows a probe unlock on cycle 4 with `routingClass=\"scrapling_promoted\"` and reason `scrapling_recovery_probe_no_recent_transport_samples` while earlier cycles remained fallback.
- Next: Continue stepped promoted runs and validate that probe-unlocked cycles produce non-zero `runLocalScraplingEvidence.requestCount`; if probe unlock still yields zero traffic, calibrate probe profile/cadence in routing/execution without relaxing session-key reuse threshold.

### 2026-04-19 09:40:50

- Scope: Added a bounded `R5` transport decay/recovery calibration in routing policy so promoted Scrapling targets can recover from transient lookback degradation without immediately staying demoted to `http`. Updated `src/runtime/reddit-provider-health-thresholds.ts` with recovery-window constants and updated `src/runtime/reddit-provider-routing-policy.ts` to compute a short Scrapling transport recovery aggregate (`10m`) and suppress lookback fallback when that recent slice is healthy with enough samples. Added focused unit coverage in `tests/unit/reddit-provider-routing-policy.test.ts` for both recovery-success and insufficient-recovery-sample paths.
- Why now: Latest DB-backed verify snapshots showed sticky `scrapling_http_fallback` after transient Scrapling errors even when subsequent run-local windows were healthy, which blocked sustained non-empty dynamic windows.
- Verify: `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`11/11`). `npm run typecheck` passed.
- Next: Re-run stepped promoted `r/python` verify cycles and compare routing transitions (`scrapling_dynamic_escalation` vs `scrapling_http_fallback`) plus run-local Scrapling request windows to confirm recovery behavior on real promotion data.

### 2026-04-19 09:28:05

- Scope: Continued `R5` Scrapling fusion hardening and fixed multiple blockers end-to-end. Updated `scripts/live-controlled-promotion-verify.ts` to (1) avoid dedupe-collided windows via automatic forward window shifts, (2) emit `requestedNowIso + windowShiftCount`, and (3) compute run-local evidence from jobs started in the actual run wall-clock interval (plus `runExecution.startedAtIso/finishedAtIso/executedJobCount`) instead of mixed historical windows. Updated `src/runtime/reddit-phase1-runtime.ts` so dynamic/stealth Scrapling defaults to no CB fallback-to-http unless explicitly enabled with `REDDIT_SCRAPLING_CB_ROUTE_TO_HTTP=true`; added unit coverage in `tests/unit/reddit-phase1-runtime.test.ts`. Fixed dynamic-path hard error in `scripts/scrapling_reddit_bridge.py` (`DynamicFetcher/StealthyFetcher retries=0` -> `retries=1`). Added routing anti-lock improvements: `src/runtime/reddit-provider-health-thresholds.ts` adds `scraplingTransportMinRequestCountForFallback` and `scraplingRecoveryProbeMinCursorLagSeconds`; `src/runtime/reddit-provider-routing-policy.ts` now requires minimum transport sample count before transport fallback and supports `scrapling_recovery_probe` on long-stalled degraded cursors. Added focused tests in `tests/unit/reddit-provider-routing-policy.test.ts`.
- Why now: Current fusion gap was no longer just threshold tuning; verify outputs showed ability was being masked by mixed-window evidence, dynamic execution runtime errors, and fallback lock-in from sparse/historical transport degradation.
- Verify: `npm run typecheck` passed after each patch set. `npx tsx --test tests/unit/reddit-phase1-runtime.test.ts` passed (`11/11`). `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`9/9`). Installed missing browser runtime for Python Playwright dependency (`python -m playwright install chromium`) after dynamic profile error surfaced in verify output. New DB-backed runs: `docs/live-controlled-promotion-2026-04-19T01-10-33-593Z.json`, `...01-13-36-310Z.json`, `...01-16-42-461Z.json`, `...01-20-17-555Z.json`, `...01-27-40-076Z.json`; outputs now expose accurate run-local execution counts and explicit `runExecution` error/success context, and dynamic-path hard failure due missing browser executable is resolved.
- Next: Continue promoted stepped evidence with the corrected run-local instrumentation and tune recovery behavior so `scrapling_http_fallback` does not remain sticky after transient dynamic transport errors; target is repeated cycles with non-zero run-local Scrapling requests under dynamic escalation before any threshold relaxation.

### 2026-04-19 08:59:51

- Scope: Completed promoted-target DB-backed validation using the new verify output contract. Ran `scripts/live-controlled-promotion-verify.ts` with explicit promotion env (`REDDIT_SCRAPLING_PRIMARY_SUBREDDITS=python`), timeout-tuned transport, and stepped windows. Verified that the script now emits `runExecution` and keeps completing even when connector instability appears.
- Why now: After adding run-local evidence and cycle fault tolerance, we needed one promoted `r/python` run proving those fields work on the actual `R5` decision path.
- Verify: Command produced `docs/live-controlled-promotion-2026-04-19T00-59-08-916Z.json` with `runCount=3`, `failedCycleCount=0`, `providersSeen=["http","scrapling"]`, and `totalScraplingFallbackTransportCounts={"powershell":2}`. All cycles routed as `scrapling_dynamic_escalation`; first cycle shows non-empty run-local Scrapling evidence (`requestCount=2`, `sessionKeyObservedRate=1`, `sessionKeyReuseRate=0.5`), while later cycles show `runLocalScraplingEvidence.requestCount=0` and preserved aggregate reuse evidence (`aggReuseRate=0.5`).
- Next: Keep threshold unchanged and gather additional stepped promoted windows to determine whether later-cycle run-local zeroes are stable transport fallback behavior or short-window sampling noise.

### 2026-04-19 08:58:20

- Scope: Added cycle-level fault tolerance to `scripts/live-controlled-promotion-verify.ts` so single-run connector failures no longer abort the full verification batch. Each cycle now emits `runExecution { ok, error }`, and summary now reports `failedCycleCount`. Kept the previously added `runLocalScraplingEvidence` output path intact.
- Why now: Promoted-window evidence collection was still brittle because one upstream timeout terminated the whole script, which blocked repeated-window decision evidence.
- Verify: `npm run typecheck` passed. Timeout-tuned stepped verify command on `r/python` completed and wrote `docs/live-controlled-promotion-2026-04-19T00-58-06-234Z.json` with `summary.failedCycleCount=0` and per-cycle `runExecution` + `runLocalScraplingEvidence` fields present.
- Next: Run the same stepped verify with explicit promoted-target env to force Scrapling routing evidence (`dynamic/http fallback reasons`) in `r/python`; keep current reuse threshold unchanged until those run-local Scrapling windows are collected.

### 2026-04-19 08:56:20

- Scope: Completed the pending `R5` verify-script hardening slice by adding a run-local Scrapling evidence view to `scripts/live-controlled-promotion-verify.ts`. The script now samples only live `collection_job` rows near each cycle `nowIso` (`scheduled_at ±3 minutes`) and computes `runLocalScraplingEvidence` (`sampledJobs`, `sampledRawEvents`, profile mix, session-key observed/reuse rates) from that cycle-local raw headers, while keeping existing 30-minute aggregate `scraplingEvidence` intact.
- Why now: The previous `next_action` explicitly required reducing lookback-mixing noise before any threshold decision; without a cycle-local view, repeated stepped runs could still be misread from blended windows.
- Verify: `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`7/7`), `npx tsx --test tests/unit/reddit-scrapling.connector.test.ts` passed (`6/6`). Verification script output `docs/live-controlled-promotion-2026-04-19T00-55-53-748Z.json` now contains the new `runLocalScraplingEvidence` block per cycle (for example `sampledJobs=2`, `sampledRawEvents=3`). During this slice, direct promoted `r/python` retries still hit upstream timeout (`Timed out after 12000ms`, then `Timed out after 30000ms`), so local-field validation used a successful single-cycle `r/machinelearning` run under `REDDIT_HTTP_TRANSPORT=powershell`.
- Next: Use timeout-tuned stepped promoted `r/python` runs to gather non-empty `runLocalScraplingEvidence` and keep `scraplingSessionKeyReuseRateMin` unchanged until repeated run-local evidence contradicts current routing thresholds.

### 2026-04-19 00:24:38

- Scope: Continued the active `R5` threshold-evidence slice and hardened the verify loop to produce usable repeated-window evidence. Updated `src/connectors/reddit/reddit-scrapling.connector.ts` so session-key reuse tracking is process-wide across connector instances, updated `src/runtime/reddit-provider-routing-policy.ts` so cursor-stall alone no longer forces immediate `scrapling_http_fallback`, and extended `scripts/live-controlled-promotion-verify.ts` with `REDDIT_CONTROLLED_PROMOTION_STEP_MINUTES` so controlled-promotion runs can advance across distinct 5-minute windows instead of being deduped in-place.
- Why now: The previous `next_action` required repeated stepped `r/python` evidence before deciding whether to relax `scraplingSessionKeyReuseRateMin`, but same-window dedupe plus per-instance session-key reset was masking real reuse behavior.
- Verify: `npx tsx --test tests/unit/reddit-scrapling.connector.test.ts` passed (`6/6`), `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`7/7`), `npx tsx --test tests/integration/reddit-phase1-provider-routing.test.ts` passed (`3/3`), and `npm run algo:phase1` passed (`29/29`). Stepped DB-backed promotion runs with `REDDIT_CONTROLLED_PROMOTION_STEP_MINUTES=6` produced `docs/live-controlled-promotion-2026-04-18T16-15-39-059Z.json`, `docs/live-controlled-promotion-2026-04-18T16-16-44-226Z.json`, `docs/live-controlled-promotion-2026-04-18T16-22-24-753Z.json`, and `docs/live-controlled-promotion-2026-04-18T16-23-49-655Z.json`; in the 12-cycle `r/python` run, routing hit `scrapling_dynamic_escalation` with `sessionKeyReuseRate=0.5` in early windows, confirming the current reuse gate can be reached without lowering threshold.
- Next: Keep `scraplingSessionKeyReuseRateMin` unchanged and continue collecting stepped `r/python` evidence, but reduce decision noise by adding run-local (current verify execution) Scrapling evidence alongside 30-minute aggregate evidence before any threshold change proposal.

### 2026-04-19 00:17:52

- Scope: Completed the next `R5` verification hardening slice around promoted technical windows. Updated `src/runtime/reddit-provider-routing-policy.ts` so cursor-stall alone no longer forces `scrapling_http_fallback` (transport fallback now requires hard transport degradation), and made Scrapling session-key reuse tracking process-wide in `src/connectors/reddit/reddit-scrapling.connector.ts` to avoid per-instance reset during repeated verify cycles. Added `REDDIT_CONTROLLED_PROMOTION_STEP_MINUTES` support in `scripts/live-controlled-promotion-verify.ts` so controlled-promotion runs can step `nowIso` across collection windows instead of being deduped inside one 5-minute bucket. Locked behavior with new tests in `tests/unit/reddit-provider-routing-policy.test.ts` and `tests/unit/reddit-scrapling.connector.test.ts`.
- Why now: Repeated DB-backed promotion runs were not accumulating valid reuse evidence because same-window dedupe suppressed new collection slices and cursor-stall-only fallback could lock promoted targets to http before enough Scrapling evidence accumulated.
- Verify: `npx tsx --test tests/unit/reddit-scrapling.connector.test.ts` passed (`6/6`). `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`7/7`). `npx tsx --test tests/integration/reddit-phase1-provider-routing.test.ts` passed (`3/3`). `npm run algo:phase1` passed (`29/29` phase1 unit). Stepped promotion verify with `REDDIT_CONTROLLED_PROMOTION_STEP_MINUTES=6` wrote `docs/live-controlled-promotion-2026-04-18T16-15-39-059Z.json`, where promoted routing stayed on Scrapling and dynamic escalation triggered for `r/javascript` once `sessionKeyReuseRate` hit `0.5`; focused `r/python` run `docs/live-controlled-promotion-2026-04-18T16-16-44-226Z.json` reached `sessionKeyReuseRate=0.25` but remained below dynamic gate.
- Next: Keep `scraplingSessionKeyReuseRateMin` unchanged at this stage and continue stepped `r/python` evidence collection; only relax threshold if repeated stepped windows still fail to cross reuse gate while stale-head stays persistently elevated.

### 2026-04-18 23:44:52

- Scope: Completed the requested DB-backed `R5` verification slice on promoted technical targets and landed a bounded threshold-calibration fix. Fixed `provider_health_window` Postgres insert mismatch in `src/storage/repositories/postgres/postgres-provider-health-window.repository.ts` (32 columns vs 31 placeholders), then tightened routing fallback behavior in `src/runtime/reddit-provider-routing-policy.ts` so `scrapling_cursor_stalled` only degrades promotion when recent Scrapling health-window evidence exists. Added regression coverage in `tests/unit/reddit-provider-routing-policy.test.ts` to lock this edge (`legacy stale cursor without recent scrapling evidence` should stay `scrapling_promoted`).
- Why now: The prior `next_action` required DB-backed promotion verification with the new `routingDecision + scraplingEvidence` payload and threshold tuning only where live evidence contradicted the calibration.
- Verify: `npm run algo:promotion:verify` initially failed with `INSERT 的指定字段数多于表达式`, then passed after the SQL fix and produced `docs/live-controlled-promotion-2026-04-18T15-41-50-058Z.json`; rerun after routing calibration produced `docs/live-controlled-promotion-2026-04-18T15-43-31-198Z.json` with promoted targets routing as `scrapling_promoted` (no false `scrapling_http_fallback` from stale cursor-only state). Additional promoted technical run `docs/live-controlled-promotion-2026-04-18T15-47-51-258Z.json` (`python,javascript`) captured real Scrapling evidence (`providersSeen=["scrapling"]`, per-cycle `scraplingEvidence.requestCount=1`, `sessionKeyObservedRate=1`, `sessionKeyReuseRate=0`) and exposed persistent stale-head on `r/python` without dynamic escalation. `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`6/6`), `npx tsx --test tests/integration/reddit-phase1-provider-routing.test.ts` passed (`3/3`), and `npm run algo:phase1` passed (`29/29` phase1 unit).
- Next: Accumulate multi-window Scrapling session-key reuse evidence on the promoted technical set (especially `r/python`) and only then decide whether to relax `scraplingSessionKeyReuseRateMin` for dynamic escalation; avoid changing thresholds based on single-request windows.

### 2026-04-18 23:26:37

- Scope: Completed the next `R5` calibration slice by wiring persisted Scrapling profile/session-key evidence into the routing policy itself. Updated `src/runtime/reddit-provider-health-thresholds.ts` and `src/runtime/reddit-provider-routing-policy.ts` so `scrapling_dynamic_escalation` now requires recent http-profile plus session-key evidence, while `scrapling_http_fallback` now also triggers when dynamic-profile requests with healthy session-key reuse still show elevated stale-head/empty evidence (`scrapling_dynamic_exhausted_http_fallback`). Promoted the new checks into verification by extending `scripts/live-controlled-promotion-verify.ts` with `routingDecision` and persisted `scraplingEvidence` output, and locked the behavior in `tests/unit/reddit-provider-routing-policy.test.ts` plus `tests/integration/reddit-phase1-provider-routing.test.ts`.
- Why now: The previous `next_action` explicitly called for using the new Scrapling observability fields to calibrate `dynamic` escalation and `http` demotion, then promoting those checks into verify output and routing-policy tests.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts` passed (`5/5`). `npx tsx --test tests/integration/reddit-phase1-provider-routing.test.ts` passed (`3/3`). `npm run algo:phase1:full` passed (`29/29` phase1 unit + `9/9` phase1 integration).
- Next: Run DB-backed `live-controlled-promotion-verify` / `verify-phase1-postgres` on promoted technical subreddits to capture real `routingDecision` and `scraplingEvidence`, then tighten thresholds only if live evidence disagrees with this bounded calibration.

### 2026-04-18 23:02:53

- Scope: Completed the next bounded `R5` Scrapling observability slice by extending `provider_health_window` with additive profile/session-key evidence (`src/storage/schema/017_provider_health_scrapling_observability.sql`) and wiring that path end-to-end. `src/connectors/reddit/reddit-scrapling.connector.ts` now stamps deterministic Scrapling session keys plus reuse markers into response headers, `scripts/scrapling_reddit_bridge.py` echoes session-key/profile metadata, and `src/jobs/collect-subreddit-new-posts.job.ts` persists profile/session-key counters and last observed Scrapling metadata into provider health windows. `/readyz` now exposes persisted Scrapling evidence (`requestCount`, `sessionKeyObservedRate`, `sessionKeyReuseRate`, `byProfile`) via `apps/api/src/readyz-observability.ts`, and `scripts/verify-phase1-postgres.ts` now prints Scrapling profile/fetcher/session-key evidence from sampled raw events.
- Why now: The previous writeback explicitly set Scrapling profile/session-level observability as the next missing `R5` slice after provider routing and the global keyword trend API landed.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/reddit-scrapling.connector.test.ts` passed (`5/5`). `npx tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts` passed (`11/11`). `npx tsx --test tests/integration/api-server-readyz.test.ts` passed (`21/21`). `npm run algo:phase1:full` passed (`29/29` phase1 unit + `8/8` phase1 integration).
- Next: Calibrate `scrapling_dynamic_escalation` and `scrapling_http_fallback` against the new profile/session-key evidence on technical targets, then lock the new thresholds into routing-policy tests and verify-script evidence.

### 2026-04-18 15:26:34

- Scope: Closed the remaining `R4` finish slice. Added frozen anomaly defaults in `src/jobs/anomaly-event-defaults.ts`, rewired `build-anomaly-events.job.ts` to consume those constants, exported scheduler replay helper `materializeTouchedTargets` for deterministic verification, and added focused coverage in `tests/unit/build-anomaly-events-thresholds.test.ts` and `tests/integration/reddit-phase1-scheduler-materialization.test.ts` to prove threshold boundaries and replay materialization order (`daily -> trend -> driver -> keyword -> anomaly`).
- Why now: `R4` still had two explicit open items in `project.md` (`scheduler replay anomaly materialization coverage` and `threshold/default freeze with synthetic edge cases`) after the first anomaly job/API slices landed.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/build-anomaly-events-thresholds.test.ts tests/unit/build-anomaly-events.job.test.ts` passed (`3/3`). `npx tsx --test tests/integration/reddit-phase1-scheduler-materialization.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts` passed (`3/3`). `npx tsx --test tests/integration/reddit-phase1-cycle.test.ts tests/integration/api-server-trends.test.ts` passed (`12/12`). `npm run algo:phase1:full` passed (`29/29` phase1 unit + `7/7` phase1 integration).
- Next: Move to `R5` provider-policy institutionalization (`fetch-execution-engine + provider-routing-policy`) and wire `/readyz` to expose provider plus algorithm-materialization health from the same persisted truth path.

### 2026-04-18 22:49:41

- Scope: Completed the missing global keyword 30-day trend read slice after the first R5 provider-routing landing. Added cross-target query support to `keywordTrendDailyRepository`, introduced `src/application/services/global-keyword-daily-trend-read-model.service.ts`, and exposed `GET /v1/trends/keywords/:query/daily` in `apps/api/src/create-api-server.ts` so explicit global queries now return day-by-day aggregated heat, breakout, explain payload, and contributing-subreddit counts from persisted `keyword_trend_daily` rows only. Added integration coverage in `tests/integration/api-server-trends.test.ts`, including rejection of subreddit-scoped input on the global endpoint.
- Why now: `project.md` and the latest R5 writeback explicitly left the global keyword 30-day trend API/read model as the next missing product read path before going deeper on Scrapling evidence.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`13/13`). `npm run algo:phase1:full` passed.
- Next: Deepen Scrapling from provider-level routing into profile/session-level observability and evidence capture for technical targets, then use that evidence to tune dynamic escalation and demotion thresholds.

### 2026-04-18 14:49:34

- Scope: Completed the next `R4` vertical slice by adding `src/jobs/build-anomaly-events.job.ts` to materialize raw anomaly signals from persisted facts (`subreddit_trend_point`, `subreddit_daily_fact`, `keyword_trend_daily`, `post_growth_fact`) into `anomaly_event` with deterministic scoring/explain payloads for `volume/quality/keyword/driver`. Wired this job into both `src/workers/reddit-phase1.worker.ts` and `workers/reddit-phase1-scheduler.ts` so phase1 cycle and scheduler replay paths now both produce anomaly rows. Added focused coverage in `tests/unit/build-anomaly-events.job.test.ts` and extended `tests/integration/reddit-phase1-cycle.test.ts` to verify cycle wiring.
- Why now: `project.md` `next_action` required first anomaly-event materialization from persisted facts so the existing anomaly feed and incident APIs can consume continuously produced signals instead of relying on manual inserts.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/build-anomaly-events.job.test.ts tests/integration/reddit-phase1-cycle.test.ts tests/unit/build-post-growth-facts.job.test.ts` passed (`4/4`). `npx tsx --test tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts` passed (`2/2`). `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`11/11`). With `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, direct Postgres execution of `buildAnomalyEventsJob` over the last 72h inserted anomaly rows (`insertedCount=1`, `signalTypes=["keyword"]`) for `r/machinelearning`.
- Next: Add focused scheduler replay integration coverage for anomaly materialization ordering and tune R4 anomaly detection thresholds with bounded synthetic cases before freezing defaults.

### 2026-04-18 14:34:00

- Scope: Completed the next `R4` slice by adding cross-signal incident merge on top of persisted `anomaly_event` and exposing it via API. Added `src/application/services/subreddit-anomaly-incident-read-model.service.ts` to merge `volume/quality/keyword/driver` signals by shared window (`windowStart/windowEnd`, with deterministic fallback bucketing), compute `mergedScore`, severity, dominant signal type, and explain payload. Extended API contracts in `packages/contracts/src/http.ts` with `SubredditAnomalyIncidentFeedResponse`. Updated `apps/api/src/create-api-server.ts` with `GET /v1/trends/subreddit/:name/anomalies/incidents` (range, signal-type filter, limit) while keeping raw `/anomalies` feed unchanged.
- Why now: After landing raw anomaly feed, the next priority was user-facing merged incidents so anomaly consumers can reason about one incident object per window instead of manually combining multiple signal rows.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/subreddit-anomaly-incident-read-model.service.test.ts tests/unit/subreddit-anomaly-feed-read-model.service.test.ts tests/unit/anomaly-event.repository.test.ts` passed (`5/5`). `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`11/11`), including new `/anomalies/incidents` and invalid `signalType` coverage. With `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, direct Postgres verification (`listByTargetInRange + buildSubredditAnomalyIncidentReadModel`) produced merged top incident output with expected dominant signal and severity.
- Next: Add the first `anomaly_event` materialization job (from trend/daily/keyword/driver persisted facts) and wire it into the phase1 cycle before anomaly feeds, with focused integration coverage.

### 2026-04-18 14:24:54

- Scope: Completed the first consumer-facing `R4` anomaly read path on top of `anomaly_event`. Added read-model service `src/application/services/subreddit-anomaly-feed-read-model.service.ts` with deterministic severity mapping (`low/medium/high`) and score-first ordering. Extended API contracts (`packages/contracts/src/http.ts`) with `SubredditAnomalyFeedResponse`. Wired `anomalyEventRepository` into API dependencies (`apps/api/src/create-api-server.ts`) and added new endpoint `GET /v1/trends/subreddit/:name/anomalies` with range, `signalType` filter (`volume/quality/keyword/driver`), and `limit` support.
- Why now: The previous slice only established raw anomaly storage/repository contracts. We needed a product-consumable anomaly feed to start serving anomaly insights from persisted truth before tackling cross-signal incident merge semantics.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/subreddit-anomaly-feed-read-model.service.test.ts tests/unit/anomaly-event.repository.test.ts` passed (`4/4`). `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`10/10`), including the new anomaly feed case and invalid `signalType` guard. With `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, a direct Postgres verification (`upsertMany + listByTargetInRange + buildSubredditAnomalyFeedReadModel`) returned ordered/severity-mapped signals (`keyword 0.93`, `volume 0.81`, `driver 0.77`).
- Next: Implement anomaly incident merge rules on top of `anomaly_event` (`volume/quality/keyword/driver`), then expose a merged incident feed/API with focused regression coverage.

### 2026-04-18 14:12:46

- Scope: Completed the additive `R4` storage/repository foundation for raw anomaly signals. Added `src/domain/entities/anomaly-event.ts` and `src/domain/repositories/anomaly-event-repository.ts`, plus additive migration `src/storage/schema/016_anomaly_event.sql` with typed `signal_type`, time-window columns, `anomaly_score`, `algorithm_version`, and `explain_payload`. Implemented both storage lanes: `InMemoryAnomalyEventRepository` in `src/storage/repositories/in-memory/raw-target-trend.repositories.ts` and `PostgresAnomalyEventRepository` in `src/storage/repositories/postgres/postgres-anomaly-event.repository.ts`, then wired the new repository into `src/storage/repositories/postgres/postgres-repository-bundle.ts` and `src/storage/repositories/postgres/postgres-row-mappers.ts`.
- Why now: After completing `R3` driver reads, the next smallest bounded move in `project.md` was to land the raw anomaly persistence contract that future feed/incident consumers can build on without blocking on merge semantics.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/anomaly-event.repository.test.ts` passed (`3/3`) for filter/upsert/order semantics. With `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, `npm run db:migrate` applied `016_anomaly_event.sql`, and a direct Postgres repository verification confirmed `upsertMany` + `listByTargetInRange` returned the inserted `volume` and `keyword` signals with scores `[0.81, 0.93]`.
- Next: Layer the first consumer-facing anomaly read model/API on top of `anomaly_event`, starting with subreddit anomaly feed payloads and focused coverage.

### 2026-04-18 14:04:48

- Scope: Completed the next `R3` driver-consumption slice by extending the persisted driver feed with derived labels and keyword-scoped filtering. Updated `src/application/services/subreddit-driver-post-read-model.service.ts` so driver rows now emit stable `labels` (`breakout/surging/emerging` + `fresh/sustained/mature`) and optional `matchedQueries`. Updated `apps/api/src/create-api-server.ts` and `packages/contracts/src/http.ts` so `GET /v1/trends/subreddit/:name/drivers` accepts `keywords=` filters using `query_normalization_v2` plus `post_search_document` matching, while explicitly rejecting `global:` scope on a subreddit-bound endpoint. Added focused coverage in `tests/unit/subreddit-driver-post-read-model.service.test.ts` and expanded `tests/integration/api-server-trends.test.ts` for labels, keyword filtering, and invalid-scope rejection.
- Why now: The previous state exposed a subreddit driver feed but still lacked product-ready labels and the first keyword-scoped read path promised in the active `next_action`, so driver-post output was persisted but not yet queryable by topic.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/subreddit-driver-post-read-model.service.test.ts tests/unit/post-growth-fact.repository.test.ts` passed (`5/5`). `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`9/9`), including filtered `GET /v1/trends/subreddit/datascience/drivers?keywords=agent`. With `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, `npm run db:migrate` applied `015_post_growth_fact.sql`, and a direct Postgres repository verification confirmed `listTopByTargetInRange` returned driver scores `[93,82]` while `post_search_document.search(tokens=['agent'])` matched only the expected driver content.
- Next: Start the additive `anomaly_event` storage/repository slice for `R4`, then layer the first consumer-facing anomaly read model/API on top with focused coverage.

### 2026-04-18 13:52:01

- Scope: Completed the first `R3` driver-post read slice on top of persisted `post_growth_fact`. Extended `PostGrowthFactRepository` with a top-driver query (`listTopByTargetInRange`) and implemented deterministic per-content dedupe/sort semantics in both `src/storage/repositories/in-memory/raw-target-trend.repositories.ts` and `src/storage/repositories/postgres/postgres-post-growth-fact.repository.ts`. Added `src/application/services/subreddit-driver-post-read-model.service.ts`, wired `postGrowthFactRepository` into `apps/api/src/create-api-server.ts`, and exposed `GET /v1/trends/subreddit/:name/drivers` returning post metadata plus `driverScore`, velocity fields, `algorithmVersion`, and `explainPayload` from persisted facts only. Updated API test helpers/contracts accordingly.
- Why now: `project.md` `next_action` called for the first driver-post consumer on top of the new R3 fact table so product reads can start consuming explainable persisted driver rows instead of stopping at storage/materialization.
- Verify: `npm run typecheck` passed. `npx tsx --test tests/unit/post-growth-fact.repository.test.ts` passed (`4/4`), including the new top-driver dedupe/order case. `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`9/9`), including `GET /v1/trends/subreddit/datascience/drivers` coverage for persisted fact ordering, `ageBucket` filtering, and `explainPayload` passthrough.
- Next: Add driver labels plus the first keyword-scoped driver read path on top of `post_growth_fact` and existing post search/materialized inputs, with focused coverage.

### 2026-04-17 00:27:42

- Scope: Wired `post_growth_fact` materialization into runtime flow. Updated `src/workers/reddit-phase1.worker.ts` and `workers/reddit-phase1-scheduler.ts` so the cycle order now includes `buildPostGrowthFactsJob` after daily/trend materialization and before downstream keyword/driver consumers. Added `postGrowthFactRepository` wiring through scheduler repo picks and touched-target materialization path. Extended `tests/integration/reddit-phase1-cycle.test.ts` to assert in-cycle `post_growth_fact` persistence.
- Why now: R3 needed persisted growth facts to be generated automatically in the same collection cycle; without worker/scheduler wiring, the new schema/repository/job stack would remain disconnected from production flow.
- Verify: `npx tsx --test tests/unit/build-post-growth-facts.job.test.ts tests/unit/post-growth-fact.repository.test.ts` passed (`5/5`). `npx tsx --test tests/integration/reddit-phase1-cycle.test.ts` passed (`1/1`) with `postGrowthFactRepository.all().length > 0`. `npm run typecheck` passed. `npm run algo:phase1:full` passed (`29/29` unit + `6/6` phase1 integration).
- Next: Add the first driver-post read model on top of `post_growth_fact` (repository query + API endpoint payload with `driver_score` and `explain_payload`) plus focused integration coverage.

### 2026-04-17 00:25:39

- Scope: Completed the first bounded `R3` materialization slice on top of the new contracts. Added `src/jobs/build-post-growth-facts.job.ts` to emit `post_growth_fact` rows from persisted `content + metrics_snapshot` using `1h/6h/24h` age buckets, cohort-normalized velocity (`median/MAD`), bounded `driver_score`, explicit `algorithm_version=post_growth_v1`, and structured `explain_payload`. Added focused non-DB unit coverage in `tests/unit/build-post-growth-facts.job.test.ts`.
- Why now: After landing additive storage/repository contracts, the next smallest vertical step was to materialize real rows with deterministic normalization logic so downstream driver APIs can consume persisted facts instead of ad-hoc scoring.
- Verify: `npx tsx --test tests/unit/build-post-growth-facts.job.test.ts tests/unit/post-growth-fact.repository.test.ts` passed (`5/5`). `npm run typecheck` passed. Reduced truth-layer gate remains green: `npm run algo:phase1` passed (`29/29`).
- Next: Wire `post_growth_fact` materialization into the worker/scheduler flow order (after collection facts, before driver-facing reads), then add focused integration coverage that proves rows are persisted in-cycle.

### 2026-04-17 00:22:35

- Scope: Completed the first bounded `R3` storage/repository contract slice for driver-post work. Added additive schema `015_post_growth_fact.sql` with `algorithm_version` and `explain_payload`, plus new domain contracts `src/domain/entities/post-growth-fact.ts` and `src/domain/repositories/post-growth-fact-repository.ts`. Implemented both storage lanes: `InMemoryPostGrowthFactRepository` in `src/storage/repositories/in-memory/raw-target-trend.repositories.ts` and `PostgresPostGrowthFactRepository` in `src/storage/repositories/postgres/postgres-post-growth-fact.repository.ts`, wired through `src/storage/repositories/postgres/postgres-repository-bundle.ts`, and added row mapping support in `src/storage/repositories/postgres/postgres-row-mappers.ts`.
- Why now: `project.md` `next_action` required a non-breaking additive `post_growth_fact` persistence contract before any R3 driver scoring/materialization logic, so downstream algorithm slices can ship against stable storage interfaces.
- Verify: `npx tsx --test tests/unit/post-growth-fact.repository.test.ts` passed (`3/3`, non-DB coverage for filter/sort/limit/upsert semantics). `npm run typecheck` passed. Reduced truth-layer gate also remained green: `npm run algo:phase1` passed (`29/29`).
- Next: Implement the first bounded `R3` materialization slice: add a `post_growth_fact` builder that emits `1h/6h/24h` cohort-normalized velocity rows from existing persisted metrics/content with focused unit tests.

### 2026-04-17 00:15:41

- Scope: Reduced low-signal repeated test runs in the execution flow by splitting phase1 gates into unit and integration tiers. Updated `package.json` with `test:phase1:unit`, `test:phase1:integration`, and new `algo:phase1:full`, while making `algo:phase1` unit-only quick gate. Synced command policy across `00_START_HERE.md`, `docs/operations-runbook.md`, `skills/algorithm-dev-suite/SKILL.md`, `docs/execution-kickoff.md`, `docs/scrapling-integration-flow.md`, and `docs/stageb-target-rollout-criteria.md`.
- Why now: Current flow was repeatedly running integration gates for routine truth-layer edits where unit-only phase1 checks are sufficient, creating avoidable test cost without additional signal.
- Verify: `npm run algo:phase1` passed (`typecheck:core` + `29/29` phase1 unit tests). `npm run algo:phase1:full` passed (`typecheck:core` + `29/29` phase1 unit + `6/6` phase1 integration tests).
- Next: Start the bounded `R3` `post_growth_fact` storage/repository slice and keep this reduced gate policy: default `algo:phase1`, escalate to `algo:phase1:full` only when integration boundaries are touched.

### 2026-04-17 00:11:32

- Scope: Ran persisted `verify:phase1:postgres` evidence checks after the new non-DB scope-proof harness, covering both default query parsing and malformed-token input fallback. Verified script JSON still emits stable `scopeProofQueries` and `keywordExplicitScopeByQuery` from real PostgreSQL data.
- Why now: The harness secured parser/shape semantics in unit tests, but we still needed one DB-backed confirmation that runtime script output remained aligned under realistic execution.
- Verify: With `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, `REDDIT_RUN_MODE=mock`, `REDDIT_RUN_SUBREDDIT=machinelearning`: (1) default env produced `scopeProofQueries=["llm"]` and `keywordExplicitScopeByQuery[0].byScope={subreddit:16, global:16}` (`total=32`); (2) malformed `VERIFY_KEYWORD_SCOPE_QUERIES=' , a, , x '` produced the same fallback/stable output shape and counts. Both runs returned `ok=true`.
- Next: Start the first bounded `R3` slice by adding additive `post_growth_fact` storage/repository contracts with `algorithm_version` and `explain_payload`, plus focused non-DB unit coverage.

### 2026-04-17 00:10:16

- Scope: Completed the pending non-DB regression harness for `verify-phase1-postgres` scope-proof behavior. Added `scripts/verify-phase1-postgres.scope-proof.ts` with pure helpers for `scopeProofQueries` parsing and `keywordExplicitScopeByQuery` shape building, then rewired `scripts/verify-phase1-postgres.ts` to consume those helpers instead of inline logic. Added `tests/unit/verify-phase1-postgres.scope-proof.test.ts` covering default `llm`, dedupe, invalid token filtering, and zero-filled per-scope output shape stability.
- Why now: The previous verify-script scope-proof evidence depended on live Postgres output only; we needed a small deterministic harness so parser/shape regressions are caught without DB availability.
- Verify: `npx tsx --test tests/unit/verify-phase1-postgres.scope-proof.test.ts` passed (`4/4`). `npm run typecheck:core` passed. `npm run typecheck` passed.
- Next: Run one persisted `verify:phase1:postgres` pass with both default and malformed `VERIFY_KEYWORD_SCOPE_QUERIES` inputs to confirm script JSON output still matches harnessed parsing/shape semantics on real data.

### 2026-04-17 00:02:09

- Scope: Completed the pending R2 verify-script promotion by extending `scripts/verify-phase1-postgres.ts` with built-in per-query explicit scope evidence. Added `scopeProofQueries` resolution (default `llm`, env override via `VERIFY_KEYWORD_SCOPE_QUERIES`) and new output field `keywordExplicitScopeByQuery` showing per-normalized-query counts split by `subreddit/global` plus total.
- Why now: The previous flow still depended on ad-hoc SQL to prove mixed-scope explicit-query persistence for a specific normalized query; this needed to become first-class in the canonical verify output.
- Verify: `npm run typecheck` passed. With `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`, `REDDIT_RUN_MODE=mock`, `REDDIT_RUN_SUBREDDIT=machinelearning`, `VERIFY_KEYWORD_SCOPE_QUERIES=llm`, `npm run verify:phase1:postgres` now prints `scopeProofQueries` and `keywordExplicitScopeByQuery`, including `normalizedQueryText=llm` with `byScope.subreddit=16` and `byScope.global=16`.
- Next: Add a small non-DB regression harness for verify-script scope-proof parsing/output-shape so this evidence field remains stable without depending on live Postgres runs.

### 2026-04-16 23:59:22

- Scope: Completed one medium R2 verification slice: added mixed-scope API coverage for explicit query semantics and executed persisted PostgreSQL verification in the same cycle. Updated `tests/integration/api-server-trends.test.ts` to assert one request with `keywords=global:llm,llm` returns both explicit scope rows (`global` + `subreddit`) in a single `/v1/trends/subreddit/:name/daily` response.
- Why now: The prior state proved each scope independently; we still needed one-request mixed-scope proof plus a fresh persisted run to confirm dual-scope behavior remains stable on materialized DB data.
- Verify: `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`8/8`). `npm run ops:prewarm:keyword-query` with `KEYWORD_QUERY_PREWARM_TARGETS='llm@machinelearning;global: llm'` succeeded (`supportCount=39` for subreddit, `171` for global). `npm run verify:phase1:postgres` (`REDDIT_RUN_MODE=mock`, `REDDIT_RUN_SUBREDDIT=machinelearning`) passed and reported `keywordTrackDistribution`: `auto_keyword/subreddit=17353`, `explicit_query/subreddit=73`, `explicit_query/global=16`. Direct DB check for normalized query `llm` confirmed both scopes persisted: `subreddit=16`, `global=16`.
- Next: Promote this persisted proof into `verify-phase1-postgres` output by adding a built-in per-normalized-query scope split section (start with `llm`) so mixed-scope evidence is first-class in the script output.

### 2026-04-16 23:35:05

- Scope: Hardened R2 explicit-query daily-read correctness for invalid keyword input. Updated `/v1/trends/subreddit/:name/daily` keyword parsing in `apps/api/src/create-api-server.ts` to reject invalid keyword query items instead of silently dropping them. Tightened normalization in `src/application/services/query-normalization-v2.service.ts` so scope-only inputs (`global:`, `r/<subreddit>:`) fail validation after scope stripping. Added regression coverage in `tests/integration/api-server-trends.test.ts` and `tests/unit/query-normalization-v2.service.test.ts`.
- Why now: The previous API path could silently ignore malformed `keywords` entries and broaden results to unfiltered materialized rows, which violates explicit-query semantics and can return misleading data.
- Verify: `npx tsx --test tests/unit/query-normalization-v2.service.test.ts` passed (`4/4`, including scope-only rejection). `npx tsx --test tests/integration/api-server-trends.test.ts` passed (`8/8`, including new invalid-keyword 400 case and existing global/subreddit scope filtering). `npm run algo:phase1` passed (`35/35`). `npm run algo:full` passed (`150/150`).
- Next: Add one mixed-request API case (`keywords=global:llm,llm`) to assert dual-scope rows are both returned deterministically in a single response, then run one persisted PostgreSQL `verify:phase1:postgres` pass to capture materialized evidence for that read path.

### 2026-04-16 23:28:01

- Scope: Closed the pending real-DB proof for `R2` dual-track keyword materialization and improved the verification surface. Seeded explicit keyword query sessions into PostgreSQL with `npm run ops:prewarm:keyword-query` for `r/machinelearning` (`github`, `https`, `llm`, `ai`) and reran `npm run verify:phase1:postgres`. Then seeded a global-scope query (`global: llm`) and reran verification to exercise query-scope v2 behavior in persistence. Upgraded `scripts/verify-phase1-postgres.ts` to output `keywordTrackDistribution`, include `track/queryScope/normalizedQueryText/algorithmVersion` in keyword previews, and add a dedicated `explicitKeywordRows` preview from materialized storage.
- Why now: The last state proved schema + code in tests, but PostgreSQL evidence still showed only `auto_keyword/subreddit` rows; we needed explicit proof that seeded query sessions feed `explicit_query` materialization, including global-scope semantics.
- Verify: Prewarm succeeded on DB `postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`: `github` (`supportCount=8`), `https` (`1`), `llm` (`39`), `ai` (`19`) scoped to `r/machinelearning`, plus global `llm` (`171`). `npm run verify:phase1:postgres` passed twice after seeding, and now reports `keywordTrackDistribution` with both explicit scopes: `auto_keyword/subreddit=17353`, `explicit_query/subreddit=73`, `explicit_query/global=16` (`keyword_trend_daily=17442`). `materializedPreview.explicitKeywordRows` now shows persisted explicit rows with `track=explicit_query`, `queryScope` (`subreddit` and `global`), `normalizedQueryText`, and `algorithmVersion=keyword_trend_v2_dual_track`. `npm run typecheck` passed after the verify-script update.
- Next: Add focused integration tests for `/v1/trends/subreddit/:name/daily` explicit query scope semantics (especially `global:` query input) so API-level filtering behavior is locked to the same single-source materialized read path.

### 2026-04-16 23:22:25

- Scope: Started `R2` query-trend upgrade with a complete dual-track keyword materialization slice. Added `query-normalization v2` (`src/application/services/query-normalization-v2.service.ts`) covering lowercase normalization, phrase groups, token-overlap dedupe, alias-boundary matching (`ai/llm/ml`), and query-scope parsing (`global:` and `r/<subreddit>:`). Upgraded `keyword_trend_daily` to dual track via migration `014_keyword_trend_dual_track.sql` (`track`, `normalized_query_text`, `query_scope`, `algorithm_version`, `explain_payload`) and wired entity/repository mapper/storage updates across in-memory and Postgres implementations. Updated keyword daily materialization (`build-subreddit-keyword-trend-daily.job.ts`) to emit both `auto_keyword` and `explicit_query` rows from the same tier-aware day-fact thresholds, including breakout/explain payload. Wired worker (`reddit-phase1.worker.ts`) to feed explicit query candidates from existing keyword-query sessions. Updated `/v1/trends/subreddit/:name/daily` read path to consume materialized keyword rows directly (single-sourced in API path), with explicit-query filtering using normalization v2.
- Why now: `next_action` explicitly required entering `R2` with normalization-v2 semantics plus explicit-query and auto-keyword dual-track materialization, and to prove 30-day keyword heat remains explainable and single-sourced from persisted fact/read-model layers.
- Verify: `npm run typecheck:core` passed. Focused suites passed: `tests/unit/query-normalization-v2.service.test.ts`, `tests/unit/api-validation.test.ts`, `tests/unit/build-subreddit-keyword-trend-daily.job.test.ts`, `tests/unit/subreddit-daily-insights.service.test.ts`, `tests/integration/api-server-trends.test.ts`, `tests/unit/keyword-pulse-query.service.test.ts`, `tests/unit/keyword-query-live-refresh.service.test.ts`, `tests/integration/api-server-keyword-query.test.ts`. Regression gates passed: `npm run algo:phase1` (`35/35`) and `npm run algo:full` (`147/147`). Postgres verification also passed with `DATABASE_URL=postgresql://postgres:13923276897Ak@localhost:5432/reddit_monitoring`: `npm run db:migrate` applied `014_keyword_trend_dual_track.sql`, and `npm run verify:phase1:postgres` returned `ok: true` with updated persisted counts (`keyword_trend_daily=17353`, `subreddit_daily_fact=46`, `subreddit_trend_point=67`). Direct SQL check confirms schema is active and currently materialized rows are `auto_keyword/subreddit` only (`explicit_query` rows not present yet) because no live keyword-query sessions have been seeded in this DB lane.
- Next: Seed explicit keyword-query sessions in Postgres and run one more persisted phase1 verification pass that directly inspects `keyword_trend_daily.track/query_scope/normalized_query_text` rows to prove dual-track persistence on live DB data (beyond in-memory and API contract tests).

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
### 2026-04-18 16:43:19

- Scope: Audited whether the current algorithm framework meets the original design targets from C:/Users/21274/Downloads/Reddit数据分析算法设计.md; validated implementation across daily facts, tiered quality, keyword trend/query, driver scoring, anomaly events, API outputs, and provider/runtime policy wiring.
- Why now: User requested a direct standards check on the current framework readiness.
- Verify: Cross-checked code in src/jobs/build-subreddit-daily-facts.job.ts, src/domain/services/subreddit-daily-heat.service.ts, src/jobs/build-subreddit-keyword-trend-daily.job.ts, src/jobs/build-post-growth-facts.job.ts, src/jobs/build-anomaly-events.job.ts, apps/api/src/create-api-server.ts, src/runtime/reddit-phase1-runtime.ts, and src/connectors/reddit/create-reddit-connector.ts; executed npm run algo:phase1 (pass: core typecheck + phase1 unit 29/29).
- Next: Close remaining gaps with a dedicated global keyword 30-day trend API/read model and a stronger provider-policy abstraction beyond provider-hint routing.

### 2026-04-18 21:58:48

- Scope: Reviewed Obsidian project state to plan the current problem and near-future work order. Consolidated signals from `project.md`, `目前问题.md`, and `登录系统设计与上线阿里云.md` into one execution priority: keep the mainline on algorithm/runtime productization, treat auth/deployment as a later product shell, and call out the state drift between old `Current Focus` text and the latest `next_action`/activity entries.
- Why now: User requested a planning pass from the `obsidian-reddit专用/Projects` workspace instead of more code changes.
- Verify: Read frontmatter/current focus/latest activity in `obsidian-reddit专用/Projects/project.md`, all items in `obsidian-reddit专用/Projects/目前问题.md`, and the auth/deployment notes in `obsidian-reddit专用/Projects/登录系统设计与上线阿里云.md`.
- Next: Execute the first `R5` provider-policy slice (`fetch-execution-engine`, `provider-routing-policy`, `/readyz` truth-path health) first; backfill the missing global keyword 30-day trend API/read model next; only after those truth/read-model gaps are closed should auth invite/session work and Aliyun deployment hardening move onto the active path.

### 2026-04-18 22:34:36

- Scope: Completed the first bounded `R5` provider-policy institutionalization slice for deeper Scrapling integration. Added shared provider-health thresholds in `src/runtime/reddit-provider-health-thresholds.ts`, new routing policy in `src/runtime/reddit-provider-routing-policy.ts`, and a policy-aware fetch execution engine in `src/runtime/reddit-fetch-execution-engine.ts`. Wired the runtime path (`src/workers/reddit-phase1.worker.ts`, `workers/reddit-phase1-once.ts`, `workers/reddit-phase1-scheduler.ts`, `src/application/use-cases/trigger-reddit-phase1-run.use-case.ts`) so promoted Scrapling targets now resolve from persisted truth into one of three actions: keep Scrapling, escalate Scrapling to `dynamic`, or demote to `http`. Extended `/readyz` observability/contracts to expose routing-policy summary and active fallback counts from the same truth path, and enriched `scripts/scrapling_reddit_bridge.py` with profile/fetcher headers for later profile-level evidence.
- Why now: User requested that `R5` be made real and asked for deeper Scrapling fusion instead of leaving the repo at target-level `providerHint` routing only.
- Verify: `npm run typecheck` passed. Targeted coverage passed: `npx tsx --test tests/unit/reddit-provider-routing-policy.test.ts tests/integration/reddit-phase1-provider-routing.test.ts tests/integration/api-server-readyz.test.ts`. Full gate passed: `npm run algo:phase1:full` (`29/29` phase1 unit + `8/8` phase1 integration after the new routing cases).
- Next: Build the missing global keyword 30-day trend read model/API, then deepen Scrapling beyond provider-level evidence by capturing profile/session-level observability on technical targets so `dynamic` vs `http` escalation can be calibrated from persisted data instead of static thresholds alone.

### 2026-04-24 18:29:57

- Scope: Added bounded per-target backfill looping in `src/workers/reddit-phase1.worker.ts` so backfill runs can continue across multiple cursor windows until a configurable day-coverage target or terminal EOF, with env wiring in `src/runtime/reddit-phase1-runtime.ts`. Also tightened storage pressure in `src/jobs/collect-subreddit-new-posts.job.ts` so candidate filtering now gates persisted `content` rows and `metrics_snapshot` points instead of only observability counts.
- Why now: User hit the current gap directly on `r/worldnews`: a single backfill run can page, but without repeated bounded iterations and real persistence filtering, high-volume subreddits both fail to form usable history quickly and risk storing too much low-value post/snapshot data.
- Verify: `npm run typecheck` passed. `node --import tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts tests/integration/reddit-phase1-cycle.test.ts` passed (`14/14`), including the new multi-iteration backfill coverage test and the candidate-filter persistence assertions.
- Next: Surface explicit backfill coverage states (`empty/partial/degraded/complete`) through the workbench/API, then add raw-event pressure controls for high-volume backfill so filtered persistence also reduces operational evidence storage pressure.

### 2026-04-25 00:00:00

- Scope: Hardened bounded 15-day backfill defaults for higher-volume targets. Added explicit backfill defaults in [src/workers/reddit-phase1-defaults.ts](/root/reddit-monitoring-mvp/src/workers/reddit-phase1-defaults.ts), wired `backfillPostLimit` plus higher default iteration budget through [src/workers/reddit-phase1.worker.ts](/root/reddit-monitoring-mvp/src/workers/reddit-phase1.worker.ts) and [src/runtime/reddit-phase1-runtime.ts](/root/reddit-monitoring-mvp/src/runtime/reddit-phase1-runtime.ts), and added regression coverage in [tests/unit/reddit-phase1-runtime.test.ts](/root/reddit-monitoring-mvp/tests/unit/reddit-phase1-runtime.test.ts) plus [tests/integration/reddit-phase1-cycle.test.ts](/root/reddit-monitoring-mvp/tests/integration/reddit-phase1-cycle.test.ts) for a higher-volume target that previously needed more than 12 cursor pages to cross 15-day history.
- Why now: Current backfill behavior was effectively budget-limited on busy subreddits because it reused live boost sizing (`40`) and only `12` default iterations, which can stall near 1-2 days of history even though the range target is 15 days.
- Verify: `npm run algo:fast`, `npm run algo:phase1`, `npm run algo:phase1:full`, and `npm run algo:full` all passed. The new integration case proves default backfill now traverses 13 pages, reaches content on or before `2026-04-09`, and materializes a daily fact on or before `2026-04-09` without explicit per-run overrides.
- Next: Expose backfill coverage progress in the API/workbench so operators can tell whether a 15-day request is empty, partial, degraded, or complete before adding more chart surfaces.

### 2026-04-25 00:20:00

- Scope: Added tiered backfill candidate filtering in [src/jobs/collect-subreddit-new-posts.job.ts](/root/reddit-monitoring-mvp/src/jobs/collect-subreddit-new-posts.job.ts) so backfill now derives `subreddit tier` from the latest `subscribers` snapshot and applies bounded per-tier thresholds before persisting posts. The current tier policy is permissive for `micro/small` and stricter for `mid/large`, while `live` collection remains unchanged. Added focused coverage in [tests/integration/collect-subreddit-new-posts-p0.test.ts](/root/reddit-monitoring-mvp/tests/integration/collect-subreddit-new-posts-p0.test.ts) and updated [tests/integration/reddit-phase1-cycle.test.ts](/root/reddit-monitoring-mvp/tests/integration/reddit-phase1-cycle.test.ts) so a large target now keeps only a few high-quality posts per page but still reaches 15-day history.
- Why now: The latest backfill budget increase fixed page depth, but user feedback exposed the remaining imbalance: small subreddits can reach 15 days with sparse qualifying posts, while large subreddits still saturate persistence with too many relevant-enough posts and lose historical depth after 2-3 days.
- Verify: `npx tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts tests/integration/reddit-phase1-cycle.test.ts` passed (`16/16`). `npm run algo:phase1`, `npm run algo:phase1:full`, and `npm run algo:full` all passed. The large-target regression now records `candidateCount=100`, `filteredOutCount=95`, `acceptedCount=5` per page while still reaching `2026-04-09` coverage; the small/large filter test confirms the same raw page keeps `2/2` posts for `small` but only `1/2` for `large`.
- Next: Surface tier-aware backfill coverage and filtered-volume diagnostics in Ops/workbench so we can calibrate whether `mid/large` thresholds should be raised further or replaced with a per-day accepted-post cap.

### 2026-04-25 03:51:00

- Scope: Verified that the repo-side web build was newer than source but the live release under `/opt/reddit-monitoring/current` was still serving the older `2026-04-24` web/API artifacts. Rebuilt the current repo, backed up the release `dist` directories under `/opt/reddit-monitoring/backups`, synced fresh `dist/` and `apps/web/dist/` into `/opt/reddit-monitoring/current`, and restarted `reddit-api`, `reddit-phase1-scheduler`, and `reddit-keyword-refresh`.
- Why now: The user had completed substantial algorithm/runtime changes, but browser behavior strongly suggested the host was still serving an older release bundle. Deployment evidence confirmed that suspicion: Nginx and systemd pointed at `/opt/reddit-monitoring/current`, whose assets had not been refreshed.
- Verify: `npm run build` passed. `npm run smoke:compiled` passed. After sync/restart, `systemctl is-active reddit-api reddit-phase1-scheduler reddit-keyword-refresh nginx` all returned `active`. `curl -fsS http://127.0.0.1/healthz` returned `ok=true`. Nginx now serves `/assets/index-Dh3EX2UF.js` and `/assets/index-BUFcVQp6.css` from `/opt/reddit-monitoring/current/apps/web/dist`, with `Last-Modified: Sat, 25 Apr 2026 03:49:32 GMT`.
- Next: Hard-refresh the browser once to force a fresh `index.html` fetch, then validate the algorithm-driven UI/output against the redeployed backend/runtime. If live behavior is still stale, the next check is release-specific API data rather than bundle drift.
