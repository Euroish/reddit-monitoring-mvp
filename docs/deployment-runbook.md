# Deployment Runbook

## Scope

This runbook covers the single-server production shape for the Reddit monitoring MVP:

- Nginx serves the future web app and proxies API traffic.
- The web app is built from `apps/web` and served as static files.
- The API runs from compiled JavaScript with Node.
- The Phase 1 scheduler and keyword refresh scheduler run from compiled JavaScript with systemd.
- PostgreSQL is the persistence backend.

## Build

Run these commands from the repository root:

```powershell
npm install
npm --prefix apps/web ci
npm run typecheck
npm test
npm run lint:web
npm run build
npm run smoke:web
npm run smoke:compiled
node dist/scripts/linux-provider-smoke.js --config-only
```

`npm run smoke:web` starts an in-memory API seed plus Vite locally and verifies
owner session persistence, keyword queries, target chart rendering, Ops
readiness plus run-trigger flow, logout redirect, viewer Ops guard, and a
mobile responsive pass across the product-shell routes. It is a pre-deploy
product-shell check, not a production service command.

The production runtime must use `node dist/...` entrypoints. Do not run production services through `tsx`.

## Staged Validation Policy

Use a staged validation loop to avoid low-value Linux retesting after every small slice:

1. `repo-side complete`
   - default for UI, tests, read models, and other repo-verifiable changes
   - run `npm run verify:repo`
2. `host verification deferred`
   - default for deploy/runtime slices between milestones
   - run `npm run verify:launch:local`
   - defer Linux/public-host proof until the next deployment batch
3. `host verification required now`
   - use at deployment milestones for changes that touch deploy assets, migrations, public readiness/auth/cookie/CORS behavior, or provider/Linux runtime behavior

Use the classifier to keep this objective:

```bash
npm run validate:scope
npm run validate:scope -- --milestone
```

The classifier inspects the changed files and reports one of:

- `repo-side complete`
- `host verification deferred`
- `host verification required now`

This keeps Linux validation aligned with real deployment boundaries instead of every small repo change.

## Public Launch Smoke

Run this after the deploy is live on the public domain:

```bash
PUBLIC_BASE_URL=https://example.com \
npm run smoke:public-launch
```

Optional authenticated checks can be enabled with a real owner/admin launch account:

```bash
PUBLIC_BASE_URL=https://example.com \
PUBLIC_LOGIN_EMAIL=owner@example.com \
PUBLIC_LOGIN_PASSWORD=change-me \
PUBLIC_ALLOWED_ORIGIN=https://example.com \
PUBLIC_BLOCKED_ORIGIN=https://evil.example.com \
npm run smoke:public-launch
```

What the smoke verifies:

- public `/healthz` responds with `200` and `ok: true`
- public `/readyz` is not exposed (`401`/`403`/`404` only)
- exact allowed origin preflight succeeds when `PUBLIC_ALLOWED_ORIGIN` is set
- invalid origin is blocked with `cors_origin_not_allowed` when origin checks are enabled
- login sets an `HttpOnly` + `Secure` + `SameSite=Lax` session cookie and `/api/auth/me` resolves the session when launch credentials are provided
- when `PUBLIC_ALLOWED_ORIGIN` is set, login, `/api/auth/me`, and logout all echo credentialed CORS headers for that exact origin
- logout clears the session cookie with `Max-Age=0` so launch smoke proves both session establishment and revocation

## Server Files

Expected server layout:

```text
/opt/reddit-monitoring
  dist/
  apps/web/dist/
  package.json
  package-lock.json
/etc/reddit-monitoring
  api.env
  scheduler.env
```

Copy and edit:

- `deploy/env/api.env.example` to `/etc/reddit-monitoring/api.env`
- `deploy/env/scheduler.env.example` to `/etc/reddit-monitoring/scheduler.env`
- `deploy/systemd/*.service` to `/etc/systemd/system/`
- `deploy/nginx/reddit-monitoring.conf` to the Nginx sites directory

Production auth/origin policy must stay explicit:

- `API_CORS_ALLOW_ORIGINS` should list the exact web origin(s); do not rely on `*`.
- `API_SESSION_COOKIE_SECURE=true` should remain enabled on the public domain.
- Same-origin deployments can leave CORS empty and rely on the Nginx `/api/` proxy path.
- `REDDIT_PROVIDER_CAPABILITY_REQUIRED=true` should remain enabled in production so `/readyz` stays `not_ready` until the live provider has real proof instead of only config-level green checks.

