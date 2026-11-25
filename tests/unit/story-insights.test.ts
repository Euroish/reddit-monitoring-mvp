import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { buildApp } from "../../apps/api/src/app";
import type { StoryFeed } from "../../packages/contracts/src/content-stories";
import { computeStoryInsights } from "../../src/modules/content/story-insights";
import { readStoryWindow, selectStoryFeed, type StoryInsightMeta } from "../../src/modules/content/stories";
import { evaluateChannelInsights } from "../../apps/web/src/components/stories/insightsPolicy";
import { cleanTextForAnalysis, tokenizeText } from "../../src/shared/text/analysis";

type StoryWindow = Awaited<ReturnType<typeof readStoryWindow>>;

function buildSyntheticWindow(
  items: Array<{
    key: string;
    title: string;
    excerpt?: string | null;
    sourceId?: string;
    sourceLabel?: string;
    tier?: "T1" | "T1_5" | "T2";
    sourceGroup?: string;
    language?: string;
    eventTimeMs: number;
    participatingSourceIds?: string[];
  }>,
  view: StoryFeed["view"] = "latest",
  fromMs = Date.UTC(2026, 10, 18, 0, 0, 0),
  toMs = Date.UTC(2026, 10, 25, 0, 0, 0),
): StoryWindow {
  const metaByStoryKey = new Map<string, StoryInsightMeta>();
  const feedItems: StoryFeed["items"] = items.map((entry, idx) => {
    const cleanText = cleanTextForAnalysis(`${entry.title} ${entry.excerpt ?? ""}`, true);
    const tokens = tokenizeText(cleanText, { preserveTechPhrases: true, maxTokensPerDoc: 120 });
    const iso = new Date(entry.eventTimeMs).toISOString();
    const sid = entry.sourceId ?? `src-${(idx % 4) + 1}`;
    metaByStoryKey.set(entry.key, {
      storyKey: entry.key,
      sourceGroup: entry.sourceGroup ?? "ai-firsthand",
      language: entry.language ?? "en",
      eventTimeMs: entry.eventTimeMs,
      participatingSourceIds: entry.participatingSourceIds ?? [sid],
      textForAnalysis: cleanText,
      tokenSet: new Set(tokens),
      hasComparableSource: true,
    });
    return {
      storyKey: entry.key,
      representative: {
        id: `content-${entry.key}`,
        platform: "web",
        title: entry.title,
        url: `https://example.com/${entry.key}`,
        author: "Editor",
        thumbnail: null,
        sourceId: sid,
        sourceLabel: entry.sourceLabel ?? `Source ${(idx % 4) + 1}`,
        tier: entry.tier ?? "T1",
        publishedAt: iso,
        discoveredAt: iso,
      },
      excerpt: entry.excerpt ?? null,
      related: [],
      relatedCount: 0,
      sourceCount: (entry.participatingSourceIds ?? [sid]).length,
      heat48h: 10 - idx * 0.1,
      tierBreakdown: { T1: 1, T1_5: 0, T2: 0 },
      sparkline48h: [1, 1, 1, 1, 1, 1, 1, 1],
      change6h: null,
      trend: "flat",
      badges: [],
      updatedAt: iso,
    };
  });

  return {
    view,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    fromMs,
    toMs,
    latest: view === "digest" ? [] : feedItems,
    hottest: feedItems,
    totalRankedCount: feedItems.length,
    metaByStoryKey,
  };
}

