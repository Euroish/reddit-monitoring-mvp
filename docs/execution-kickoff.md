# Execution Kickoff (Day 1)

Date: 2026-04-10

## Goal for today

Switch from document-only preparation to executable project skeleton.

## Files to implement first

1. API app entry
- `apps/api/src/server.ts`

2. Worker entry
- `workers/reddit-phase1-once.ts`

3. Contract package
- `packages/contracts/src/http.ts`

4. Manual trigger script
- `scripts/manual-phase1-run.ts`

5. Integration test
- `tests/integration/reddit-phase1-cycle.test.ts`

## Fast local path

1. `npm run typecheck:core`
2. `npm run test:unit`
3. `npm run test:trend` when the change touches scoring/read-model behavior

## Manual verification path

1. `npm run typecheck`
2. `npm run test`
3. `npm run db:migrate` (needs `DATABASE_URL`)
4. `npm run worker:phase1:once` for mock-safe DB verification
5. `npm run worker:phase1:once:live` only when live Reddit verification is required
6. `npm run app:api`

Then verify:
- `GET /healthz`
- `GET /v1/trends/subreddit/{subreddit}`

## Scope guard

- no multi-source expansion now
- scheduler automation is available via `npm run worker:phase1:scheduler`, but continuous schedulers are manual-only and do not run a cycle on boot by default
- no UI app now
- no ranking/alert algorithm now