Launch logging policy:

- Nginx writes main edge traffic to `/var/log/nginx/reddit-monitoring.access.log`.
- Nginx writes `/readyz` probes and denials to `/var/log/nginx/reddit-monitoring.readyz.access.log`.
- Nginx forwards `$request_id` to the API as `X-Request-Id` so edge logs can be correlated with API JSON request logs.
- `app_audit_log` remains schema-ready, but launch evidence today comes from correlated API request logs plus the Nginx access logs above; do not claim DB-backed actor audit persistence until a write path exists.

## Database

Run migrations after deploying a fresh build:

```bash
npm ci --omit=dev
npm run db:migrate:compiled
```

Bootstrap the first owner exactly once on a fresh production database before public login:

```bash
BOOTSTRAP_OWNER_EMAIL=owner@example.com \
BOOTSTRAP_OWNER_PASSWORD=change-me \
BOOTSTRAP_OWNER_DISPLAY_NAME="Owner" \
npm run auth:bootstrap-owner:compiled
```

The bootstrap command is intentionally narrow: it fails if any `app_user` row already exists.

## Linux Provider Smoke

On the Linux host, verify provider configuration before starting schedulers:

```bash
REDDIT_HTTP_TRANSPORT=fetch REDDIT_LIVE_PROVIDER=http node dist/scripts/linux-provider-smoke.js
```

This is now a real provider capability probe, not only a config lint. It verifies
transport policy and performs a live `about.json` probe against the configured
provider before the scheduler is allowed to start its live cycle.

If Scrapling is enabled later, set `REDDIT_LIVE_PROVIDER=scrapling` and rerun the same command on the Linux host. The smoke script intentionally rejects non-`fetch` HTTP transport for production.

Scheduler safety defaults in `deploy/env/scheduler.env.example` are conservative:

- `PHASE1_SCHEDULER_RUN_ON_START=false`
- `REDDIT_PROVIDER_CAPABILITY_REQUIRED=true`

Keep them that way on first deployment. Only enable boot-time scheduling after the provider probe succeeds on the Linux host.

Small-VPS retention defaults should also stay bounded unless a larger storage budget is explicitly proven:

- `RAW_EVENT_RETENTION_DAYS=7`
- `METRICS_SNAPSHOT_RETENTION_DAYS=30`
- keep prune jobs batched; do not switch to unbounded delete loops outside controlled maintenance windows

## Start Or Restart

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now reddit-api
sudo systemctl enable --now reddit-phase1-scheduler
sudo systemctl enable --now reddit-keyword-refresh
sudo systemctl reload nginx
```

Health checks:

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/readyz
curl -fsS http://example.com/healthz
PUBLIC_BASE_URL=https://example.com npm run smoke:public-launch
```

`/readyz` exposes detailed provider and materialization state. The Nginx template
restricts the public `/readyz` path to localhost; inspect it locally or through
the authenticated web Ops page instead of expecting `http://example.com/readyz`
to pass from an external client.

## Backup And Restore

Before any deployment milestone that changes runtime config, schema, or release assets, capture both a database backup and the current release pointer:

```bash
sudo mkdir -p /opt/reddit-monitoring/backups
pg_dump --format=custom --file /opt/reddit-monitoring/backups/reddit-monitoring-$(date +%F-%H%M%S).dump "$DATABASE_URL"
readlink -f /opt/reddit-monitoring > /opt/reddit-monitoring/backups/current-release.txt
```

Restore procedure for a full production rollback rehearsal or recovery:

```bash
sudo systemctl stop reddit-phase1-scheduler reddit-keyword-refresh reddit-api
dropdb --if-exists reddit_monitoring_restore
createdb reddit_monitoring_restore
pg_restore --clean --if-exists --no-owner --dbname reddit_monitoring_restore /opt/reddit-monitoring/backups/<backup>.dump
```

Use a separate restore database first when validating a backup. Only restore over the production database after you have confirmed the dump is valid and the recovery plan has been approved for the incident.

## Rollback

Keep the previous release directory until the new API, scheduler, and readiness checks pass. To roll back:

```bash
sudo systemctl stop reddit-phase1-scheduler reddit-keyword-refresh reddit-api
sudo ln -sfn /opt/reddit-monitoring/releases/previous /opt/reddit-monitoring
sudo systemctl start reddit-api reddit-phase1-scheduler reddit-keyword-refresh
curl -fsS http://127.0.0.1:3000/readyz
```

Do not roll migrations backward without a specific migration rollback plan.
