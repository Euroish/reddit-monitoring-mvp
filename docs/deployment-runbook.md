# Deployment Runbook

## Scope

This runbook covers the single-server production shape for the Reddit monitoring MVP:

- Nginx serves the future web app and proxies API traffic.
- The API runs from compiled JavaScript with Node.
- The Phase 1 scheduler and keyword refresh scheduler run from compiled JavaScript with systemd.
- PostgreSQL is the persistence backend.

## Build

Run these commands from the repository root:

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run smoke:compiled
npm run smoke:linux-provider
```

The production runtime must use `node dist/...` entrypoints. Do not run production services through `tsx`.

## Server Files

Expected server layout:

```text
/opt/reddit-monitoring
  dist/
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
curl -fsS http://example.com/readyz
```

## Rollback

Keep the previous release directory until the new API, scheduler, and readiness checks pass. To roll back:

```bash
sudo systemctl stop reddit-phase1-scheduler reddit-keyword-refresh reddit-api
sudo ln -sfn /opt/reddit-monitoring/releases/previous /opt/reddit-monitoring
sudo systemctl start reddit-api reddit-phase1-scheduler reddit-keyword-refresh
curl -fsS http://127.0.0.1:3000/readyz
```

Do not roll migrations backward without a specific migration rollback plan.