test("Channel Insights: bilingual phrases, duplicate-in-doc dedup, rising terms, exclusive topics, and drilldown", () => {
  const fromMs = Date.UTC(2026, 10, 18, 0, 0, 0);
  const toMs = Date.UTC(2026, 10, 25, 0, 0, 0);
  const day = 86_400_000;

  const docs = [
    // Previous half: infrastructure + compiler releases
    { key: "s1", title: "Kubernetes cluster autoscaler &amp; Rust compiler release", sourceGroup: "dev-infra", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 0.5 * day, participatingSourceIds: ["src-a", "src-b"] },
    { key: "s2", title: "Rust async runtime compiler benchmark update", sourceGroup: "dev-infra", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 1.2 * day },
    { key: "s3", title: "Kubernetes scheduler latency improvements", sourceGroup: "dev-infra", language: "en", tier: "T1_5" as const, eventTimeMs: fromMs + 1.8 * day },
    { key: "s4", title: "PostgreSQL query planner compiler optimizations", sourceGroup: "dev-infra", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 2.4 * day },
    { key: "s5", title: "Kubernetes storage CSI driver stability patch", sourceGroup: "dev-infra", language: "en", tier: "T2" as const, eventTimeMs: fromMs + 2.9 * day },
    { key: "s6", title: "Open Source database replication notes", sourceGroup: "dev-infra", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 3.1 * day },
    // Current half: surge in AI Agent + World Model + 中文模型评测
    { key: "s7", title: "AI Agent AI Agent AI Agent workflow SDK launch — Read more", excerpt: "Open Source agent runtime", sourceGroup: "ai-firsthand", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 4.1 * day, participatingSourceIds: ["src-a", "src-c", "src-d"] },
    { key: "s8", title: "AI Agent memory benchmarks for coding assistants", sourceGroup: "ai-firsthand", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 4.6 * day },
    { key: "s9", title: "Multi-step AI Agent planning paper published", sourceGroup: "ai-firsthand", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 5.1 * day },
    { key: "s10", title: "World Model video simulation for robotics control", sourceGroup: "ai-firsthand", language: "en", tier: "T1_5" as const, eventTimeMs: fromMs + 5.4 * day },
    { key: "s11", title: "World Model physics fidelity evaluation benchmark", sourceGroup: "ai-firsthand", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 5.7 * day },
    { key: "s12", title: "AI Agent enterprise orchestration with Open Source tools", sourceGroup: "ai-firsthand", language: "en", tier: "T2" as const, eventTimeMs: fromMs + 6.1 * day },
    { key: "s13", title: "多智能体推理模型与开源评测基准发布", excerpt: "聚焦工程落地与推理延迟优化", sourceGroup: "ai-firsthand", language: "zh", tier: "T1" as const, eventTimeMs: fromMs + 6.3 * day },
    { key: "s14", title: "AI Agent tool calling latency benchmark 2026", sourceGroup: "ai-firsthand", language: "en", tier: "T1" as const, eventTimeMs: fromMs + 6.6 * day },
  ];

  const win = buildSyntheticWindow(docs, "latest", fromMs, toMs);
  const computed = computeStoryInsights(win, { view: "latest", lang: "zh" }, toMs);
  const { insights, topicStoryKeys } = computed;

  assert.equal(insights.sample.analyzedCount, 14);
  assert.equal(insights.activityTrend.bucketGranularity, "day");
  assert.ok(insights.activityTrend.summaryText.length > 0);

  // Repeating "AI Agent" 3x inside s7 must still yield document frequency <= matching event count
  const aiAgentKw = insights.hotKeywords.items.find((k) => k.term === "ai_agent");
  assert.ok(aiAgentKw, "Preserves AI Agent phrase");
  assert.equal(aiAgentKw.displayTerm, "AI Agent");
  assert.equal(aiAgentKw.eventCount, 5);
  assert.ok(!insights.hotKeywords.items.some((k) => k.term === "read more" || k.term === "read"), "Filters Read more boilerplate");

  // Composition counts participating corroborated sources across related evidence too
  assert.ok(insights.composition.allParticipatingSourceCount >= 4);
  assert.ok(insights.composition.byChannel.some((c) => c.key === "ai-firsthand"));
  assert.ok(insights.composition.byChannel.some((c) => c.key === "dev-infra"));

  // Rising terms should spot AI Agent surging in second half
  assert.equal(insights.risingTerms.mode, "rising");
  assert.ok(insights.risingTerms.items.some((r) => r.term === "ai_agent" && r.deltaPctPoints > 0));
  assert.equal(insights.risingTerms.items[0].sparkline.length, insights.activityTrend.buckets.length);

  // Topics assignment sum invariant: assigned + unassigned === analyzedCount
  assert.ok(insights.topics.mode === "nmf" || insights.topics.mode === "cooccurrence_degraded");
  assert.equal(insights.topics.assignedCount + insights.topics.unassignedCount, insights.sample.analyzedCount);

  // Select story feed drilldown filters without modifying base window
  const nonOtherTopic = insights.topics.items.find((t) => !t.isOther);
  assert.ok(nonOtherTopic);
  const filteredByTopic = selectStoryFeed(win, "latest", 25, 0, true, {
    topicId: nonOtherTopic.topicId,
    topicStoryKeys: topicStoryKeys.get(nonOtherTopic.topicId),
  });
  assert.equal(filteredByTopic.totalCount, nonOtherTopic.docCount);

  const filteredByTerm = selectStoryFeed(win, "latest", 25, 0, true, { term: "ai agent" });
  assert.equal(filteredByTerm.totalCount, 5);
});

