---
title: "project"
type: codex-project-workspace
status: active
stage: market-homepage-frontend-slice
updated_at: "2026-04-28 12:10:00"
repo_path: "/root/reddit-monitoring-mvp"
next_action: "Implement the frontend market homepage against the landed `targets[]` workbench contract so users can see every monitored subreddit plus crawl/coverage freshness alongside the existing leaders, breakouts, and anomalies."
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
- Archive: keep empty by default. External analysis notes are temporary inputs only; read, reconcile against code, update this file, then remove.
- Product truth: this is a bounded monitored Reddit analytics workbench. It may display `Total New Posts` / `Qualified Posts` only for target/day/range data with coverage proof. Otherwise the product must label the same raw counts as observed and expose coverage status.
- Runtime path: `http` primary plus `scrapling` fallback capability. Legacy Apify is not an active main path.

## Attention Hygiene

- Live state files: only `00_START_HERE.md` and this file. `AGENTS.md`, skill docs, and architecture notes are static constraints, not task queues.
- `obsidian-reddit专用/Projects/` root must contain only `project.md`. Any uploaded analysis note belongs in `Archive/` or should be removed after reconciliation.
- Advisory filenames previously read in this repo are historical inputs only. Do not carry their headings or proposed todo lists forward unless the same issue is still visible in current code.
- Ignore local tool state such as untracked `.codex/` during project planning unless the user explicitly asks to inspect tool internals. It is workspace noise, not product state.
- Do not create parallel planning surfaces in repo root, `context/`, or ad hoc markdown files for the same execution slice.

## Harness Rules

- One slice at a time: active execution is the smallest complete storage-pressure slice that preserves collection truth and reduces either row growth or collector complexity.
- Evidence before design: current filesystem and current code win over remembered analysis notes, prior chat summaries, or archived markdown.
- Structure follows storage: collector refactors are valid only when they remove work made unnecessary by a landed data-model or repository change.
- Compatibility is explicit: when replacing storage or read paths, keep fallback reads or migration compatibility until focused tests prove parity.
- Stop when the next step would require widening product scope, rewriting unrelated layers, or changing retention defaults without migrations and tests in the same slice.

## Current State

- Coverage semantics are landed: `content.total_eligible`, collection provenance, day-level coverage facts, target workbench, comparison workbench, and legacy daily trend API all distinguish observed counts from complete totals.
- `post_volume` / `qualified_post_volume` in daily facts remain observed eligible facts. They become product-facing totals only through a coverage-complete read-model gate.
- The storage-pressure slice is closed through `P3.4`, and `P4.1` market target-status visibility is now landed on the backend.
- `post_engagement_latest` plus bounded `post_engagement_window` storage now back new writes and materialization reads. Legacy post-level `metrics_snapshot` fallback reads were removed, target-only cleanup is migration-backed, and retention prunes engagement windows separately.
- `P3.4` is now landed: `collect-subreddit-new-posts.job.ts` has explicit collection-page, normalized-batch, persistence-plan, and outcome seams instead of one monolithic mutable flow.
- No advisory markdown file is currently active. Prior storage/collector notes were reconciled and should not be re-opened unless new repo evidence disagrees with the current harness.
- Current repo search did not find a standalone export/report generator path. Future export/report work must reuse coverage-aware API/read-model fields.
- Current repo evidence shows the market workbench contract now includes `targets[]` with per-target crawl freshness, live/backfill coverage status, latest observed headline metrics, and a compact live reliability summary.

## Core Decision

- `new` listing evidence is the only total-volume candidate source because it is the time-ordered stream.
- `top` / `hot` / search / manual supplement evidence is discovery-only unless a future source can prove time-contiguous completeness.
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

## Next Slice Harness: Market Homepage Frontend

- Objective: wire the homepage to the landed market workbench `targets[]` contract so users can inspect all monitored subreddits, not just ranked subsets.
- Verified backend state: `leaders`, `targets`, `breakouts`, and `anomalies` are all returned from the same market workbench response.
- Recommended next slice: implement the frontend market target table/card surface with honest labels for freshness, live/backfill status, observed headline metrics, and stale states.
- Keep the next slice presentation-focused. Do not reopen backend analysis features unless frontend integration reveals a concrete contract gap.
- Stop condition: stop before expanding into comments, new ranking families, or speculative market analytics beyond the landed contract.

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
  - latest 1-3 relevant `Activity Log` entries
- If the next action and current code disagree, fix this file first, then execute.
- If a file outside the startup pair appears to define "current plan", treat that as drift and either archive it or explicitly mark it non-active here.
- If the worktree contains unrelated local artifacts, ignore them unless they affect build/test/runtime behavior.

## Verification Policy

- For algorithm/collection truth changes, start with `npm run algo:fast`.
- Run `npm run algo:phase1` when truth-layer behavior changes.
- Run `npm run algo:phase1:full` when collection/storage/API integration boundaries are touched.
- Run focused tests around any changed repository, job, read-model, or contract path before close-out.
- Documentation-only state updates do not require tests, but must leave `Projects` root containing only `project.md`.

## Activity Log

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
