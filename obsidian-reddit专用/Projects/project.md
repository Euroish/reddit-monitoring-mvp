---
title: "project"
type: codex-project-workspace
status: active
stage: language-switch-deployed
updated_at: "2026-04-29 08:17:51"
repo_path: "/root/reddit-monitoring-mvp"
next_action: "Browser-check the deployed Simplified Chinese language switch across logged-in desktop/mobile views, then fill any untranslated secondary admin pages only if they block actual use."
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

- Authority: this file is the active state source. The active frontend implementation contract for the current slice is `docs/frontend-upgrade-workflow-2026-04-29.md`.
- Startup set for the current slice: `00_START_HERE.md`, this file, and `docs/frontend-upgrade-workflow-2026-04-29.md`.
- Archive: keep `Archive/` empty by default. External analysis notes are temporary inputs only; read, reconcile against code, update this file or the active implementation contract, then remove.
- Product truth: this is a bounded monitored Reddit analytics workbench. The target workbench now exposes captured-day chart semantics plus a broader fetched-data composition pool across `new` / `hot` / `best` / `rising` / `top` provenance. `new` remains the time-contiguous total-volume evidence; the additional listing lanes support fetched-pool display, driver fallback, and composition analysis.
- Runtime path: `http` primary plus `scrapling` fallback capability. Legacy Apify is not an active main path.
- Current frontend truth: `WorkbenchChart` uses `lightweight-charts`, `/target/:targetId` has the third-pass scale polish, and the deployed web app now has an English/Simplified Chinese language switch in the top-right account area plus auth-page access.

## Attention Hygiene

- Live state files for this slice: `00_START_HERE.md`, this file, and `docs/frontend-upgrade-workflow-2026-04-29.md`. `AGENTS.md`, skill docs, and architecture notes are static constraints, not task queues.
- `obsidian-reddit专用/Projects/后端能力盘点与前端后台规划-2026-04-28.md` is now a historical advisory note. Do not treat it as the live frontend implementation contract unless this file explicitly promotes it again.
- Advisory filenames previously read in this repo are historical inputs only. Do not carry their headings or proposed todo lists forward unless the same issue is still visible in current code.
- Ignore local tool state such as untracked `.codex/` during project planning unless the user explicitly asks to inspect tool internals. It is workspace noise, not product state.
- Do not create additional planning surfaces in repo root, `context/`, or ad hoc markdown files for the same execution slice beyond the active implementation contract named above.

## Harness Rules

- One slice at a time: active execution is the smallest complete product-facing slice that lands frontend/admin value on top of the existing refresh contracts without reopening backend architecture.
- Evidence before design: current filesystem and current code win over remembered analysis notes, prior chat summaries, or archived markdown.
- Structure follows contracts: frontend and admin work must consume landed refresh contracts and verified API/data boundaries before asking for new backend branches.
- Compatibility is explicit: when replacing storage or read paths, keep fallback reads or migration compatibility until focused tests prove parity.
- Stop when the next step would require widening product scope beyond the active implementation contract, rewriting unrelated backend layers, or changing retention/runtime defaults without the corresponding API/data-contract work in the same slice.

## Current State

- Coverage semantics are landed: `content.total_eligible`, collection provenance, day-level coverage facts, target workbench, comparison workbench, and legacy daily trend API all distinguish observed counts from complete totals.
- `post_volume` / `qualified_post_volume` in daily facts remain observed eligible facts. They become product-facing totals only through a coverage-complete read-model gate.
- The storage-pressure slice is closed through `P3.4`, and `P4.1` market target-status visibility is now landed on the backend.
- `post_engagement_latest` plus bounded `post_engagement_window` storage now back new writes and materialization reads. Legacy post-level `metrics_snapshot` fallback reads were removed, target-only cleanup is migration-backed, and retention prunes engagement windows separately.
- `P3.4` is now landed: `collect-subreddit-new-posts.job.ts` has explicit collection-page, normalized-batch, persistence-plan, and outcome seams instead of one monolithic mutable flow.
- Current backend shape already has the right macro layers: evidence, canonical entities, derived facts/materialization, and read-model services. The active gap is no longer backend layering; it is product/frontend delivery on top of the landed contracts.
- Data-structure/framework direction is now confirmed and temporarily closed for this slice: do not reopen broad backend renames, new orchestration paths, or speculative serving layers while product-facing work remains unfinished.
- Scheduler/materialization scope hardening is now landed across both replay and direct cycle paths: `workers/reddit-phase1-scheduler.ts` emits `TouchedTarget.scope`, scheduler replay uses it to narrow rebuild windows, coverage rebuilds also consume it, and direct cycle plus replay now share one target materialization chain in `src/workers/reddit-phase1-materialization.ts`.
- Serving refresh contract hardening is now also landed for workbench reads: compare, market, and target routes no longer assemble broad repository fan-in inline inside `create-api-server.ts`; they now go through explicit refresh-contract loaders in `src/application/services/workbench-refresh-contract.service.ts`.
- `P4.2` backend data-structure optimization is now closed in current code. The active execution contract is `docs/frontend-upgrade-workflow-2026-04-29.md`, which is intentionally tied to current code truth instead of the older capability-inventory note.
- The active product slice is:
  - market surfaces: `/markets` and `/markets/board`
  - analysis surfaces: `/target/:targetId`, `/compare`, `/queries`, `/saved`
  - admin surfaces: `/ops`, `/ops/storage`, then `/ops/targets`, `/ops/collection`, `/ops/maintenance`
