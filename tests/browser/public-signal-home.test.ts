import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { commitContentBatch, prepareContentBatch } from "../../src/modules/content/sql";
import { transaction } from "../../src/storage/db";
import { batchItem } from "../helpers/content-batch-fixtures";
import { testDatabase } from "../helpers/database";

async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

async function launchVite(t: test.TestContext, address: string, port: number, origin: string) {
  const webRoot = path.resolve(process.cwd(), "apps/web");
  const viteBin = path.join(webRoot, "node_modules/vite/bin/vite.js");
  const viteArgs = [
    viteBin,
    ...(process.env.TEST_COMPILED === "true" ? ["preview"] : []),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ];
  const vite = spawn(process.execPath, viteArgs, {
    cwd: webRoot,
    env: { ...process.env, VITE_API_PROXY_TARGET: address },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    vite.stdout?.destroy();
    vite.stderr?.destroy();
    try {
      if (process.platform === "win32" && vite.pid) {
        execFileSync("taskkill", ["/T", "/F", "/PID", String(vite.pid)], { stdio: "ignore" });
      } else if (vite.pid) {
        process.kill(-vite.pid, "SIGTERM");
      } else {
        vite.kill("SIGTERM");
      }
    } catch {
      /* Process already exited. */
    }
  });
  const deadline = Date.now() + 25_000;
  let ready = false;
  while (Date.now() < deadline) {
    ready = await fetch(origin, { signal: AbortSignal.timeout(1000) })
      .then(async (response) => response.ok && (await response.text()).includes("SIFTLINE"))
      .catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Vite HTTP readiness timeout");
}

function resolveChromiumPath(): string | undefined {
  return (
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (existsSync(chromium.executablePath())
      ? undefined
      : [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ].find((p) => existsSync(p)))
  );
}

test("browser: editorial signal home (/), pagination, channels, reader, search, responsive & empty/private gates", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@localhost");

  const groups = [
    { key: "ai-firsthand", label: "Research Lab", tier: "T1", lang: "zh" },
    { key: "dev-infra", label: "Systems Weekly", tier: "T1", lang: "zh" },
    { key: "tech-media", label: "Hardware Signal", tier: "T1_5", lang: "en" },
    { key: "science", label: "Science Feed", tier: "T2", lang: "zh" },
  ] as const;

  const sources: Array<{ id: string; platform_id: string; key: string; lang: string }> = [];
  for (const g of groups) {
    const { rows } = await db.pool.query<{ id: string; platform_id: string }>(
      `INSERT INTO collection_source(
        id, platform_id, primary_provider, label, target, content_kind,
        delivery_mode, usage_domain, feed_lane, tier, source_group, locale, created_at, updated_at
      )
      SELECT gen_random_uuid(), id, 'feed', $1::text,
             jsonb_build_object('type', 'feed', 'url', 'https://example.org/rss/' || $3::text),
             'article', 'pull', 'feed', 'discussion', $2::text, $3::text, $4::text, now(), now()
      FROM source WHERE code = 'web'
      RETURNING id, platform_id`,
      [g.label, g.tier, g.key, g.lang],
    );
    sources.push({ ...rows[0], key: g.key, lang: g.lang });
  }

  const { rows: [socialSrc] } = await db.pool.query<{ id: string; platform_id: string }>(
    `INSERT INTO collection_source(
      id, platform_id, primary_provider, label, target, content_kind,
      delivery_mode, usage_domain, feed_lane, tier, locale, created_at, updated_at
    )
    SELECT gen_random_uuid(), id, 'kaix', 'Reddit Social Feed',
           jsonb_build_object('type', 'search', 'query', 'signal-home'),
           'post', 'pull', 'research', 'discussion', 'T2', 'zh', now(), now()
    FROM source WHERE code = 'reddit'
    RETURNING id, platform_id`,
  );

  // Seed 24 web stories + 2 reddit social posts so default Info tab and Social tab stay strictly separated
  const now = Date.now();
  await transaction(db.pool, async (client) => {
    for (let i = 0; i < 24; i++) {
      const src = sources[i % sources.length];
      const hoursAgo = i < 4 ? 1 + i * 2 : 10 + i * 3;
      const pubIso = new Date(now - hoursAgo * 3600_000).toISOString();
      const url = `https://example.org/signal-home-story-${i + 1}`;
      const item = batchItem(src.id, {
        externalId: url,
        platform: "web",
        kind: "article",
        title: `信号测试报道 ${i + 1}：跨源可追溯情报样本`,
        language: src.lang,
        text: `第 ${i + 1} 条测试报道正文，验证编辑式首页阅读抽屉与连续分页。`,
        url,
        publishedAt: pubIso,
        fetchedAt: pubIso,
        platformDetails: { platform: "web", publisher: "example.org", canonicalUrl: url, feedUrl: `https://example.org/rss/${src.key}` },
        observation: {
          sourceId: src.id, provider: "feed", sourceObservedAt: null, fetchedAt: pubIso,
          timeBasis: "provider_snapshot", maturity: "unknown", metrics: {}, evidenceKey: `signal-home-${i}`,
        },
      });
      await commitContentBatch(
        client,
        { id: src.id, platformId: src.platform_id, platform: "web", provider: "feed", contentKinds: ["article"] },
        prepareContentBatch([item]),
        pubIso,
      );
    }

    for (let i = 0; i < 2; i++) {
      const pubIso = new Date(now - (2 + i) * 3600_000).toISOString();
      const socialItem = batchItem(socialSrc.id, {
        externalId: `t3_sighomesocial${i}`,
        title: `社媒样本讨论 ${i + 1}：Reddit 社区真实反馈`,
        language: "zh",
        text: `第 ${i + 1} 条 Reddit 社媒帖子，应在社媒动态板块展示，不混入资讯信息流。`,
        url: `https://www.reddit.com/r/fixture/comments/sighomesocial${i}/`,
        publishedAt: pubIso,
        fetchedAt: pubIso,
      });
      socialItem.observation.fetchedAt = pubIso;
      await commitContentBatch(
        client,
        { id: socialSrc.id, platformId: socialSrc.platform_id, platform: "reddit", provider: "kaix", contentKinds: ["post"] },
        prepareContentBatch([socialItem]),
        pubIso,
      );
    }
  });

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const createApp: typeof buildApp =
    process.env.TEST_COMPILED === "true"
      ? require("../../dist/apps/api/src/app.js").buildApp
      : buildApp;
  const app = await createApp({
    pool: db.pool,
    sessionSecret: "synthetic-secret-".repeat(3),
    origin,
    secureCookies: false,
    publicRead: true,
    publicRegistration: false,
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  await launchVite(t, address, port, origin);

  const browser = await chromium.launch({
    executablePath: resolveChromiumPath(),
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors: string[] = [];
  const badStatus: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("response", (res) => {
    if (res.url().includes("/api/v1/") && [401, 404, 500].includes(res.status())) {
      badStatus.push(`${res.status()} ${res.url()}`);
    }
  });

  // HOME-01: Initial render, editorial bands, single feature band
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "重要变化，先一步发现。" }).waitFor();
  await page.getByRole("heading", { name: "焦点信号" }).waitFor();
  await page.getByRole("heading", { name: "48小时热度" }).waitFor();
  await page.getByRole("heading", { name: "今日精选" }).waitFor();
  await page.getByRole("heading", { name: "AI 产品动态" }).waitFor();
  const dailyBrief = page.getByRole("heading", { name: "08:00 每日简报", exact: true });
  await dailyBrief.waitFor();
  await page.getByRole("heading", { name: "更多精选" }).waitFor();
  assert.equal(await page.locator(".sh-feature-band").count(), 1);
  const socialStories = page.getByText(/社媒样本讨论 \d+：/);
  const webStories = page.getByText(/信号测试报道 \d+：/);
  await webStories.first().waitFor();
  assert.equal(await socialStories.count(), 0, "Info stream must exclude Reddit posts");
  assert.deepEqual(badStatus, []);

  // Domain separation: Social tab displays Reddit posts and excludes Web articles
  const domainBar = page.getByLabel("内容展示板块");
  await domainBar.getByRole("button", { name: /社媒动态/ }).click();
  await page.getByText(/社媒样本讨论 1：Reddit 社区真实反馈/).first().waitFor();
  assert.equal(await webStories.count(), 0, "Social feed must exclude Web articles");
  assert.equal(await dailyBrief.count(), 0, "The daily brief is Info-only");
  await domainBar.getByRole("button", { name: "资讯信息流" }).click();
  await webStories.first().waitFor();
  await dailyBrief.waitFor();
  assert.equal(await socialStories.count(), 0, "Switching back to Info must not retain Reddit posts");

  // HOME-03: Load more pagination + transient failure retry preserves existing items
  const initialRowCount = await page.locator(".sh-story-row").count();
  assert.ok(initialRowCount > 0, "Expected initial editorial story rows");
  let failOnce = true;
  await page.route("**/api/v1/content/stories*offset=*", async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary_error", message: "Simulated transient failure" }) });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "加载更多精选" }).click();
  await page.getByRole("button", { name: "重试加载" }).waitFor();
  assert.equal(await page.locator(".sh-story-row").count(), initialRowCount, "Existing rows must be preserved on error");
  await page.getByRole("button", { name: "重试加载" }).click();
  await page.getByText(/已浏览完当前 7 天已存样本窗口内的全部精选内容/).waitFor();
  const expandedRowCount = await page.locator(".sh-story-row").count();
  assert.ok(expandedRowCount > initialRowCount, `Expected more rows after Load More (${expandedRowCount} > ${initialRowCount})`);
  assert.equal(await page.locator(".sh-feature-band").count(), 1, "Feature band must appear only once after pagination");
  await page.unroute("**/api/v1/content/stories*offset=*");

  // HOME-02: Channel switch updates picks only; Focus Signal and Feature Band remain visible
  const channelBar = page.getByLabel("按频道浏览");
  await channelBar.getByRole("button", { name: /工程与基础/ }).click();
  await page.getByRole("heading", { name: "工程与基础" }).waitFor();
  await page.getByRole("heading", { name: "焦点信号" }).waitFor();
  await page.getByRole("heading", { name: "AI 产品动态" }).waitFor();
  await channelBar.getByRole("button", { name: "全部精选" }).click();
  await page.getByRole("heading", { name: "今日精选" }).waitFor();

  // HOME-04: ReaderDrawer opens from Featured Signal & closes on Escape
  await page.getByRole("button", { name: "阅读全文" }).click();
  const drawer = page.getByLabel("内容阅读详情");
  await drawer.waitFor();
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached" });
  assert.equal(new URL(page.url()).pathname, "/");

  // HOME-05: Search submits to /content with query & platform
  await page.getByLabel("检索公开内容").fill("信号测试");
  await page.getByLabel("按平台筛选").selectOption("web");
  await page.getByRole("button", { name: "立即检索" }).click();
  await page.waitForURL("**/content?*");
  const contentUrl = new URL(page.url());
  assert.equal(contentUrl.searchParams.get("query"), "信号测试");
  assert.equal(contentUrl.searchParams.get("platform"), "web");
  await page.getByText("信号测试报道 1：跨源可追溯情报样本", { exact: true }).waitFor();
  await page.goBack();
  await page.waitForURL(`${origin}/`);

  // HOME-12: Responsive viewports (no horizontal overflow) + English toggle
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false, `Horizontal overflow detected at ${vp.width}x${vp.height}`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("heading", { name: "Spot what matters, one step ahead." }).waitFor();
  assert.deepEqual(pageErrors, []);
});

test("browser: publicRead=false private mode preserves auth gate on /", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@localhost");

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const createApp: typeof buildApp =
    process.env.TEST_COMPILED === "true"
      ? require("../../dist/apps/api/src/app.js").buildApp
      : buildApp;
  const app = await createApp({
    pool: db.pool,
    sessionSecret: "synthetic-secret-".repeat(3),
    origin,
    secureCookies: false,
    publicRead: false,
    publicRegistration: false,
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  await launchVite(t, address, port, origin);

  const browser = await chromium.launch({
    executablePath: resolveChromiumPath(),
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByText(/私有部署模式/).waitFor();
  assert.equal(await page.locator(".sh-page").count(), 0);
});
