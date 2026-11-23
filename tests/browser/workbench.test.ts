import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { buildApp } from "../../apps/api/src/app";
import { BlueskyAppViewContentConnector } from "../../src/connectors/bluesky/bluesky-appview-content.connector";
import { webSource } from "../../src/connectors/web/sources";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { twitterApis } from "../../src/connectors/x/twitterapis";
import { createCredentialVault } from "../../src/modules/collection/credentials";
import { scheduleDueSourcesOnce } from "../../src/modules/collection/schedule";
import { workOnce } from "../../src/modules/collection/worker";
import { bootstrapOwner, tokenHash } from "../../src/modules/access/sql";
import { provisionMfa } from "../../src/modules/access/mfa-sql";
import { commitContentBatch, prepareContentBatch } from "../../src/modules/content/sql";
import { attachBatchToProjectInTx } from "../../src/modules/projects/index";
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

test("browser: source operations by domain, scheduling, paid block and role boundaries", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  const password = "fixture-password-123";
  await bootstrapOwner(db.pool, password, "owner@localhost");
  await db.pool.query(`UPDATE source_provider_budget SET enabled=true, daily_requests=25, monthly_requests=100,
    daily_resources=500, monthly_resources=2000 WHERE provider='feed'`);
  await db.pool.query(`
    WITH staff AS (
      INSERT INTO app_user(id,email,role,status)
      VALUES (gen_random_uuid(),'ops@example.test','admin','active'),
             (gen_random_uuid(),'reader@example.test','viewer','active')
      RETURNING id
    )
    INSERT INTO app_user_password(user_id,password_hash,password_algo)
    SELECT staff.id,p.password_hash,p.password_algo FROM staff
    CROSS JOIN app_user_password p JOIN app_user u ON u.id=p.user_id AND u.email='owner@localhost'
  `);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const createApp: typeof buildApp = process.env.TEST_COMPILED === "true"
    ? require("../../dist/apps/api/src/app.js").buildApp
    : buildApp;
  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true" }, async () => ({
    status: 200,
    body: '<rss version="2.0"><channel><title>Test feed</title><item><title>Source operations article</title>' +
      '<link>https://example.test/story</link><description>Source operations browser fixture.</description></item></channel></rss>',
  }));
  const reddit = new KaixContentConnector({ networkEnabled: true, apiToken: "browser-fixture" });
  const app = await createApp({
    pool: db.pool, providers: [feed, reddit], origin,
    credentialVault: createCredentialVault(db.pool, "synthetic-secret-".repeat(3), { SOURCE_NETWORK_ENABLED: "true" }),
    sessionSecret: "synthetic-secret-".repeat(3), secureCookies: false, rateLimitMax: 350,
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  await launchVite(t, address, port, origin);
  const browser = await chromium.launch({ executablePath: resolveChromiumPath(), args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const post = (path: string, data: object) => page.request.post(origin + "/api/v1" + path, { data, headers: { origin } });
  const login = async (email: string) => {
    const response = await post("/auth/login", { email, password });
    assert.ok(response.ok(), `Login for fixture ${email} returned ${response.status()}`);
  };
  const capture = async (name: string) => {
    if (process.env.CAPTURE_SOURCE_OPS !== "1") return;
    await mkdir("output/validation/source-operations", { recursive: true });
    await page.screenshot({ path: `output/validation/source-operations/${name}.png`, fullPage: true });
  };
  const wizard = page.getByRole("dialog", { name: "新建采集来源" });
  const next = wizard.getByRole("button", { name: "下一步" });
  const create = wizard.getByRole("button", { name: "创建来源" });
  const researchPath = "/sources?tab=sources&domain=research";
  const feedPath = "/sources?tab=sources&domain=feed";

  await login("owner@localhost");
  await page.goto(origin + researchPath);
  await page.getByText("研究目标目录").waitFor();
  await page.getByText("没有符合筛选条件的来源。").waitFor();
  await capture("research-empty-1440");
  assert.equal(await page.getByLabel("设置 / 轮换密钥（只写）").count(), 0);
  await page.getByRole("button", { name: "添加研究目标" }).click();
  assert.equal(await wizard.getByLabel("平台", { exact: true }).inputValue(), "reddit");
  assert.equal(await wizard.getByLabel("目标类型").inputValue(), "community");
  await next.click();
  await wizard.getByRole("heading", { name: "采集目标" }).waitFor();
  await wizard.getByLabel("Reddit 版块", { exact: true }).fill("LocalLLaMA");
  await wizard.getByLabel(/来源名称/).fill("Research operations target");
  await next.click();
  await wizard.getByRole("heading", { name: "渠道与分类" }).waitFor();
  await next.click();
  await wizard.getByRole("heading", { name: "调度与保存" }).waitFor();
  await create.click();
  await wizard.waitFor({ state: "hidden" });
  const researchId = new URL(page.url()).searchParams.get("sourceId");
  assert.ok(researchId);
  assert.equal(new URL(page.url()).searchParams.get("domain"), "research");
  await page.getByRole("heading", { name: "使用此来源的研究项目" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "使用此来源的研究项目" }).waitFor();
  await page.getByRole("button", { name: "编辑来源" }).click();
  const sourceEdit = page.getByRole("dialog", { name: "编辑来源" });
  await sourceEdit.waitFor();
  await capture("research-editor-1440");
  await sourceEdit.getByRole("button", { name: "取消" }).click();

  for (const width of [1280, 768, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(`research-normal-${width}`);
  }
  await db.pool.query(
    `UPDATE collection_source SET automatic_collection_blocked=true,
      health=jsonb_build_object('lastStatus','failed','lastError','HTTP 502 fixture','consecutiveFailures',1)
      WHERE id=$1`, [researchId],
  );
  await page.reload();
  await page.getByText("渠道计费结果待核实，已阻断采集。").waitFor();
  assert.equal(await page.getByRole("button", { name: "确认并解除封锁" }).isDisabled(), true);
  assert.equal(await page.getByText("HTTP 502 fixture").first().isVisible(), false);
  await capture("research-blocked-1440");
  await page.getByText("试运行采集", { exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "提交采集任务" }).isDisabled(), true);

  await page.goto(origin + feedPath);
  await page.getByRole("button", { name: "添加资讯源" }).click();
  assert.equal(await wizard.getByLabel("平台", { exact: true }).inputValue(), "web");
  await wizard.getByLabel("公开 HTTPS 地址", { exact: true }).fill("https://example.test/feed.xml");
  await wizard.getByLabel(/来源名称/).fill("News operations channel");
  await next.click();
  await wizard.getByRole("heading", { name: "解析与分类" }).waitFor();
  await next.click();
  await wizard.getByRole("button", { name: "预览来源" }).click();
  await wizard.getByText("Source operations article", { exact: true }).waitFor();
  await create.click();
  await wizard.waitFor({ state: "hidden" });
  const feedId = new URL(page.url()).searchParams.get("sourceId");
  assert.ok(feedId);
  assert.equal(new URL(page.url()).searchParams.get("domain"), "feed");
  await page.getByText("暂无入库资讯。可先预览订阅或执行一次抓取。").waitFor();
  await page.getByRole("button", { name: "开启定时", exact: true }).click();
  await page.getByRole("button", { name: "暂停定时", exact: true }).waitFor();
  const sources = async () => (await (await page.request.get(origin + "/api/v1/sources")).json()).sources;
  const scheduledFeed = (await sources()).find((source: { id: string }) => source.id === feedId);
  assert.equal(scheduledFeed.schedule.enabled, true);
  assert.ok(scheduledFeed.nextDueAt);
  await scheduleDueSourcesOnce(db.pool, [feed]);
  assert.equal(await workOnce(db.pool, [feed]), true);
  await page.reload();
  await page.getByText("Source operations article", { exact: true }).waitFor();
  await page.getByRole("button", { name: "暂停定时", exact: true }).click();
  await page.getByRole("button", { name: "开启定时", exact: true }).waitFor();
  await scheduleDueSourcesOnce(db.pool, [feed]);
  assert.equal(await workOnce(db.pool, [feed]), false);
  assert.equal((await sources()).find((source: { id: string }) => source.id === feedId).nextDueAt, null);
  for (const width of [1280, 1440, 1920, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(`feed-normal-${width}`);
  }
  await page.getByRole("button", { name: "预览抓取", exact: true }).click();
  await page.getByRole("button", { name: "执行预览抓取" }).click();
  await page.getByRole("dialog").getByText("Source operations article", { exact: true }).waitFor();
  await capture("feed-preview-390");
  await page.keyboard.press("Escape");
  await page.getByText("任务记录", { exact: true }).click();
  await page.getByText("已成功 · 入库 1", { exact: true }).waitFor();
  const push = await post("/sources", {
    platform: "web", primaryProvider: "external_ingest", deliveryMode: "push", contentKind: "article",
    target: { type: "search", query: "partner-news" }, label: "Partner news delivery",
  });
  assert.equal(push.status(), 200, await push.text());
  const pushId = (await push.json()).source.id;
  await page.goto(origin + feedPath + "&sourceId=" + pushId + "&section=plan");
  await page.getByRole("heading", { name: "外部推送" }).waitFor();
  await page.getByRole("heading", { name: "最近入库资讯" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /预览抓取|开启定时|暂停定时/ }).count(), 0);
  await page.getByRole("link", { name: "管理接入密钥" }).waitFor();
  await page.getByRole("heading", { name: "最近入库资讯" }).scrollIntoViewIfNeeded();
  await capture("feed-push-390");
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture("feed-push-1440");
  await page.setViewportSize({ width: 390, height: 844 });


  assert.ok((await post("/auth/logout", {})).ok());
  await login("ops@example.test");
  await page.goto(origin + researchPath);
  await page.getByRole("button", { name: "添加研究目标" }).waitFor();
  await page.getByRole("button", { name: "打开菜单" }).click();
  await page.getByRole("button", { name: "第三方采集密钥", exact: true }).click();
  await page.getByRole("heading", { name: "第三方采集密钥" }).waitFor();
  await page.goto(origin + "/sources?tab=budgets");
  const readerRow = page.getByRole("row").filter({ hasText: "reader@example.test" });
  await readerRow.getByRole("button", { name: "调整", exact: true }).click();
  await page.getByLabel("每帖评论上限").fill("0");
  await page.getByLabel("私有项目数量上限").fill("2");
  await page.getByLabel("最大历史回溯天数").fill("3");
  await page.getByLabel("选择采集渠道").selectOption("true");
  await page.getByLabel("CSV / JSON 数据导出").selectOption("false");
  await capture("export-policy-override-390");
  await page.getByRole("button", { name: "保存覆盖" }).press("Enter");
  await readerRow.getByText(/禁止导出/).waitFor();
  await readerRow.getByRole("button", { name: "调整", exact: true }).click();
  assert.equal(await page.getByLabel("每帖评论上限").inputValue(), "0");
  assert.equal(await page.getByLabel("私有项目数量上限").inputValue(), "2");
  assert.equal(await page.getByLabel("最大历史回溯天数").inputValue(), "3");
  assert.equal(await page.getByLabel("选择采集渠道").inputValue(), "true");
  assert.equal(await page.getByLabel("CSV / JSON 数据导出").inputValue(), "false");
  assert.ok((await post("/auth/logout", {})).ok());
  await login("reader@example.test");
  await page.goto(origin + researchPath);
  await page.getByRole("alert").filter({ hasText: "仅所有者和管理员可以管理来源及服务商密钥" }).waitFor();
  await capture("viewer-denied-390");
  assert.equal((await post("/sources/preview", {
    platform: "web", primaryProvider: "feed", deliveryMode: "pull", contentKind: "article",
    target: { type: "feed", url: "https://example.test/feed.xml" }, label: "Forbidden preview",
  })).status(), 403);
  assert.equal((await page.request.get(origin + "/api/v1/sources/credentials")).status(), 403);
});

test("browser: project switching and guided intake with real project and role boundaries", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  const password = "fixture-password-123";
  await bootstrapOwner(db.pool, password, "owner@localhost");
  await db.pool.query(`
    WITH accounts AS (
      INSERT INTO app_user(id,email,role,status,plan_tier)
      VALUES (gen_random_uuid(),'admin@example.test','admin','active','free'),
             (gen_random_uuid(),'free@example.test','viewer','active','free'),
             (gen_random_uuid(),'pro@example.test','viewer','active','pro')
      RETURNING id
    )
    INSERT INTO app_user_password(user_id,password_hash,password_algo)
    SELECT accounts.id,p.password_hash,p.password_algo FROM accounts
    CROSS JOIN app_user_password p JOIN app_user u ON u.id=p.user_id AND u.email='owner@localhost'
  `);
  await db.pool.query(`UPDATE plan_collection_policy SET manual_collect_enabled=true, allowed_providers='{twitterapis}',
    daily_requests=5,daily_resources=100,max_batch_limit=25,max_comments_per_post=8 WHERE plan_tier='pro'`);
  await db.pool.query(`UPDATE source_provider_budget SET enabled=true,daily_requests=25,monthly_requests=100,
    daily_resources=500,monthly_resources=2000 WHERE provider='twitterapis'`);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const createApp: typeof buildApp = process.env.TEST_COMPILED === "true"
    ? require("../../dist/apps/api/src/app.js").buildApp : buildApp;
  let upstreamCalls = 0;
  let rejectUpstream = false;
  const x = twitterApis({ SOURCE_NETWORK_ENABLED: "true" }, async () => {
    upstreamCalls++;
    if (rejectUpstream) return Response.json({ error: "fixture provider failure" }, { status: 400 });
    return Response.json({ tweets: [{
      id: "1234560010", created_at: new Date(Date.now() - 3_600_000).toISOString(),
      text: "Evidence from guided research intake", author: { username: "example" },
    }] });
  }, () => "synthetic-browser-fixture");
  const app = await createApp({
    pool: db.pool, providers: [x], origin, secureCookies: false,
    sessionSecret: "synthetic-intake-fixture-".repeat(3), rateLimitMax: 400,
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  await launchVite(t, address, port, origin);
  const browser = await chromium.launch({ executablePath: resolveChromiumPath(), args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const post = (path: string, data: object, key?: string) => page.request.post(origin + "/api/v1" + path, {
    data, headers: { origin, ...(key ? { "idempotency-key": key } : {}) },
  });
  const login = async (email: string) => assert.equal((await post("/auth/login", { email, password })).status(), 200);
  const logout = async () => assert.ok((await post("/auth/logout", {})).ok());
  const project = async (name: string, description = "") => {
    const response = await post("/projects", { name, description, datasetMode: "batch", sourceIds: [], filter: {} });
    assert.equal(response.status(), 200, await response.text());
    return (await response.json()).id as string;
  };
  const intakePath = (id: string) => `/projects?view=collect&projectId=${id}`;
  const capture = async (name: string) => {
    if (process.env.CAPTURE_PROJECT_INTAKE !== "1") return;
    await mkdir("output/validation/project-intake", { recursive: true });
    await page.screenshot({ path: `output/validation/project-intake/${name}.png`, fullPage: true });
  };
  const selectProject = page.getByRole("button", { name: /^切换项目 ·/ });
  const switcher = page.getByRole("dialog", { name: "切换研究项目" });
  const search = switcher.getByRole("searchbox");
  const start = page.getByRole("button", { name: "开始采集", exact: true });
  const preflight = page.getByRole("button", { name: "查看预计消耗" });
  const confirm = page.getByRole("button", { name: "确认开始采集" });
  const chooseX = async () => {
    await page.getByRole("radio", { name: /Registered X source/ }).check();
    await page.getByRole("button", { name: "继续设置范围" }).click();
    await page.getByRole("heading", { name: "设置采集范围" }).waitFor();
  };

  await login("owner@localhost");
  const sharedId = await project("系统共享研究");
  const sourceResponse = await post("/sources", {
    platform: "x", primaryProvider: "twitterapis", deliveryMode: "pull", contentKind: "post",
    label: "Registered X source", target: { type: "account", account: "example" },
  });
  assert.equal(sourceResponse.status(), 200, await sourceResponse.text());
  const sourceId = (await sourceResponse.json()).source.id as string;
  await db.pool.query("UPDATE source_provider_budget SET enabled=false WHERE provider='twitterapis'");
  await page.goto(origin + intakePath(sharedId));
  await page.getByText("目前没有可添加的已有研究数据。").waitFor();
  assert.equal(await page.getByRole("button", { name: "使用已有数据", exact: true }).count(), 0);
  await capture("intake-start-1440");
  await start.click();
  await page.getByRole("heading", { name: "选择研究对象" }).waitFor();
  await capture("owner-target-1440");
  await page.getByRole("radio", { name: /Registered X source/ }).check();
  await page.getByRole("button", { name: "继续设置范围" }).click();
  await page.getByText("该采集服务暂无可用预算。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "检查渠道预算" }).getAttribute("href"), "/sources?tab=budgets");
  assert.equal(await confirm.count(), 0);
  await db.pool.query("UPDATE source_provider_budget SET enabled=true WHERE provider='twitterapis'");
  await page.getByRole("button", { name: "更换研究对象" }).click();
  await page.getByRole("button", { name: "输入其他研究对象" }).click();
  await page.getByLabel("目标平台").selectOption("x");
  await page.getByLabel("目标内容").fill("@newtarget");
  await page.getByRole("button", { name: "检查这个目标" }).click();
  await page.getByRole("link", { name: "添加此研究来源" }).click();
  const sourceWizard = page.getByRole("dialog", { name: "新建采集来源" });
  assert.equal(await sourceWizard.getByLabel("账号名称").inputValue(), "@newtarget");
  await sourceWizard.getByRole("button", { name: "取消" }).click();
  await page.getByLabel("目标内容").waitFor();
  assert.equal(await page.getByLabel("目标内容").inputValue(), "@newtarget");

  await logout();
  await login("pro@example.test");
  const firstId = await project("私人研究一");
  const secondId = await project("私人研究二", "用于验证说明搜索");
  await page.goto(origin + intakePath(firstId));
  await start.click();
  await page.getByRole("button", { name: "输入其他研究对象" }).click();
  await page.getByLabel("目标内容").fill("r/NotRegistered");
  await page.getByRole("button", { name: "检查这个目标" }).click();
  await page.getByText("暂时无法采集这个目标。", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("本次条数上限").count(), 0);
  assert.equal(await confirm.count(), 0);
  assert.equal(await page.getByRole("link", { name: "添加此研究来源" }).count(), 0);
  await capture("pro-unregistered-1440");
  await selectProject.click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "searchbox");
  await switcher.getByRole("region", { name: "我的研究" }).waitFor();
  await switcher.getByRole("region", { name: "系统共享" }).waitFor();
  await capture("switcher-1440");
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press(i >= 12 ? "Shift+Tab" : "Tab");
    await page.waitForFunction(() => document.querySelector(".project-switcher")?.contains(document.activeElement));
  }
  await search.fill("验证说明搜索");
  await page.keyboard.press("Escape");
  await switcher.waitFor({ state: "hidden" });
  assert.equal(await selectProject.evaluate(button => button === document.activeElement), true);
  await selectProject.click();
  await search.fill("验证说明搜索");
  await switcher.getByRole("button", { name: /私人研究二/ }).click();
  await page.waitForURL("**" + intakePath(secondId));
  await page.getByRole("heading", { name: "为项目添加研究数据" }).waitFor();
  assert.equal(await page.getByText("暂时无法采集这个目标。", { exact: true }).count(), 0);
  await selectProject.click();
  await switcher.getByRole("group", { name: "筛选项目" }).getByRole("button", { name: "系统共享" }).click();
  assert.equal(await switcher.getByRole("region", { name: "我的研究" }).count(), 0);
  await switcher.getByRole("button", { name: /系统共享研究.*只读/ }).click();
  await page.waitForURL(`**/projects?view=overview&projectId=${sharedId}`);
  await page.goBack();
  await page.waitForURL("**" + intakePath(secondId));
  await page.goForward();
  await page.waitForURL(`**/projects?view=overview&projectId=${sharedId}`);
  await page.reload();
  await selectProject.filter({ hasText: "系统共享研究" }).waitFor();
  await page.getByText("暂无趋势数据", { exact: true }).first().waitFor();
  assert.equal(await page.locator(".kpi-strip canvas").count(), 0);
  await capture("empty-project-analysis-1440");
  await page.setViewportSize({ width: 1280, height: 900 });
  await selectProject.click();
  await capture("switcher-1280");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开菜单" }).click();
  await selectProject.click();
  assert.equal(await switcher.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
  await capture("switcher-390");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(origin + intakePath(firstId));
  await start.click();
  await chooseX();
  await capture("intake-scope-1440");
  assert.equal(await page.getByLabel("同时采集评论").count(), 0);
  await preflight.click();
  await page.getByRole("heading", { name: "确认采集内容与预计消耗" }).waitFor();
  assert.equal(await confirm.isDisabled(), true);
  await page.getByRole("checkbox", { name: "我已核对预计用量并确认本次采集。" }).check();
  await page.clock.setFixedTime(new Date(Date.now() + 6 * 60_000));
  await confirm.click();
  await page.getByRole("alert").filter({ hasText: "估算已过期" }).waitFor();
  assert.equal(upstreamCalls, 0);
  await page.clock.setFixedTime(new Date());
  await preflight.click();
  await page.getByRole("heading", { name: "确认采集内容与预计消耗" }).waitFor();
  await page.getByRole("button", { name: "修改采集范围" }).click();
  await page.getByLabel("本次条数上限").fill("10");
  assert.equal(await confirm.count(), 0);
  await preflight.click();
  await page.getByRole("heading", { name: "确认采集内容与预计消耗" }).waitFor();
  await capture("pro-preflight-1440");
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(`pro-preflight-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const confirmQuota = page.getByRole("checkbox", { name: "我已核对预计用量并确认本次采集。" });
  await confirmQuota.check();
  await db.pool.query("UPDATE source_provider_budget SET enabled=false WHERE provider='twitterapis'");
  await confirm.click();
  await page.getByRole("alert").filter({ hasText: "采集配置或服务预算可能已变化" }).waitFor();
  assert.equal(upstreamCalls, 0);
  await db.pool.query("UPDATE source_provider_budget SET enabled=true WHERE provider='twitterapis'");
  await confirm.click();
  await page.waitForURL(/view=jobs.*jobId=/);
  await page.getByText("已排队", { exact: true }).waitFor();
  await capture("intake-queued-1440");
  await page.reload();
  await page.getByText("已排队", { exact: true }).waitFor();
  assert.equal(await workOnce(db.pool, [x], undefined, undefined, { onProjectBatchCommitted: attachBatchToProjectInTx }), true);
  await page.getByText("已成功", { exact: true }).waitFor();
  await capture("intake-completed-1440");
  await page.getByRole("button", { name: "查看批次" }).click();
  await page.waitForURL(/view=batches.*batchId=/);
  await page.locator('tr[aria-current="true"]').getByText("[X] Registered X source", { exact: true }).waitFor();
  const privateBatchId = new URL(page.url()).searchParams.get("batchId");
  await page.goto(origin + intakePath(secondId));
  await page.getByRole("button", { name: "使用已有数据", exact: true }).click();
  await capture("intake-reuse-1440");
  await page.getByRole("button", { name: "添加到项目" }).click();
  await page.waitForURL(/view=batches.*batchId=/);
  assert.equal(new URL(page.url()).searchParams.get("batchId"), privateBatchId);
  assert.equal(upstreamCalls, 1);

  await page.goto(origin + `/projects?view=overview&projectId=${secondId}`);
  const analytics = page.getByRole("group", { name: "分析展示模式" });
  await analytics.getByRole("button", { name: "合并总览" }).waitFor();
  await page.getByRole("group", { name: "时间窗口" }).getByRole("button", { name: "7d" }).click();
  assert.equal(await page.getByRole("group", { name: "时间窗口" }).getByRole("button", { name: "7d" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "6h", exact: true }).click();
  await page.getByLabel("按 UTC 六小时分桶与平台的内容量").waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出证据样本（CSV）" }).click();
  const csv = await readFile(await (await downloadPromise).path(), "utf8");
  assert.match(csv, /Evidence from guided research intake/);

  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await capture(`project-analysis-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await selectProject.click();
  const defaultPanel = await switcher.evaluate(el => getComputedStyle(el).getPropertyValue("--wb-purple").trim());
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "界面皮肤与配色方案" }).click();
  await page.getByRole("button", { name: /冰川青灰 × 锐利钴蓝/ }).click();
  await page.getByRole("checkbox", { name: "工作台同步跟随主辅色调" }).check();
  await page.getByRole("button", { name: "Close palette studio" }).click();
  await selectProject.click();
  assert.notEqual(await switcher.evaluate(el => getComputedStyle(el).getPropertyValue("--wb-purple").trim()), defaultPanel);
  await capture("switcher-theme-1440");
  await page.keyboard.press("Escape");

  await analytics.getByRole("button", { name: "分平台独立视图" }).click();
  await page.getByRole("button", { name: "钻取", exact: true }).click();
  await page.waitForURL(/\/content\?/);
  const drilldown = new URL(page.url()).searchParams;
  assert.equal(drilldown.get("projectId"), secondId);
  assert.equal(drilldown.get("platform"), "x");
  assert.equal(Date.parse(drilldown.get("to")!) - Date.parse(drilldown.get("from")!), 7 * 86_400_000);

  // Keep the page open while the account loses export permission. The button
  // must use the current policy, even when its previous summary allowed CSV.
  await page.goto(origin + `/projects?view=overview&projectId=${secondId}`);
  const evidenceExport = page.getByRole("button", { name: "导出证据样本（CSV）" });
  await evidenceExport.click({ trial: true });
  let deniedDownloads = 0;
  const countDownload = () => { deniedDownloads++; };
  page.on("download", countDownload);
  await db.pool.query(`UPDATE app_user SET quota_override='{"exportEnabled":false}' WHERE email='pro@example.test'`);
  await evidenceExport.press("Enter");
  await page.getByText("当前账号的导出权限已关闭。", { exact: true }).waitFor();
  assert.equal(await evidenceExport.isDisabled(), true);
  assert.equal(deniedDownloads, 0);
  page.off("download", countDownload);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("evidence-export-denied-390");
  await page.goto(origin + `/content?projectId=${secondId}`);
  await page.getByText("当前账号的导出权限已关闭。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "流式导出" }).isDisabled(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture("stream-export-denied-390");
  await db.pool.query("UPDATE app_user SET quota_override=NULL WHERE email='pro@example.test'");
  await page.setViewportSize({ width: 1440, height: 900 });

  rejectUpstream = true;
  await page.goto(origin + intakePath(firstId));
  await start.click();
  await chooseX();
  await preflight.click();
  await page.getByRole("checkbox", { name: "我已核对预计用量并确认本次采集。" }).check();
  await confirm.click();
  await page.waitForURL(/view=jobs.*jobId=/);
  assert.equal(await workOnce(db.pool, [x], undefined, undefined, { onProjectBatchCommitted: attachBatchToProjectInTx }), true);
  await page.getByText("失败", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "查看批次" }).count(), 0);
  await capture("intake-failed-1440");
  assert.equal(upstreamCalls, 2);

  const sharedBatchId = (await db.pool.query(`INSERT INTO collection_batch(id,collection_source_id,label,visibility)
    VALUES(gen_random_uuid(),$1,'Reusable shared evidence','shared') RETURNING id`, [sourceId])).rows[0].id;
  await db.pool.query("INSERT INTO monitor_project_batch(project_id,batch_id) VALUES($1,$2)", [sharedId, sharedBatchId]);
  await page.goto(origin + `/projects?view=batches&projectId=${sharedId}`);
  const sharedBatch = page.getByRole("row").filter({ hasText: "Reusable shared evidence" });
  await sharedBatch.getByRole("button", { name: "引入到项目" }).waitFor();
  assert.equal(await sharedBatch.getByRole("button", { name: /禁用|移除/ }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture("readonly-shared-batch-390");
  await sharedBatch.getByLabel("选择要复用到的目标项目").selectOption(firstId);
  await sharedBatch.getByRole("button", { name: "引入到项目" }).press("Enter");
  await page.getByRole("status").filter({ hasText: "已将该批次复用到项目『私人研究一』" }).waitFor();
  await page.goto(origin + `/projects?view=batches&projectId=${firstId}`);
  await page.getByRole("row").filter({ hasText: "Reusable shared evidence" }).getByRole("button", { name: "禁用" }).waitFor();
  assert.equal(upstreamCalls, 2);
  await page.setViewportSize({ width: 1440, height: 900 });

  await logout();
  await login("free@example.test");
  const freeId = await project("Free 私有研究");
  await page.goto(origin + intakePath(freeId));
  await page.getByText("目前没有可添加的已有研究数据。").waitFor();
  await page.getByText("当前套餐无法发起采集。", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "使用已有数据", exact: true }).count(), 0);
  assert.equal(await start.count(), 0);
  assert.equal(await confirm.count(), 0);
  const scope = { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date().toISOString(), limit: 1, projectId: sharedId };
  assert.equal((await post("/research/collection-plans/preview", { ...scope, sourceId })).status(), 403);
  assert.equal((await post(`/sources/${sourceId}/collect`, scope, "unauthorized-browser-project")).status(), 403);
  await capture("free-blocked-1440");

  await logout();
  await login("admin@example.test");
  await page.goto(origin + intakePath(sharedId));
  await start.click();
  await page.getByRole("heading", { name: "选择研究对象" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await capture("admin-target-390");
});

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
  const articleTitle = "Introducing GPT-5.99: Workbench fixture";
  const feedUrl = "https://openai.com/news/workbench-fixture.xml";
  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true" }, async () => ({
    status: 200,
    body: '<rss version="2.0"><channel><title>Workbench fixture</title><item><title>' + articleTitle +
      '</title><link>https://openai.com/index/workbench-fixture</link><description>Official model release evidence for the workbench test.</description></item></channel></rss>',
  }));
  const kaix = new KaixContentConnector({ networkEnabled: true, apiToken: "browser-fixture" });
  const sessionSecret = "synthetic-secret-".repeat(3);
  const sourceEnv = { SOURCE_NETWORK_ENABLED: "true" };
  const fixtureKey = "browser-twitterapis-fixture";
  const tweetText = "Post stored from a TwitterAPIs workbench submission";
  const vault = createCredentialVault(db.pool, sessionSecret, sourceEnv);
  await vault.reload();
  const x = twitterApis(sourceEnv, async (input, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${fixtureKey}`);
    assert.equal(new URL(String(input)).pathname, "/twitter/tweet/advanced_search");
    return Response.json({ tweets: [{ id: "1234567890", created_at: fetchedAt, text: tweetText, author: { username: "example" } }] });
  }, () => vault.getSecret("twitterapis"));
  await db.pool.query("UPDATE source_provider_budget SET enabled=false WHERE provider='twitterapis'");
  const app = await createApp({
    pool: db.pool,
    providers: [feed, webSource("newsnow", { SOURCE_NETWORK_ENABLED: "true" }), kaix, x, new BlueskyAppViewContentConnector({ networkEnabled: false })],
    sessionSecret,
    credentialVault: vault,
    origin,
    secureCookies: false,
    publicRead: true,
    publicRegistration: true,
    rateLimitMax: 500,
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Asia/Shanghai" });
  const page = await context.newPage();
  const errors: string[] = [];
  const guestUnauthorized: string[] = [];
  let isAuthed = false;
  page.on("response", (res) => {
    if (!isAuthed && res.status() === 401 && res.url().includes("/api/v1/")) {
      guestUnauthorized.push(res.url());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  // 1. Public Info Home on / (public nav, zero 401s, live stories)
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
  await page.getByRole("heading", { name: "官方可核验 AI 模型发布时间轴与情报中心" }).waitFor();
  await page.getByRole("heading", { name: "厂商 × 时间发布矩阵" }).waitFor();
  await page.getByText("外部授权评测数据源尚未配置").waitFor();
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
  await page.locator(".rail").getByRole("button", { name: "运维管理", exact: true }).click();
  const feedNav = nav.getByRole("button", { name: /^资讯信息流源/ });
  await feedNav.click();
  await page.getByRole("button", { name: "添加资讯源" }).click();
  const modal = page.getByRole("dialog", { name: "新建采集来源" });
  await modal.getByLabel("来源名称").fill("官方测试 Feed");
  await modal.getByLabel("公开 HTTPS 地址", { exact: true }).fill(feedUrl);
  await modal.getByRole("button", { name: "下一步" }).click();
  await modal.getByText("可选分类信息", { exact: true }).click();
  await modal.getByLabel("来源分类").fill("ai-firsthand");
  await modal.getByLabel("来源等级").selectOption("T1");
  await modal.getByLabel("语言区域（如 zh-CN）").fill("en-US");
  await modal.getByRole("button", { name: "下一步" }).click();
  await modal.getByLabel("启用自动调度").check();
  await modal.getByRole("button", { name: "预览来源" }).click();
  await modal.getByText(articleTitle).waitFor();
  await modal.getByRole("button", { name: "创建来源" }).click();
  await modal.waitFor({ state: "hidden" });
  const createdFeedResponse = await page.request.get(origin + "/api/v1/sources?sourceGroup=ai-firsthand");
  const createdFeed = createdFeedResponse.ok() && (await createdFeedResponse.json()).sources.find((row: { label: string }) => row.label === "官方测试 Feed");
  assert.ok(createdFeed);
  assert.equal(createdFeed.schedule.enabled, true);
  assert.ok(createdFeed.nextDueAt);
  await page.goto(origin + "/sources?sourceId=" + createdFeed.id);
  await page.getByText("技术诊断", { exact: true }).click();
  await page.locator("dd").getByText("ai-firsthand", { exact: true }).waitFor();
  await page.getByRole("button", { name: "编辑来源" }).click();
  const edit = page.getByRole("dialog", { name: "编辑来源" });
  assert.equal(await edit.getByLabel("来源分类").inputValue(), "ai-firsthand");
  assert.equal(await edit.getByLabel("启用自动调度").isChecked(), true);
  await edit.getByLabel("标签（逗号或空格分隔）").fill("vendor-official");
  await edit.getByRole("button", { name: "保存来源" }).click();
  await page.getByText(/标签 · vendor-official/).waitFor();

  const quotasNav = nav.getByRole("button", { name: "渠道配额与套餐策略", exact: true });
  const sourceNav = nav.getByRole("button", { name: /^研究采集源/ });
  const jobsNav = nav.getByRole("button", { name: "全站采集任务", exact: true });
  await quotasNav.click();
  await page.getByRole("heading", { name: "渠道配额与套餐策略", exact: true }).waitFor();
  assert.equal(await quotasNav.getAttribute("aria-current"), "page");
  await page.getByRole("columnheader", { name: "日请求（次）" }).waitFor();
  await page.getByRole("columnheader", { name: "月资源（单位）" }).waitFor();
  assert.equal(await page.locator(".collection-page").getByRole("button", { name: "采集任务", exact: true }).count(), 0);
  await page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "feed", exact: true }) })
    .getByRole("button", { name: "调整配额" }).click();
  const budget = page.locator(".sr-modal");
  await budget.getByLabel("启用渠道预算").check();
  await budget.getByLabel("日请求上限（次）", { exact: true }).fill("25");
  await budget.getByRole("button", { name: "更新配额" }).click();
  await budget.waitFor({ state: "hidden" });
  await feedNav.click();
  await page.getByRole("heading", { name: "资讯信息流源", exact: true }).waitFor();
  await scheduleDueSourcesOnce(db.pool, [feed]);
  assert.equal(await workOnce(db.pool, [feed]), true);
  await page.goto(origin + "/sources?sourceId=" + createdFeed.id);
  await page.getByText("上次运行新增入库 1 条。", { exact: true }).waitFor();
  const stored = await page.request.get(origin + "/api/v1/content?sourceId=" + createdFeed.id);
  assert.ok((await stored.json()).items.some((item: { title: string }) => item.title === articleTitle));

  await page.getByRole("button", { name: "查看此来源的任务" }).click();
  await page.getByRole("heading", { name: "全站采集任务", exact: true }).waitFor();
  assert.equal(await jobsNav.getAttribute("aria-current"), "page");
  assert.equal(await page.getByLabel("按来源筛选").inputValue(), createdFeed.id);
  await page.getByRole("columnheader", { name: "渠道请求" }).waitFor();
  await page.getByText("定时采集", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator(".collection-table-scroll").evaluate(region => region.scrollWidth > region.clientWidth));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goBack();
  assert.equal(await sourceNav.getAttribute("aria-current"), "page");
  await nav.getByRole("button", { name: "AI 发布审核队列", exact: true }).click();
  assert.equal(await nav.getByRole("button", { name: "AI 发布审核队列", exact: true }).getAttribute("aria-current"), "page");
  assert.equal(await page.locator(".rail").getByRole("button", { name: "AI 发布审核队列" }).count(), 0);
  await page.getByRole("button", { name: "官方来源与注册表" }).click();
  await page.getByLabel("Web 来源", { exact: true }).selectOption(createdFeed.id);
  await page.getByLabel("厂商", { exact: true }).selectOption({ label: "OpenAI" });
  await page.getByRole("button", { name: "保存厂商关联" }).click();
  await page.getByText("厂商关联已保存。").waitFor();
  await page.getByText(/官方测试 Feed · OpenAI · blog/).waitFor();
  await page.getByRole("button", { name: "打开官方发现与自动化" }).click();
  await page.getByRole("button", { name: "执行影子评估" }).click();
  await page.getByText(/进入审核 · 1/).waitFor();
  await page.getByRole("button", { name: "异常审核队列" }).click();
  await page.getByLabel("按状态筛选").selectOption("needs_info");
  await page.getByText(articleTitle, { exact: true }).click();
  await page.getByLabel(/官方日期/).fill(new Date().toISOString().slice(0, 10));
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByText("候选草稿已保存。").waitFor();
  await page.getByRole("button", { name: "发布到 /ai" }).click();
  await page.getByText(/已发布事件 [0-9a-f-]+/).waitFor();
  const events = await page.request.get(origin + "/api/v1/ai/events");
  assert.ok((await events.json()).items.some((item: { title: string }) => item.title === articleTitle));

  await page.goto(origin + "/sources");
  await page.getByRole("button", { name: "批量导入来源" }).click();
  const sourceImport = page.getByRole("dialog", { name: "批量导入来源" });
  await sourceImport.getByLabel("OPML Feed 列表").fill('<opml><body><outline text="Workbench">' +
    '<outline text="Duplicate" xmlUrl="' + feedUrl + '"/>' +
    '<outline text="Imported" xmlUrl="https://example.test/atom"/>' +
    '<outline text="Invalid" xmlUrl="http://127.0.0.1/feed"/></outline></body></opml>');
  await sourceImport.getByRole("button", { name: "导入来源" }).click();
  await sourceImport.getByText(/已创建 1 · 重复跳过 1 · 错误 1/).waitFor();
  await sourceImport.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "新建来源" }).click();
  await modal.getByLabel("平台", { exact: true }).selectOption("bluesky");
  assert.equal(await modal.getByRole("button", { name: "创建来源" }).isDisabled(), true);
  await modal.getByText("请在渠道设置中检查服务联网与凭证。").waitFor();
  await modal.getByLabel("平台", { exact: true }).selectOption("web");
  await modal.getByLabel("主渠道").selectOption("newsnow");
  await modal.getByLabel("NewsNow 榜单").selectOption("github-trending");
  await modal.getByLabel("来源名称").fill("GitHub Trending UI fixture");
  await modal.getByRole("button", { name: "创建来源" }).click();
  await page.locator(".collection-panel-header").getByText("github-trending", { exact: true }).waitFor();
  await page.getByRole("button", { name: "新建来源" }).click();
  await modal.getByLabel("平台", { exact: true }).selectOption("reddit");
  await modal.getByLabel("来源名称").fill("Reddit UI fixture");
  await modal.getByLabel("Reddit 版块", { exact: true }).fill("LocalLLaMA");
  await modal.getByRole("button", { name: "预览来源" }).click();
  await modal.getByText(/配置已校验/).waitFor();
  await modal.getByRole("button", { name: "创建来源" }).click();
  await page.locator(".collection-panel-header").getByText("localllama", { exact: true }).waitFor();
  await page.getByRole("link", { name: "管理服务商密钥" }).click();
  const twitterKey = page.getByRole("region", { name: "TwitterAPIs" });
  await twitterKey.getByLabel("设置 / 轮换密钥（只写）").fill(fixtureKey);
  await twitterKey.getByRole("button", { name: "保存密钥" }).click();
  await twitterKey.getByText(/密钥已保存/).waitFor();
  await page.goto(origin + "/sources");
  const channel = page.getByLabel("采集渠道", { exact: true });
  await channel.selectOption("twitterapis");
  await page.getByText("此渠道还没有已配置的来源。").waitFor();
  await page.getByRole("button", { name: "新建此渠道来源" }).click();
  assert.equal(await modal.getByLabel("平台", { exact: true }).inputValue(), "x");
  assert.equal(await modal.getByLabel("主渠道", { exact: true }).inputValue(), "twitterapis");
  await modal.getByLabel("来源名称").fill("X UI fixture");
  await modal.getByLabel("账号名称", { exact: true }).fill("example");
  await modal.getByRole("button", { name: "创建来源" }).click();
  await page.locator(".collection-panel-header").getByText("example", { exact: true }).waitFor();
  await page.getByLabel("查找来源", { exact: true }).fill("X UI fixture");
  await page.getByRole("heading", { name: "手动采集" }).waitFor();
  assert.equal(await page.getByLabel("采集上限").getAttribute("max"), "20");
  assert.equal(await page.getByLabel("同时采集评论").count(), 0);
  await page.getByText(/首次渠道执行 · 1 次请求 \/ 20 单位预留资源/).waitFor();
  const submitCollection = page.getByRole("button", { name: "提交采集任务" });
  assert.equal(await submitCollection.isDisabled(), true);
  await page.getByRole("button", { name: "调整此渠道预算" }).click();
  const xBudget = page.getByRole("dialog", { name: /调整渠道预算 · twitterapis/ });
  await xBudget.getByLabel("启用渠道预算").check();
  await xBudget.getByLabel("日请求上限（次）").fill("2");
  await xBudget.getByLabel("月请求上限（次）").fill("5");
  await xBudget.getByLabel("日资源上限（单位）").fill("19");
  await xBudget.getByLabel("月资源上限（单位）").fill("100");
  await xBudget.getByRole("button", { name: "更新配额" }).click();
  await page.getByText(/本次执行需预留 20 单位/).waitFor();
  assert.equal(await submitCollection.isDisabled(), true);
  await page.getByRole("button", { name: "调整此渠道预算" }).click();
  await xBudget.getByLabel("日资源上限（单位）").fill("40");
  await xBudget.getByRole("button", { name: "更新配额" }).click();
  await submitCollection.click();
  const queued = page.getByRole("dialog", { name: /任务详情/ });
  await queued.getByText("等待采集 Worker 执行。").waitFor();
  assert.equal(await workOnce(db.pool, [x]), true);
  await queued.getByText("处理 / 新增 / 更新 · 1 / 1 / 0").waitFor();
  const storageLink = await queued.getByRole("link", { name: "查询该来源的已入库内容" }).getAttribute("href");
  const monitoringLink = await queued.getByRole("link", { name: "将此来源纳入监测" }).getAttribute("href");
  assert.ok(storageLink && monitoringLink);
  const followup = await context.newPage();
  await followup.goto(origin + storageLink);
  const search = followup.getByPlaceholder(/输入检索词后回车/);
  await search.fill("TwitterAPIs workbench submission");
  await search.press("Enter");
  await followup.getByText(tweetText, { exact: true }).first().waitFor();
  await followup.goto(origin + monitoringLink);
  const projectModal = followup.getByRole("dialog", { name: "新建监测项目" });
  await projectModal.getByText(/此项目将使用所选来源.*X UI fixture/).waitFor();
  await projectModal.getByLabel(/项目名称/).fill("采集到分析验收");
  const createRequest = followup.waitForRequest(req => req.method() === "POST" && req.url().endsWith("/v1/projects"));
  const overviewResponse = followup.waitForResponse(res => /\/v1\/projects\/[^/]+\/overview$/.test(res.url()) && res.ok());
  await projectModal.getByRole("button", { name: "创建项目" }).click();
  const submittedProject = (await createRequest).postDataJSON();
  assert.equal(submittedProject.datasetMode, "source_filter");
  assert.deepEqual(submittedProject.sourceIds, [new URL(origin + monitoringLink).searchParams.get("sourceId")]);
  await followup.getByRole("heading", { name: "采集到分析验收" }).waitFor();
  const projectOverview = await (await overviewResponse).json();
  assert.equal(projectOverview.contentCount, 1);
  assert.ok(projectOverview.facets.some((facet: { platform?: string }) => facet.platform === "x"));
  await followup.getByRole("button", { name: "全部检索", exact: true }).click();
  assert.equal(new URL(followup.url()).searchParams.get("projectId"), projectOverview.project.id);
  await followup.getByText(tweetText, { exact: true }).first().waitFor();
  await followup.close();
  await queued.getByRole("button", { name: "关闭任务详情" }).click();

  await page.getByRole("button", { name: "新建来源" }).click();
  await modal.getByLabel("接入方式").selectOption("push");
  await modal.getByLabel("平台", { exact: true }).selectOption("reddit");
  await modal.getByLabel("来源名称").fill("内部研究样本");
  await modal.getByLabel("搜索词", { exact: true }).fill("人工智能工具");
  await modal.getByRole("button", { name: "创建来源" }).click();
  await page.locator(".collection-panel-header").getByText("人工智能工具", { exact: true }).waitFor();
  assert.equal(await page.getByText(/R4 离线归档检索与推流控制台/).count(), 0);
  await page.getByRole("button", { name: "编辑来源" }).click();
  await edit.getByLabel("Reddit 离线归档（R4）").check();
  await edit.getByRole("button", { name: "保存来源" }).click();
  await page.getByText(/R4 离线归档检索与推流控制台/).waitFor();
  await page.getByRole("button", { name: "自定义月份", exact: true }).click();
  await page.getByLabel(/自定义月份列表/).fill("2026-08");
  await page.getByLabel(/起始发布时间 UTC/).fill("2026-08-31T23:30");
  await page.getByLabel(/截止发布时间 UTC/).fill("2026-09-01T01:30");
  await page.locator("pre").filter({ hasText: "--from '2026-08-31T23:30:00.000Z'" }).waitFor();
  await page.getByRole("group", { name: "来源状态" }).getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByText("请启用当前来源后再推流。").waitFor();
  assert.equal(await page.getByRole("button", { name: "提交推流批次" }).isDisabled(), true);
  await page.getByRole("group", { name: "来源状态" }).getByRole("button", { name: "启用", exact: true }).click();
  await page.getByText(/来源状态已切换为 active/).waitFor();

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
  await page.getByText(/推流成功：接收 2 条（新增 2，更新 0）/).waitFor();
  await page.getByRole("button", { name: "任务详情", exact: true }).click();
  await page.getByText("处理 / 新增 / 更新 · 2 / 2 / 0").waitFor();
  await page.locator(".sr-modal").getByRole("button").first().click();

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
  await page.goto(origin + "/content?sourceId=" + sourceId);
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

  // 10. Settings -> Mint a source-scoped R4 ingest key
  const secondBrowser = await fetch(`${address}/v1/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@localhost", password: "fixture-password-123" }),
  });
  assert.equal(secondBrowser.status, 200);
  const otherCookie = secondBrowser.headers.get("set-cookie")!.split(";")[0];
  await page.locator(".rail").getByRole("button", { name: "账户与设置", exact: true }).click();
  const browserSessions = page.getByRole("region", { name: "已登录的浏览器" });
  await browserSessions.getByText("当前浏览器", { exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await browserSessions.locator(".toggle-line").filter({ has: page.getByText("浏览器", { exact: true }) })
    .getByRole("button", { name: "退出此浏览器" }).click();
  await browserSessions.getByText("浏览器已退出。").waitFor();
  const otherSession = await fetch(`${address}/v1/auth/session`, { headers: { cookie: otherCookie } });
  assert.equal((await otherSession.json()).user, null);
  await page.goto(origin + "/settings?tab=keys&archiveSource=" + sourceId);
  await page.getByRole("button", { name: "应用归档来源预设" }).click();
  assert.equal(await page.getByRole("checkbox", { name: "内部研究样本" }).isChecked(), true);
  await page.getByRole("button", { name: "生成机器密钥" }).click();
  const key = await page.locator(".wb-alert--warn code").innerText();
  const machineHeaders = { authorization: "Bearer " + key };
  const readRes = await fetch(address + "/v1/content?sourceId=" + sourceId, { headers: machineHeaders });
  assert.equal(readRes.status, 403);
  const machineIngest = (id: string) => fetch(address + "/v1/sources/" + id + "/ingest", {
    method: "POST",
    headers: { ...machineHeaders, "content-type": "application/json", "idempotency-key": "r4-fixture-receipt" },
    body: JSON.stringify({ items: [item] }),
  });
  assert.equal((await machineIngest(sourceId)).status, 201);
  assert.equal((await machineIngest(createdFeed.id)).status, 404);

  // 11. Projects -> Push exclusion & includePushInTrends toggle
  const pushProject = await page.request.post(origin + "/api/v1/projects", {
    headers: { origin },
    data: {
      name: "工具使用反馈", datasetMode: "source_filter", sourceIds: [sourceId],
      filter: { anyTerms: ["内部讨论"] }, threadAware: true, includePushInTrends: false,
    },
  });
  assert.equal(pushProject.status(), 200);
  const { id: pushProjectId } = await pushProject.json();
  await page.goto(origin + "/projects?view=overview&projectId=" + pushProjectId);
  await page.getByRole("heading", { name: "工具使用反馈" }).waitFor();
  assert.equal(await page.locator(".kpi .kpi-val").nth(1).innerText(), "0");

  await page.getByRole("button", { name: "编辑" }).click();
  await page.locator(".sr-modal").getByText(/高级分析过滤规则/).click();
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
  await page.locator(".rail").getByRole("button", { name: "资讯信息流", exact: true }).click();
  await nav.getByRole("button", { name: "公开首页" }).click();
  await page.getByRole("heading", { name: "重要变化，先一步发现。" }).waitFor();
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

  assert.deepEqual(serverErrors, ["API key scope does not permit this operation", "Source not found"]);
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

test("browser: email confirmation consumes the fragment only on submit and administrator login requires its second factor", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  const password = "fixture-browser-account-password";
  await bootstrapOwner(db.pool, password, "owner@example.test");
  const key = Buffer.alloc(32, 17);
  const userId = (await db.pool.query("SELECT id FROM app_user WHERE email='owner@example.test'")).rows[0].id;
  await provisionMfa(db.pool, userId, Buffer.alloc(20, 7), key, 0, false);
  const recoveryCode = "0123456789abcdef01234567";
  await db.pool.query("UPDATE app_auth_mfa SET recovery_hashes=$1 WHERE user_id=$2", [[tokenHash(recoveryCode)], userId]);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const createApp: typeof buildApp = process.env.TEST_COMPILED === "true"
    ? require("../../dist/apps/api/src/app.js").buildApp
    : buildApp;
  let linkToken = "";
  const app = await createApp({
    pool: db.pool, origin, secureCookies: false, publicRead: false,
    sessionSecret: "browser-account-security-fixture-secret", mfa: { key, required: true },
    accountEmail: { publicRegistration: true, provider: {
      siteKey: "fixture",
      verify: async (proof, action) => proof === "fixture-" + action,
      send: async (_email, _purpose, token) => { linkToken = token; return true; },
    } },
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  await launchVite(t, address, port, origin);
  const browser = await chromium.launch({ executablePath: resolveChromiumPath(), headless: true, args: ["--no-sandbox"] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route) =>
    route.fulfill({ contentType: "application/javascript", body:
      "window.turnstile = { render: (_, o) => { o.callback('fixture-' + o.action); return 'widget'; }, remove: () => {} };",
    }));
  await page.goto(origin);
  await page.getByRole("button", { name: "注册账号", exact: true }).click();
  await page.getByLabel("邮箱地址", { exact: true }).fill("browser-viewer@example.test");
  await page.getByRole("button", { name: "发送邮件链接" }).click();
  await page.getByText("如果符合条件，你将收到邮件。", { exact: false }).waitFor();
  assert.match(linkToken, /^[A-Za-z0-9_-]{43}$/);
  await page.goto(`${origin}/account/confirm#purpose=register&token=${linkToken}`);
  await page.getByRole("heading", { name: "确认账户请求" }).waitFor();
  assert.equal(new URL(page.url()).hash, "");
  assert.equal((await db.pool.query("SELECT 1 FROM app_user WHERE email='browser-viewer@example.test'")).rowCount, 0);
  await page.getByLabel(/新密码/).fill(password);
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByText("操作已完成，现在可以登录。", { exact: true }).waitFor();
  await page.getByRole("link", { name: "返回 SIFTLINE" }).click();
  await page.getByLabel("工作邮箱").fill("owner@example.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.getByLabel("验证器代码或恢复码").fill(recoveryCode);
  assert.equal((await page.context().cookies()).some((item) => item.name === "app_session"), false);
  await page.getByRole("button", { name: "验证并登录" }).click();
  await page.getByLabel("验证器代码或恢复码").waitFor({ state: "detached" });
  assert.ok((await page.context().cookies()).some((item) => item.name === "app_session"));
});

test("AI Release Intelligence Center (/ai timeline, drawer, /admin/queue) and public visual unification", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@localhost");

  // Seed one verified official release event so timeline + drawer + shareable URL are exercised end-to-end
  const vendorRes = await db.pool.query<{ id: string }>(
    `SELECT id FROM ai_vendor WHERE slug = 'anthropic' LIMIT 1`,
  );
  const vendorId = vendorRes.rows[0].id;
  const todayIso = new Date().toISOString().slice(0, 10);
  const evRes = await db.pool.query<{ id: string }>(
    `INSERT INTO ai_release_event (
       vendor_id, event_type, event_status, publication_status, title,
       event_date, date_precision, summary_zh, summary_en, source_tier
     ) VALUES ($1, 'model_release', 'released', 'published', 'Claude 4 Official E2E Release',
       $2::date, 'day', 'Anthropic 官方正式发布 Claude 4。', 'Anthropic officially released Claude 4.', 'official')
     RETURNING id`,
    [vendorId, todayIso],
  );
  const seededEventId = evRes.rows[0].id;
  await db.pool.query(
    `INSERT INTO ai_event_reference (event_id, title, url, source_kind, is_primary, verified_at)
     VALUES ($1, 'Introducing Claude 4', 'https://www.anthropic.com/news/claude-4', 'official', TRUE, NOW())`,
    [seededEventId],
  );

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
    rateLimitMax: 500,
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
  page.on("pageerror", (error) => errors.push(error.message));

  // 1. /ai timeline renders verified official event, clicking opens drawer with ?event=:id & official link
  await page.goto(`${origin}/ai`);
  await page.getByRole("heading", { name: "厂商 × 时间发布矩阵" }).waitFor();
  await page.getByRole("button", { name: "Claude 4 Official E2E Release" }).first().click();
  await page.getByRole("dialog").waitFor();
  assert.ok(page.url().includes(`event=${seededEventId}`), `Expected shareable URL with event=${seededEventId}`);
  await page.getByText("Introducing Claude 4").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });

  // 2. Honest empty state for unconfigured third-party rankings
  await page.getByText("外部授权评测数据源尚未配置").waitFor();

  // 3. Visual unification: zero horizontal overflow across /, /product, /docs, /ai at 1440, 768, 390
  const captureAfter = process.env.CAPTURE_VISUAL_AFTER === "1";
  const viewports = [
    { name: "1440", width: 1440, height: 900 },
    { name: "768", width: 768, height: 1024 },
    { name: "390", width: 390, height: 844 },
  ];
  const pagesToCheck = [
    { slug: "product", path: "/product" },
    { slug: "home", path: "/" },
    { slug: "docs", path: "/docs" },
    { slug: "ai", path: "/ai" },
  ];
  if (captureAfter) {
    const fs = await import("node:fs/promises");
    await fs.mkdir("output/validation/visual-after", { recursive: true });
  }
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const p of pagesToCheck) {
      await page.goto(`${origin}${p.path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 2, `Horizontal overflow on ${p.path} at ${vp.name}: ${overflow}px`);
      if (captureAfter) {
        await page.screenshot({
          path: `output/validation/visual-after/${p.slug}-${vp.name}.png`,
          fullPage: false,
        });
      }
    }
  }

  // 4. Owner login -> /admin/queue renders review queue & published events
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/admin/queue`);
  await page.getByRole("button", { name: "立即登录" }).click();
  await page.getByLabel("工作邮箱").fill("owner@localhost");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-123");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.getByRole("heading", { name: "AI 发布审核与台账队列" }).waitFor();
  await page.getByRole("button", { name: "已发布事件" }).click();
  await page.getByText("Claude 4 Official E2E Release").waitFor();

  assert.deepEqual(errors, []);
});