- `post_engagement_daily`, explicit materialization manifests, and market-serving projections remain design-approved next-step candidates, but they are not the active slice while the current product/frontend contract is unfinished.
- Historical analysis notes such as `后端功能分析.md` are reconciled and inactive. The current detailed execution contract for the frontend slice is `docs/frontend-upgrade-workflow-2026-04-29.md`.
- Current repo search did not find a standalone export/report generator path. Future export/report work must reuse coverage-aware API/read-model fields.
- Current repo evidence shows the market workbench contract now includes `targets[]` with per-target crawl freshness, live/backfill coverage status, latest observed headline metrics, and a compact live reliability summary.
- Current repo evidence also supports the frontend constraints captured in the active implementation contract: market UI is currently front-end-limited to 8 items, compare is back-end-limited to 6 targets, target-level scheduling config exists in the data model, and comment-level analytics are not yet supported.
- Auth surface status is now explicit: backend supports invite-based registration through `POST /auth/register`, admin invite creation exists in `/ops/invites`, and the frontend now has both `/login` and `/register` routes. Any remaining onboarding work should be based on browser/product validation, not the older assumption that registration UI is missing.
- Current repo evidence also explains the qualified-post drift: `src/jobs/build-subreddit-daily-facts.job.ts` now computes daily qualified counts through `resolveDailyQualityThreshold()` plus `isQualifiedDailyPost()`, using subreddit-tier floors and per-day percentile-derived thresholds instead of a fixed legacy `like > 20 && comment > 20` rule.
- Current repo evidence also explains why `/markets` now feels materially heavier than the earlier route: `apps/web/src/pages/Dashboard.tsx` mounts both `/v1/trends/market` and `/v1/workbench/market`, while `src/application/services/workbench-refresh-contract.service.ts` fans the market workbench read across every active target for breakout facts, recent content, anomaly rows, provider-health windows, coverage rows, and both live/backfill cursors before the page can show its full state.
- Automatic-collection control is now materially improved in product code: `apps/web/src/pages/OpsTargets.tsx` now presents `favorite` as the operator-facing `Auto collect` toggle, and `apps/web/src/pages/OpsCollection.tsx` now consolidates automatic target scope, effective cadence, live/backfill budget, and scheduler selection fallback into one admin page instead of forcing operators to infer behavior from separate pages.
- SQL cleanup control is also improved in product code: `apps/web/src/pages/OpsMaintenance.tsx` now exposes per-action scope copy, retention override, batch size, dry-run, and loop-until-done behavior on top of the existing retention-backed prune endpoints in `apps/api/src/create-api-server.ts`. The remaining gap is no longer basic cleanup access; it is whether the product also needs a deeper scoped deletion contract by target/date/data-family.
- Target workbench count semantics are now materially different from the earlier observed-only model, but the latest user feedback changes the desired end state again:
  - chart-facing captured-day counts now prefer `content.first_seen_at` plus fetched listing totals instead of treating `created_at_source` day facts as the only user-facing count source
  - the target detail page summary now presents `Captured New Posts` / `Captured Qualified Posts` instead of falling back to `Observed ...` wording
  - the collection write path now records `new_posts_15m` as the unique total-eligible listing count captured in that polling window, not only newly inserted corpus rows
- New requested content-scope direction from browser testing is now implemented in code:
  - product-facing target detail no longer promotes `observed` wording in the primary workbench UI
  - live collection keeps the `new` lane and also requests `hot`, `best`, `rising`, and daily `top` supplement lanes in parallel
  - content provenance now accepts `hot_listing`, `best_listing`, `rising_listing`, and `top_supplement`
  - target workbench composition exposes fetched listing/classification/engagement mixes from real read-model data
- Qualified-post semantics are now reconciled toward Reddit-style "quantity plus quality" instead of the temporary fixed `20/20` fallback:
  - daily thresholds are tier-aware again
  - qualified classification now allows balanced quality posts plus score-led or discussion-led breakout posts
  - target-workbench captured qualified counts are now derived from the captured-day corpus with latest engagement, so "all qualifypost fetched that day" is closer to the product truth than the older observed/materialized-only path
- New qualified-post acceptance feedback is implemented in code: tier thresholds were lowered and the classifier now accepts balanced, score-led, and discussion-led posts. The UI exposes the widened rule in the composition summary.
- Current repo state has entered the frontend upgrade phase because the key backend/product semantics the user was blocking on have been stabilized in code:
  - route-level error boundary and lazy loading are already in place for basic page-stability hardening
  - admin automatic collection and retention-backed cleanup flows are exposed in product UI
  - target chart counts now reflect fetched listing capture semantics instead of only reduced observed/materialized semantics
- First frontend upgrade code slice is now landed in the working tree and ready for commit after review:
  - `apps/web/src/features/workbench/components/WorkbenchChart.tsx` now wraps `lightweight-charts` with local legend/readout, crosshair, drag/zoom, line/histogram support, dual price scales, and TradingView attribution.
  - `apps/web/src/pages/TargetDetail.tsx` now uses a chart-first command surface: metric rail, primary chart stage, compact controls, saved/query/compare context strips, and lower analysis panels instead of broad card stacking.
  - `apps/web/src/index.css` now carries the active visual-system direction: dark analytical surface, subtle grid/radial depth, amber/cyan accents, compact pill controls, target workbench layout tokens, and responsive collapse.
  - `apps/web/src/components/Phase1RunCard.tsx`, `apps/web/src/pages/OpsCollection.tsx`, and `apps/web/src/pages/OpsTargets.tsx` have small React 19 lint-compatible state/dependency cleanups only; product behavior was not intentionally changed.
- Current user acceptance feedback recovery is landed in working tree:
  - target detail now uses a less card-like hero/workbench layout inspired by TradingView density and Spaceship-style polished depth
  - interactive composition donut is backed by `TargetWorkbenchResponse.composition`
  - total fetched posts, qualified posts, and driver count are promoted to large primary readouts
  - driver posts fall back to captured hot/best/rising/top listing posts when post-growth driver facts are empty
  - live collection fetches `new`, `hot`, `best`, `rising`, and `top` lanes with provenance
- Current visual scale feedback is also landed in working tree:
  - used local `awesome-design-md-main` references for Stripe's generous chrome around dense data, Linear's dark precision hierarchy, and Coinbase's large-radius spacious containers
  - widened the target hero from cramped three-column cards to a wider two-column hero plus full-width composition module
  - increased metric panel padding, row height, and display-number scale so labels and large numerals are no longer compressed
  - added a chart-top `Captured Qualified Posts` visualization band with large count, fetched-pool percentage, and a tall progress bar
- Latest deployed frontend slice is now multilingual:
  - `apps/web/src/i18n/LanguageContext.tsx` and `apps/web/src/i18n/LanguageToggle.tsx` provide persisted English / Simplified Chinese switching through `localStorage`
  - the logged-in topbar places the language switch immediately to the left of the account email/login controls
  - login/register, route loading/access-denied states, main navigation, markets/dashboard, market board, compare, target detail, collection, and target-admin flows now use the shared translation helper for fixed UI copy
  - backend-returned data labels, subreddit names, signal keys, and chart series labels remain untranslated unless explicitly mapped, to avoid changing data meaning
- Remaining live-product regressions/user-reported gaps now need explicit resolution before broad surface expansion:
  - qualified-post counts appear materially lower than the prior user expectation of `like > 20 && comment > 20`, so the current qualified-post algorithm/threshold path needs reconciliation against historical behavior and honest recovery options
  - returning to `/markets` after visiting another page can still black-screen or stall, so route-transition stability around the market page remains unresolved
  - the general-user Phase 1 run 5000-cap gap is now closed in both UI and API validation, but this should still be regression-tested in live usage
  - admin automatic collection is understandable in one flow, but the backend scheduling rule still uses the existing `favorite targets if any, else all active targets` fallback and has not been redesigned beyond that verified behavior
  - admin retention-backed cleanup is operable in the UI, but deeper scoped deletion plus rebuild/invalidation semantics are still undecided

