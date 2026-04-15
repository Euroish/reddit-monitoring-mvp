# Progress Log

## Session: 2026-04-15

### Phase 1: Context Recovery & Discovery
- **Status:** complete
- Actions taken:
  - Read the planning skill instructions and the repo `AGENTS.md`.
  - Restored project context from `obsidian-reddit专用/Projects/project.md`.
  - Confirmed the next unfinished algorithm/observability gap is live `cursor stall` evidence.
  - Verified that live collection did not persist `crawl_cursor` state yet.
- Files created/modified:
  - `E:\vibe coding\project\task_plan.md`
  - `E:\vibe coding\project\findings.md`
  - `E:\vibe coding\project\progress.md`

### Phase 2: Scope Lock
- **Status:** complete
- Actions taken:
  - Chose a bounded upgrade that persists live cursor snapshots for observability only.
  - Scoped `readyz` changes to additive metrics and degraded reasons.
- Files created/modified:
  - `E:\vibe coding\project\task_plan.md`
  - `E:\vibe coding\project\findings.md`
  - `E:\vibe coding\project\progress.md`

### Phase 3: Implementation
- **Status:** complete
- Actions taken:
  - Extended `CrawlCursorRepository` with list support so `readyz` can inspect live cursor snapshots.
  - Persisted live crawl-cursor snapshots after successful live fetches without changing head-repoll behavior.
  - Added `cursorStallRate` and `cursorLagSecondsMax` to readiness observability, including provider-scoped degraded reasons.
  - Updated focused integration tests for live cursor persistence and readiness cursor-stall behavior.
- Files created/modified:
  - `E:\vibe coding\project\packages\contracts\src\http.ts`
  - `E:\vibe coding\project\src\domain\repositories\crawl-cursor-repository.ts`
  - `E:\vibe coding\project\src\storage\repositories\postgres\postgres-crawl-cursor.repository.ts`
  - `E:\vibe coding\project\src\storage\repositories\in-memory\cursor-and-provider.repositories.ts`
  - `E:\vibe coding\project\src\jobs\collect-subreddit-new-posts.job.ts`
  - `E:\vibe coding\project\apps\api\src\create-api-server.ts`
  - `E:\vibe coding\project\tests\integration\collect-subreddit-new-posts-p0.test.ts`
  - `E:\vibe coding\project\tests\integration\api-server-readyz.test.ts`

### Phase 4: Verification
- **Status:** complete
- Actions taken:
  - Ran `npm run typecheck`.
  - Ran `npx tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts`.
  - Ran `npx tsx --test tests/integration/api-server-readyz.test.ts`.
  - Ran `npm run test`.
- Files created/modified:
  - `E:\vibe coding\project\task_plan.md`
  - `E:\vibe coding\project\findings.md`
  - `E:\vibe coding\project\progress.md`

### Phase 5: Live Calibration & Writeback
- **Status:** complete
- Actions taken:
  - Attempted real HTTP verification with the provided local PostgreSQL URL.
  - Confirmed `npm run verify:phase1:postgres` in live mode fails on Node `fetch` with `ECONNRESET`.
  - Confirmed PowerShell direct request to the same Reddit endpoint succeeds with HTTP `200`.
  - Confirmed a minimal Node `fetch` reproduces the same `ECONNRESET`, isolating the blocker to the current Node/runtime network path.
  - Wrote the new state back to `project.md`.
