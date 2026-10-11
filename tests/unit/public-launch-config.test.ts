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