## Core Decision

- Previous decision: `new` listing evidence was the only total-volume candidate source because it is the time-ordered stream.
- Revised user-requested direction: the product should show all fetched data across `new`, `hot`, `best`, `rising`, and `top` as the visible captured-data pool. This requires a new provenance/read-model contract that separates time-contiguous total-volume claims from broader fetched/discovered content.
- `top` / `hot` / `best` / `rising` / search / manual supplement evidence can support discovery, drivers, composition charts, and "all fetched data" displays. They must not be silently treated as time-complete total-volume evidence unless a future source can prove time-contiguous completeness.
- `content` remains an observed corpus. It must not be treated as a complete Reddit post table unless each counted row is total-eligible and the requested day/range has coverage proof.
- Candidate filters may support driver posts, keyword discovery, growth, anomaly, and qualified-signal work. They must not determine the denominator for total post volume.
- `iteration_budget_exhausted` means this run used its budget and should continue later; it is not final proof of source limitation.
- Missing history stays `missing`, `partial`, `source_limited`, or `unknown`. Never materialize uncovered days as fake zero.
- Small subreddits may become complete for a 15-day historical window if backfill reaches the day start or true terminal EOF. Medium/high-volume subreddits usually need uninterrupted live monitoring from activation time before totals are commercially defensible.

## Completed Stack

- `P0.1` Done: Add `content` provenance and total-eligibility fields across domain, schema, Postgres repository, and in-memory/test repositories.
- `P0.2` Done: Split `collect-subreddit-new-posts.job.ts` page collection/write semantics so `new_listing` and `top_supplement` are no longer indistinguishable after ingestion.
- `P0.3` Done: Stop candidate filtering from shrinking the total-corpus denominator; keep filtering for analytics candidates and qualified/driver surfaces.
- `P0.4` Done: Update daily fact materialization to count only total-eligible `new` listing posts for observed volume.
- `P1.1` Done: Add coverage fact storage/read path with day granularity and concrete coverage status/basis.
- `P1.2` Done: Wire backfill progress and live/source-limited cursor evidence into coverage facts.
- `P1.3` Done: Added regression coverage for backfill-proven complete days, live-continuous complete days, missed live windows, iteration-budget continuation, and rate-limited live windows.
- `P2.1` Done: Update API contracts/read models/UI display rules for total-vs-observed semantics and coverage-aware chart/KPI behavior.
- `P2.2` Done: Target workbench, comparison read-model, and legacy daily trend API semantics are aligned. No standalone export/report generator exists in the current repo evidence.
- `P3.1` Done: Replace default full raw payload persistence with lightweight fetch-event summaries while retaining full raw payloads for HTTP errors, normalization failures, anomalous empty responses, provider diff evidence, and debug mode.
- `P3.2a`-`P3.2d` Done: Split target metrics from post engagement storage, add narrow latest/windowed post-engagement repositories, migrate daily/growth/keyword/trend jobs to the new reads with compatibility fallback, and switch ordinary collection writes to target snapshots plus structured engagement upserts.
- `P3.4` Done: Simplify `collect-subreddit-new-posts.job.ts` around concrete `CollectedPageRecord`, `NormalizedBatch`, `PersistencePlan`, and `CollectionOutcome` structures so collection truth, persistence writes, and observability counters are separated without changing behavior.
- `P4.1` Done: Extend the market workbench contract/read model/API so it returns a coverage-aware `targets[]` status surface for every monitored subreddit, including live/backfill cursor state, latest observed headline metrics, latest coverage row, and compact live reliability/freshness fields.
- `P4.2a` Done: Reconcile `后端功能分析.md` against current code and lock the backend simplification direction into project state. Verified conclusion: the repo already has raw/entity/fact/read-model layering; the next structural work is explicit invalidation/materialization scope, not broad renaming or early architecture freeze.
- `P4.2b` Done: Land explicit scheduler materialization scope. `executeRunnableCollectionJobs` now returns `TouchedTarget` rows with `scope.{affectedDays, affectedWindows, reasons}`, and `materializeTouchedTargets` now narrows daily/trend/keyword/growth rebuild windows from that scope instead of always replaying full fixed lookbacks.
- `P4.2c` Done: Unify target materialization flow. Coverage rebuilds now consume the same narrowed scope in scheduler replay, and both `runRedditPhase1Cycle` and scheduler replay now call the shared target fact pipeline in `src/workers/reddit-phase1-materialization.ts` instead of maintaining separate derived-data orchestration paths.
- `P4.2d` Done: Land explicit workbench refresh contracts for compare/market/target read paths. `create-api-server.ts` no longer hand-assembles those workbench fan-in bundles inline; contract-driven loaders in `src/application/services/workbench-refresh-contract.service.ts` now own those serving refresh boundaries and reuse the shared driver-keyword match helper.

## Next Slice Harness: Product Frontend And Admin Control Plane

- Objective: continue shipping the highest-value frontend and admin surfaces on top of the landed refresh contracts without reopening backend architecture.
- Verified current state: collection truth, coverage semantics, target-status backend, structured engagement storage, scheduler entrypoint scope, shared target materialization, and explicit workbench refresh contracts are landed.
- Verified frontend slice status:
  - `/target/:targetId`: chart kernel replacement and first visual-system pass are implemented and deployed, but user browser testing rejects the result as still too card-stacked and not visually polished enough.
  - shared chart adapter: `WorkbenchChart` keeps the existing product-level `chartOptions.ts` boundary and now powers both target and compare surfaces where imported.
  - React 19 lint compatibility: full `apps/web` lint is now green after small state/dependency fixes in touched admin/run surfaces.
- Recommended next slice: validate and deploy the recovered target route:
  - immediate: apply migration `028_listing_provenance_expansion.sql`, deploy API/web, run a fresh live collection, and browser-check `/target/:targetId`.
  - verify that hot/best/rising/top provenance appears in composition and that driver fallback is populated when growth facts are empty.
  - then: apply the improved chart/readout/visual-system direction to `/compare` without introducing frontend-only formulas or exceeding the backend 6-target cap.
  - later: revisit `/markets` and `/markets/board`, with route-return stability and heavy market workbench payload behavior treated as product reliability work, not visual polish.
  - no new backend orchestration branch unless a concrete API contract gap appears during implementation
- Keep the next slice product-facing and contract-respecting. Do not reopen backend architecture expansion, provider expansion, or speculative infra additions in the same step.
- Stop condition: stop before introducing new persistence layers, generic projection engines, route-local fan-in that duplicates the refresh-contract services, or admin actions that bypass the documented API boundary.

