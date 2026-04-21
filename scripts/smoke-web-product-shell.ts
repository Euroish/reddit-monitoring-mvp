import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { chromium, type Page } from "playwright";
import { createApiServer } from "../apps/api/src/create-api-server";
import { RedditMockConnector } from "../src/connectors/reddit/reddit-mock.connector";
import { PasswordHashingService } from "../src/application/services/password-hashing.service";
import {
  InMemoryAccountRepository,
  InMemoryAppInviteRepository,
  InMemoryAppSessionRepository,
  InMemoryAppUserRepository,
  InMemoryAnomalyEventRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryCrawlCursorRepository,
  InMemoryKeywordQuerySessionRepository,
  InMemoryKeywordTrendDailyRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryPostGrowthFactRepository,
  InMemoryPostSearchDocumentRepository,
  InMemoryProviderHealthWindowRepository,
  InMemoryRawEventRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../src/storage/repositories/in-memory/in-memory.repositories";
import { stableUuidFromString } from "../src/shared/ids/stable-id";

const API_PORT = 3000;
const WEB_PORT = 5173;
const FIXED_NOW = "2026-04-20T08:30:00.000Z";
const OWNER_EMAIL = "owner@example.com";
const OWNER_PASSWORD = "owner-password";
const VIEWER_EMAIL = "viewer@example.com";
const VIEWER_PASSWORD = "viewer-password";

function createSmokeRepositories() {
  const appInviteRepository = new InMemoryAppInviteRepository();
  const appUserRepository = new InMemoryAppUserRepository();
  appUserRepository.attachInviteRepository(appInviteRepository);

  return {
    monitorTargetRepository: new InMemoryMonitorTargetRepository(),
    collectionJobRepository: new InMemoryCollectionJobRepository(),
    crawlCursorRepository: new InMemoryCrawlCursorRepository(),
    rawEventRepository: new InMemoryRawEventRepository(),
    accountRepository: new InMemoryAccountRepository(),
    appUserRepository,
    appInviteRepository,
    appSessionRepository: new InMemoryAppSessionRepository(),
    anomalyEventRepository: new InMemoryAnomalyEventRepository(),
    contentRepository: new InMemoryContentRepository(),
    keywordTrendDailyRepository: new InMemoryKeywordTrendDailyRepository(),
    keywordQuerySessionRepository: new InMemoryKeywordQuerySessionRepository(),
    postSearchDocumentRepository: new InMemoryPostSearchDocumentRepository(),
    postGrowthFactRepository: new InMemoryPostGrowthFactRepository(),
    metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
    subredditDailyFactRepository: new InMemorySubredditDailyFactRepository(),
    subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    providerHealthWindowRepository: new InMemoryProviderHealthWindowRepository(),
  };
}

async function seedSmokeData(repos: ReturnType<typeof createSmokeRepositories>) {
  const passwordHashingService = new PasswordHashingService();
  const ownerId = randomUUID();
  const viewerId = randomUUID();
  const datascienceTargetId = stableUuidFromString("reddit:target:r/datascience");
  const machineLearningTargetId = stableUuidFromString("reddit:target:r/machinelearning");

  await repos.appUserRepository.create(
    {
      id: ownerId,
      email: OWNER_EMAIL,
      displayName: "Owner",
      role: "owner",
      status: "active",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    },
    {
      userId: ownerId,
      passwordHash: await passwordHashingService.hashPassword(OWNER_PASSWORD),
      passwordAlgo: passwordHashingService.passwordAlgo,
      updatedAt: FIXED_NOW,
    },
  );
  await repos.appUserRepository.create(
    {
      id: viewerId,
      email: VIEWER_EMAIL,
      displayName: "Viewer",
      role: "viewer",
      status: "active",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    },
    {
      userId: viewerId,
      passwordHash: await passwordHashingService.hashPassword(VIEWER_PASSWORD),
      passwordAlgo: passwordHashingService.passwordAlgo,
      updatedAt: FIXED_NOW,
    },
  );

  for (const [targetId, canonicalName] of [
    [datascienceTargetId, "r/datascience"],
    [machineLearningTargetId, "r/machinelearning"],
  ] as const) {
    await repos.monitorTargetRepository.upsert({
      id: targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName,
      status: "active",
      config: {},
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
  }

  await repos.subredditTrendPointRepository.upsertMany([
    {
      targetId: datascienceTargetId,
      windowStart: "2026-04-20T06:00:00.000Z",
      windowEnd: "2026-04-20T12:00:00.000Z",
      granularity: "6h",
      newPosts: 42,
      sampledPostCount: 18,
      deltaNewPostsVsPrevWindow: 14,
      deltaActiveUsersVsPrevWindow: 8,
      heatChangePct: 0.42,
      heatIndex: 84,
      surgeScore: 2.4,
      dispersionScore: 0.7,
      trendScore: 91,
      algorithmVersion: "web_smoke",
    },
    {
      targetId: machineLearningTargetId,
      windowStart: "2026-04-20T06:00:00.000Z",
      windowEnd: "2026-04-20T12:00:00.000Z",
      granularity: "6h",
      newPosts: 31,
      sampledPostCount: 12,
      deltaNewPostsVsPrevWindow: 6,
      deltaActiveUsersVsPrevWindow: 4,
      heatChangePct: 0.2,
      heatIndex: 68,
      surgeScore: 1.5,
      dispersionScore: 0.4,
      trendScore: 70,
      algorithmVersion: "web_smoke",
    },
  ]);

  await repos.subredditDailyFactRepository.upsertMany([
    {
      targetId: datascienceTargetId,
      day: "2026-04-18",
      postVolume: 24,
      qualifiedPostVolume: 8,
      sampledPostVolume: 24,
      scoreSum: 260,
      commentSum: 90,
      subscriberCount: 125_000,
      activeUserCount: 1_900,
      activePostRatio: 0.72,
      dispersionScore: 0.5,
      impactScoreSum: 140,
      impactPostVolume: 7,
      topImpactShare: 0.4,
      heatPrice: 52,
      heatChangePct: 0,
      ema7: 50,
      ema30: 47,
      subredditTier: "mid",
      qualityThresholdScore: 20,
      qualityThresholdComments: 8,
      algorithmVersion: "web_smoke",
      explainPayload: {},
    },
    {
      targetId: datascienceTargetId,
      day: "2026-04-19",
      postVolume: 29,
      qualifiedPostVolume: 10,
      sampledPostVolume: 29,
      scoreSum: 340,
      commentSum: 120,
      subscriberCount: 126_200,
      activeUserCount: 2_100,
      activePostRatio: 0.76,
      dispersionScore: 0.58,
      impactScoreSum: 180,
      impactPostVolume: 8,
      topImpactShare: 0.44,
      heatPrice: 61,
      heatChangePct: 0.17,
      ema7: 55,
      ema30: 49,
      subredditTier: "mid",
      qualityThresholdScore: 20,
      qualityThresholdComments: 8,
      algorithmVersion: "web_smoke",
      explainPayload: {},
    },
    {
      targetId: datascienceTargetId,
      day: "2026-04-20",
      postVolume: 36,
      qualifiedPostVolume: 13,
      sampledPostVolume: 36,
      scoreSum: 460,
      commentSum: 160,
      subscriberCount: 127_500,
      activeUserCount: 2_450,
      activePostRatio: 0.81,
      dispersionScore: 0.68,
      impactScoreSum: 230,
      impactPostVolume: 10,
      topImpactShare: 0.49,
      heatPrice: 78,
      heatChangePct: 0.28,
      ema7: 61,
      ema30: 52,
      subredditTier: "mid",
      qualityThresholdScore: 20,
      qualityThresholdComments: 8,
      algorithmVersion: "web_smoke",
      explainPayload: {},
    },
  ]);

  await repos.postSearchDocumentRepository.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:web-smoke:query-a"),
      targetId: datascienceTargetId,
      canonicalSubreddit: "r/datascience",
      title: "LLM agent benchmark for production analytics teams",
      bodySnippet: "Discussion of LLM agent workflow evaluation for analytics operations.",
      permalink: "/r/datascience/comments/web_smoke_query_a",
      createdAtSource: "2026-04-20T07:00:00.000Z",
    },
    {
      contentId: stableUuidFromString("reddit:content:web-smoke:query-b"),
      targetId: machineLearningTargetId,
      canonicalSubreddit: "r/machinelearning",
      title: "LLM agent orchestration patterns for model monitoring",
      bodySnippet: "A practical thread on agent orchestration and monitoring signals.",
      permalink: "/r/machinelearning/comments/web_smoke_query_b",
      createdAtSource: "2026-04-20T07:15:00.000Z",
    },
  ]);
}

