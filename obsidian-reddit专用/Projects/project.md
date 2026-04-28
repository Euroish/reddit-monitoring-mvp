---
title: "project"
type: codex-project-workspace
status: active
stage: storage-pressure-harness
updated_at: "2026-04-28 06:35:13"
repo_path: "/root/reddit-monitoring-mvp"
next_action: "Evaluate P3.2 metrics storage compression while preserving post score/comment engagement data and compatibility reads."
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

## Current State

- Coverage semantics are landed: `content.total_eligible`, collection provenance, day-level coverage facts, target workbench, comparison workbench, and legacy daily trend API all distinguish observed counts from complete totals.
- `post_volume` / `qualified_post_volume` in daily facts remain observed eligible facts. They become product-facing totals only through a coverage-complete read-model gate.
- The next unresolved product risk is storage pressure and collector complexity, not another chart or ranking surface.
- The corrected advisory note `代码优化建议分析.md` was read on 2026-04-28 and reconciled as a temporary input. Its storage-pressure and collector-structure diagnosis remains useful; its recommendation to later connect read models to coverage is already complete in current code.
- Current repo search did not find a standalone export/report generator path. Future export/report work must reuse coverage-aware API/read-model fields.

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

## Next Slice Harness: Storage Pressure

- Objective: reduce database growth without weakening collection truth, coverage proof, or debugability.
- P3.1 Raw fetch event summary: done. Successful normal pages write lightweight fetch metadata by default; exception/debug paths retain full raw payloads.
- P3.2 Metrics storage compression: evaluate replacing post-level EAV `metrics_snapshot` writes with a `post_engagement_latest` or bounded `post_engagement_snapshot` path. Keep target-level snapshots and compatibility reads until tests prove daily facts and growth facts no longer need EAV rows.
- P3.3 Text/search retention: keep `content.body_text` nullable/short for ordinary posts; preserve longer text only for qualified, high-impact, keyword-hit, or manually saved posts. Keep search snippets bounded.
- P3.4 Collector structure reduction: only after storage writes are bounded, split `collect-subreddit-new-posts.job.ts` around concrete data structures: `CollectedPageRecord`, `NormalizedBatch`, `PersistencePlan`, and `CollectionOutcome`.
- Already closed from the corrected advisory: coverage-aware read-model gating for target workbench, comparison workbench, and daily trend API. Do not reopen this as a storage slice unless a new uncovered output path is found in code.
- Stop condition: stop before changing retention defaults or dropping legacy tables unless migrations, fallback reads, and focused storage/read-model tests are in the same slice.

## Guardrails

- Allowed: collector/storage truth fixes, provenance fields, coverage facts, retention/prune automation, favorite-target scheduling, coverage/data-quality contract fixes, and the smallest UI/API updates needed to expose honest total/observed semantics.
- Forbidden: provider expansion, broad architecture rewrites, catalog/dashboard expansion, whole-Reddit wording, treating supplement listings as total evidence, treating `iteration_budget_exhausted` as final source limitation, or cleanup that touches many layers without reducing storage pressure or improving coverage/provenance truth.
- Keep `activity_index` / `activity_confidence` as optional diagnostics. They do not replace raw post-count defaults unless the product explicitly changes KPI semantics.

## Verification Policy

- For algorithm/collection truth changes, start with `npm run algo:fast`.
- Run `npm run algo:phase1` when truth-layer behavior changes.
- Run `npm run algo:phase1:full` when collection/storage/API integration boundaries are touched.
- Run focused tests around any changed repository, job, read-model, or contract path before close-out.
- Documentation-only state updates do not require tests, but must leave `Projects` root containing only `project.md`.

## Activity Log

### 2026-04-28 06:35:13

- Scope: Landed P3.1 raw fetch event summary. Added `reddit_fetch_event`, changed raw event persistence so normal successful fetches keep lightweight metadata/hash while exceptions keep full raw payloads, and kept post score/comment engagement normalization and writes unchanged.
- Why now: The storage-pressure harness needed database growth reduction without dropping post data or weakening coverage/debug truth.
- Verify: `npm run typecheck`, `npm run algo:phase1:full`, and focused integration/migration tests passed. The focused set first exposed an ops storage table-list expectation drift; the test contract was updated and rerun green.
- Next: Evaluate P3.2 metrics storage compression with compatibility reads before changing retention defaults or dropping legacy metric rows.

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