## Pre-UIUX Gate: Stability And Admin Completion

- Principle: do not start animation-heavy UI/art polish while route-loading semantics, qualified-post wording, and admin control boundaries are still unstable. First freeze the product contract and interaction model, then layer motion and visual depth on top.

### Verified Problem Analysis

- `/markets` route stability/perceived lag:
  - Frontend evidence: `apps/web/src/pages/Dashboard.tsx` mounts two separate queries and renders a much denser surface than the older market page.
  - Backend evidence: `buildMarketWorkbenchFromRefreshContract()` fans out target-by-target across multiple repositories, so route return now depends on a heavier multi-read path instead of a single rankings request.
  - Product impact: even if the route does not hard-crash, it is structurally more likely to stall, repaint late, or feel black-screen-like on return navigation.
- Qualified-post count drift:
  - Code evidence: the current daily fact pipeline is adaptive and threshold-derived, not a fixed historical `20/20` filter.
  - Product impact: the UI cannot imply old semantics unless the product explicitly restores them or exposes a switch/explanation.
- Automatic collection control status:
  - Existing capability: target enable/disable plus favorite cadence exist, global live/backfill budget defaults exist, scheduler entry and manual run-now entry exist.
  - Current UI now has a single operator-facing flow across `/ops/targets` and `/ops/collection` that answers `which targets auto-run`, `every how many hours`, and `how many new posts each automatic pass should fetch`.
  - Remaining boundary: backend scheduling semantics still intentionally use `favorite targets if any, else all active targets`; do not redesign that rule without a verified operator gap.
- SQL cleanup status:
  - Existing capability: retention-backed preview/prune already works for three storage buckets.
  - Current UI exposes retention-backed preview/prune controls with clearer scope, dry-run, batch, and loop-until-done behavior.
  - Remaining boundary: there is no scoped cleanup by target/date/data family, and no rebuild/invalidation safety contract for deleting deeper analytics data.

### Execution Order Before Deep UIUX Work

- Step 1: stabilize `/markets` navigation before redesigning the market surface.
  - Reproduce the return-navigation stall/black-screen path.
  - Measure `/v1/trends/market` versus `/v1/workbench/market` latency separately.
  - Decide the minimum fix path before polish: cache/prefetch/keep-previous-data on the frontend, or split the market workbench payload so the page no longer blocks on the heaviest per-target fan-out.
- Step 2: widened qualified-post product contract is landed in code.
  - The rule now uses lower tier thresholds plus balanced, score-led, and discussion-led acceptance.
  - Product copy must keep exposing the rule honestly because it is no longer legacy fixed `20/20`.
- Step 3: automatic collection UI consolidation is landed; keep future work limited to verified gaps.
  - Keep `/ops/targets` responsible for the monitored target pool and per-target inclusion/cadence semantics.
  - Keep `/ops/collection` responsible for global automatic-collection defaults such as default cadence, live post budget, backfill budget, backfill depth, and provider preference.
  - The current UI already includes one effective-summary view that tells the operator which targets will auto-run now and why; do not redesign backend scheduling semantics unless a concrete operator gap is observed.
- Step 4: retention-backed cleanup UX is landed; deeper deletion remains a separate contract decision.
  - Existing retention-backed cleanup UX now has clearer preview, scope copy, and result reporting.
  - Only after that, design a scoped cleanup contract for additional data families. Do not expose deletion of `content`, `crawl_cursor`, coverage/fact/trend/anomaly tables, or other derived state until the same flow also defines invalidation/rebuild behavior.
- Step 5: visual-system work has started on target detail only.
  - User feedback says the first pass is not sufficient and still feels card-stacked.
  - Next target-detail UI pass should explicitly study TradingView and Spaceship-style polish, create a less card-like workspace, and add interactive real-data visualizations before broadening the same language elsewhere.

### P3.2 Execution Order

- P3.2a Schema split first: keep `metrics_snapshot` for target-level `subscribers` / `active_users` / `new_posts_15m` only; add `post_engagement_latest` for latest per-post score/comment/upvote state and a bounded windowed post-engagement table for historical read paths that still need per-window post metrics.
- P3.2b Query contraction second: replace generic range scans that load many post-level EAV rows into TypeScript maps with narrow repository methods such as latest subscriber lookup, latest engagement by content, and bounded windowed engagement by target/range.
- P3.2c Reader migration third: move `build-subreddit-daily-facts.job.ts`, `build-post-growth-facts.job.ts`, and `build-subreddit-keyword-trend-daily.job.ts` to latest-engagement reads; move `build-subreddit-trend-points.job.ts` to bounded windowed engagement reads; keep compatibility fallback reads until focused tests prove parity.
- P3.2d Writer migration fourth: update `collect-subreddit-new-posts.job.ts` so ordinary collection writes one target snapshot row plus structured post-engagement upserts instead of per-metric EAV rows. Do not start `P3.4` before this lands.
- P3.2e Retention and cleanup last: done. Legacy post-level `metrics_snapshot` rows are pruned by migration, retention no longer treats them as active data, and fallback reads have been removed.

### P3.2 Design Guard

- Do not optimize `metrics_snapshot` with more indexes alone. The main pressure is row explosion and compatibility reads rebuilding latest post state in memory.
- `post_engagement_latest` must be keyed for cheap per-post replacement and direct readback by `content_id`/`target_id`.
- Windowed post engagement must be bounded to the exact history needed by growth/trend jobs; avoid recreating unbounded per-15-minute EAV history under a new name.
- Keep repository contracts honest: target metrics and post engagement are different shapes and should no longer share one generic list method.
- Preserve collection truth: candidate filtering may still reduce engagement persistence, but it must not change `content` corpus eligibility or `new_posts_15m` observed counts.
- Treat `collect-subreddit-new-posts.job.ts` simplification as a follow-on benefit of the storage split, not as an independent rewrite.

### P3.4 Structure Harness

- `CollectedPageRecord`: one fetched page plus listing/provenance metadata and raw-event retention decision.
- `NormalizedBatch`: merged post/account/upvote/comment normalization output keyed by external id so duplicate filtering and active-window checks happen once.
- `PersistencePlan`: the exact write set for accounts, content, target snapshots, post engagement latest/window rows, provider health deltas, and cursor updates.
- `CollectionOutcome`: counters/evidence only; job status transitions and observability should consume this instead of recomputing counts from mutable arrays.

### Verification Harness For P3.2/P3.4

