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

const API_PORT = Number(process.env.SMOKE_API_PORT ?? 3000);
const WEB_PORT = Number(process.env.SMOKE_WEB_PORT ?? 5173);
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
    {
      targetId: machineLearningTargetId,
      day: "2026-04-18",
      postVolume: 20,
      qualifiedPostVolume: 7,
      sampledPostVolume: 20,
      scoreSum: 240,
      commentSum: 80,
      subscriberCount: 2_900_000,
      activeUserCount: 4_200,
      activePostRatio: 0.7,
      dispersionScore: 0.52,
      impactScoreSum: 130,
      impactPostVolume: 6,
      topImpactShare: 0.38,
      heatPrice: 64,
      heatChangePct: 0,
      ema7: 61,
      ema30: 58,
      subredditTier: "large",
      qualityThresholdScore: 20,
      qualityThresholdComments: 8,
      algorithmVersion: "web_smoke",
      explainPayload: {},
    },
    {
      targetId: machineLearningTargetId,
      day: "2026-04-19",
      postVolume: 25,
      qualifiedPostVolume: 9,
      sampledPostVolume: 25,
      scoreSum: 310,
      commentSum: 102,
      subscriberCount: 2_901_000,
      activeUserCount: 4_450,
      activePostRatio: 0.73,
      dispersionScore: 0.56,
      impactScoreSum: 160,
      impactPostVolume: 7,
      topImpactShare: 0.41,
      heatPrice: 72,
      heatChangePct: 0.13,
      ema7: 65,
      ema30: 60,
      subredditTier: "large",
      qualityThresholdScore: 20,
      qualityThresholdComments: 8,
      algorithmVersion: "web_smoke",
      explainPayload: {},
    },
    {
      targetId: machineLearningTargetId,
      day: "2026-04-20",
      postVolume: 31,
      qualifiedPostVolume: 12,
      sampledPostVolume: 31,
      scoreSum: 410,
      commentSum: 140,
      subscriberCount: 2_902_000,
      activeUserCount: 4_900,
      activePostRatio: 0.78,
      dispersionScore: 0.62,
      impactScoreSum: 210,
      impactPostVolume: 9,
      topImpactShare: 0.47,
      heatPrice: 88,
      heatChangePct: 0.22,
      ema7: 72,
      ema30: 63,
      subredditTier: "large",
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

  const driverContentId = stableUuidFromString("reddit:content:web-smoke:driver-a");
  await repos.contentRepository.upsertMany([
    {
      id: driverContentId,
      source: "reddit",
      targetId: datascienceTargetId,
      externalId: "t3_web_smoke_driver_a",
      kind: "post",
      title: "Vector database benchmark drives analytics workflow discussion",
      bodyText: "A fast-moving thread about vector database benchmarks and production analytics.",
      permalink: "/r/datascience/comments/web_smoke_driver_a",
      createdAtSource: "2026-04-20T06:45:00.000Z",
      firstSeenAt: "2026-04-20T06:50:00.000Z",
      lastSeenAt: "2026-04-20T08:00:00.000Z",
    },
  ]);

  await repos.postGrowthFactRepository.upsertMany([
    {
      targetId: datascienceTargetId,
      contentId: driverContentId,
      ageBucket: "1h",
      observedAt: "2026-04-20T08:00:00.000Z",
      ageMinutes: 75,
      score: 420,
      comments: 96,
      scoreVelocityPerHour: 212,
      commentVelocityPerHour: 45,
      cohortPostCount: 18,
      cohortMedianScoreVelocity: 48,
      cohortMedianCommentVelocity: 9,
      velocityZScore: 2.7,
      driverScore: 94,
      algorithmVersion: "web_smoke",
      explainPayload: { matchedQueries: ["llm agent"] },
    },
  ]);

  await repos.keywordTrendDailyRepository.upsertMany([
    {
      targetId: datascienceTargetId,
      day: "2026-04-18",
      keyword: "llm agent",
      track: "explicit_query",
      normalizedQueryText: "llm agent",
      queryScope: "subreddit",
      sampledPosts: 24,
      matchedPosts: 3,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.125,
      qualifiedMentionRate: 0.041,
      matchedScoreSum: 80,
      matchedCommentSum: 21,
      keywordHeat: 24,
      algorithmVersion: "web_smoke",
      explainPayload: {},
      sourceType: "live",
      updatedAt: "2026-04-20T08:00:00.000Z",
    },
    {
      targetId: datascienceTargetId,
      day: "2026-04-19",
      keyword: "llm agent",
      track: "explicit_query",
      normalizedQueryText: "llm agent",
      queryScope: "subreddit",
      sampledPosts: 29,
      matchedPosts: 5,
      qualifiedMatchedPosts: 2,
      mentionRate: 0.172,
      qualifiedMentionRate: 0.069,
      matchedScoreSum: 130,
      matchedCommentSum: 40,
      keywordHeat: 37,
      algorithmVersion: "web_smoke",
      explainPayload: {},
      sourceType: "live",
      updatedAt: "2026-04-20T08:00:00.000Z",
    },
    {
      targetId: datascienceTargetId,
      day: "2026-04-20",
      keyword: "llm agent",
      track: "explicit_query",
      normalizedQueryText: "llm agent",
      queryScope: "subreddit",
      sampledPosts: 36,
      matchedPosts: 8,
      qualifiedMatchedPosts: 4,
      mentionRate: 0.222,
      qualifiedMentionRate: 0.111,
      matchedScoreSum: 260,
      matchedCommentSum: 78,
      keywordHeat: 62,
      algorithmVersion: "web_smoke",
      explainPayload: {},
      sourceType: "live",
      updatedAt: "2026-04-20T08:00:00.000Z",
    },
  ]);

  await repos.anomalyEventRepository.upsertMany([
    {
      targetId: datascienceTargetId,
      signalType: "driver",
      signalKey: driverContentId,
      observedAt: "2026-04-20T08:00:00.000Z",
      windowStart: "2026-04-20T07:00:00.000Z",
      windowEnd: "2026-04-20T08:00:00.000Z",
      anomalyScore: 0.91,
      algorithmVersion: "web_smoke",
      explainPayload: { driverScore: 94 },
      updatedAt: "2026-04-20T08:00:00.000Z",
    },
  ]);

  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId: datascienceTargetId,
    mode: "live",
    windowStart: "2026-04-20T08:00:00.000Z",
    requestCountDelta: 8,
    successCountDelta: 8,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 36,
    acceptedCountDelta: 34,
    filteredOutCountDelta: 2,
    duplicatePostCountDelta: 1,
    ingestLagSecondsSumDelta: 210,
    ingestLagSampleCountDelta: 7,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: "2026-04-20T08:05:00.000Z",
  });
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
  if (webServer.pid) {
    try {
      process.kill(-webServer.pid, "SIGTERM");
    } catch {
      webServer.kill();
    }
  } else {
    webServer.kill();
  }
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
        env: {
          ...process.env,
          BROWSER: "none",
          VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
        },
        detached: true,
      },
    );
  }

  return spawn(
    "npm",
    ["--prefix", "apps/web", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER: "none",
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
      },
      detached: true,
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
  await page.getByRole("heading", { name: "Workbench Chart" }).waitFor();
  await page.getByRole("heading", { name: "Driver Posts" }).waitFor();
  await page.getByRole("heading", { name: "Keyword Heat" }).waitFor();
  await page.getByRole("heading", { name: "Reliability" }).waitFor();
  await page.getByText("Vector database benchmark drives analytics workflow discussion").waitFor();
  await page.locator("svg").first().waitFor();
  await assertNoHorizontalOverflow(page, "desktop target detail");

  console.log("web smoke: target detail keyword overlay");
  await page.goto(`http://127.0.0.1:${WEB_PORT}/target/datascience?keywords=llm%20agent`);
  await page.getByRole("heading", { name: "Workbench Chart" }).waitFor();
  await page.getByText("Keyword overlays: llm agent").waitFor();
  await page.getByText("llm agent").first().waitFor();
  await page.getByRole("button", { name: "Keyword overlays: llm agent" }).click();
  await page.getByRole("button", { name: "Keyword overlays: llm agent" }).click();
  await page.getByLabel("Keyword overlays").fill("llm agent, vector database");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.waitForURL(/keywords=llm\+agent%2Cvector\+database|keywords=llm%20agent%2Cvector%20database/);
  await assertNoHorizontalOverflow(page, "desktop target detail keyword overlay");

  console.log("web smoke: target detail comparison");
  await page.getByRole("button", { name: "Compare r/machinelearning" }).click();
  await page.waitForURL(/compare=machinelearning/);
  await page.getByRole("heading", { name: "Comparison" }).waitFor();
  await page.getByText("r/machinelearning", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Remove r/machinelearning" }).waitFor();
  await page.locator("svg").nth(1).waitFor();
  await assertNoHorizontalOverflow(page, "desktop target detail comparison");

  console.log("web smoke: ops");
  await page.getByRole("link", { name: "Ops" }).click();
  await page.getByRole("heading", { name: "Operations" }).waitFor();
  await page.getByText("Overall Status").waitFor();
  await fillByLabel(page, "Subreddit", "datascience");
  await fillByLabel(page, "Post limit", "12");
  await page.getByRole("button", { name: "Queue run" }).click();
  await page.getByText("Run completed").waitFor();
  await assertNoHorizontalOverflow(page, "desktop ops");

  console.log("web smoke: logout redirect");
  await page.getByRole("button", { name: "Logout" }).click();
  await page.getByRole("heading", { name: "Sign in to Analytics" }).waitFor();
  await page.goto(`http://127.0.0.1:${WEB_PORT}/dashboard`, { waitUntil: "domcontentloaded" });
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
    await mobilePage.getByRole("heading", { name: "Workbench Chart" }).waitFor();
    await mobilePage.getByRole("heading", { name: "Driver Posts" }).waitFor();
    await mobilePage.getByRole("heading", { name: "Reliability" }).waitFor();
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
          "target comparison chart",
          "target keyword overlay",
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