- Files created/modified:
  - `E:\vibe coding\project\obsidian-reddit专用\Projects\project.md`
  - `E:\vibe coding\project\task_plan.md`
  - `E:\vibe coding\project\findings.md`
  - `E:\vibe coding\project\progress.md`

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Typecheck | `npm run typecheck` | No TS errors | Passed | pass |
| Focused live cursor regression | `npx tsx --test tests/integration/collect-subreddit-new-posts-p0.test.ts` | Live/backfill cursor semantics remain correct | Passed `7/7` | pass |
| Focused readiness regression | `npx tsx --test tests/integration/api-server-readyz.test.ts` | `readyz` exposes stall evidence without false positives | Passed `7/7` | pass |
| Full suite | `npm run test` | Whole repo remains green | Passed `90/90` | pass |
| Live verify | `npm run verify:phase1:postgres` with `REDDIT_RUN_MODE=live` | One real HTTP collection cycle | Failed with Node `fetch` `ECONNRESET` | blocked |
| Direct PowerShell Reddit request | `Invoke-WebRequest https://www.reddit.com/r/machinelearning/about.json` | Confirm current network reachability | Passed `200` | pass |
| Minimal Node fetch Reddit request | `node -` with `fetch(...)` | Confirm worker runtime network path | Failed with `ECONNRESET` | blocked |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-04-15 11:35 | `npm run verify:phase1:postgres` in live mode failed with Node `fetch` `ECONNRESET` | 1 | Confirmed PowerShell direct request succeeds while minimal Node `fetch` still fails, so the blocker is current Node/runtime network routing rather than PostgreSQL or the new cursor-stall code |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 5, delivery after completed cursor-stall observability upgrade |
| Where am I going? | Restore stable Node live path, then rerun real HTTP calibration |
| What's the goal? | Make `readyz` expose truthful live cursor-stall evidence and verify it under real HTTP runs |
| What have I learned? | The missing code gap was live cursor persistence; the remaining live blocker is Node network stability |
| What have I done? | Implemented the upgrade, passed all repo tests, and isolated the live calibration blocker |

### Reconnect Follow-up: 2026-04-15 12:05
- **Status:** complete
- Actions taken:
  - Rechecked live connectivity through PowerShell, Node `fetch`, Node `https.request`, and `curl.exe`.
  - Confirmed only PowerShell succeeds in the current environment.
  - Rewrote `obsidian-reddit专用/Projects/project.md` as clean UTF-8 / ASCII-first content to remove historical mojibake.
- Files created/modified:
  - `E:\vibe coding\project\obsidian-reddit专用\Projects\project.md`
  - `E:\vibe coding\project\findings.md`
  - `E:\vibe coding\project\progress.md`

### Connection Fix: 2026-04-15 12:20
- **Status:** complete
- Actions taken:
  - Added Windows PowerShell fallback transport to the Reddit HTTP connector for `ECONNRESET` cases.
  - Added `REDDIT_HTTP_TRANSPORT` env support through connector factory and runtime.
  - Added unit coverage for transport resolution and Windows fallback behavior.
  - Re-ran live PostgreSQL verification and confirmed a successful real HTTP collection cycle.
  - Re-ran the full repo test suite after the transport fix.
- Files created/modified:
  - `E:\vibe coding\project\src\connectors\reddit\reddit-http.connector.ts`
  - `E:\vibe coding\project\src\connectors\reddit\create-reddit-connector.ts`
  - `E:\vibe coding\project\src\runtime\reddit-phase1-runtime.ts`
  - `E:\vibe coding\project\tests\unit\reddit-http.connector.test.ts`
  - `E:\vibe coding\project\tests\unit\create-reddit-connector.test.ts`
  - `E:\vibe coding\project\tests\unit\reddit-phase1-runtime.test.ts`
  - `E:\vibe coding\project\README.md`
  - `E:\vibe coding\project\docs\operations-runbook.md`
  - `E:\vibe coding\project\obsidian-reddit专用\Projects\project.md`
  - `E:\vibe coding\project\findings.md`
  - `E:\vibe coding\project\progress.md`
  - `E:\vibe coding\project\task_plan.md`

## Final Verification Update
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| Live verify after transport fix | `npm run verify:phase1:postgres` with `REDDIT_RUN_MODE=live` | One real HTTP collection cycle | Passed against local PostgreSQL with real Reddit HTTP collection | pass |
| Full suite after transport fix | `npm run test` | Whole repo remains green after connector fallback change | Passed `93/93` | pass |