- Focused repository tests: SQL contract tests for new tables/indexes and compatibility reads.
- Focused job tests: `collect-subreddit-new-posts` integration coverage for live/backfill writes, duplicate handling, candidate filtering, and target observed-count semantics.
- Focused read-model/materialization tests: daily facts, growth facts, keyword trend, and trend points parity between legacy and compressed storage paths.
- Required gate when code changes: `npm run algo:fast`, `npm run algo:phase1`, and `npm run algo:phase1:full` because this slice touches collection/storage/materialization boundaries.

## Guardrails

- Allowed: collector/storage truth fixes, provenance fields, coverage facts, retention/prune automation, favorite-target scheduling, coverage/data-quality contract fixes, and the smallest UI/API updates needed to expose honest total/observed semantics.
- Forbidden: provider expansion, broad architecture rewrites, catalog/dashboard expansion, whole-Reddit wording, treating supplement listings as total evidence, treating `iteration_budget_exhausted` as final source limitation, or cleanup that touches many layers without reducing storage pressure or improving coverage/provenance truth.
- Keep `activity_index` / `activity_confidence` as optional diagnostics. They do not replace raw post-count defaults unless the product explicitly changes KPI semantics.

## Drift Checks

- Before execution, check only:
  - frontmatter `stage`, `updated_at`, and `next_action`
  - `Current State`
  - the active implementation contract `docs/frontend-upgrade-workflow-2026-04-29.md`
  - latest 1-3 relevant `Activity Log` entries
- If the next action and current code disagree, fix this file first, then execute.
- If a file outside the startup set appears to define "current plan", treat that as drift and either archive it or explicitly mark it non-active here.
- If the worktree contains unrelated local artifacts, ignore them unless they affect build/test/runtime behavior.

## Verification Policy

- For algorithm/collection truth changes, start with `npm run algo:fast`.
- Run `npm run algo:phase1` when truth-layer behavior changes.
- Run `npm run algo:phase1:full` when collection/storage/API integration boundaries are touched.
- Run focused tests around any changed repository, job, read-model, or contract path before close-out.
- Documentation-only state updates do not require tests, but they must keep `project.md` aligned with the currently promoted implementation contract and mark older planning notes as historical when they drift from code.

## Activity Log

### 2026-04-29 08:17:51

- Scope: Added and deployed the frontend language-switch slice. The app now has a persisted English / Simplified Chinese switch, with the logged-in toggle placed in the top-right account area immediately left of the user email, and an auth-page toggle for login/register.
- Why now: The user requested a Simplified Chinese version as the final frontend feature for this iteration, with a specific placement requirement in the top-right account area.
- Verify: `npm --prefix apps/web run build` passed; `npm --prefix apps/web run lint` passed; deployed `apps/web/dist` to `/opt/reddit-monitoring/current/apps/web/dist`; reloaded `nginx`; verified `http://127.0.0.1/` serves the new bundle and `nginx`, `reddit-api`, `reddit-phase1-scheduler`, and `reddit-keyword-refresh` are active.
- Next: Browser-check the deployed Chinese switch across logged-in desktop/mobile views and fill any remaining untranslated secondary admin surfaces only if they block actual operation.

### 2026-04-29 07:02:58

- Scope: Applied the latest visual scale feedback to `/target/:targetId`. The target workbench hero is now wider and less compressed, composition spans full width, metric typography is larger, and a new high-visibility `Captured Qualified Posts` band sits above the chart with count, fetched-pool share, and progress visualization.
- Design references: Consulted local `awesome-design-md-main` entries for Stripe (`dense data, generous chrome`), Linear (dark-mode native hierarchy and large compressed numerals), and Coinbase (spacious large-radius financial containers). No external assets were copied.
- Verify: `npm --prefix apps/web run build` passed, `npm --prefix apps/web run lint` passed, and `git diff --check` passed.
- Next: Deploy this scale-polish slice and browser-check desktop target detail for typography compression, chart-top qualified-post emphasis, and narrow-width responsive fallback.

### 2026-04-29 06:48:43

- Scope: Landed the browser-feedback recovery slice. Added multi-listing live capture for `new`, `hot`, `best`, `rising`, and daily `top`; expanded content provenance constraints; widened the qualified-post classifier; added target-workbench composition data; added driver fallback from captured listing posts; and redesigned `/target/:targetId` around large fetched/qualified/driver readouts plus an interactive composition donut.
- Why now: The deployed first target-detail pass still felt card-stacked, under-emphasized total/qualified volume, showed no driver posts for empty growth facts, and only represented the new-listing path. This slice turns those into real backend/read-model/frontend changes instead of copy-only relabeling.
- Verify: `npm run build` passed, `npm --prefix apps/web run lint` passed, and `git diff --check` passed.
- Next: Apply migration `028_listing_provenance_expansion.sql`, deploy API/web, run fresh collection, and validate in browser that composition segments and driver fallback reflect live fetched data.

### 2026-04-29 06:37:39

- Scope: Reconciled live browser acceptance feedback into the active project state and frontend workflow. The user reports that the deployed target page still feels like card stacking, qualified-post counts are too narrow, driver posts are missing, important volume metrics lack visibility, and collection should fetch/display `new`, `hot`, `best`, `rising`, and `top` instead of product-facing `observed` wording.
- Why now: The latest deployed frontend slice passed build/lint and was deployed, but browser validation changed the active task from "reuse chart adapter on compare" to "fix product acceptance gaps in target detail plus backing data semantics." Capturing this prevents agents from continuing along the stale compare/markets sequence while the target surface and data contract remain unacceptable.
- Verify: Documentation reconciliation only at that timestamp. No code or tests were run in that write-back; the requested widened qualification, multi-listing capture, hot-post driver fallback, and interactive composition visualization were implemented later in the 2026-04-29 06:48:43 recovery slice.
- Next: Implement a contract-aware target-detail recovery slice: stronger TradingView/Spaceship-inspired layout, interactive real-data composition/donut view, prominent total/qualified volume treatment, wider qualified-post classifier, driver fallback from hot posts, and multi-listing capture/read-model support for `new` / `hot` / `best` / `rising` / `top`.

### 2026-04-29 06:09:15

- Scope: Reconciled project/frontend docs after landing the first target-detail frontend upgrade slice. Current working tree now has `lightweight-charts` inside `WorkbenchChart`, a chart-first `/target/:targetId` command surface, dark analytical visual tokens, and small React 19 lint cleanups for run/admin pages touched by verification.
- Why now: `project.md` and `docs/frontend-upgrade-workflow-2026-04-29.md` still described the next action as starting target-detail chart-kernel replacement, while current code has already implemented that slice. The smallest correct write-back is to mark that work as landed-in-working-tree, keep browser acceptance explicit, and move the next task to review/commit plus compare/markets follow-up.
- Verify: `npm --prefix apps/web run build` passed; `npm --prefix apps/web run lint` passed; `git diff --check` passed. Browser-level desktop/narrow interaction review has not yet been run in this session.
- Next: Commit the current frontend slice after review, then browser-check `/target/:targetId` for desktop/narrow layout, chart resize, crosshair/drag behavior, loading/error/empty states, and keyboard/clickability before applying the chart/visual direction to `/compare`.