test("Channel Insights: low-sample degradation hides/degrades safely without fabricating topics", () => {
  const fromMs = Date.UTC(2026, 10, 23, 0, 0, 0);
  const toMs = Date.UTC(2026, 10, 25, 0, 0, 0);
  const win = buildSyntheticWindow(
    [
      { key: "low1", title: "Single channel note one", sourceId: "only-src", sourceGroup: "science", tier: "T1", language: "en", eventTimeMs: toMs - 3_600_000 },
      { key: "low2", title: "Single channel note two", sourceId: "only-src", sourceGroup: "science", tier: "T1", language: "en", eventTimeMs: toMs - 1_800_000 },
    ],
    "hot",
    fromMs,
    toMs,
  );

  const { insights } = computeStoryInsights(win, { view: "hot", sourceGroup: "science", lang: "zh" }, toMs);
  assert.equal(insights.activityTrend.bucketGranularity, "6h");
  assert.equal(insights.panels.composition.status, "hidden");
  assert.equal(insights.panels.topics.status, "hidden");
  assert.equal(insights.risingTerms.mode, "hidden");

  const plan = evaluateChannelInsights(insights, "science");
  assert.ok(plan.primary.length <= 3);
  assert.ok(plan.hidden.some((h) => h.id === "topics"));
});

test("Channel Insights policy: caps primary cards at 3 and enforces channel priority order", () => {
  const fromMs = Date.UTC(2026, 10, 18, 0, 0, 0);
  const toMs = Date.UTC(2026, 10, 25, 0, 0, 0);
  const day = 86_400_000;
  const docs = Array.from({ length: 16 }, (_, idx) => ({
    key: `p-${idx}`,
    title: idx < 8
      ? `Kubernetes infrastructure storage patch ${idx}`
      : `AI Agent open source robotics world model release ${idx}`,
    sourceGroup: idx % 2 === 0 ? "ai-firsthand" : "tech-media",
    tier: (idx % 2 === 0 ? "T1" : "T1_5") as "T1" | "T1_5",
    language: idx % 3 === 0 ? "zh" : "en",
    eventTimeMs: fromMs + ((idx * 0.4) % 6.8) * day,
  }));
  const win = buildSyntheticWindow(docs, "latest", fromMs, toMs);
  const { insights } = computeStoryInsights(win, { view: "latest", lang: "zh" }, toMs);

  const aiPlan = evaluateChannelInsights(insights, "ai-firsthand");
  assert.ok(aiPlan.primary.length <= 3);
  assert.equal(aiPlan.primary[0].id, "risingTerms");
  assert.equal(aiPlan.primary.length + aiPlan.more.length + aiPlan.hidden.length, 5);

  const techPlan = evaluateChannelInsights(insights, "tech-media");
  assert.ok(techPlan.primary.length <= 3);
  assert.equal(techPlan.primary[0].id, "topics");
});