async function listen(server: Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function stopWebServer(webServer: ChildProcessWithoutNullStreams) {
  if (webServer.killed) return;
  if (process.platform === "win32" && webServer.pid) {
    spawnSync("taskkill", ["/PID", String(webServer.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  webServer.kill();
  await Promise.race([
    once(webServer, "exit").catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}

function startWebServer(): ChildProcessWithoutNullStreams {
  if (process.platform === "win32") {
    return spawn(
      "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        `npm --prefix apps/web run dev -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, BROWSER: "none" },
      },
    );
  }

  return spawn(
    "npm",
    ["--prefix", "apps/web", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"],
    {
      cwd: process.cwd(),
      env: { ...process.env, BROWSER: "none" },
    },
  );
}

async function waitForHttp(url: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

async function fillByLabel(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`http://127.0.0.1:${WEB_PORT}/login`);
  await fillByLabel(page, "Email", email);
  await fillByLabel(page, "Password", password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  if (metrics.scrollWidth > metrics.innerWidth + 1) {
    throw new Error(`${label} overflowed horizontally: ${metrics.scrollWidth} > ${metrics.innerWidth}`);
  }
}

async function runOwnerDesktopFlow(page: Page) {
  console.log("web smoke: owner login");
  await loginAs(page, OWNER_EMAIL, OWNER_PASSWORD);
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await assertNoHorizontalOverflow(page, "desktop dashboard");

  console.log("web smoke: queries");
  await page.getByRole("link", { name: "Queries" }).click();
  await page.getByRole("heading", { name: "Queries" }).waitFor();
  await fillByLabel(page, "Keyword", "LLM agent");
  await fillByLabel(page, "Subreddit", "datascience");
  await fillByLabel(page, "Sample limit", "5");
  await page.getByRole("button", { name: "Run query" }).click();
  await page.getByRole("heading", { name: "Matching Posts" }).waitFor();
  await page.getByText("LLM agent benchmark for production analytics teams").waitFor();
  await assertNoHorizontalOverflow(page, "desktop queries");

  console.log("web smoke: target detail");
  await page.getByRole("link", { name: "r/datascience" }).first().click();
  await page.getByRole("heading", { name: "Heat Trend" }).waitFor();
  await page.locator("svg").first().waitFor();
  await assertNoHorizontalOverflow(page, "desktop target detail");

  console.log("web smoke: ops");
  await page.getByRole("link", { name: "Ops" }).click();
  await page.getByRole("heading", { name: "Operations" }).waitFor();
  await page.getByText("Overall Status").waitFor();
  await fillByLabel(page, "Subreddit", "datascience");
  await fillByLabel(page, "Post limit", "12");
  await page.getByRole("button", { name: "Queue run" }).click();
  await page.getByText("Run queued").waitFor();
  await assertNoHorizontalOverflow(page, "desktop ops");

  console.log("web smoke: logout redirect");
  await page.getByRole("button", { name: "Logout" }).click();
  await page.getByRole("heading", { name: "Sign in to Analytics" }).waitFor();
  await page.goto(`http://127.0.0.1:${WEB_PORT}/dashboard`);
  await page.getByRole("heading", { name: "Sign in to Analytics" }).waitFor();
}

async function runViewerGuardFlow(page: Page) {
  console.log("web smoke: viewer guard");
  await loginAs(page, VIEWER_EMAIL, VIEWER_PASSWORD);
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  if ((await page.getByRole("link", { name: "Ops" }).count()) !== 0) {
    throw new Error("Viewer unexpectedly saw Ops navigation");
  }
  await page.goto(`http://127.0.0.1:${WEB_PORT}/ops`);
  await page.getByRole("heading", { name: "Access Denied" }).waitFor();
}

async function runMobileReview(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  console.log("web smoke: mobile responsive review");
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobilePage.setDefaultTimeout(15_000);

  try {
    await loginAs(mobilePage, OWNER_EMAIL, OWNER_PASSWORD);
    await mobilePage.getByRole("heading", { name: "Dashboard" }).waitFor();
    await assertNoHorizontalOverflow(mobilePage, "mobile dashboard");

    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/queries`);
    await mobilePage.getByRole("heading", { name: "Queries" }).waitFor();
    await assertNoHorizontalOverflow(mobilePage, "mobile queries");

    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/target/datascience`);
    await mobilePage.getByRole("heading", { name: "Heat Trend" }).waitFor();
    await mobilePage.locator("svg").first().waitFor();
    await assertNoHorizontalOverflow(mobilePage, "mobile target detail");

    await mobilePage.goto(`http://127.0.0.1:${WEB_PORT}/ops`);
    await mobilePage.getByRole("heading", { name: "Operations" }).waitFor();
    await assertNoHorizontalOverflow(mobilePage, "mobile ops");
  } finally {
    await mobilePage.close();
  }
}

async function runBrowserSmoke() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];

  try {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const text = message.text();
      const expectedAuthProbe = text.includes("Failed to load resource") && text.includes("401");
      if (message.type() === "error" && !expectedAuthProbe) errors.push(text);
    });

    await runOwnerDesktopFlow(page);
    await runViewerGuardFlow(page);
    await runMobileReview(browser);

    if (errors.length > 0) {
      throw new Error(`Browser smoke saw console/page errors: ${errors.join(" | ")}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const repos = createSmokeRepositories();
  await seedSmokeData(repos);

  const apiServer = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => FIXED_NOW,
  });
  let webServer: ChildProcessWithoutNullStreams | null = null;

  try {
    await listen(apiServer, API_PORT);
    webServer = startWebServer();
    const webExit = once(webServer, "exit").then(([code]) => {
      throw new Error(`Vite dev server exited early with code ${String(code)}`);
    });
    const webReady = waitForHttp(`http://127.0.0.1:${WEB_PORT}/login`, 30_000);
    await Promise.race([webReady, webExit]);
    await runBrowserSmoke();
    console.log(
      JSON.stringify({
        ok: true,
        checked: [
          "owner session persistence",
          "queries",
          "target chart svg",
          "ops readiness",
          "ops trigger",
          "logout redirect",
          "viewer ops guard",
          "mobile responsive review",
        ],
        finalUrl: `http://127.0.0.1:${WEB_PORT}/ops`,
      }),
    );
  } finally {
    if (webServer) {
      await stopWebServer(webServer);
    }
    await closeServer(apiServer);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