### 2026-04-29 05:47:38

- Scope: Installed the external frontend design skills requested by the user, promoted a new current-state frontend upgrade workflow doc, updated local frontend skill routing to compose those installed skills plus `awesome-design-md-main`, and explicitly demoted the older backend-capability inventory note from active frontend-contract status because the user flagged it as stale.
- Why now: The repo is entering a UI/UX and chart-upgrade pass, and continuing to treat the stale capability-inventory markdown as the active contract would create planning drift. The smallest correct move was to lock a new frontend contract to current code truth before any visual or chart implementation begins.
- Verify: Installed skills now present under `~/.codex/skills` as `web-design-engineer`, `gpt-image-2`, and `rag-skill`; repo changes are documentation/skill-routing only, so no code tests were run.
- Next: Superseded by the 2026-04-29 06:09:15 entry; target-detail chart kernel and first visual-system pass are now landed in the working tree, and the next active step is review/commit plus browser verification.

### 2026-04-29 03:06:08

- Scope: Landed the first code slice from the newly documented pre-UIUX gate: raised the general-user Phase 1 live run cap to 5000, consolidated automatic collection understanding in the admin UI, improved retention-backed SQL cleanup controls, and reduced the initial weight of the market route by deferring the heavier workbench fetch until the rankings query is present.
- Why now: The user moved from planning to implementation. The smallest high-value slice was to finish the admin control surfaces that already had backend support, close the explicit 5000-cap bug, and lower the chance that `/markets` return-navigation feels blocked on the heaviest data fan-out before any deeper UI animation pass.
- Verify: `npm run typecheck` passed; `npm --prefix apps/web run build` passed.
- Next: Reproduce the remaining `/markets` return-navigation stall path in browser-level usage, decide the final qualified-post product contract, and only then judge whether cleanup scope must expand beyond the now-landed retention-backed maintenance actions.

### 2026-04-29 03:42:00

- Scope: Wrote back the now-landed post-semantics recovery after shipping the captured-listing chart path, captured qualified-post path, backfill/live materialization fixes, and the qualified-post rule update that reintroduces tier-aware thresholds plus breakout handling.
- Why now: The user has moved from backend/data-contract reconciliation into a frontend upgrade intent. The project state needed to stop describing qualified-post and observed-count semantics as unresolved blockers once code and tests now support "that day fetched all posts / all qualifypost" behavior on the target workbench.
- Verify: Code state and latest commit reconciliation only for this documentation update. Relevant landed code includes `src/jobs/collect-subreddit-new-posts.job.ts`, `src/application/services/subreddit-daily-insights.service.ts`, `src/application/services/target-workbench-read-model.service.ts`, `src/application/services/workbench-refresh-contract.service.ts`, `src/domain/services/quality-threshold.service.ts`, and `apps/web/src/pages/TargetDetail.tsx`. Latest pushed commit is `d84d719` on `main`.
- Next: Start the frontend upgrade pass on top of the stabilized semantics, treating captured-day target charts, current admin control surfaces, and the existing route-stability fixes as the baseline rather than reopening count semantics again.

### 2026-04-29 02:59:23

- Scope: Re-read the latest reported testing issues plus current frontend/admin code, then wrote back the verified root-cause analysis and pre-UIUX execution order for market-route lag, qualified-post drift, automatic collection control, and SQL cleanup control.
- Why now: The next work should not jump straight into deep animation or visual redesign. Current code still has unstable market-route behavior and split admin control semantics, so the project state needed to spell out which stability/admin steps must land first and which existing backend capabilities can already be reused.
- Verify: Documentation/state reconciliation only. Checked `apps/web/src/pages/Dashboard.tsx`, `apps/web/src/pages/OpsTargets.tsx`, `apps/web/src/pages/OpsCollection.tsx`, `apps/web/src/pages/OpsMaintenance.tsx`, `apps/web/src/components/Phase1RunCard.tsx`, `apps/api/src/create-api-server.ts`, `src/application/services/workbench-refresh-contract.service.ts`, `src/jobs/build-subreddit-daily-facts.job.ts`, `src/workers/reddit-target-scheduling.ts`, and `src/runtime/reddit-phase1-runtime.ts`. No tests were run because no product code changed.
- Next: Use this order as the active pre-UIUX gate: stabilize `/markets`, freeze the qualified-post contract, consolidate automatic collection controls, then harden admin cleanup flows before starting heavy animation/UI work.

### 2026-04-29 02:50:41

- Scope: Wrote back the currently reported live-product issues after the latest frontend/backend alignment pass so the active state file reflects what still blocks acceptable user operation.
- Why now: The deployed product now exposes registration and a general-user Phase 1 run surface, but the next highest-value work is no longer new page coverage. It is regression control: qualified-post count drift versus prior `like > 20 && comment > 20` expectations, persistent `/markets` return-navigation black-screen behavior, and the remaining user-facing run-budget cap that still blocks the requested 5000 setting.
- Verify: User report plus current deployed/frontend repo state reconciliation only. No new tests were run for this documentation update.
- Next: Inspect the qualified-post algorithm/read-model path, reproduce the `/markets` black-screen on route return, and raise the remaining Phase 1 run UI cap to 5000 without widening unrelated admin scope.

### 2026-04-29 01:10:27

- Scope: Wrote back the verified auth/onboarding state after checking current frontend routes and auth pages against the shipped backend auth endpoints.
- Why now: Current code can be misread as having full registration support because backend invite registration exists and admin invite creation is already exposed in the UI. In reality, the frontend still has login only, so project state needed to record that gap explicitly.
- Verify: Documentation/state reconciliation only. Checked `apps/web/src/pages/Login.tsx`, `apps/web/src/App.tsx`, `apps/web/src/pages/OpsInvites.tsx`, and `apps/api/src/create-api-server.ts`. No tests were run because no product code changed.
- Next: If onboarding is required in the current slice, add the smallest invite-based registration page and route on top of the already-landed `POST /auth/register` backend contract.

### 2026-04-29 00:57:18

