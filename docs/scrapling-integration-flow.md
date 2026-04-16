# Scrapling Integration Flow (P1.6)

## Goal

Integrate Scrapling into the existing algorithm pipeline as a new HTTP acquisition lane without breaking proven Stage-B truth semantics.

## Verified external facts (used as integration constraints)

- Scrapling is an adaptive scraping framework and positions itself from single request to full crawl.
- Docs/README expose fetcher classes for HTTP, dynamic browser, and stealth anti-bot usage (`Fetcher`, `DynamicFetcher`, `StealthyFetcher`).
- Spider docs show multi-session crawling and session-level configuration for mixing fast HTTP and stealth browser sessions.
- Installation requires Python 3.10+.

Sources:
- https://github.com/D4Vinci/Scrapling
- https://scrapling.readthedocs.io/en/latest/
- https://scrapling.readthedocs.io/en/latest/spiders/sessions.html

## Integration architecture (additive, not rewrite)

1. Keep current Node orchestration unchanged:
   - `worker -> collect job -> raw_event/content/metrics/provider_health_window -> trend/sampling`
2. Add a Python bridge runner for Scrapling:
   - Node sends normalized request JSON.
   - Python executes selected Scrapling session profile.
   - Python returns normalized response JSON (status, headers, body/meta, timing/error fields).
3. Add `scrapling` provider lane in connector factory with target-level routing.
4. Keep baseline `http` lane as control/fallback until parity is proven.

## Bridge contract (project-defined)

### Request

- `requestId`
- `targetId`
- `url`
- `profile`: `http | dynamic | stealth`
- `timeoutMs`
- `headers` (optional)
- `cursor` (optional)

### Response

- `provider`: `scrapling`
- `status`
- `headers`
- `fetchedAt`
- `body` or `extracted` payload
- `nextCursor` (optional)
- `timingMs`
- `errorCode` (optional)
- `errorMessage` (optional)

## Runtime routing policy

- Default target policy: baseline `http` only.
- Shadow policy: run Scrapling in parallel for selected targets; persist comparison evidence, but baseline output remains authoritative.
- Promotion policy: switch target to Scrapling primary only when parity gates pass.
- Fallback policy: if Scrapling fails, route to baseline `http` and tag fallback evidence.

## Algorithm and observability mapping

Map both lanes to the same provider-health semantics:

- `fetchSuccessRate`
- `fallbackRate`
- `duplicateRate`
- `ingestLagSeconds`
- `errorRate`
- `rateLimitRate`
- `timeoutRate`
- `circuitOpenRate`

Add Scrapling-specific evidence fields (without changing existing gate semantics):

- `blockedChallengeRate` (challenge-like/blocked responses)
- `renderPathShare` (dynamic/stealth usage ratio)
- `sessionSwitchShare` (profile switch pressure)

## Stage checklist

### S0 Contract freeze

- Define bridge JSON schema and error taxonomy.
- Add mapper tests for both success/error responses.
- No production routing changes.

### S1 Fetcher shadow lane

- Enable Scrapling shadow runs on selected targets.
- Compare baseline vs Scrapling for status, duplicate, lag, timeout, and extracted count parity.
- Keep baseline authoritative.

### S2 Session/spider lane

- Enable dynamic/stealth session routing only for targets that fail S1 parity under HTTP.
- Keep pause/resume behavior explicit and auditable.

### S3 Algorithm coupling

- Tune adaptive sampling/health thresholds only with captured parity evidence.
- Add bounded regression tests for new degraded signals.

## Verification gates (per stage)

- `npm run algo:phase1`
- `npm run algo:full`
- live verification snapshot with comparable target set and fixed timeout/circuit settings
- activity log entry in `obsidian-reddit专用/Projects/project.md` (`Scope`, `Why now`, `Verify`, `Next`)

## Immediate next execution

1. Implement S0 schema doc + fixture tests.
2. Add connector factory flag for `scrapling` provider (off by default).
3. Build shadow-compare report writer under `docs/` for parity evidence.
