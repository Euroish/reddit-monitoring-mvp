# Task Plan: P1.5-2 Cursor Stall Observability

## Goal
Continue `P1.5-2 observability truth` by adding real live cursor-stall evidence to `readyz`, without changing live collection semantics, and then validate how far live HTTP calibration can proceed in the current environment.

## Current Phase
Phase 5

## Phases

### Phase 1: Requirements & Discovery
- [x] Recover the latest project context from `obsidian-reddit专用/Projects/project.md`
- [x] Confirm the next unfinished gap is `cursor stall`, not architecture or provider-health transport evidence
- [x] Verify whether live cursor state is currently persisted at all
- **Status:** complete

### Phase 2: Planning & Scope Lock
- [x] Read `readyz`, crawl-cursor repository, and live collection code paths
- [x] Choose a bounded upgrade that adds cursor-stall evidence without changing live fetch semantics
- [x] Record the chosen change and verify target in `findings.md`
- **Status:** complete

### Phase 3: Implementation
- [x] Persist live crawl-cursor snapshots for observability only
- [x] Extend `readyz` to expose cursor-stall observability and degraded reasons
- [x] Update API contract and focused tests
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Run `npm run typecheck`
- [x] Run targeted tests for `readyz` and live/backfill cursor behavior
- [x] Run full `npm run test`
- **Status:** complete

### Phase 5: Live Calibration & Writeback
- [x] Rewrite `Projects/project.md` with clean UTF-8-safe content
- [x] Update project context in `obsidian-reddit专用/Projects/project.md`
- [x] Log verification and next action
- [x] Attempt real HTTP verification with the provided `DATABASE_URL`
- [x] Deliver concise summary to user
- **Status:** complete

## Key Questions
1. Can live cursor freshness be exposed without changing live collection replay semantics?
2. Is current live calibration blocked by algorithm thresholds or by the Node runtime network path?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Continue from `P1.5-2 observability truth` rather than more provider-health tuning | `project.md` now points specifically at cursor-stall evidence and live calibration |
| Persist live crawl cursor as observability state only | Live collection should still repoll from head every cycle; stored live cursor is for truth/health evidence, not fetch input |
| Define stall as stale live cursor freshness first, not as a new multi-window diff algorithm | This keeps the upgrade additive, explainable, and testable with existing state |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `verify:phase1:postgres` live run failed with Node `fetch` `ECONNRESET` | 1 | Confirmed PowerShell direct HTTP succeeds while Node `fetch` still resets; treat as runtime/network-path blocker, not algorithm regression |

## Notes
- Keep this round bounded to cursor-stall observability and live calibration evidence.
- Do not change live collection read semantics just to make cursor observability easier.


## Connection Fix
- [x] Diagnose Windows-specific Node live HTTP reset behavior
- [x] Add bounded connector transport fallback without changing business logic
- [x] Verify live PostgreSQL run succeeds after the fix