- Scope: Reconciled `project.md` with the active frontend/admin implementation contract in `obsidian-reddit专用/Projects/后端能力盘点与前端后台规划-2026-04-28.md`, moved the project stage from backend-framework simplification to product/frontend control-plane delivery, and removed the attention drift that still treated `Projects/` root as if `project.md` were the only allowed active planning file.
- Why now: Current repo state already closed `P4.2`, but `project.md` frontmatter and hygiene rules still described the old backend slice and treated the current frontend execution contract as drift. That contradiction would keep sending agents back into closed architecture work or into false cleanup of the active product plan.
- Verify: Documentation/state reconciliation only. Checked current `project.md`, the active frontend/admin implementation contract, and `Projects/` root contents. No tests were run because no product code changed.
- Next: Execute the product-facing slice through the active implementation contract: market surfaces first, then target/compare analysis UX, then admin control-plane pages and any strictly necessary supporting APIs.

### 2026-04-28 11:25:55

- Scope: Closed the remaining `P4.2` backend simplification work by adding explicit workbench refresh-contract loaders for compare, market, and target routes, moving broad repository fan-in out of `create-api-server.ts`, and reusing a shared driver-keyword match helper for workbench-serving reads.
- Why now: After unifying the fact/materialization pipeline, the main remaining drift was the serving boundary. The API still hand-assembled large read bundles inline, which would have recreated the same architectural sprawl on the read side. This change closes that gap without adding new persistence or speculative infrastructure.
- Verify: `npm run typecheck`; `node --import tsx --test tests/integration/api-server-trends.test.ts tests/integration/reddit-phase1-cycle.test.ts tests/integration/reddit-phase1-cycle-isolation.test.ts tests/integration/reddit-phase1-scheduler-materialization.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts` passed.
- Next: Treat `P4.2` as complete and resume product/frontend work on top of the explicit workbench refresh contracts and existing persisted-fact/read-model pipeline.

### 2026-04-28 11:12:29

- Scope: Landed the next backend simplification step after scheduler scope propagation. Coverage rebuilds are now included in the same narrowed replay path, and direct cycle plus scheduler replay now share one target materialization chain via `src/workers/reddit-phase1-materialization.ts`.
- Why now: The remaining structural drag was duplicated orchestration. Even with explicit `TouchedScope`, the code still had two materialization pipelines: one in `runRedditPhase1Cycle` and one in scheduler replay. Unifying them is a higher-value simplification than adding more scope fields while duplicate execution paths remain.
- Verify: `npm run typecheck`; `node --import tsx --test tests/integration/reddit-phase1-cycle.test.ts tests/integration/reddit-phase1-cycle-isolation.test.ts tests/integration/reddit-phase1-scheduler-materialization.test.ts tests/integration/reddit-phase1-scheduler-runnable-jobs.test.ts` passed.
- Next: Move the same explicit refresh discipline up to serving/projection boundaries so market/target-facing read paths stop depending on broad read-time fan-in.

### 2026-04-28 10:31:09

- Scope: Wrote back the current data-structure optimization state after the latest landed backend work, removed `Projects/后端功能分析.md` as an active root-level advisory file, and reset the next execution frame around post-scheduler scope propagation.
- Why now: The repo had already moved past planning-only status. `TouchedScope`-style scheduler invalidation is now landed in code, so the active state file needed to stop describing it as pending and clear the remaining drift source from `Projects/`.
- Verify: State reconciliation only. Checked current `project.md`, `workers/reddit-phase1-scheduler.ts`, scheduler integration tests, and `Projects/` root contents. No new tests were run for this write-back step because product code was not changed here.
- Next: Implement the next backend simplification phase by propagating explicit materialization scope into coverage/projection rebuild paths before reopening frontend work.

### 2026-04-28 09:06:42

- Scope: Re-read `project.md`, the uploaded `后端功能分析.md`, and the current backend architecture/materialization code; then updated active project state to record the verified backend data-structure direction.
- Why now: The user clarified that the project still needs long-term feature growth, so the right move is framework simplification without premature freeze. Current code evidence shows the layering largely exists already; the next structural gap is explicit invalidation/materialization scope.
- Verify: Documentation/state reconciliation only. Checked `docs/architecture.md`, `src/domain/entities/content.ts`, `src/domain/entities/post-engagement.ts`, `src/jobs/build-subreddit-daily-facts.job.ts`, `src/jobs/build-post-growth-facts.job.ts`, `src/application/services/market-workbench-read-model.service.ts`, `src/application/services/target-workbench-read-model.service.ts`, and `workers/reddit-phase1-scheduler.ts`. No tests were run because no product code changed.
- Next: Implement the smallest backend simplification slice around explicit `TouchedScope`-style invalidation and materialization scope tracking before resuming market homepage frontend work.

### 2026-04-28 12:10:00

- Scope: Closed `P4.1` by extending the market workbench backend contract/read model/API with a coverage-aware `targets[]` surface built from active targets, latest daily facts, latest trend points, collection coverage, live/backfill cursors, and recent live provider-health windows.
- Why now: The verified market gap was homepage visibility for the whole monitored target set. That gap is smaller and more immediately useful than inventing new analysis families before the frontend can show current crawl state honestly.
- Verify: `npm run typecheck`; `node --import tsx --test tests/integration/api-server-trends.test.ts`; `npm run algo:fast`; `npm run algo:phase1`; `npm run algo:phase1:full` all passed.
- Next: Build the frontend market homepage against the landed `targets[]` contract and keep total-vs-observed wording aligned with the existing coverage semantics.

### 2026-04-28 11:20:00

- Scope: Re-read `project.md` plus the uploaded `后端功能分析.md`, reconciled the note against current code, closed `P3.4`, and advanced the active execution frame from storage-pressure cleanup to the next verified product gap.
- Why now: Storage writes are already bounded. The remaining drift was a monolithic collector flow plus an external analysis note living beside the active state file and competing with verified repo truth.
- Verify: `npm run typecheck`; `node --import tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts`; `npm run algo:fast`; `npm run algo:phase1`; `npm run algo:phase1:full` all passed. Verified current market read-model code still lacks a full per-target status list.
- Next: Implement `P4.1` by extending the market homepage/backend with a coverage-aware monitored-target status surface built from existing targets, cursor state, provider-health windows, and materialized facts.

### 2026-04-28 08:20:00

