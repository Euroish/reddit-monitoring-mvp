import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("nginx launch template keeps readyz private and emits correlated access logs", async () => {
  const nginxConfig = await readFile("deploy/nginx/reddit-monitoring.conf", "utf8");

  assert.match(
    nginxConfig,
    /^log_format reddit_monitoring_main[\s\S]+server \{/,
  );
  assert.match(nginxConfig, /access_log \/var\/log\/nginx\/reddit-monitoring\.access\.log reddit_monitoring_main;/);
  assert.match(nginxConfig, /error_log \/var\/log\/nginx\/reddit-monitoring\.error\.log warn;/);
  assert.match(nginxConfig, /location = \/readyz \{/);
  assert.match(nginxConfig, /allow 127\.0\.0\.1;/);
  assert.match(nginxConfig, /deny all;/);
  assert.match(nginxConfig, /access_log \/var\/log\/nginx\/reddit-monitoring\.readyz\.access\.log reddit_monitoring_main;/);
  assert.match(nginxConfig, /proxy_set_header X-Request-Id \$request_id;/);
});

test("deployment runbook documents the public launch smoke and rollout logging", async () => {
  const runbook = await readFile("docs/deployment-runbook.md", "utf8");

  assert.match(runbook, /npm run smoke:public-launch/);
  assert.match(runbook, /PUBLIC_BASE_URL=https:\/\/example\.com/);
  assert.match(runbook, /PUBLIC_LOGIN_EMAIL=/);
  assert.match(runbook, /PUBLIC_LOGIN_PASSWORD=/);
  assert.match(runbook, /PUBLIC_ALLOWED_ORIGIN=/);
  assert.match(runbook, /reddit-monitoring\.access\.log/);
  assert.match(runbook, /reddit-monitoring\.readyz\.access\.log/);
  assert.match(runbook, /logout clears the session cookie/i);
  assert.match(runbook, /credentialed CORS headers/i);
  assert.match(runbook, /## Backup And Restore/);
  assert.match(runbook, /pg_dump --format=custom/);
  assert.match(runbook, /pg_restore --clean --if-exists --no-owner/);
  assert.match(runbook, /## Rollback/);
  assert.match(runbook, /`app_audit_log` remains schema-ready/);
});
