import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
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
test("browser: keyboard login, five navigation tasks, saved query and responsive layouts", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  const app = await buildApp({
    pool: db.pool,
    sessionSecret: "synthetic-secret-".repeat(3),
    origin,
    secureCookies: false,
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  const vite = spawn(
    "npm",
    [
      "--prefix",
      "apps/web",
      "run",
      "dev",
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
      if (process.platform !== "win32" && vite.pid)
        process.kill(-vite.pid, "SIGTERM");
      else vite.kill("SIGTERM");
    } catch {
      /* Process already exited. */
    }
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Vite startup timeout")),
      20000,
    );
    vite.stdout.on("data", (chunk) => {
      if (chunk.toString().includes(origin)) {
        clearTimeout(timer);
        resolve();
      }
    });
    vite.once("exit", (code) => {
      clearTimeout(timer);
      if (code) reject(Error(`Vite exit ${code}`));
    });
  });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  assert.equal(await page.title(), "信号研究");
  await page.getByLabel("邮箱").fill("owner@example.test");
  await page.keyboard.press("Tab");
  await page.keyboard.type("fixture-password-123");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "监测项目" }).waitFor();
  await page.getByRole("link", { name: "来源", exact: true }).click();
  await page.getByRole("button", { name: "添加来源" }).click();
  await page.getByLabel("来源名称").fill("内部研究样本");
  await page.getByLabel("采集方式").selectOption("external_ingest");
  await page.getByLabel("样本主题").fill("人工智能工具");
  await page.getByRole("button", { name: "保存来源" }).click();
  await page
    .getByRole("heading", { name: "内部研究样本", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /内部研究样本/ }).click();
  const sourceResponse = await page.request.get(`${origin}/api/v1/sources`);
  const sourceId = (await sourceResponse.json()).sources[0].id;
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
  await page
    .getByLabel("导入规范 JSON 文件")
    .setInputFiles({
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
  await page.keyboard.press("Escape");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载当前结果" }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "content.json");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  page.once("dialog", (dialog) => {
    void dialog.accept("常用研究查询");
  });
  await page.getByRole("button", { name: "保存查询" }).click();
  await page.getByRole("link", { name: "我的研究", exact: true }).click();
  await page.getByRole("button", { name: "常用研究查询 →" }).waitFor();
  await page.getByText("保留这条研究判断", { exact: true }).waitFor();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await page.getByRole("heading", { name: "当前账户" }).waitFor();
  await page.getByRole("link", { name: "项目", exact: true }).click();
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByLabel("研究主题").fill("工具使用反馈");
  await page.getByLabel("任一提及").fill("内部");
  await page.getByRole("checkbox", { name: "内部研究样本" }).check();
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await page.getByRole("button", { name: /工具使用反馈/ }).click();
  await page.getByText("已存命中内容", { exact: true }).waitFor();
  assert.equal(await page.locator(".big-number").innerText(), "2");
  await mkdir("output/validation/kernel", { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("link", { name: "项目", exact: true }).click();
    assert.equal(
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("link")
        .count(),
      5,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${viewport.width}px overflow`,
    );
    await page.screenshot({
      path: `output/validation/kernel/workbench-${viewport.width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
});