- Scope: Landed the P3.2 storage split slice. Added `post_engagement_latest` and bounded `post_engagement_window` storage plus Postgres/in-memory repositories; kept `metrics_snapshot` target-level for ordinary writes; migrated daily facts, post growth, keyword trend, and trend-point materialization to new engagement reads with explicit fallback to legacy post-level snapshots; and wired live/backfill collection to write structured post engagement in the normal runtime path.
- Why now: Post-level EAV `metrics_snapshot` writes were the active storage-pressure hotspot and forced broad range scans rebuilding latest engagement in memory. The smallest honest fix was to separate target snapshots from post engagement before any collector structure refactor.
- Verify: `npm run typecheck`, focused unit/integration tests for daily facts, growth facts, keyword trend, trend points, collector writes, and ops storage observability passed. Required gates `npm run algo:fast`, `npm run algo:phase1`, and `npm run algo:phase1:full` passed.
- Next: Implement `P3.2e` by proving Postgres migration/repository parity, then prune legacy post-level `metrics_snapshot` rows, tighten retention, and remove compatibility fallbacks before starting `P3.3` or `P3.4`.

### 2026-04-28 08:55:00

- Scope: Closed `P3.2e`. Added the target-only cleanup migration for `metrics_snapshot`, tightened retention to prune bounded `post_engagement_window` history separately, removed legacy post-level fallback reads from daily/growth/keyword/trend materialization, and updated phase1/Postgres repository tests plus fixtures to assert the structured engagement path instead of legacy EAV row counts.
- Why now: The storage split was already landed, so the remaining pressure and drift came from compatibility paths and stale test expectations that still treated post-level `metrics_snapshot` rows as the canonical source.
- Verify: `npm run typecheck`, focused collector/materialization/Postgres repository tests, `npm run algo:fast`, `npm run algo:phase1`, and `npm run algo:phase1:full` passed.
- Next: Implement `P3.3` by bounding ordinary post text/search retention while preserving longer text for qualified, high-impact, keyword-hit, or manually saved posts.

### 2026-04-28 10:05:00

- Scope: Closed `P3.3`. Added a shared text-retention policy that bounds ordinary stored post bodies while retaining a longer capped body for qualified/high-impact posts, applied that policy in collection writes, and bounded `post_search_document` snippet/search text duplication in both direct upserts and `seedFromContent`.
- Why now: After `P3.2`, the next storage-pressure hotspot was duplicated post text: full `content.body_text` plus a second search-document copy/index source. This slice reduces that duplication without removing keyword-trend or keyword-query functionality.
- Verify: `npm run typecheck`, focused text-retention/search/collector tests, `npm run algo:fast`, `npm run algo:phase1`, and `npm run algo:phase1:full` passed.
- Next: Implement `P3.4` by simplifying `collect-subreddit-new-posts.job.ts` around concrete collection/persistence structures now that raw payloads, metrics, engagement, and text retention are bounded.

### 2026-04-28 06:54:59

- Scope: Tightened the execution harness in `project.md` around attention hygiene, live-state boundaries, and drift checks; removed current-state dependence on prior advisory filenames and documented local tool-state noise handling.
- Why now: The repo state is clean enough to proceed, but the active state file still carried historical advisory framing that can pull attention away from the current storage-pressure slice.
- Verify: Documentation/state reconciliation only. Checked repo root, `Projects` root, startup docs, and worktree status; confirmed `Projects` root contains only `project.md` and the only visible local-noise artifact is untracked `.codex/`.
- Next: Use this tightened harness as the sole execution frame and implement `P3.2a` before any collector refactor or retention-default change.

### 2026-04-28 06:51:05

- Scope: Re-read the active storage-pressure harness, inspected `metrics_snapshot` schema/repositories plus `collect-subreddit-new-posts.job.ts` and downstream daily/growth/keyword/trend jobs, and tightened the project execution plan around a target-vs-post metrics split before collector refactoring.
- Why now: The real bottleneck is not one slow SQL statement. Post-level EAV writes are inflating row count, forcing broad range scans, and keeping collector persistence logic coupled to a generic metric shape.
- Verify: Planning/state update only. Reconciled `project.md` against current schema/repository/job code and current startup docs. No tests were run.
- Next: Implement `P3.2a` with new post-engagement storage plus narrow repository reads, then migrate daily/growth/keyword/trend jobs before pruning legacy EAV rows or splitting the collector job.

### 2026-04-28 06:35:13

- Scope: Landed P3.1 raw fetch event summary. Added `reddit_fetch_event`, changed raw event persistence so normal successful fetches keep lightweight metadata/hash while exceptions keep full raw payloads, and kept post score/comment engagement normalization and writes unchanged.
- Why now: The storage-pressure harness needed database growth reduction without dropping post data or weakening coverage/debug truth.
- Verify: `npm run typecheck`, `npm run algo:phase1:full`, and focused integration/migration tests passed. The focused set first exposed an ops storage table-list expectation drift; the test contract was updated and rerun green.
- Next: Evaluate P3.2 metrics storage compression with compatibility reads before changing retention defaults or dropping legacy metric rows.

### 2026-04-28 07:00:00

- Scope: Replaced `AGENTS.md` with the requested single-rule instruction set, imported `skills/karpathy-guidelines` into the repo, and wired startup routing so the skill is read by default for coding/review/debug/refactor work.
- Why now: The task was to switch the repo's default agent behavior to the Karpathy-style guardrails and enable that skill immediately instead of waiting on external session refresh.
- Verify: Updated `AGENTS.md`, `00_START_HERE.md`, `skills/README.md`, `skills/karpathy-guidelines/SKILL.md`, and `skills/karpathy-guidelines/.import-source.txt`. Global Codex skill installation was verified separately after the file changes.
- Next: Restart Codex in a new session if you want the globally installed `~/.codex/skills/karpathy-guidelines` entry to appear in the runtime skill registry as well.

### 2026-04-28 06:28:14

- Scope: Re-read the corrected `代码优化建议分析.md` upload and reconciled it against current code. Kept the storage-pressure harness, clarified that coverage/read-model gating is already complete, and removed the temporary advisory note from active project state.
- Why now: The previous advisory input had state drift. The corrected note still supports the same next storage-pressure sequence, but its read-model coverage recommendation should not be treated as pending work.
- Verify: Documentation/state reconciliation only. Checked the corrected advisory, current `project.md`, root `Projects` files, and git status. No tests were run.
- Next: Implement P3.1 raw fetch event summary before metrics compression or collect-job restructuring.

### 2026-04-28 06:19:19

- Scope: Read and reconciled `代码优化建议分析.md`; shifted the active harness from coverage-semantics hardening to storage-pressure reduction; deleted historical Archive Markdown inputs and removed the temporary advisory note from active project state.
- Why now: Coverage/read-model semantics are already landed. The remaining useful signal from the advisory note is storage growth risk in raw payloads, post metrics EAV rows, text/search duplication, and collect-job complexity.
- Verify: Documentation/state cleanup only. Checked current `project.md`, the advisory note, Archive contents, and git status. No tests were run.
- Next: Implement P3.1 raw fetch event summary as the smallest storage-pressure slice.

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
