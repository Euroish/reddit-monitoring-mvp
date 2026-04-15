# Reddit Monitoring Lean Kit

This kit is intentionally small.

It follows the principle from your workflow notes:
- short standing rules
- short skill files
- externalized context
- minimal mode separation
- no heavy persona setup

Use this when you want Codex to stay focused instead of being buried under too many files.

## Current Architecture Notes

- `runtime/*` is the composition root for phase-1 execution:
  - shared env parsing
  - Postgres/repository assembly
  - connector factory assembly
  - phase-1 option resolution
- `application/use-cases/*` owns write-trigger orchestration boundaries.
- `workers/*` owns collection execution and adaptive sampling behavior.
- `application/services/*read-model*` owns website-facing aggregation from persisted truth.

## Default command surface

For algorithm work, ignore the rest of `package.json` by default and use only:

- `npm install`
- `npm run algo:fast`
- `npm run algo:phase1`
- `npm run algo:full`
- `npm run algo:live:verify` only when live calibration is explicitly required

## Command policy

- Default algorithm loop: `algo:fast`
- Wider truth-layer regression check: `algo:phase1`
- Pre-close gate: `algo:full`
- Live verification: manual-only and opt-in through `algo:live:verify`
- Operational commands such as DB migration, worker boot, scheduler loops, API boot, cache prewarm, and prune tasks are not part of the routine algorithm loop. Treat them as runbook operations, not default development commands.

All operational/manual commands live in [docs/operations-runbook.md](docs/operations-runbook.md).

## Runtime env

- `DATABASE_URL`: PostgreSQL connection string (required for migration/worker PostgreSQL path)
- `REDDIT_ACCESS_TOKEN`: optional; when set, connector uses OAuth endpoint
- `REDDIT_USER_AGENT`: optional custom User-Agent for Reddit requests
- `REDDIT_LIVE_PROVIDER`: live provider selector (`http` default, `apify` for fallback/backfill)
- `REDDIT_HTTP_TRANSPORT`: http transport selector (`auto` default, `fetch`, or `powershell` on Windows)
- `REDDIT_CB_ENABLED`: enable provider circuit breaker for live connector (`true` default)
- `REDDIT_CB_TIMEOUT_MS`: breaker execution timeout, default `12000`
- `REDDIT_CB_ERROR_THRESHOLD_PERCENT`: open-threshold percentage, default `50`
- `REDDIT_CB_RESET_TIMEOUT_MS`: open-to-half-open wait, default `15000`
- `REDDIT_CB_VOLUME_THRESHOLD`: minimum request volume before opening, default `5`
- `REDDIT_CB_ROLLING_COUNT_TIMEOUT_MS`: rolling stats window, default `10000`
- `REDDIT_CB_ROLLING_COUNT_BUCKETS`: rolling stats bucket count, default `10`
- `REDDIT_CB_ROUTE_TO_FALLBACK`: route to fallback provider when breaker rejects (`true` default; `apify -> http`)
- `APIFY_REDDIT_ACTOR_RUN_ENDPOINT`: Apify actor run endpoint (required for real Apify runtime, e.g. `https://api.apify.com/v2/acts/<actor>/runs`)
- `APIFY_TOKEN`: optional Apify token for private actors / higher limits
- `APIFY_FALLBACK_TO_HTTP`: fallback to HTTP provider when Apify run fails (`true` default)
- `APIFY_COMPARE_WITH_HTTP`: run HTTP provider in parallel for post-count comparison telemetry (`false` default)
- `APIFY_RUN_WAIT_FOR_FINISH_SECONDS`: wait time per Apify run poll call, default `60`
- `APIFY_RUN_POLL_ATTEMPTS`: max poll attempts before timeout classification, default `3`
- `REDDIT_RUN_SUBREDDIT`: optional target for one-shot worker, default `machinelearning`
- `REDDIT_RUN_SUBREDDITS`: optional comma-separated targets for scheduler bootstrap, e.g. `machinelearning,datascience`
- `REDDIT_POST_LIMIT`: optional fixed posts-per-target per window (disables adaptive limit for that run)
- `REDDIT_POST_LIMIT_BASE`: adaptive baseline posts per target, default `16`
- `REDDIT_POST_LIMIT_BOOST`: adaptive boosted posts per target, default `40`
- `REDDIT_POST_LIMIT_BOOST_WINDOW_MINUTES`: lookback window for adaptive boost trigger, default `180`
- `REDDIT_POST_LIMIT_BOOST_SURGE_THRESHOLD`: adaptive boost trigger on `surge_score`, default `0.85`
- `REDDIT_POST_LIMIT_BOOST_HEAT_CHANGE_THRESHOLD`: adaptive boost trigger on `heat_change_pct`, default `0.8`
- `REDDIT_POST_LIMIT_BOOST_IMPACT_MOMENTUM_THRESHOLD`: adaptive boost trigger on impact momentum score component, default `0.7`
- `REDDIT_POST_LIMIT_BOOST_MIN_DISPERSION`: minimum `dispersion_score` required for surge/impact boost triggers, default `0.45`
- `REDDIT_POST_LIMIT_BOOST_MIN_HIGH_SCORE_POSTS`: minimum `high_score_post_count` required for heat-change boost trigger, default `2`
- `REDDIT_POST_LIMIT_BOOST_COOLDOWN_WINDOWS`: boosted-window cooldown length (in trend windows) before another boost is allowed, default `2`
- `REDDIT_KEYWORD_DAILY_LOOKBACK_DAYS`: lookback window for keyword daily materialization per run, default `90`
- `REDDIT_KEYWORD_QUALITY_MIN_SCORE`: minimum post score for `qualified_mention_rate`, default `10`
- `REDDIT_KEYWORD_QUALITY_MIN_COMMENTS`: minimum comment count for `qualified_mention_rate`, default `20`
- `REDDIT_KEYWORD_DAILY_MAX_KEYWORDS_PER_DAY`: max persisted keywords per day per subreddit, default `50`
- `REDDIT_POST_LIMIT_ADAPTIVE`: set `false` to disable adaptive sampling and always use baseline/fixed limit
- `PHASE1_SCHEDULER_INTERVAL_MS`: scheduler polling interval, default `300000` (minimum `5000`)
- Live `collect_subreddit_new_posts` now polls the head page on a 5m collection window; backfill keeps cursor-based paging on a 15m window.
- `PHASE1_SCHEDULER_RUN_ON_START`: run one cycle immediately on boot (`false` default)
- `KEYWORD_QUERY_LIVE_REFRESH_RUN_ON_START`: run keyword-query refresh immediately on boot (`false` default)
- `COLLECTION_JOB_MAX_RETRIES`: per-job retry ceiling before dead-letter, default `2`
- `COLLECTION_JOB_RETRY_BASE_MS`: base backoff delay, default `60000`
- `COLLECTION_JOB_RETRY_MAX_MS`: max backoff delay, default `900000`
- `API_BEARER_TOKEN`: required for `npm run app:api`; protects `/v1/*` routes
- `API_CORS_ALLOW_ORIGINS`: comma-separated CORS allowlist, default `*`
- `API_CORS_MAX_AGE_SECONDS`: preflight cache seconds, default `300`
- `API_RATE_LIMIT_ENABLED`: enable query rate limiting for `GET /v1/trends/*`, default `true`
- `API_RATE_LIMIT_POINTS`: max query requests per key in one window, default `60`
- `API_RATE_LIMIT_DURATION_SECONDS`: rate-limit window seconds, default `60`
- `KEYWORD_QUERY_PREWARM_TARGETS`: semicolon-separated prewarm list, format `query text@subreddit;query text 2`
- `KEYWORD_QUERY_PREWARM_LIMIT`: representative sample limit for prewarm runs, default `10`
- `PG_CONNECTION_TIMEOUT_MS`: PostgreSQL connect timeout, default `10000`
- `PG_IDLE_TIMEOUT_MS`: PostgreSQL idle timeout, default `30000`
- `PG_QUERY_TIMEOUT_MS`: PostgreSQL query timeout, default `30000`
- `RAW_EVENT_RETENTION_DAYS`: retention window for prune script, default `30`
- `RAW_EVENT_PRUNE_BATCH_SIZE`: prune batch size, default `5000`
- `RAW_EVENT_PRUNE_LOOP`: set `true` to loop batches until caught up

