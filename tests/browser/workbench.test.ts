import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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
  let viteOutput = "";
  let viteError: Error | undefined;
  const capture = (chunk: Buffer) => {
    viteOutput = (viteOutput + chunk.toString()).slice(-8000);
  };
  vite.stdout.on("data", capture);
  vite.stderr.on("data", capture);
  vite.once("error", (error) => { viteError = error; });
  const deadline = Date.now() + 25_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (viteError) throw viteError;
    if (vite.exitCode !== null || vite.signalCode !== null) {
      throw Error(`Vite exited before readiness: ${vite.exitCode ?? vite.signalCode}\n${viteOutput}`);
    }
    ready = await fetch(origin, { signal: AbortSignal.timeout(1000) })
      .then(async (response) => response.ok && (await response.text()).includes("SIFTLINE"))
      .catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Vite HTTP readiness timeout\n${viteOutput}`);
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

test("browser: open-access stories, reader drawer, /product, anonymous content/facets, auth gate, workbench & responsive layouts", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@localhost");

  // Seed multi-source story (T1 / T1_5 / T2) so anonymous visitors immediately see live stories on /
  const { rows: storySources } = await db.pool.query<{ id: string; platform_id: string }>(`
    INSERT INTO collection_source(
      id, platform_id, primary_provider, label, target, content_kind,
      delivery_mode, tier, source_group, locale, created_at, updated_at
    )
    SELECT gen_random_uuid(), id, 'kaix', label,
           jsonb_build_object('type', 'search', 'query', label),
           'post', 'pull', tier, 'ai-firsthand', 'zh', now(), now()
    FROM source CROSS JOIN (
      VALUES ('研发团队', 'T1'), ('开发者社区', 'T1_5'), ('行业媒体', 'T2')
    ) fixture(label, tier)
    WHERE code = 'reddit'
    RETURNING id, platform_id
  `);
  const fetchedAt = new Date(Date.now() - 60_000).toISOString();
  const storyTitle = "研发团队发布多语言检索工具";
  await transaction(db.pool, async (client) => {
    for (const [index, source] of storySources.entries()) {
      const story = batchItem(source.id, {
        externalId: `t3_uistory${index}`,
        title: storyTitle,
        language: "zh",
        text: "新版工具支持中文短词检索，并公开了用于复现结果的评估样本。",
        url: "https://example.com/multilingual-search",
        publishedAt: new Date(Date.now() - [28, 9, 2][index] * 3600_000).toISOString(),
        fetchedAt,
      });
      story.observation.fetchedAt = fetchedAt;
      await commitContentBatch(
        client,
        {
          id: source.id,
          platformId: source.platform_id,
          platform: "reddit",
          provider: "kaix",
          contentKinds: ["post"],
        },
        prepareContentBatch([story]),
        fetchedAt,
      );
    }
  });

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const createApp: typeof buildApp = process.env.TEST_COMPILED === "true"
    ? require("../../dist/apps/api/src/app.js").buildApp
    : buildApp;
  const app = await createApp({
    pool: db.pool,
    sessionSecret: "synthetic-secret-".repeat(3),
    origin,
    secureCookies: false,
    publicRead: true,
    publicRegistration: true,
  });
  const serverErrors: string[] = [];
  app.addHook("onError", async (_request, _reply, error) => {
    serverErrors.push(error.message);
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
  const errors: string[] = [];
  const scripts: string[] = [];
  const guestUnauthorized: string[] = [];
  let isAuthed = false;
  page.on("request", (req) => {
    if (req.resourceType() === "script") scripts.push(req.url());
  });
  page.on("response", (res) => {
    if (!isAuthed && res.status() === 401 && res.url().includes("/api/v1/")) {
      guestUnauthorized.push(res.url());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  // 1. Public Info Home on / (public nav, zero ECharts, zero workbench chunks, zero 401s, live stories)
  await page.goto(origin);
  assert.equal(await page.title(), "SIFTLINE · 信号研究");
  const publicNav = page.getByLabel("公开导航", { exact: true });
  await publicNav.waitFor();
  assert.deepEqual(
    await publicNav.getByRole("button").allInnerTexts(),
    ["信息流", "研究分析", "产品介绍", "AI 资讯", "文档"],
  );
  const initialCard = page.getByRole("article").filter({ hasText: storyTitle }).first();
  await initialCard.waitFor();
  assert.ok(
    scripts.every((url) => !/echarts|charts-|EChartCanvas|WorkbenchShell|ProjectsPage|SourcesPage|Homepage/.test(url)),
    `Unexpected heavy script on /: ${scripts.join(", ")}`,
  );
  assert.deepEqual(guestUnauthorized, []);
  await initialCard.getByRole("img", { name: /来源分布.*T1 1.*T1_5 1.*T2 1/ }).waitFor();
  await initialCard.getByRole("img", { name: /已采样热度/ }).waitFor();

  // 2. Anonymous ReaderDrawer on / + bookmark triggers login modal (Escape closes both)
  await initialCard.getByRole("button", { name: storyTitle }).click();
  const readerDrawer = page.getByLabel("内容阅读详情");
  await readerDrawer.getByText("新版工具支持中文短词检索，并公开了用于复现结果的评估样本。").waitFor();
  await readerDrawer.getByRole("button", { name: /登录后收藏/ }).click();
  const authDialog = page.getByRole("dialog", { name: /SIFTLINE/ });
  await authDialog.waitFor();
  await authDialog.getByRole("button", { name: "注册账号" }).click();
  assert.equal(await authDialog.getByText("Invite only").count(), 0);
  await page.keyboard.press("Escape");
  await authDialog.waitFor({ state: "detached" });
  if (await readerDrawer.isVisible()) {
    await page.keyboard.press("Escape");
  }

  // 2b. Channel filter & search box on / -> anonymous /content?query=...
  await page.getByLabel("按频道浏览").getByRole("button", { name: /AI 一手与研发/ }).click();
  await initialCard.waitFor();
  await page.getByLabel("检索公开内容").fill("多语言");
  await page.getByRole("button", { name: "立即检索" }).click();
  assert.equal(new URL(page.url()).pathname, "/content");
  assert.equal(new URL(page.url()).searchParams.get("query"), "多语言");
  await page.getByText(storyTitle).first().waitFor();

  await page.goto(origin);
  await publicNav.getByRole("button", { name: "研究分析" }).click();
  await page.waitForURL("**/content");
  await page.getByText(storyTitle).first().waitFor();

  // 3. Public Site pages (/product no duplicate nav, /docs real DB docs center, /ai transition, /guide preserved, 404)
  await page.goto(`${origin}/product`);
  const productNav = page.getByLabel("公开导航", { exact: true });
  await productNav.waitFor();
  assert.equal(await page.locator("header").count(), 1, "Expected single PublicSiteShell header on /product");
  await page.getByRole("heading", { name: "社媒研究分析", exact: true }).waitFor();
  await page.getByRole("heading", { name: "高质量信息流", exact: true }).waitFor();
  await productNav.getByRole("button", { name: "文档" }).click();
  await page.getByText("功能说明").first().waitFor();
  await productNav.getByRole("button", { name: "AI 资讯" }).click();
  await page.getByRole("heading", { name: "AI 资讯即将上线" }).waitFor();
  await page.goto(`${origin}/guide`);
  await page.getByText(/SIFTLINE/).first().waitFor();
  await page.goto(`${origin}/non-existent-route-check`);
  await page.getByText(/404/).waitFor();
  await page.getByRole("button", { name: "返回公开首页" }).click();
  assert.equal(new URL(page.url()).pathname, "/");

  // 4. Legacy URL compatibility (/?view=hot & /?view=digest -> /app/feed?...) + full /app/feed Stories
  await page.goto(`${origin}/?view=hot`);
  await page.waitForURL("**/app/feed?view=hot");
  assert.equal(new URL(page.url()).pathname, "/app/feed");
  assert.equal(new URL(page.url()).searchParams.get("view"), "hot");
  await page.getByRole("article").filter({ hasText: storyTitle }).first().waitFor();
  const nav = page.getByLabel("工作台导航");
  await nav.getByRole("button", { name: "08:00 日报" }).click();
  assert.ok(page.url().includes("/app/feed?view=digest"));
  await page.getByRole("button", { name: "前一日" }).click();
  assert.ok(page.url().includes("date="));

  // 5. Anonymous Content Explorer + Content Facets (/v1/content/facets)
  await page.goto(`${origin}/content`);
  await page.getByText(storyTitle).first().waitFor();
  assert.deepEqual(guestUnauthorized, []);
  const facetsResponse = page.waitForResponse(
    (res) => res.url().includes("/api/v1/content/facets") && res.status() === 200,
  );
  await page.getByRole("button", { name: "分析内容" }).click();
  await facetsResponse;

  await page.goto(`${origin}/content?from=2025-01-01T00%3A00%3A00Z&to=2025-05-01T00%3A00%3A00Z`);
  await page.getByRole("button", { name: "分析内容" }).click();
  await page.getByText("分析需要大于零且不超过 90 天的日期范围。").waitFor();

  // 6. Protected route gate -> Sign in -> Redirect preserves target path & query
  await page.goto(`${origin}/projects?section=platform`);
  await page.getByText("该模块需要登录后访问").waitFor();
  await page.getByRole("button", { name: "立即登录" }).click();
  await page.getByLabel("工作邮箱").fill("owner@localhost");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-123");
  isAuthed = true;
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.getByRole("heading", { name: "监测总览" }).waitFor();
  assert.ok(page.url().includes("/projects?section=platform"), `Expected preserved target URL, got ${page.url()}`);

  await page.goto(origin);
  await initialCard.getByRole("button", { name: "收藏", exact: true }).click();
  await initialCard.getByRole("button", { name: "已收藏", exact: true }).waitFor();
  await page.reload();
  await initialCard.getByRole("button", { name: "已收藏", exact: true }).waitFor();

  // 7. Open Workbench from PublicSiteShell -> Sources -> Create Push Source & R4 Panel + UI Ingest
  await page.getByRole("button", { name: "打开工作台" }).click();
  await nav.getByRole("button", { name: /来源列表/ }).click();
  await page.getByRole("button", { name: "新建来源" }).click();
  const modal = page.locator(".sr-modal");
  await modal.locator("select").first().selectOption("push");
  await modal.locator("input[maxlength='100']").fill("内部研究样本");
  await modal.locator("input[placeholder='SaaS']").fill("人工智能工具");
  await modal.getByRole("button", { name: "创建来源" }).click();
  await page.getByText("target: search = 人工智能工具").waitFor();
  await page.getByText(/同一离线归档（push）来源可统一接收多月归档数据/).waitFor();
  await page.getByRole("button", { name: "2026-08", exact: true }).click();
  await page.locator("pre").filter({ hasText: "--months '2026-08'" }).waitFor();
  await page.getByRole("button", { name: "全部可用月份", exact: true }).click();

  const sourceResponse = await page.request.get(`${origin}/api/v1/sources`);
  const allSources = (await sourceResponse.json()).sources as Array<{ id: string; label: string }>;
  const pushSource = allSources.find((s) => s.label === "内部研究样本");
  assert.ok(pushSource);
  const sourceId = pushSource.id;
  const item = batchItem(sourceId, {
    title: "研究证据",
    text: "来自内部样本的讨论证据。",
  });
  item.observation.provider = "external_ingest";
  const comment = batchItem(sourceId, {
    externalId: "t1_browsercomment12345",
    kind: "comment",
    title: null,
    text: "内部讨论的补充评论。",
    references: [
      { relation: "reply_to", kind: "post", externalId: item.externalId },
      { relation: "thread_root", kind: "post", externalId: item.externalId },
    ],
    observation: { ...item.observation, evidenceKey: "browser-comment" },
  });
  await page.locator("textarea.wb-textarea").fill(JSON.stringify({ items: [item, comment] }));
  await page.getByRole("button", { name: "提交推流批次" }).click();
  await page.getByText("推流成功：接收 2 条（新增 2，更新 0）").waitFor();

  // 7b. File import prepares the editor. Retrying a lost response reuses the same ingest job.
  const fileInput = page.getByLabel("导入规范 JSON 文件");
  await fileInput.setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-valid-json", "utf8"),
  });
  await page.getByText("所选文件不是合法的 JSON 格式，未发送请求。").waitFor();
  await fileInput.setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(1048577, "a"),
  });
  await page.getByText("预检拦截：文件超过 1 MiB 上限，未发送请求。").waitFor();
  const fileItem = batchItem(sourceId, {
    externalId: "t3_fileimport12345",
    title: "文件导入样本",
    text: "来自规范 JSON 文件导入的讨论证据。",
  });
  fileItem.observation.provider = "external_ingest";
  const ingestRoute = "**/api/v1/sources/*/ingest";
  const ingestAttempts: Array<{ key: string | undefined; jobId: string }> = [];
  await page.route(ingestRoute, async (route) => {
    const response = await route.fetch();
    ingestAttempts.push({
      key: route.request().headers()["idempotency-key"],
      jobId: (await response.json()).jobId,
    });
    if (ingestAttempts.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await fileInput.setInputFiles({
    name: "canonical.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ items: [fileItem] }), "utf8"),
  });
  await page.waitForFunction(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("textarea.wb-textarea");
    return editor?.value.includes("t3_fileimport12345");
  });
  assert.deepEqual([...ingestAttempts], []);
  const submitIngest = page.getByRole("button", { name: "提交推流批次" });
  const lostIngestResponse = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().endsWith(`/sources/${sourceId}/ingest`),
  });
  await submitIngest.click();
  await lostIngestResponse;
  await submitIngest.click();
  await page.getByText(/推流成功：接收 1 条（新增 1，更新 0）/).waitFor();
  assert.equal(ingestAttempts.length, 2);
  assert.ok(ingestAttempts[0]?.key && ingestAttempts[0]?.jobId);
  assert.deepEqual(ingestAttempts[0], ingestAttempts[1]);
  await page.unroute(ingestRoute);

  // 8. Content Explorer -> Annotation + Thread Tree + Stream Export + Save Query
  await nav.getByRole("button", { name: "内容检索" }).click();
  await page.getByText("研究证据").first().click();
  const drawer = page.locator(".drawer-panel");
  await drawer.getByRole("button", { name: /研究批注/ }).click();
  await drawer.getByRole("checkbox", { name: "收藏这条证据" }).check();
  await drawer.locator("textarea.wb-textarea").fill("保留这条研究判断");
  await drawer.getByRole("button", { name: "保存到我的研究" }).click();
  await drawer.getByText(/批注已保存/).waitFor();

  await drawer.getByRole("button", { name: /讨论树/ }).click();
  await drawer.getByText("内部讨论的补充评论。").waitFor();
  await drawer.locator("header button").first().click();

  await page.getByRole("button", { name: "流式导出" }).click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载当前结果" }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "content.json");

  await page.getByRole("button", { name: "保存查询" }).click();
  await page.getByPlaceholder("例如：账单波动痛点 · 近30天").fill("常用研究查询");
  await page.getByRole("button", { name: "确认保存查询" }).click();
  await page.getByText("已保存查询至个人工作区。").waitFor();

  // 9. Personal Workspace verification
  await nav.getByRole("button", { name: /保存的查询/ }).click();
  await page.getByText("常用研究查询").waitFor();
  await nav.getByRole("button", { name: /批注与收藏/ }).click();
  await page.getByText("保留这条研究判断").waitFor();

  // 10. Settings -> Mint R4 ingest + read machine key
  await page.getByRole("button", { name: "账户与权限" }).click();
  await page.getByRole("button", { name: "机器 API 密钥" }).click();
  await page.getByPlaceholder("BI Export Sync").fill("R4 验证密钥");
  await page.getByRole("button", { name: /一键预设: R4 归档推流/ }).click();
  await page.getByRole("checkbox", { name: "内部研究样本" }).check();
  await page.getByRole("button", { name: "生成机器密钥" }).click();
  const key = await page.locator(".wb-alert--warn code").innerText();
  const readRes = await fetch(`${address}/v1/content?sourceId=${sourceId}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  assert.equal(readRes.status, 200);

  // 11. Projects -> Push exclusion & includePushInTrends toggle
  await nav.getByRole("button", { name: "项目总览" }).click();
  await page.getByRole("button", { name: "新建监测" }).click();
  const projModal = page.locator(".sr-modal");
  await projModal.locator("input[maxlength='100']").fill("工具使用反馈");
  await projModal.getByPlaceholder("pricing, billing, churn").fill("内部讨论");
  await projModal.getByRole("checkbox", { name: /内部研究样本/ }).check();
  await projModal.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("heading", { name: "工具使用反馈" }).waitFor();
  assert.equal(await page.locator(".kpi .kpi-val").nth(1).innerText(), "0");

  await page.getByRole("button", { name: "编辑" }).click();
  await page.locator(".sr-modal").getByRole("checkbox", { name: "include_push_in_trends" }).check();
  await page.locator(".sr-modal").getByRole("button", { name: "保存修改" }).click();
  await page.getByText("趋势已计入推流/归档样本").waitFor();
  assert.equal(await page.locator(".kpi .kpi-val").nth(1).innerText(), "1");

  // 12. Responsive checks across desktop / tablet / mobile on / (Public Home) & /app/feed (Stories + j/m)
  await mkdir("output/validation/kernel", { recursive: true });
  const viewports = [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ];
  await nav.getByRole("button", { name: "公开首页" }).click();
  await page.getByRole("heading", { name: "SIFTLINE 公开信息首页" }).waitFor();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(120);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Public home at ${viewport.width}px horizontal overflow detected`,
    );
    await page.screenshot({
      path: `output/validation/kernel/public-home-${viewport.width}.png`,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/app/feed?language=zh`);
  const storyCard = page.getByRole("article").filter({ hasText: storyTitle });
  await storyCard.getByRole("img", { name: /来源分布.*T1 1.*T1_5 1.*T2 1/ }).waitFor();
  await storyCard.getByRole("img", { name: /已采样热度/ }).waitFor();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(120);
    await page.keyboard.press("j");
    assert.equal(await storyCard.evaluate((card) => card === document.activeElement), true);
    await page.keyboard.press("m");
    assert.ok(await storyCard.locator("details").evaluate((details) => details.hasAttribute("open")));
    await page.keyboard.press("m");
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Stories at ${viewport.width}px horizontal overflow detected`,
    );
    await page.screenshot({
      path: `output/validation/kernel/stories-${viewport.width}.png`,
    });
  }

  // 13. Navigate back to PublicSiteShell from Workbench & Switch Account clears session
  await page.setViewportSize({ width: 1440, height: 900 });
  await nav.getByRole("button", { name: "公开首页" }).click();
  await page.getByRole("button", { name: "切换账号" }).click();
  const switchDialog = page.getByRole("dialog", { name: /SIFTLINE/ });
  await switchDialog.getByText(/已退出当前会话/).waitFor();
  await page.keyboard.press("Escape");
  await switchDialog.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "登录", exact: true }).waitFor();

  assert.deepEqual(serverErrors, []);
  assert.deepEqual(errors, []);
});

test("browser: private deployment mode (publicRead=false) blocks anonymous access cleanly", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@localhost");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const createApp: typeof buildApp = process.env.TEST_COMPILED === "true"
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const leakedRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (req) => {
    if (/\/api\/v1\/(content|projects|sources|workspace|public)/.test(req.url())) {
      leakedRequests.push(req.url());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(origin);
  await page.getByText("当前为私有部署模式").waitFor();
  assert.deepEqual(leakedRequests, []);

  await page.goto(`${origin}/content`);
  await page.getByText("当前为私有部署模式").waitFor();
  assert.deepEqual(leakedRequests, []);

  // Signing in from private-mode gate immediately unmounts the gate and loads the page
  await page.getByLabel("工作邮箱").fill("owner@localhost");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-123");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.getByText("当前为私有部署模式").waitFor({ state: "detached" });
  await page.getByRole("heading", { name: "内容检索" }).waitFor();
  assert.deepEqual(errors, []);
});
