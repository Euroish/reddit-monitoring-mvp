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
import { ResearchExportService } from "../src/application/services/research-export.service";
import { PostgresResearchExportRepository } from "../src/storage/repositories/postgres/postgres-research-export.repository";
import type { ResearchExportPageResponse } from "../packages/contracts/src/research-export";
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
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12), database = `source_validation_research_ui_${suffix}`;
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.href }); await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 3 });
  const folder = path.resolve("output/validation"), screenshots = path.resolve("output/playwright");
  await mkdir(folder, { recursive: true }); await mkdir(screenshots, { recursive: true });
  const log = await open(path.join(folder, `research-local-vite-${suffix}.log`), "a");
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
      const job = await sourceContent.enqueue(source.id, { from: new Date(Date.now()-52*3600000).toISOString(), to: now(), pageSize: 100, maxPages: 3 });
      const deadline = Date.now() + 15000;
      while ((await sourceContent.getJob(job.id)).status !== "succeeded" && Date.now() < deadline) {
        await sourceContent.workOnce(); await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal((await sourceContent.getJob(job.id)).exhausted, true, "Synthetic paged job must exhaust its window");
    }
    const seeded = await sourceRepository.listContent({ platform: "reddit", author: "workspace_writer", limit: 100 });
    assert.equal(seeded.items.length, 100); const sample = seeded.items[0]!;
    const webPort = await availablePort(), webBase = `http://127.0.0.1:${webPort}`;
    server = createApiServer({ repositories: repos, sourceContent, contentPersonal: new ContentPersonalService(new PostgresContentPersonalRepository(db), sourceContent), researchExports: new ResearchExportService(new PostgresResearchExportRepository(db), sourceContent), createConnector: () => new RedditMockConnector(),
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
    const queryPath='/content?platform=reddit&author=workspace_writer&sourceGroup=Local+research&sort=published_asc&query=workspace_writer+information&searchMode=terms&searchScope=title&exclusions=excluded_token';
    await page.goto(`${webBase}${queryPath}`);
    await page.getByRole("heading", { name: sample.title!, exact: true }).first().waitFor();
    assert.equal(await page.getByLabel("Search mode", { exact: true }).inputValue(), "terms");
    assert.equal(await page.getByLabel("Search fields", { exact: true }).inputValue(), "title");
    await page.getByText("Freeze matching content for research", { exact: true }).click();
    await page.getByLabel("Research export name", { exact: true }).fill("Local A frozen research");
    await page.getByRole("button", { name: "Create frozen export", exact: true }).click();
    await page.getByRole("link", { name: "Open frozen export", exact: true }).click();
    await page.getByRole("heading", { name: "Local A frozen research", exact: true }).waitFor();
    const exportId=new URL(page.url()).searchParams.get('research')!;
    const readDownload=async (label:string) => { const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:label,exact:true}).click()]);const file=await download.path();assert.ok(file);return readFile(file,'utf8'); };
    const first=JSON.parse(await readDownload('Download this frozen page as JSON')) as ResearchExportPageResponse;
    assert.equal(first.total,104);assert.equal(first.items.length,100);assert.ok(first.nextCursor);
    assert.equal(first.manifest.coverage.indexed,104);assert.equal(first.manifest.query.searchMode,'terms');
    const original=first.items[0]!;
    await db.query("UPDATE content SET title='LIVE_ONLY_AFTER_FREEZE',body_text='Changed live body after frozen research' WHERE id=$1",[original.id]);
    const csv=await readDownload('Download this frozen page as CSV');
    assert.ok(csv.includes('research_export_manifest'));assert.ok(csv.includes('payload_json'));assert.ok(csv.includes(original.title!));assert.equal(csv.includes('LIVE_ONLY_AFTER_FREEZE'),false);
    await page.getByRole('button',{name:'Next frozen page',exact:true}).click();
    await page.getByText('Records on this page 4', { exact:false }).waitFor();
    const next=JSON.parse(await readDownload('Download this frozen page as JSON')) as ResearchExportPageResponse;
    assert.equal(next.total,104);assert.equal(next.items.length,4);assert.equal(next.nextCursor,null);
    assert.equal(new Set([...first.items,...next.items].map(item=>item.id)).size,104);
    const manifest=JSON.parse(await readDownload('Download manifest JSON'));assert.equal(manifest.total,104);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(screenshots,'phase5b-real-research-local-mobile.png'),fullPage:true});
    await login(b.email,password);await page.goto(`${webBase}/saved`);await page.getByText('No research exports for this account.',{exact:true}).waitFor();
    const denied=await context.request.get(`${webBase}/api/v1/research-exports/${exportId}`);assert.equal(denied.status(),404);
    assert.equal(await page.getByRole('link',{name:'Local A frozen research',exact:true}).count(),0);
    await login(a.email,password);await page.goto(`${webBase}/saved?research=${exportId}`);await page.getByRole('heading',{name:'Local A frozen research',exact:true}).waitFor();
    const reloaded=JSON.parse(await readDownload('Download this frozen page as JSON')) as ResearchExportPageResponse;
    assert.equal(reloaded.items[0].title,original.title);assert.equal(reloaded.items[0].text,original.text);
    await Promise.all([page.waitForEvent('dialog').then(dialog=>dialog.accept()),page.getByRole('button',{name:'Delete frozen export',exact:true}).click()]);
    await page.getByText('No research exports for this account.',{exact:true}).waitFor();
    assert.equal(Number((await db.query('SELECT count(*) FROM research_export_member WHERE export_id=$1',[exportId])).rows[0].count),0);
    assert.equal(externalRequests, 0); assert.deepEqual(pageErrors, []);
    const result = { scope: "real_loopback_browser_api_worker_postgres_frozen_research", database, accountIsolation: true, searchModesApplied: true, frozenTotal104: true, pagesNoDuplicates: true, liveUpdateImmutability: true, jsonCsvAndManifest: true, ownedDeleteCascade: true, viewport390: true, requests, externalRequests, pageErrors, realSourceRequests: 0 };
    await writeFile(path.join(folder, "phase5b-real-research-local.json"), JSON.stringify(result, null, 2));
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