## Docs

- SQL review: `docs/sql-repository-review.md`
- operations runbook: `docs/operations-runbook.md`
- API acceptance examples: `docs/phase1-api-acceptance-examples.md`
- open questions (closed): `docs/open-questions.md`
- execution kickoff: `docs/execution-kickoff.md`

## Frontend Skill Entry

- Unified frontend skill: `skills/frontend-dev-suite/SKILL.md`
- Unified frontend prompt: `prompts/frontend-dev-unified.md`
- Design templates root: `awesome-design-md-main/design-md`
- Default design template: `awesome-design-md-main/design-md/voltagent/DESIGN.md`

## Algorithm Skill Entry

- Unified algorithm skill: `skills/algorithm-dev-suite/SKILL.md`
- Use it as the only project-facing entrypoint for algorithm work.
- It routes truth-layer fixes through the current P1.5 branch before any later scoring/ranking expansion.
- Its default command surface is `algo:fast -> algo:phase1 -> algo:full`, with `algo:live:verify` only by explicit need.

## Phase-1 API boundary

- `GET /healthz`
- `GET /readyz`
- `POST /v1/targets/subreddit`
- `POST /v1/runs/reddit-phase1`
- `POST /v1/keyword-queries`
- `GET /v1/keyword-queries/:queryId`
- `GET /v1/trends/subreddit/:subreddit`
- `GET /v1/trends/subreddit/:subreddit/daily`
- `GET /v1/trends/market`

Response quality defaults:
- every response includes `requestId` (also mirrored in `x-request-id` header)
- ready response includes `checks`, `queue` (`backlog/scheduled/running/deadLetter`), and `activeSessions`
- trend response includes `timeline`, `summary`, `topMovers`, `recentAnomalies`, and per-point `scoreComponents`
- keyword query response includes `coverageLevel`, `supportCount`, `confidenceLevel`, `mentionRate`, `qualifiedMentionRate`, `sourceTypeSummary`, `sourceType`, `dataQuality`, `degradedReason`, `explainPayload`, `samplePosts`, and `pulsePoints5m`
- trend scores include product metrics: `heatIndex`, `surgeScore`, `dispersionScore`, `heatChangePct`
- market response includes cross-subreddit rankings: `byHeat`, `bySurge`, `byDispersion`
- errors include stable `errorCode` for acceptance checks

Input guardrails:
- subreddit format: letters/numbers/underscore, length 3-21
- trend `from/to` range max: 30 days
- trend `from/to` are aligned to 6-hour UTC windows on read
- trend `recentPostsLimit` range: 1-50
- daily insights `from/to` range max: 90 days
- daily insights `keywords`: optional comma list
- daily insights `keywordLimit` range: 1-30
