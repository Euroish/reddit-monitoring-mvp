import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer as createProbeServer } from "node:net";
import { chromium } from "playwright";
import { Client } from "pg";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { runMigrations } from "../src/storage/schema/run-migrations";
import { createPostgresRepositoryBundle } from "../src/storage/repositories/postgres/postgres-repository-bundle";
import { createApiServer } from "../apps/api/src/create-api-server";
import { RedditMockConnector } from "../src/connectors/reddit/reddit-mock.connector";
import { PasswordHashingService } from "../src/application/services/password-hashing.service";
import type { AppUser } from "../src/domain/entities/app-user";

async function availablePort() {
  const server = createProbeServer(); await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
}
async function ready(url: string) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* bounded local startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("Local account smoke web server did not start");
}
async function main() {
  const raw = process.env.TEST_SOURCE_DATABASE_URL;
  if (!raw) throw new Error("TEST_SOURCE_DATABASE_URL is required; account smoke never uses the business database");
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname)
      || url.search || url.hash || !/^\/source_validation_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Use dedicated loopback source_validation_* PostgreSQL");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12), database = `source_validation_account_ui_${suffix}`;
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.href }); await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 3 });
  const folder = path.resolve("output/validation"), screenshots = path.resolve("output/playwright");
  await mkdir(folder, { recursive: true }); await mkdir(screenshots, { recursive: true });
  const log = await open(path.join(folder, `account-local-vite-${suffix}.log`), "a");
  let web: ReturnType<typeof spawn> | undefined, server: ReturnType<typeof createApiServer> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const password = `Synthetic-${randomBytes(12).toString("hex")}`, changed = `Changed-${randomBytes(12).toString("hex")}`;
  const requests: { path: string; status: number }[] = [], pageErrors: string[] = []; let externalRequests = 0;
  try {
    await runMigrations({ db });
    const repos = createPostgresRepositoryBundle(db), now = () => new Date().toISOString(), hashes = new PasswordHashingService();
    const seed = async (label: string, role: AppUser["role"]) => {
      const user: AppUser = { id: randomUUID(), email: `${label}-${suffix}@example.test`, displayName: label, role, status: "active", createdAt: now(), updatedAt: now() };
      await repos.appUserRepository.create(user, { userId: user.id, passwordHash: await hashes.hashPassword(password), passwordAlgo: "scrypt", updatedAt: now() });
      await db.query("INSERT INTO saved_workbench_view(id,user_id,name,view_kind,primary_target,route_path) VALUES($1,$2,$3,'target','synthetic','/target/synthetic')", [randomUUID(), user.id, `${label}-private-view`]);
      return user;
    };
    const a = await seed("Account-A", "viewer"), b = await seed("Account-B", "viewer");
    await seed("Synthetic-owner", "owner");
    const webPort = await availablePort(), webBase = `http://127.0.0.1:${webPort}`;
    server = createApiServer({ repositories: repos, createConnector: () => new RedditMockConnector(),
      executionEnvironment: { NODE_ENV: "test", SOURCE_RUN_MODE: "demo", SOURCE_NETWORK_ENABLED: "false" },
      auth: { bearerToken: randomBytes(24).toString("hex"), sessionCookieSecure: false },
      cors: { allowedOrigins: [webBase] }, logger: () => {} });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert.ok(address && typeof address === "object");
    const apiBase = `http://127.0.0.1:${address.port}`;
    web = spawn(process.execPath, ["apps/web/node_modules/vite/bin/vite.js", path.resolve("apps/web"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", log.fd, log.fd],
      env: { ...process.env, LOCAL_ENV_FILE: "none", NODE_ENV: "test", VITE_API_PROXY_TARGET: apiBase },
    });
    await ready(`${webBase}/login`);
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } }), page = await context.newPage();
    await context.route("**/*", async route => {
      const requestUrl = new URL(route.request().url());
      if (![webBase, apiBase].includes(requestUrl.origin) && !["data:", "blob:"].includes(requestUrl.protocol)) { externalRequests++; await route.abort(); }
      else await route.continue();
    });
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => { const u = new URL(response.url()); if (u.pathname.startsWith("/api/")) requests.push({ path: u.pathname, status: response.status() }); });
    const login = async (email: string, secret: string) => {
      await page.goto(`${webBase}/login`); await page.locator("#login-email").fill(email); await page.locator("#login-password").fill(secret);
      await page.locator("form button[type=submit]").click(); await page.waitForURL(u => !u.pathname.startsWith("/login"));
    };
    await login(a.email, password);
    await page.goto(`${webBase}/saved`); await page.getByText("Account-A-private-view", { exact: true }).waitFor();
    assert.equal(await page.getByText("Account-B-private-view", { exact: true }).count(), 0);
    const secondary = await fetch(`${apiBase}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: a.email, password }) });
    assert.equal(secondary.status, 200); const oldCookie = secondary.headers.get("set-cookie")!;
    await page.goto(`${webBase}/account`); await page.locator("#account-current-password").waitFor();
    await page.locator("#account-current-password").fill(password); await page.locator("#account-new-password").fill(changed); await page.locator("#account-confirm-password").fill(changed);
    await page.locator("form button[type=submit]").click(); await page.waitForURL(u => u.pathname === "/login");
    assert.equal((await fetch(`${apiBase}/auth/me`, { headers: { cookie: oldCookie } })).status, 401);
    await login(b.email, password);
    await page.goto(`${webBase}/saved`); await page.getByText("Account-B-private-view", { exact: true }).waitFor();
    assert.equal(await page.getByText("Account-A-private-view", { exact: true }).count(), 0);
    await page.goto(`${webBase}/account`); await page.locator("#account-current-password").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(screenshots, "phase4b-real-account-local-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: /Revoke all sessions and sign out|撤销全部会话并退出/ }).click();
    await page.waitForURL(u => u.pathname === "/login");
    await login(a.email, changed); await page.goto(`${webBase}/saved`); await page.getByText("Account-A-private-view", { exact: true }).waitFor();
    const audit = await db.query("SELECT action,outcome FROM app_audit_log WHERE action IN ('account.password.change','account.sessions.revoke_all') ORDER BY action");
    assert.deepEqual(audit.rows.map(row => [row.action, row.outcome]), [["account.password.change", "succeeded"], ["account.sessions.revoke_all", "succeeded"]]);
    assert.equal(externalRequests, 0); assert.deepEqual(pageErrors, []);
    const result = { scope: "real_loopback_browser_api_postgres_synthetic_accounts", database, accountIsolation: true, passwordReauthentication: true,
      oldSessionRejected: true, revokeAll: true, auditPersisted: true, viewport390: true, requests, externalRequests, pageErrors, realSourceRequests: 0 };
    await writeFile(path.join(folder, "phase4b-real-account-local.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, requests: requests.length }));
  } finally {
    if (browser) await browser.close();
    if (web && web.exitCode === null) {
      web.kill(); await Promise.race([new Promise(resolve => web!.once("exit", resolve)), new Promise(resolve => setTimeout(() => { if (web!.exitCode === null) web!.kill("SIGKILL"); resolve(undefined); }, 3000))]);
    }
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    await log.close(); await db.close();
  }
}
if (require.main === module) void main().catch(error => { console.error(error instanceof Error ? error.message : "Local account smoke failed"); process.exitCode = 1; });
