import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, writeFile, readFile } from "node:fs/promises";
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
import { SourceContentService } from "../src/application/services/source-content.service";
import { ContentPersonalService } from "../src/application/services/content-personal.service";
import { PostgresContentPersonalRepository } from "../src/storage/repositories/postgres/postgres-content-personal.repository";
import { PostgresSourceContentRepository } from "../src/storage/repositories/postgres/postgres-source-content.repository";
import { DemoContentProvider } from "../src/connectors/demo/demo-content.connector";
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
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12), database = `source_validation_content_ui_${suffix}`;
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.href }); await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 3 });
  const folder = path.resolve("output/validation"), screenshots = path.resolve("output/playwright");
  await mkdir(folder, { recursive: true }); await mkdir(screenshots, { recursive: true });
  const log = await open(path.join(folder, `content-local-vite-${suffix}.log`), "a");
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
    const sourceRepository = new PostgresSourceContentRepository(db);
    const sourceContent = new SourceContentService(sourceRepository, [new DemoContentProvider("reddit", now), new DemoContentProvider("x", now)], now);
    for (const platform of ["reddit", "x"] as const) {
      const source = await sourceContent.createSource({ platform, provider: `demo_${platform}`, contentKind: "post", label: `Synthetic ${platform} workspace`, target: { type: "account", account: "workspace_writer" } });
      await sourceContent.updateSource(source.id, { group: "Local research", expectedRevision: source.revision });
      await sourceContent.enqueue(source.id, { from: new Date(Date.now()-4*3600000).toISOString(), to: now(), pageSize: 100, maxPages: 1 });
      assert.equal(await sourceContent.workOnce(), true);
    }
    const seeded = await sourceRepository.listContent({ platform: "reddit", author: "workspace_writer" });
    assert.equal(seeded.items.length, 8); const sample = seeded.items[0]!;
    const webPort = await availablePort(), webBase = `http://127.0.0.1:${webPort}`;
    server = createApiServer({ repositories: repos, sourceContent, contentPersonal: new ContentPersonalService(new PostgresContentPersonalRepository(db), sourceContent), createConnector: () => new RedditMockConnector(),
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
    const queryPath = '/content?platform=reddit&author=workspace_writer&language=zh-CN&sourceGroup=Local+research&sort=published_asc';
    await page.goto(`${webBase}${queryPath}`);
    await page.getByRole("heading", { name: sample.title!, exact: true }).first().waitFor();
    await page.getByText("Save applied query for my account", { exact: true }).click();
    await page.locator("#saved-content-query-name").fill("Local A research");
    await page.getByRole("button", { name: "Save query", exact: true }).click();
    await page.getByText("Query saved.", { exact: false }).waitFor();
    await page.goto(`${webBase}/saved`); await page.getByRole("link", { name: "Local A research", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("author"), "workspace_writer");
    await page.getByRole("heading", { name: sample.title!, exact: true }).first().getByRole("link").click();
    await page.getByRole("heading", { name: "Stored references and replies", exact: true }).waitFor();
    const contentId = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByLabel("Favorite this content", { exact: true }).check();
    await page.getByLabel("Personal note", { exact: true }).fill("Private localhost A note");
    await page.getByRole("button", { name: "Save personal note", exact: true }).click();
    await page.getByText("Personal annotation updated.", { exact: true }).waitFor();
    const conflict = await context.request.put(`${webBase}/api/v1/content/${contentId}/annotation`, { data: { note: "Concurrent tab note", expectedRevision: 1 } });
    assert.equal(conflict.status(), 200);
    await page.getByLabel("Personal note", { exact: true }).fill("Preserved local conflict draft");
    await page.getByRole("button", { name: "Save personal note", exact: true }).click();
    await page.getByText("Your draft is preserved.", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Personal note", { exact: true }).inputValue(), "Preserved local conflict draft");
    await page.getByRole("button", { name: "Reload personal note", exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('#personal-content-note') as HTMLTextAreaElement)?.value === 'Concurrent tab note');
    await page.getByLabel("Personal note", { exact: true }).fill("Final localhost A note");
    await page.getByRole("button", { name: "Save personal note", exact: true }).click();
    await page.getByText("Personal annotation updated.", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(screenshots, "phase5a-real-content-local-mobile.png"), fullPage: true });
    await page.goto(`${webBase}${queryPath}`); await page.getByText("Export matching saved content", { exact: true }).click();
    const download = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download JSON", exact: true }).click()]);
    const file = await download[0].path(); assert.ok(file); const exported = JSON.parse(await readFile(file, "utf8"));
    assert.equal(exported.totalMatching, 8); assert.equal(exported.items.length, 8);
    await login(b.email, password); await page.goto(`${webBase}/saved`);
    await page.getByText("No personal content queries yet.", { exact: false }).waitFor();
    assert.equal(await page.getByRole("link", { name: "Local A research", exact: true }).count(), 0);
    await page.goto(`${webBase}/content/${contentId}`); await page.getByLabel("Personal note", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Personal note", { exact: true }).inputValue(), "");
    const rows = await db.query("SELECT note FROM content_annotation WHERE user_id=$1 AND content_id=$2", [a.id, contentId]);
    assert.equal(rows.rows[0].note, "Final localhost A note");
    const saved = await db.query("SELECT query FROM content_saved_query WHERE user_id=$1", [a.id]);
    assert.equal(saved.rows[0].query.author, "workspace_writer");
    assert.equal(externalRequests, 0); assert.deepEqual(pageErrors, []);
    const result = { scope: "real_loopback_browser_api_worker_postgres_synthetic_content", database, accountIsolation: true, savedQueryReopened: true, annotationPersisted: true, conflictDraftPreserved: true, filteredExport: true, viewport390: true, requests, externalRequests, pageErrors, realSourceRequests: 0 };
    await writeFile(path.join(folder, "phase5a-real-content-local.json"), JSON.stringify(result, null, 2));
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
