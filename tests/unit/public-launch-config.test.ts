import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("nginx launch template keeps readyz private and emits correlated access logs", async () => {
  const nginxConfig = await readFile("deploy/nginx/reddit-monitoring.conf", "utf8");

  assert.match(
    nginxConfig,
    /^log_format reddit_monitoring_main[\s\S]+server \{/m,
  );
  assert.match(nginxConfig, /access_log \/var\/log\/nginx\/reddit-monitoring\.access\.log reddit_monitoring_main;/);
  assert.match(nginxConfig, /error_log \/var\/log\/nginx\/reddit-monitoring\.error\.log warn;/);
  assert.match(nginxConfig, /location = \/readyz \{/);
  const apiReady = /location = \/api\/readyz \{([^}]+)\}/.exec(nginxConfig)?.[1];
  assert.ok(apiReady, "The /api/ prefix must not bypass readiness access restrictions");
  assert.match(apiReady, /deny all;/);
  assert.match(nginxConfig, /allow 127\.0\.0\.1;/);
  assert.match(nginxConfig, /deny all;/);
  assert.match(nginxConfig, /access_log \/var\/log\/nginx\/reddit-monitoring\.readyz\.access\.log reddit_monitoring_main;/);
  assert.match(nginxConfig, /proxy_set_header X-Request-Id \$request_id;/);
});

test("nginx authentication edge limit keys actual client connections without trusting forwarded headers", async () => {
  const nginxConfig = await readFile("deploy/nginx/reddit-monitoring.conf", "utf8");
  assert.match(nginxConfig, /limit_req_zone \$binary_remote_addr zone=reddit_auth:10m rate=20r\/m;/);
  const authentication = /location ~ \^\/api\/auth\/\(login\|register\)\$ \{([^}]+)\}/.exec(nginxConfig)?.[1];
  assert.ok(authentication, "Both anonymous credential endpoints require the edge policy");
  assert.match(authentication, /limit_req zone=reddit_auth burst=5 nodelay;/);
  assert.match(authentication, /limit_req_status 429;/);
  assert.match(authentication, /rewrite \^\/api\/auth\/\(login\|register\)\$ \/auth\/\$1 break;/);
  assert.doesNotMatch(nginxConfig, /real_ip_header|set_real_ip_from|\$http_x_forwarded_for.*zone=/);
});
