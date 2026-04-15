# Open Questions (Closed)

Decision date: 2026-04-10

## Q1. First monitored object

- Decision: `subreddit`
- Locked shape: one target is one canonical name (`r/<name>`)
- Why now: matches current schema, jobs, and trend model with zero redesign cost

## Q2. First core value

- Decision: `trend change`
- Locked metric frame: 15-minute windows, compare current vs previous window
- Why now: fastest path to one clear signal before ranking/alerts

## Q3. First presentation form

- Decision: `Trend Board v0`
- v0 output:
  - API response with timeline points
  - recent posts list for quick context
- Why now: API-first output lets UI/CLI iterate later without blocking collection

## Q4. API boundary (Phase 1)

- Decision: keep API boundary minimal and explicit
- Endpoints:
  - `GET /healthz`
  - `POST /v1/targets/subreddit`
  - `POST /v1/runs/reddit-phase1`
  - `GET /v1/trends/subreddit/:subreddit`
- Why now: enough to seed target, run collection, and read trend in one loop

## Q5. What is manual trigger first

- Decision: manual trigger first for three flows
  - target seed (`POST /v1/targets/subreddit` or worker bootstrap)
  - one collection cycle (`POST /v1/runs/reddit-phase1`)
  - trend read (`GET /v1/trends/subreddit/:subreddit`)
- Why now: keeps operations deterministic before scheduler automation

## Connector provider decision (with your new input)

- Decision: keep `RedditConnector` as stable domain boundary.
- Current provider choices:
  - `RedditApifyConnector` (primary live provider; actor-run + dataset flow)
  - `RedditHttpConnector` (fallback/compare provider, still switchable via `REDDIT_LIVE_PROVIDER=http`)
  - `RedditMockConnector` (deterministic local testing)
