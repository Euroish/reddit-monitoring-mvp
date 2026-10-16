import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import { createServer as createProbeServer } from "node:net";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { AuthUserView, CollectionSource, PublicContent, SourceCapability, SourceCollectionJob } from "../packages/contracts/src/http";

// Independent loopback Web with intercepted synthetic API; no API server, database or provider is started.
const output = path.resolve("output/validation/closeout-v0.9.1");
const now = "2026-10-13T04:00:00.000Z";
const user: AuthUserView = { id: "10000000-0000-4000-8000-000000000001", email: "closeout@example.test", displayName: "Synthetic closeout owner", role: "owner", status: "active" };
const sourceId = "20000000-0000-4000-8000-000000000001";
const failedJobId = "30000000-0000-4000-8000-000000000001";
const partialJobId = "30000000-0000-4000-8000-000000000002";
const source: CollectionSource = {
  id: sourceId, platform: "reddit", provider: "demo_reddit", label: "Synthetic blocked source", target: { type: "community", community: "closeout_fixture" }, contentKind: "post",
  createdAt: now, updatedAt: now, lastSuccessAt: now, latestPublishedAt: now, coverage: "partial", state: "active", group: null, revision: 1,
  schedule: { enabled: true, cadenceSeconds: 3600, overlapSeconds: 300, initialLookbackHours: 24, maxCatchupHours: 6, pageSize: 25, maxPages: 5, recheckLookbackHours: 12, recheckCadenceSeconds: 21600 },
  refresh: { enabled: true, afterHours: 36, minIntervalHours: 12, maxAttempts: 3, batchSize: 25 }, nextDueAt: now, incrementalTo: null, nextRecheckAt: now, automaticCollectionBlocked: true,
};
const capability: SourceCapability = { platform: "reddit", provider: "demo_reddit", enabled: true, contentKinds: ["post", "comment"], targetTypes: ["community", "account", "post"], keywordSearch: "scoped", observationModel: "archive", refreshByIds: true, metrics: [], limitations: ["Synthetic local fixture; no real source coverage is claimed."] };
const failedJob: SourceCollectionJob = { id: failedJobId, sourceId, status: "failed", from: "2026-10-12T04:00:00.000Z", to: now, pageSize: 25, maxPages: 5, pagesCommitted: 0, recordsProcessed: 0, checkpoint: null, coverage: "unknown", exhausted: false, attempts: 1, error: "Synthetic permanent authorization/configuration failure", nextRunAt: now, createdAt: now, finishedAt: now, purpose: "scheduled", parentJobId: null, refreshIds: [], recordsInserted: 0, recordsUpdated: 0, requestCount: 1, requestDurationMs: 100, failureKind: "permanent" };
const partialJob: SourceCollectionJob = { ...failedJob, id: partialJobId, status: "succeeded", error: null, failureKind: null, coverage: "partial", pagesCommitted: 5, recordsProcessed: 125, exhausted: false, checkpoint: { offset: 125 }, purpose: "manual" };
const contents: PublicContent[] = [null, "", "Synthetic nonempty stored body."].map((text, index) => ({
  id: `40000000-0000-4000-8000-00000000000${index + 1}`, platform: "reddit", kind: "post", externalId: `closeout_${index + 1}`, title: ["Unknown body fixture", "Known empty body fixture", "Nonempty body fixture"][index]!, text,
  url: null, language: "en", author: null, publishedAt: now, firstFetchedAt: now, lastFetchedAt: now, availability: "available", references: [], media: [], platformDetails: { platform: "reddit", community: "closeout_fixture", flair: null, nsfw: false }, observations: [],
}));
const tableNames = ["app_user", "app_session", "app_audit_log", "content", "collection_source", "content_discovery", "content_observation", "source_collection_job", "source_provider_budget", "source_provider_usage", "content_saved_query", "content_annotation", "research_export", "research_export_member", "public_content_search_document", "runtime_setting"];

