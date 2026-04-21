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
npm run smoke:linux-provider
```

`npm run smoke:web` starts an in-memory API seed plus Vite locally and verifies
owner session persistence, keyword queries, target chart rendering, Ops
readiness plus run-trigger flow, logout redirect, viewer Ops guard, and a
mobile responsive pass across the product-shell routes. It is a pre-deploy
product-shell check, not a production service command.

The production runtime must use `node dist/...` entrypoints. Do not run production services through `tsx`.

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
- login sets an `HttpOnly` + `Secure` session cookie and `/api/auth/me` resolves the session when launch credentials are provided

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

## Linux Provider Smoke

On the Linux host, verify provider configuration before starting schedulers:

```bash
REDDIT_HTTP_TRANSPORT=fetch REDDIT_LIVE_PROVIDER=http node dist/scripts/linux-provider-smoke.js
```

If Scrapling is enabled later, set `REDDIT_LIVE_PROVIDER=scrapling` and rerun the same command on the Linux host. The smoke script intentionally rejects non-`fetch` HTTP transport for production.

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

## Rollback

Keep the previous release directory until the new API, scheduler, and readiness checks pass. To roll back:

```bash
sudo systemctl stop reddit-phase1-scheduler reddit-keyword-refresh reddit-api
sudo ln -sfn /opt/reddit-monitoring/releases/previous /opt/reddit-monitoring
sudo systemctl start reddit-api reddit-phase1-scheduler reddit-keyword-refresh
curl -fsS http://127.0.0.1:3000/readyz
```

Do not roll migrations backward without a specific migration rollback plan.
