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

test("browser: public landing, modal login, workbench workflows, R4 push & responsive layouts", async (t) => {
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
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
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
  const deadline = Date.now() + 25000;
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

  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (existsSync(chromium.executablePath())
      ? undefined
      : [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ].find((p) => existsSync(p)));

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const scripts: string[] = [];
  page.on("request", (req) => { if (req.resourceType() === "script") scripts.push(req.url()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(origin);
  assert.equal(await page.title(), "SIFTLINE · 信号研究");
  assert.ok(scripts.every((url) => !/echarts|EChartCanvas/.test(url)), `Unexpected ECharts script on /: ${scripts.join(", ")}`);

  // 1. Public Homepage -> Login Modal -> Workbench (/projects)
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("工作邮箱").fill("owner@localhost");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password-123");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.getByRole("heading", { name: "监测总览" }).waitFor();

  // 2. Sources -> Create Push Source & UI Ingest
  await page.getByRole("button", { name: /来源列表/ }).click();
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
  const sourceId = (await sourceResponse.json()).sources[0].id as string;
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

  // 3. Content Explorer -> Annotation + Thread Tree + Stream Export + Save Query
  const nav = page.getByLabel("工作台导航");
  await nav.getByRole("button", { name: "内容检索" }).click();
  await page.getByText("研究证据").first().click();
  const drawer = page.locator(".drawer-panel");
  await drawer.getByRole("button", { name: /研究批注/ }).click();
  await drawer.getByRole("checkbox", { name: "标星收藏为高价值证据" }).check();
  await drawer.locator("textarea.wb-textarea").fill("保留这条研究判断");
  await drawer.getByRole("button", { name: "保存批注" }).click();
  await drawer.getByText(/批注已保存/).waitFor();

  await drawer.getByRole("button", { name: /讨论树/ }).click();
  await drawer.getByText("内部讨论的补充评论。").waitFor();
  await drawer.locator("header button").first().click();

  await page.getByRole("button", { name: "流式导出" }).click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "开始校验并导出" }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "content.json");

  await page.getByRole("button", { name: "保存查询" }).click();
  await page.getByPlaceholder("例如：账单波动痛点 · 近30天").fill("常用研究查询");
  await page.getByRole("button", { name: "确认保存" }).click();
  await page.getByText("已保存查询至个人工作区。").waitFor();

  // 4. Personal Workspace verification
  await nav.getByRole("button", { name: /保存的查询/ }).click();
  await page.getByText("常用研究查询").waitFor();
  await nav.getByRole("button", { name: /批注与收藏/ }).click();
  await page.getByText("保留这条研究判断").waitFor();

  // 5. Settings -> Mint R4 ingest + read machine key
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

  // 6. Projects -> Push exclusion & includePushInTrends toggle
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

  // 7. Responsive checks across desktop / tablet / mobile
  await mkdir("output/validation/kernel", { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(150);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${viewport.width}px horizontal overflow detected`,
    );
    await page.screenshot({
      path: `output/validation/kernel/semrush-workbench-${viewport.width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
});