test("Channel Insights performance: 600-story synthetic window completes well under 1500ms", () => {
  const fromMs = Date.UTC(2026, 10, 18, 0, 0, 0);
  const toMs = Date.UTC(2026, 10, 25, 0, 0, 0);
  const themes = [
    "AI Agent autonomous coding benchmark release",
    "World Model embodied robotics simulation safety",
    "Rust compiler async runtime performance optimization",
    "PostgreSQL distributed storage scaling engineering",
    "Open Source inference engine quantization kernel",
  ];
  const docs = Array.from({ length: 600 }, (_, i) => ({
    key: `perf-${i}`,
    title: `${themes[i % themes.length]} update ${i}`,
    excerpt: "Detailed engineering notes on throughput, memory usage, and evaluation metrics.",
    sourceGroup: i % 2 === 0 ? "ai-firsthand" : "dev-infra",
    tier: (i % 3 === 0 ? "T1" : "T1_5") as "T1" | "T1_5",
    language: i % 4 === 0 ? "zh" : "en",
    eventTimeMs: fromMs + ((i / 600) * (toMs - fromMs - 60_000)),
  }));
  const win = buildSyntheticWindow(docs, "latest", fromMs, toMs);
  const started = performance.now();
  const { insights } = computeStoryInsights(win, { view: "latest", lang: "en" }, toMs);
  const elapsedMs = performance.now() - started;

  assert.equal(insights.sample.analyzedCount, 600);
  assert.ok(elapsedMs < 1500, `Expected < 1500ms, got ${elapsedMs.toFixed(1)}ms`);
});

test("Channel Insights HTTP route enforces public_read visibility & preserves base insights during story drilldown", async () => {
  let capturedSql: string[] = [];
  const baseTime = new Date(Date.now() - 2 * 3_600_000);
  const sampleRows = Array.from({ length: 8 }, (_, idx) => ({
    id: `00000000-0000-0000-0000-00000000010${idx}`,
    platform: "web",
    title: idx < 4 ? `AI Agent workflow benchmark ${idx}` : `Kubernetes compiler latency fix ${idx}`,
    url: `https://example.com/post/${idx}`,
    author: { displayName: "Author" },
    thumbnail: null,
    excerpt: "Engineering evaluation notes with real observations.",
    language: idx % 2 === 0 ? "en" : "zh",
    links: [],
    source_id: `11111111-1111-1111-1111-11111111110${idx % 2}`,
    label: idx % 2 === 0 ? "AI Lab Blog" : "Systems Journal",
    source_group: idx % 2 === 0 ? "ai-firsthand" : "dev-infra",
    tier: idx % 2 === 0 ? "T1" : "T1_5",
    participant: `p-${idx % 2}`,
    comparable: true,
    published_at: baseTime,
    first_fetched_at: baseTime,
    event_at: new Date(baseTime.getTime() - idx * 300_000),
  }));

  const pool = {
    async query(sql: string) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      capturedSql.push(normalized);
      if (normalized.includes("FROM candidates k") && normalized.includes("JOIN collection_source cs")) {
        return { rows: sampleRows, rowCount: sampleRows.length };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return {
        query: async () => ({ rows: [], rowCount: 0 }),
        release: () => undefined,
      };
    },
  } as unknown as Pool;

  const app = await buildApp({
    pool,
    sessionSecret: "story-insights-test-session-secret-32chars!",
    origin: "https://insights.example.test",
    publicRead: true,
  });

  try {
    capturedSql = [];
    const insightsRes = await app.inject({
      method: "GET",
      url: "/v1/content/stories/insights?view=latest&lang=zh",
    });
    assert.equal(insightsRes.statusCode, 200);
    const body = insightsRes.json();
    assert.equal(body.sample.analyzedCount, 8);
    assert.equal(body.sample.coverage, "stored_sample");
    assert.ok(
      capturedSql.some((s) => s.includes("FROM candidates k") && (s.includes("owner_entity_id") || s.includes("usage_domain"))),
      "Public route strictly enforces contentVisibility scope filter",
    );

    // Drilldown on /v1/content/stories filters matching subset without altering /insights
    const drillRes = await app.inject({
      method: "GET",
      url: "/v1/content/stories?view=latest&term=ai%20agent",
    });
    assert.equal(drillRes.statusCode, 200);
    const drillFeed = drillRes.json();
    assert.equal(drillFeed.totalCount, 4);

    const insightsAfter = await app.inject({
      method: "GET",
      url: "/v1/content/stories/insights?view=latest&lang=zh",
    });
    assert.equal(insightsAfter.json().sample.analyzedCount, 8);
  } finally {
    await app.close();
  }
});
