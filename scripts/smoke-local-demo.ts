import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { CollectionSourceResponse, SourceJobResponse, ContentListResponse, ContentExportResponse, ContentWorkbenchResponse, SourceJobsResponse, SourceListResponse } from "../packages/contracts/src/http";

async function main() {
  const root = process.cwd(), folder = path.join(root, "output", "local-dev");
  const config = JSON.parse(await readFile(path.join(folder, "config.json"), "utf8"));
  const account = JSON.parse(await readFile(path.join(folder, "account.json"), "utf8"));
  const base = `http://127.0.0.1:${config.webPort}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const external: string[] = [], errors: string[] = [], evidence: string[] = [];
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) { external.push(url.origin); await route.abort(); }
    else await route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("reddit-monitoring.language", "en"));
  const request = async <T>(endpoint: string, method = "GET", body?: unknown): Promise<T> => {
    const response = await context.request.fetch(`${base}/api${endpoint}`, { method, ...(body === undefined ? {} : { data: body }) });
    assert.ok(response.ok(), `${method} ${endpoint} returned ${response.status()}: ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  const searchContent = async (expected: { sourceId?: string; platform?: string }) => {
    const matches = (url: URL) => (url.searchParams.get("sourceId") ?? "") === (expected.sourceId ?? "")
      && (url.searchParams.get("platform") ?? "") === (expected.platform ?? "");
    // Search also invalidates the previous query. Only the newly applied filters prove this transition.
    const listReady = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/content" && matches(url) && response.request().method() === "GET";
    });
    const statsReady = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/content/workbench" && matches(url) && response.request().method() === "GET";
    });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/content" && matches(url));
    const [list, stats] = await Promise.all([listReady, statsReady]);
    assert.equal(list.status(), 200, "Applied content filters must succeed");
    assert.equal(stats.status(), 200, "Applied workbench filters must succeed");
    return await list.json() as ContentListResponse;
  };
  const waitJob = async (id: string) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const result = await request<SourceJobResponse>(`/v1/source-jobs/${id}`);
      if (result.job.status === "succeeded") return result.job;
      assert.notEqual(result.job.status, "failed", result.job.error ?? "job failed");
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    throw new Error("Local demo worker did not finish a bounded job");
  };
  try {
    await page.goto(`${base}/content`);
    await page.locator("#login-email").fill(account.email);
    await page.locator("#login-password").fill(account.password);
    const [login] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST"),
      page.locator('button[type="submit"]').click(),
    ]);
    assert.equal(login.status(), 200, "Managed account login must succeed before content workflow acceptance");
    await page.waitForURL(url => url.pathname === "/content");
    await page.getByRole("heading", { name: "Collected content" }).waitFor();
    const sources = await request<SourceListResponse>("/v1/sources");
    assert.ok(sources.capabilities.some(row => row.provider === "demo_reddit" && row.enabled));
    assert.ok(sources.capabilities.every(row => row.provider.startsWith("demo_") || !row.enabled));
    evidence.push("Real local UI login/session; explicit synthetic provider capabilities");
    const demoX = sources.sources.find(row => row.provider === "demo_x");
    if (sources.capabilities.some(row => row.provider === "demo_x" && row.enabled)) {
      assert.ok(demoX, "Setup must seed the X demo after the platform migration");
      const x = await request<ContentListResponse>("/v1/content?platform=x");
      assert.ok(x.items.length > 0 && x.items.every(row => row.platform === "x" && row.observations.every(obs => obs.provider === "demo_x")));
    }
    const created = await request<CollectionSourceResponse>("/v1/sources", "POST", { platform: "reddit", provider: "demo_reddit", label: "[SYNTHETIC] E2E", contentKind: "post", target: { type: "community", community: `demo_e2e_${Date.now()}`, query: "本地端到端" } });
    const id = created.source.id, to = new Date().toISOString(), from = new Date(Date.now() - 7200000).toISOString();
    const scope = `sourceId=${id}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const first = await request<SourceJobResponse>(`/v1/sources/${id}/collect`, "POST", { from, to, pageSize: 2, maxPages: 1 });
    const finished = await waitJob(first.job.id);
    assert.ok(finished.checkpoint && finished.recordsInserted === 2);
    const next = await request<SourceJobResponse>(`/v1/source-jobs/${first.job.id}/continue`, "POST", {});
    await waitJob(next.job.id);
    const content = await request<ContentListResponse>(`/v1/content?${scope}`);
    assert.equal(content.items.length, 4);
    assert.ok(content.items.every(row => row.text?.includes("SYNTHETIC")));
    evidence.push("Source create -> queue -> real local worker -> PostgreSQL -> continuation -> saved query");
    await request(`/v1/sources/${id}/pause`, "POST", {});
    const blocked = await context.request.post(`${base}/api/v1/sources/${id}/collect`, { data: { from, to } });
    assert.equal(blocked.status(), 409);
    await request(`/v1/sources/${id}/resume`, "POST", {});
    await request(`/v1/sources/${id}`, "PATCH", { group: "local-e2e", schedule: { enabled: true, cadenceSeconds: 60, initialLookbackHours: 1, maxCatchupHours: 1, pageSize: 10, maxPages: 1 } });
    const deadline = Date.now() + 20000; let scheduled = false;
    while (Date.now() < deadline) {
      const jobs = await request<SourceJobsResponse>(`/v1/source-jobs?sourceId=${id}`);
      const job = jobs.jobs.find(row => row.purpose === "scheduled" && row.status === "succeeded");
      if (job) { scheduled = true; break; }
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    assert.ok(scheduled, "Managed worker must execute a real local scheduled demo job");
    await request(`/v1/sources/${id}/archive`, "POST", {});
    const workbench = await request<ContentWorkbenchResponse>(`/v1/content/workbench?${scope}`);
    assert.equal(workbench.stats.total, 4);
    assert.deepEqual(workbench.byPlatform, [{ platform: "reddit", count: 4 }]);
    const part1 = await request<ContentExportResponse>(`/v1/content/export?${scope}&maxItems=2`);
    assert.equal(part1.totalMatching, 4); assert.equal(part1.exportedCount, 2); assert.ok(part1.truncated && part1.nextCursor);
    const part2 = await request<ContentExportResponse>(`/v1/content/export?${scope}&maxItems=2&cursor=${encodeURIComponent(part1.nextCursor!)}`);
    assert.equal(new Set([...part1.items, ...part2.items].map(row => row.id)).size, 4); assert.equal(part2.truncated, false);
    evidence.push("Pause/resume, persisted schedule, archive preserves content; exact workbench/export denominator");
    await page.reload();
    await page.locator("#content-source").selectOption(id);
    const selectedContent = await searchContent({ sourceId: id });
    assert.equal(selectedContent.items.length, 4);
    assert.ok(selectedContent.items.every(item => item.observations.some(obs => obs.sourceId === id)));
    await page.locator("article").filter({ hasText: "本地端到端" }).first().waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    if (demoX) {
      await page.locator("#content-source").selectOption("");
      await page.locator("#content-platform").selectOption("x");
      const xContent = await searchContent({ platform: "x" });
      assert.ok(xContent.items.length > 0 && xContent.items.every(item => item.platform === "x"
        && item.observations.some(obs => obs.provider === "demo_x")));
      await page.locator("article").filter({ hasText: "demo_x" }).first().waitFor();
      await page.getByText("Export matching saved content", { exact: true }).click();
      await page.getByLabel("Export limit per file (1–2000)").fill("2");
      const downloadReady = page.waitForEvent("download"); await page.getByRole("button", { name: "Download JSON", exact: true }).click();
      const download = await downloadReady, file = path.join(folder, "browser-x-export.json"); await download.saveAs(file);
      const exported = JSON.parse(await readFile(file, "utf8")) as ContentExportResponse;
      assert.equal(exported.exportedCount, 2); assert.ok(exported.truncated && exported.items.every(row => row.platform === "x"));
      const csvReady = page.waitForEvent("download"); await page.getByRole("button", { name: "Download CSV", exact: true }).click();
      const csvFile = path.join(folder, "browser-x-export.csv"); await (await csvReady).saveAs(csvFile);
      const csv = await readFile(csvFile, "utf8"); assert.ok(csv.includes("export_metadata") && csv.includes("demo_x"));
      evidence.push("X synthetic PostgreSQL samples -> platform UI filtering -> real authenticated JSON/CSV browser downloads");
    }
    const screenshots = path.join(root, "output", "playwright"); await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "local-demo-real-pipeline-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "390px must not overflow");
    await page.screenshot({ path: path.join(screenshots, "local-demo-real-pipeline-mobile.png"), fullPage: true });
    assert.equal(external.length, 0); assert.equal(errors.length, 0);
    const result = { checkedAt: new Date().toISOString(), base, mode: "real-local-ui-api-worker-postgres-with-synthetic-provider", realSourceRequests: 0, externalBrowserRequests: external, pageErrors: errors, evidence, sourceId: id };
    await writeFile(path.join(folder, "smoke-evidence.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: true, evidence, realSourceRequests: 0, output: "output/local-dev/smoke-evidence.json" }));
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