async function availablePort() {
  const probe = createProbeServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const address = probe.address(); assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function ready(base: string, web: ChildProcess) {
  const deadline = Date.now() + 45000;
  let diagnostic = "No startup response";
  while (Date.now() < deadline) {
    if (web.exitCode !== null) throw new Error(`Closeout Vite exited during startup (${web.exitCode})`);
    try {
      const response = await fetch(`${base}/`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
      diagnostic = `HTTP ${response.status} ${response.statusText}`;
    } catch (error) { diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : "Loopback startup failed"; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Independent closeout Vite did not become ready in 45 seconds (${diagnostic})`);
}
async function stopOwnWeb(web: ChildProcess) {
  if (web.exitCode !== null) return;
  const exited = new Promise<void>(resolve => web.once("exit", () => resolve()));
  web.kill();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([exited, new Promise<void>(resolve => { timer = setTimeout(() => { if (web.exitCode === null) web.kill("SIGKILL"); resolve(); }, 3000); })]);
  if (timer) clearTimeout(timer);
}

async function main() {
  await mkdir(output, { recursive: true });
  const log = await open(path.join(output, "content-closeout-vite.log"), "w");
  const webPort = await availablePort(), base = `http://127.0.0.1:${webPort}`;
  let web: ChildProcess | undefined, browser: Browser | undefined, page: Page | undefined;
  const checks: string[] = [], requests: { path: string; method: string }[] = [], externalRequests: string[] = [], pageErrors: string[] = [], unhandledApi: string[] = [], screenshots: string[] = [];
  let sourceReads = 0, retryRequests = 0, releaseRetryCompletion = false;
  const capture = async (name: string) => {
    const file = path.join(output, name);
    // Reset the viewport before a full-page capture so sticky navigation stays at the document top.
    await page!.evaluate(() => new Promise<void>(resolve => { window.scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));
    await page!.screenshot({ path: file, fullPage: true }); screenshots.push(file);
  };
  try {
    web = spawn(process.execPath, ["apps/web/node_modules/vite/bin/vite.js", path.resolve("apps/web"), "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", log.fd, log.fd], env: { ...process.env, LOCAL_ENV_FILE: "none", NODE_ENV: "test", VITE_API_PROXY_TARGET: "http://127.0.0.1:1" },
    });
    web.once("error", error => pageErrors.push(`Independent Vite spawn: ${error.message}`));
    await ready(base, web);
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "Asia/Shanghai", serviceWorkers: "block" });
    await context.addInitScript(({ userId, jobId }) => {
      if (!localStorage.getItem("reddit-monitoring.language")) localStorage.setItem("reddit-monitoring.language", "en");
      if (!sessionStorage.getItem(`source-content-job:${userId}`)) sessionStorage.setItem(`source-content-job:${userId}`, jobId);
    }, { userId: user.id, jobId: failedJobId });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { externalRequests.push(url.href); await route.abort(); return; }
      if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
      const endpoint = url.pathname.slice(4), method = route.request().method();
      requests.push({ path: endpoint, method });
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: status < 400, requestId: "synthetic-closeout", ...body as object }) });
      if (endpoint === "/auth/me") return json({ user });
      if (endpoint === "/v1/sources" && method === "GET") { sourceReads++; return json({ sources: [source], capabilities: [capability] }); }
      if (endpoint === "/v1/source-jobs" && method === "GET") return json({ jobs: [failedJob, partialJob] });
      if (endpoint === `/v1/source-jobs/${failedJobId}/retry` && method === "POST") {
        retryRequests++; source.automaticCollectionBlocked = false;
        releaseRetryCompletion = false;
        Object.assign(failedJob, { status: "queued", error: null, failureKind: null, finishedAt: null });
        return json({ job: failedJob }, 202);
      }
      if (endpoint === `/v1/source-jobs/${failedJobId}`) {
        if (failedJob.status === "queued" && releaseRetryCompletion) Object.assign(failedJob, { status: "succeeded", coverage: "partial", pagesCommitted: 1, recordsProcessed: 25, finishedAt: now });
        return json({ job: failedJob });
      }
      if (endpoint === `/v1/source-jobs/${partialJobId}`) return json({ job: partialJob });
      if (endpoint === "/v1/source-ops") return json({ ops: { checkedAt: now, workers: [], queue: [], oldestQueuedAt: null, sources: [], providers: [] } });
      if (endpoint === "/v1/content") return json({ items: contents, nextCursor: null, coverage: "stored_sample", queryScope: "collected_content", searchCoverage: { formatVersion: 1, candidateCount: 3, indexed: 3, unindexed: 0, textPresent: 2, textMissing: 1, state: "complete", textBasis: "stored_title_text" } });
      if (endpoint === "/v1/content/workbench") return json({ generatedAt: now, stats: { total: 3, byKind: [{ kind: "post", count: 3 }], daily: [{ day: "2026-10-13", count: 3 }], scope: "collected_content", unknownPublishedAtCount: 0 }, byPlatform: [{ platform: "reddit", count: 3 }], byProvider: [{ provider: "demo_reddit", count: 3 }], sources: [source], capabilities: [capability], scope: "collected_content", providerCountsMayOverlap: true, metricComparison: "platform_units_only" });
      const annotation = /^\/v1\/content\/([^/]+)\/annotation$/u.exec(endpoint);
      if (annotation && method === "GET") return json({ annotation: null });
      const detail = /^\/v1\/content\/([^/]+)$/u.exec(endpoint);
      if (detail && method === "GET") { const content = contents.find(item => item.id === detail[1]); if (content) return json({ content, sources: [], references: [], children: [], relatedLimit: 20, relatedTruncated: false, scope: "stored_content" }); }
      if (endpoint === "/v1/ops/storage" && method === "GET") return json({ service: "reddit-monitoring-mvp", capturedAtIso: now, databaseSizeBytes: 1000000, tables: tableNames.map((tableName, index) => ({ tableName, rowEstimate: index === 0 ? 0 : 100 + index, tableBytes: 8192, indexBytes: 4096, totalBytes: 12288 })) });
      unhandledApi.push(`${method} ${endpoint}`);
      return json({ error: `Unexpected synthetic endpoint ${endpoint}`, errorCode: "synthetic_unhandled" }, 404);
    });
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on("pageerror", error => pageErrors.push(error.message));

    for (const [index, expected] of ["Text was not provided; missing text is not an empty source post.", "The stored body text is empty.", "Synthetic nonempty stored body."].entries()) {
      await page.goto(`${base}/content/${contents[index]!.id}`);
      await page.getByRole("heading", { name: contents[index]!.title!, exact: true }).waitFor();
      await page.getByText(expected, { exact: true }).waitFor();
      if (index !== 0) assert.equal(await page.getByText("Text was not provided; missing text is not an empty source post.", { exact: true }).count(), 0);
      checks.push(`Stored body ${index === 0 ? "null" : index === 1 ? "empty string" : "nonempty"} has the correct separate state`);
      if (index === 1) await capture("content-known-empty-desktop.png");
    }
    await page.goto(`${base}/ops/storage`);
    await page.getByRole("columnheader", { name: "Estimated rows", exact: true }).waitFor();
    for (const name of tableNames) await page.getByRole("cell", { name, exact: true }).waitFor();
    await page.getByText(/Row counts are PostgreSQL statistics estimates/u).waitFor();
    assert.equal(await page.locator("tbody tr").count(), tableNames.length);
    checks.push("Storage UI renders returned public tables including research, search, personal and account tables and labels estimated rows");
    await capture("storage-public-inventory-desktop.png");

    await page.goto(`${base}/content`);
    await page.getByRole("heading", { name: "Collected content", exact: true }).waitFor();
    await page.locator(".content-job").getByText(failedJob.error!, { exact: true }).waitFor();
    await page.getByText(/View and manage sources/u).click();
    const sourceRow = page.locator(".content-source-list > li").first();
    const collect = sourceRow.getByRole("button", { name: "Collect", exact: true });
    assert.equal(await collect.isDisabled(), true);
    await sourceRow.getByText(/Automatic collection.*blocked/iu).waitFor();
    await page.locator(".content-job").getByText(/permanent/iu).waitFor();
    await sourceRow.getByText("Source settings", { exact: true }).click();
    await sourceRow.getByLabel("Maximum automatic refresh rounds", { exact: true }).waitFor();
    await sourceRow.getByText(/Each round allows at most three requests/iu).waitFor();
    checks.push("Permanent failure fences Collect and presents source/settings/manual Retry guidance");
    await page.getByText("Collection task history", { exact: true }).click();
    const failedRow = page.locator("details > ul > li").filter({ hasText: failedJobId });
    await failedRow.getByRole("note").getByText(/Correct the provider configuration, then retry this failed task/iu).waitFor();
    await capture("source-permanent-block-desktop.png");
    const readsBeforeRetry = sourceReads;
    await failedRow.getByRole("button", { name: "Retry task", exact: true }).click();
    await sourceRow.getByRole("alert").waitFor({ state: "detached" });
    assert.ok(sourceReads > readsBeforeRetry, "Task Retry must refresh source cache while the new job is still queued, before any terminal-state invalidation");
    assert.equal(failedJob.status, "queued");
    checks.push("Task-list Retry refreshes source cache and releases the permanent fence while the retried task remains queued");
    releaseRetryCompletion = true;
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>(".content-source-list button")].some(button => button.textContent === "Collect" && !button.disabled));
    assert.equal(retryRequests, 1);
    assert.equal(await collect.isDisabled(), false);

    // Repeat through the current-task Retry caller; a terminal result would mask a missing cache invalidation.
    source.automaticCollectionBlocked = true; releaseRetryCompletion = false;
    Object.assign(failedJob, { status: "failed", failureKind: "permanent", error: "Synthetic permanent authorization/configuration failure", coverage: "unknown", pagesCommitted: 0, recordsProcessed: 0, finishedAt: now });
    await page.reload();
    await page.locator(".content-job").getByText(failedJob.error!, { exact: true }).waitFor();
    await page.getByText(/View and manage sources/u).click();
    await sourceRow.getByRole("alert").waitFor();
    const readsBeforeCurrentRetry = sourceReads;
    await page.locator(".content-job").getByRole("button", { name: "Retry collection", exact: true }).click();
    await sourceRow.getByRole("alert").waitFor({ state: "detached" });
    assert.ok(sourceReads > readsBeforeCurrentRetry, "Current-task Retry must also refresh source cache before the queued task finishes");
    assert.equal(failedJob.status, "queued");
    checks.push("Current-task Retry also releases the source cache fence before completion");
    releaseRetryCompletion = true;
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>(".content-source-list button")].some(button => button.textContent === "Collect" && !button.disabled));
    assert.equal(retryRequests, 2);
    await page.getByText("Collection task history", { exact: true }).click();
    const partialRow = page.locator("details > ul > li").filter({ hasText: partialJobId });
    await partialRow.getByRole("button", { name: "Inspect task", exact: true }).click();
    const current = page.locator(".content-job");
    await current.getByText("Partial coverage", { exact: false }).waitFor();
    assert.match(await current.innerText(), /succeeded/iu);
    assert.doesNotMatch(await current.innerText(), /(?:coverage (?:is )?complete|complete coverage achieved|full platform coverage)/iu);
    await partialRow.getByText(/Partial coverage/iu).waitFor();
    checks.push("A succeeded partial task retains its explicit partial scope in both the current task and history");
    await capture("source-partial-success-desktop.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("heading", { name: "来源内容查询", exact: true }).waitFor();
    await current.getByText("部分覆盖", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await capture("source-partial-success-mobile-zh.png");
    await page.goto(`${base}/content/${contents[1]!.id}`);
    await page.getByText("已存正文为空。", { exact: true }).waitFor();
    await capture("content-known-empty-mobile-zh.png");
    await page.goto(`${base}/ops/storage`);
    await page.getByRole("columnheader", { name: "估计行数", exact: true }).waitFor();
    await page.getByRole("cell", { name: "research_export_member", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
    await capture("storage-public-inventory-mobile-zh.png");
    checks.push("Chinese 390px content/partial task/storage states render and content/storage pages have no horizontal page overflow");
    assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []); assert.deepEqual(unhandledApi, []);
    const report = { scope: "real Chromium synthetic API with independent temporary loopback Vite", base, checks, requests, sourceReads, retryRequests, screenshots, externalRequests, pageErrors, unhandledApi, realProviderRequests: 0, databaseWrites: 0 };
    await writeFile(path.join(output, "content-closeout-browser.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, requests: requests.length, screenshots: screenshots.length }));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, "content-closeout-failure.png"), fullPage: true }).catch(() => {});
    await writeFile(path.join(output, "content-closeout-browser-failure.json"), `${JSON.stringify({ checks, requests, externalRequests, pageErrors, unhandledApi, error: error instanceof Error ? error.message : String(error), realProviderRequests: 0, databaseWrites: 0 }, null, 2)}\n`);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (web) await stopOwnWeb(web);
    await log.close();
  }
}

if (require.main === module) void main().catch(error => { console.error(error instanceof Error ? error.message : "Synthetic closeout browser failed"); process.exitCode = 1; });
