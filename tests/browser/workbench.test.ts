import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { buildApp } from "../../apps/api/src/app";
import { commitContentBatch, prepareContentBatch } from "../../src/modules/content/sql";
import { transaction } from "../../src/storage/db";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { BATCH_NOW, batchItem } from "../helpers/content-batch-fixtures";
import { testDatabase } from "../helpers/database";

async function freePort() {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

test("browser: public open-access feed, reader drawer, auth modal login, workbench & responsive layouts", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");

  // Seed multi-source story so anonymous visitors immediately see live stories on /
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
  const appOptions: Parameters<typeof buildApp>[0] & {
    publicRead?: boolean;
    publicRegistration?: boolean;
  } = {
    pool: db.pool,
    sessionSecret: "synthetic-secret-".repeat(3),
    origin,
    secureCookies: false,
    publicRead: true,
    publicRegistration: true,
  };
  const app = await createApp(appOptions);
  const serverErrors: string[] = [];
  app.addHook("onError", async (_request, _reply, error) => {
    serverErrors.push(error.message);
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());

  const vite = spawn(
    "npm",
    [
      "--prefix",
      "apps/web",
      "run",
      process.env.TEST_COMPILED === "true" ? "preview" : "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      env: { ...process.env, VITE_API_PROXY_TARGET: address },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => {
    try {
      if (process.platform !== "win32" && vite.pid) process.kill(-vite.pid, "SIGTERM");
      else vite.kill("SIGTERM");
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

  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline) {
    if (viteError) throw viteError;
    if (vite.exitCode !== null || vite.signalCode !== null) {
      throw Error(`Vite exited before readiness: ${vite.exitCode ?? vite.signalCode}\n${viteOutput}`);
    }
    ready = await fetch(origin, { signal: AbortSignal.timeout(1000) })
      .then(async (response) => response.ok && (await response.text()).includes("<title>信号研究</title>"))
      .catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Vite HTTP readiness timeout\n${viteOutput}`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(12_000);
  const errors: string[] = [];
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  // 1. Anonymous visitor opens / directly with zero login wall
  await page.goto(origin);
  assert.equal(await page.title(), "信号研究");
  await page.getByRole("heading", { name: "今日精选" }).waitFor();
  const initialStory = page.getByRole("article").filter({ hasText: storyTitle });
  await initialStory.waitFor();
  assert.ok(scripts.every((url) => !/charts-|echarts|AnalysisChart/.test(url)));

  // Open Slide-Over Reader Drawer as anonymous guest
  await initialStory.getByRole("button", { name: storyTitle }).click();
  const reader = page.getByRole("dialog", { name: "内容阅读详情" });
  await reader.waitFor();
  await reader.getByText("新版工具支持中文短词检索", { exact: false }).waitFor();
  await reader.getByRole("button", { name: "登录后收藏与记录笔记" }).waitFor();
  await page.keyboard.press("Escape");
  await reader.waitFor({ state: "hidden" });

  // Filter by channel in left rail
  await page.getByRole("navigation", { name: "主题频道" }).getByRole("link", { name: /AI 一手与研发/ }).click();
  await page.waitForURL(/sourceGroup=ai-firsthand/);
  await page.getByRole("heading", { name: "AI 一手与研发" }).waitFor();
  await page.getByRole("navigation", { name: "信息流视图" }).getByRole("link", { name: "精选信息流" }).click();
  await page.getByRole("heading", { name: "今日精选" }).waitFor();

  // 2. Guest opens Auth Modal and logs in as owner
  await page.getByRole("banner").getByRole("button", { name: "登录", exact: true }).click();
  const authDialog = page.getByRole("dialog", { name: "登录账户" });
  await authDialog.waitFor();
  await authDialog.getByRole("tab", { name: "注册" }).waitFor();
  await authDialog.getByLabel("邮箱").fill("owner@example.test");
  await authDialog.getByLabel("密码").fill("fixture-password-123");
  await authDialog.getByRole("button", { name: "登录", exact: true }).click();
  await authDialog.waitFor({ state: "hidden" });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "来源运维" }).waitFor();

  // 3. Keyboard shortcuts: Ctrl+K and [
  await page.getByRole("button", { name: "快速导航" }).focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "快速导航" });
  await palette.waitFor();
  await palette.getByRole("textbox", { name: "查找页面" }).fill("来源运维");
  assert.equal(await palette.getByRole("link").count(), 1);
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "快速导航" }).focus();
  await page.keyboard.press("[");
  await page.getByRole("button", { name: "展开侧栏" }).waitFor();
  await page.keyboard.press("[");
  await page.getByRole("button", { name: "折叠侧栏" }).waitFor();

  // Feed views
  const views = page.getByRole("navigation", { name: "信息流视图" });
  await views.getByRole("link", { name: "48h 热度榜" }).click();
  await page.getByRole("heading", { name: "48 小时热度" }).waitFor();
  await views.getByRole("link", { name: "08:00 日报" }).click();
  await page.getByRole("heading", { name: "08:00 日报" }).waitFor();
  await page.getByRole("link", { name: "前一日" }).click();
  await page.waitForURL(/view=digest&date=/);

  // 4. Sources ingest + Content Library + Lazy ECharts + Saved Query + Workspace + Settings + Projects
  await page.getByRole("link", { name: "来源运维", exact: true }).click();
  await page.getByRole("button", { name: "添加来源" }).click();
  await page.getByLabel("来源名称").fill("内部研究样本");
  await page.getByLabel("采集方式").selectOption("external_ingest");
  await page.getByLabel("样本主题").fill("人工智能工具");
  await page.getByLabel("权威等级").selectOption("T1_5");
  await page.getByRole("button", { name: "保存来源" }).click();
  await page.getByRole("heading", { name: "内部研究样本", exact: true }).waitFor();
  await page.getByRole("button", { name: /内部研究样本/ }).click();

  const sourceResponse = await page.request.get(`${origin}/api/v1/sources`);
  const createdSource = (await sourceResponse.json()).sources.find((s: { label: string }) => s.label === "内部研究样本");
  const sourceId = createdSource.id as string;
  const item = batchItem(sourceId, {
    title: "研究证据",
    publishedAt: BATCH_NOW,
    text: "来自内部样本的讨论证据。",
  });
  item.observation.provider = "external_ingest";
  const comment = batchItem(sourceId, {
    externalId: "t1_browsercomment12345",
    kind: "comment",
    publishedAt: BATCH_NOW,
    title: null,
    text: "内部讨论的补充评论。",
    references: [
      { relation: "reply_to", kind: "post", externalId: item.externalId },
      { relation: "thread_root", kind: "post", externalId: item.externalId },
    ],
    observation: { ...item.observation, evidenceKey: "browser-comment" },
  });
  await page.getByLabel("导入规范 JSON 文件").setInputFiles({
    name: "sample.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ items: [item, comment] })),
  });
  await page.getByText("2 条", { exact: true }).waitFor();

  await page.getByRole("link", { name: "内容库", exact: true }).click();
  await page.getByRole("button", { name: /研究证据/ }).click();
  await page.getByLabel("研究批注").fill("保留这条研究判断");
  await page.getByRole("checkbox", { name: "收藏这条证据" }).check();
  await page.getByRole("button", { name: "保存到我的研究" }).click();
  await page.getByLabel("研究批注").fill("刷新后仍保留的草稿");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  assert.equal(await page.getByLabel("研究批注").inputValue(), "刷新后仍保留的草稿");
  await page.getByRole("button", { name: "保存到我的研究" }).click();
  await page.getByRole("button", { name: "保存到我的研究" }).isEnabled();
  await page.keyboard.press("Escape");

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载当前结果" }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "content.json");

  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByRole("button", { name: "保存查询", exact: true }).click();
  await page.getByLabel("查询名称").fill("常用研究查询");
  await page.getByRole("button", { name: "确认保存查询" }).click();

  await page.getByRole("link", { name: "我的研究", exact: true }).click();
  await page.getByRole("button", { name: "常用研究查询 →" }).waitFor();
  await page.getByText("刷新后仍保留的草稿", { exact: true }).waitFor();

  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("heading", { name: "当前账户" }).waitFor();
  await page.getByLabel("工具名称").fill("只读研究工具");
  await page.getByRole("checkbox", { name: "检索内容与查看来源" }).check();
  await page.getByRole("checkbox", { name: "下载结果" }).check();
  await page.getByRole("checkbox", { name: "内部研究样本" }).check();
  await page.getByRole("button", { name: "创建访问密钥" }).click();
  const key = await page.getByRole("status").locator("code").innerText();
  const read = await fetch(`${address}/v1/content?sourceId=${sourceId}`, {
    headers: { authorization: `Bearer ${key}` },
  });
  assert.equal(read.status, 200);

  await page.getByRole("link", { name: "专题监测", exact: true }).click();
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByLabel("研究主题").fill("工具使用反馈");
  await page.getByLabel("任一提及").fill("内部讨论");
  await page.getByRole("checkbox", { name: "内部研究样本" }).check();
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await page.getByRole("button", { name: /工具使用反馈/ }).click();
  await page.getByText("已存命中内容", { exact: true }).waitFor();
  await page.getByRole("button", { name: "编辑项目" }).click();
  await page.getByRole("checkbox", { name: "统计纳入导入样本" }).check();
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await page.getByText("· 包含导入样本", { exact: false }).waitFor();
  assert.equal(await page.locator(".big-number").innerText(), "1");
  await page.getByRole("img", { name: "按日与平台的内容量" }).locator("canvas").waitFor();

  await page.getByLabel("按日期与平台查看内容").selectOption("0");
  await page.waitForURL((url) => url.searchParams.has("from") && url.searchParams.get("platform") === "reddit");
  const facetsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/content/facets");
  await page.getByRole("button", { name: "分析内容" }).click();
  const facetResult = await facetsResponse;
  assert.equal(facetResult.status(), 200, [await facetResult.text(), ...serverErrors].join("\n"));
  await page.getByRole("img", { name: "按日与平台的内容量" }).locator("canvas").waitFor();

  // 5. Responsive layout & keyboard navigation verification across 1440 / 768 / 390
  await mkdir("output/validation/kernel", { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/?language=zh`);
    const storyCard = page.getByRole("article").filter({ hasText: storyTitle });
    await storyCard.getByRole("img", { name: /来源分布.*T1 1.*T1_5 1.*T2 1/ }).waitFor();
    await storyCard.getByRole("img", { name: /已采样热度/ }).waitFor();
    await page.keyboard.press("j");
    assert.equal(await storyCard.evaluate((card) => card === document.activeElement), true);
    await page.keyboard.press("m");
    assert.ok(await storyCard.locator("details").evaluate((details) => details.hasAttribute("open")));
    await page.keyboard.press("m");
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `Stories at ${viewport.width}px overflow`,
    );
    await page.screenshot({ path: `output/validation/kernel/stories-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
});
