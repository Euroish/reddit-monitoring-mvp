# Findings & Decisions

## Requirements
- Continue the current project mainline after the completed architecture cleanup.
- Stay inside `P1.5-2 observability truth`.
- Avoid redoing finished architecture work.
- Maintain project memory on disk while working.

## Research Findings
- `obsidian-reddit专用/Projects/project.md` is the authoritative execution source and sets the next action to validating `readyz`, provider-health evidence, and the http-first sampling plan under live runs.
- `collectSubredditNewPostsJob` persisted `crawl_cursor` only for `backfill`; `live` mode had no durable cursor snapshot, so `readyz` could not expose truthful cursor-stall evidence yet.
- `crawl_cursor` already stores enough additive state for stall evidence without schema change:
  - `provider`
  - `mode`
  - `cursor`
  - `lastFetchedAt`
  - `updatedAt`
- A bounded live-safe approach is to persist live cursor snapshots for observability only while keeping live polling behavior unchanged (`after` remains unset on each head repoll).
- `apps/api/src/create-api-server.ts` `GET /readyz` already aggregates provider-health evidence, but it had no crawl-cursor freshness signal.
- The live collection window is 5 minutes (`LIVE_COLLECTION_WINDOW_MINUTES = 5`), so a 3-window freshness rule gives a 15-minute first-pass cursor-stall threshold that is additive and explainable.
- In the current environment, PowerShell `Invoke-WebRequest` to Reddit succeeds, but Node `fetch` fails with `ECONNRESET` against the same endpoint and `User-Agent`. This blocks the worker's real live calibration path independently of the algorithm changes.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Persist live cursor snapshot but do not read it during live collection | This adds observability truth without changing the head-repoll collection contract |
| Surface cursor-stall evidence in `readyz` as `cursorStallRate` and `cursorLagSecondsMax` | These metrics are additive, provider-comparable, and sufficient for first-pass stall evidence |
| Use `provider_cursor_stalled:<provider>` degraded reasons | This keeps degraded output aligned with the provider-scoped observability model already used by `readyz` |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Previous temporary planning files had already been archived | Created a fresh plan for the new cursor-stall observability round |
| Live PostgreSQL verification still failed on Node `fetch` | Confirmed it is a runtime/network-path issue rather than a database or algorithm regression |

## Resources
- `E:\vibe coding\project\obsidian-reddit专用\Projects\project.md`
- `E:\vibe coding\project\apps\api\src\create-api-server.ts`
- `E:\vibe coding\project\src\domain\repositories\crawl-cursor-repository.ts`
- `E:\vibe coding\project\src\jobs\collect-subreddit-new-posts.job.ts`
- `E:\vibe coding\project\src\storage\repositories\postgres\postgres-crawl-cursor.repository.ts`
- `E:\vibe coding\project\src\storage\repositories\in-memory\cursor-and-provider.repositories.ts`
- `E:\vibe coding\project\tests\integration\api-server-readyz.test.ts`
- `E:\vibe coding\project\tests\integration\collect-subreddit-new-posts-p0.test.ts`

## Visual/Browser Findings
- No browser or image inspection was used in this round.

## Reconnect Follow-up
- `project.md` was not broken at the byte level; it was valid UTF-8 text containing historical mojibake content.
- Rewriting the file with clean ASCII-first / UTF-8-safe content removes the display problem without any encoding conversion step.
- Live connectivity recheck results in the current shell:
  - PowerShell `Invoke-WebRequest` -> success (`200`)
  - Node `fetch` -> `ECONNRESET`
  - Node `https.request` -> `ECONNRESET`
  - `curl.exe` -> connection reset
- This keeps the diagnosis aligned with `context/decision-log.md`: the remaining live blocker is environment/runtime routing, not repository code or PostgreSQL.

## Connection Fix Result
- Added a Windows-safe fallback transport to `RedditHttpConnector`: default transport remains `fetch`, but on Windows `ECONNRESET` now falls back to PowerShell `Invoke-WebRequest`.
- Added explicit env override `REDDIT_HTTP_TRANSPORT` with values: `auto`, `fetch`, `powershell`.
- Verified the repaired live path with `npm run verify:phase1:postgres` in `REDDIT_RUN_MODE=live`; the run now succeeds against the provided local PostgreSQL database.
- This changes the current diagnosis from "connection still blocked" to "connection repaired inside the app path, with a Windows-specific fallback transport available when Node HTTP traffic is reset".
