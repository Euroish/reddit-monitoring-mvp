import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { testDatabase } from "../helpers/database";

const publicRoutes = ["/", "/product", "/ai", "/docs"];
const viewports = [
  { width: 1440, height: 900, columns: 4 },
  { width: 768, height: 1024, columns: 2 },
  { width: 390, height: 844, columns: 1 },
  { width: 320, height: 700, columns: 1 },
];

async function freePort() {
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

test("browser: editorial footer routes, responsive layout, language and workbench gate", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  const email = "footer-owner@example.test";
  const password = "footer-fixture-password";
  await bootstrapOwner(db.pool, password, email);

  const host = "127.0.0.1";
  const port = await freePort();
  const origin = `http://${host}:${port}`;
  const compiled = process.env.TEST_COMPILED === "true";
  const createApp: typeof buildApp = compiled
    ? require("../../dist/apps/api/src/app.js").buildApp
    : buildApp;
  const app = await createApp({
    pool: db.pool,
    sessionSecret: "editorial-footer-fixture-".repeat(3),
    origin,
    secureCookies: false,
    publicRead: true,
  });
  const address = await app.listen({ host, port: 0 });
  t.after(() => app.close());

  const root = path.resolve("apps/web");
  const webRequire = createRequire(path.join(root, "package.json"));
  const viteEntry = pathToFileURL(webRequire.resolve("vite")).href;
  const vite = await import(viteEntry) as typeof import("../../apps/web/node_modules/vite/dist/node/index.js");
  const options = {
    host,
    port,
    strictPort: true,
    proxy: { "/api": { target: address, rewrite: (url: string) => url.replace(/^\/api/, "") } },
  };
  const server = compiled
    ? await vite.preview({ root, preview: options })
    : await vite.createServer({ root, server: options }).then((server) => server.listen());
  t.after(() => server.close());

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: viewports[0] });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const footer = page.locator(".ef-footer");
  const language = footer.getByRole("combobox");
  const tagline = footer.getByText("DISCOVER WHAT MATTERS.", { exact: true });
  for (const route of publicRoutes) {
    await page.goto(origin + route);
    await tagline.waitFor();
    assert.equal(await page.locator("footer").count(), 1, route);
    assert.doesNotMatch(await footer.innerText(), /stored_sample|Logo Explorer/);
  }

  await page.goto(origin + "/product");
  for (const { width, height, columns } of viewports) {
    await page.setViewportSize({ width, height });
    for (const lang of ["zh", "en"]) {
      await language.selectOption(lang);
      const layout = await footer.evaluate((element) => {
        const grid = element.querySelector(".ef-links-grid")!;
        const wordmark = element.querySelector(".ef-wordmark")!;
        const range = document.createRange();
        range.selectNodeContents(wordmark);
        const { left, right } = range.getBoundingClientRect();
        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          wordmarkFits: left >= 0 && right <= innerWidth,
          pageFits: document.documentElement.scrollWidth <= innerWidth,
          languageInLegal: !!element.querySelector(".ef-legal select"),
        };
      });
      assert.deepEqual(layout, { columns, wordmarkFits: true, pageFits: true, languageInLegal: true }, `${width}px / ${lang}`);
    }
  }

  await page.setViewportSize(viewports[0]);
  await language.focus();
  await page.keyboard.press("ArrowUp");
  assert.equal(await language.inputValue(), "zh");
  assert.equal(await language.evaluate((element) => getComputedStyle(element).outlineStyle), "solid");
  await page.getByRole("navigation", { name: "公开导航", exact: true }).waitFor();
  await language.selectOption("en");
  await page.getByRole("navigation", { name: "Public navigation", exact: true }).waitFor();

  const links = [
    ["Information Feed", "/"],
    ["Explore AI News", "/ai"],
    ["Product Overview", "/product"],
    ["AI News", "/ai"],
    ["Documentation", "/docs"],
    ["Data Sources & Coverage", "/docs"],
    ["Product Guide", "/guide"],
    ["User Instructions", "/guide"],
  ] as const;
  for (const [label, target] of links) {
    await page.goto(origin + "/product");
    await footer.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL(origin + target);
    if (target === "/docs" && label === "Data Sources & Coverage") {
      await page.getByRole("button", { name: /10 个章节/ }).waitFor();
    }
    if (target === "/guide") {
      await page.locator(".gd-root").waitFor();
      assert.equal(await footer.count(), 0);
    }
  }

  await page.goto(origin + "/product");
  await language.selectOption("zh");
  await page.evaluate(() => localStorage.setItem("siftline.themeId", "midnight-ocean-teal"));
  await page.reload();
  await tagline.waitFor();
  const surface = footer.locator(".ef-links-surface");
  assert.equal(await surface.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
  assert.equal(await surface.evaluate((element) => getComputedStyle(element).color), "rgb(17, 27, 17)");

  await footer.getByRole("link", { name: "打开工作台", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("请登录以进入监测工作台。").waitFor();
  assert.equal(new URL(page.url()).pathname, "/product");
  await dialog.getByLabel("工作邮箱").fill(email);
  await dialog.getByLabel("密码", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "登录工作台" }).click();
  await page.waitForURL(origin + "/projects");
  await page.getByRole("heading", { name: "监测总览" }).waitFor();

  await page.goto(origin + "/");
  await footer.getByRole("link", { name: "打开工作台", exact: true }).click();
  await page.waitForURL(origin + "/projects");
  assert.equal(await dialog.count(), 0);
  for (const route of ["/app/feed", "/projects", "/content", "/sources"]) {
    await page.goto(origin + route);
    await page.getByLabel("工作台导航", { exact: true }).waitFor();
    assert.equal(await footer.count(), 0, route);
  }
  assert.deepEqual(errors, []);
});
