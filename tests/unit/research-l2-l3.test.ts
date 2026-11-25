import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../packages/contracts/src/access";
import { buildApp } from "../../apps/api/src/app";
import {
  cleanTextForAnalysis,
  clearL2ResearchCacheForTests,
  computeDistinctiveTermsForGroups,
  computeTermCooccurrence,
  detectBucketAnomalies,
  extractNgrams,
  extractTfIdfKeywords,
  runL2ResearchComparison,
  runSentimentAnalysisTask,
  runTopicDiscoveryTask,
  tokenizeClauses,
  tokenizeText,
} from "../../src/modules/intelligence/index";

const adminActor: Actor = {
  sessionId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000010",
  email: "admin@siftline.test",
  role: "admin",
  clientKind: "browser",
  scopes: [],
  allowedSourceIds: null,
};

test("Phase 2: bilingual text cleaning & tokenization handles empty, URLs, short codes, and EN+ZH mixed phrases", () => {
  assert.equal(cleanTextForAnalysis(null), "");
  assert.equal(cleanTextForAnalysis(""), "");
  const cleaned = cleanTextForAnalysis("Check [DeepSeek docs](https://example.com/a?b=1) &amp; https://foo.bar/baz!");
  assert.ok(!cleaned.includes("https://"));
  assert.match(cleaned, /DeepSeek docs/);

  const tokens = tokenizeText("对比 o3 与 DeepSeek 的中文推理算力成本 benchmark accuracy!");
  assert.ok(tokens.includes("o3"), "Preserves short model code 'o3'");
  assert.ok(tokens.includes("deepseek"));
  assert.ok(tokens.includes("算力") || tokens.includes("算力成本"));
  assert.ok(tokens.includes("推理") || tokens.includes("推理速度"));
  assert.ok(tokens.includes("benchmark"));
  assert.ok(tokens.includes("accuracy"));
});

test("Phase 2: n-grams, TF-IDF, co-occurrence, distinctive terms, and anomaly Z-score detection", () => {
  const docs = [
    { clauses: tokenizeClauses("cursor agent mode fast autocomplete works well") },
    { clauses: tokenizeClauses("cursor agent mode coding workflow speeds up refactoring") },
    { clauses: tokenizeClauses("windsurf cascade pricing expensive monthly quota") },
    { clauses: tokenizeClauses("windsurf cascade pricing budget credits run out quickly") },
  ];

  const uni = extractNgrams(docs, 1, 10);
  assert.ok(uni.some((u) => u.term === "cursor" && u.docCount === 2));

  const bi = extractNgrams(docs, 2, 10);
  assert.ok(bi.some((b) => b.term === "cursor agent" && b.docCount === 2));

  const tri = extractNgrams(docs, 3, 10);
  assert.ok(tri.some((tr) => tr.term === "cursor agent mode" && tr.docCount === 2));

  const tfidf = extractTfIdfKeywords(docs, 10);
  assert.ok(tfidf.length > 0 && (tfidf[0].avgScore ?? 0) > 0);

  const cooc = computeTermCooccurrence(docs, 8);
  assert.ok(cooc.topPairs.some((p) => (p.termA === "cursor" && p.termB === "agent") || (p.termA === "agent" && p.termB === "cursor")));

  const docSets = docs.map((d) => new Set(d.clauses.flat()));
  const distinct = computeDistinctiveTermsForGroups(
    [
      { objectKey: "k1", label: "Cursor", docIndices: [0, 1] },
      { objectKey: "k2", label: "Windsurf", docIndices: [2, 3] },
    ],
    docSets,
    5,
  );
  const k1Terms = distinct[0].distinctiveTerms.map((t) => t.term);
  const k2Terms = distinct[1].distinctiveTerms.map((t) => t.term);
  assert.ok(k1Terms.includes("cursor"));
  assert.ok(k2Terms.includes("windsurf") || k2Terms.includes("pricing"));

  const series = [
    { bucket: "2026-11-18", count: 5, topTerms: ["a"], topItemIds: ["1"] },
    { bucket: "2026-11-19", count: 6, topTerms: ["a"], topItemIds: ["2"] },
    { bucket: "2026-11-20", count: 5, topTerms: ["a"], topItemIds: ["3"] },
    { bucket: "2026-11-21", count: 4, topTerms: ["a"], topItemIds: ["4"] },
    { bucket: "2026-11-22", count: 5, topTerms: ["a"], topItemIds: ["5"] },
    { bucket: "2026-11-23", count: 42, topTerms: ["outage"], topItemIds: ["6"] },
  ];
  const anomalies = detectBucketAnomalies(series, "medium");
  const spike = anomalies.points.find((p) => p.bucket === "2026-11-23");
  assert.equal(spike?.isAnomaly, true);
  assert.equal(spike?.direction, "spike");
  assert.ok((spike?.zScore ?? 0) >= 2.0);
});

test("Phase 2: bilingual sentiment handles negation, intensifiers, transparent unclassified reporting, and cancellation", async () => {
  const sampleDocs = [
    { id: "d1", platform: "reddit" as const, title: "Super fast!", text: "This tool is super fast and reliable, love it.", bucket: "2026-11-20", targetKeys: [{ key: "k1", label: "K1" }], engagementScore: 50 },
    { id: "d2", platform: "x" as const, title: "坏了", text: "今天版本严重报错，体验非常糟糕，完全卡顿", bucket: "2026-11-20", targetKeys: [{ key: "k1", label: "K1" }], engagementScore: 20 },
    { id: "d3", platform: "reddit" as const, title: "Negated", text: "Not good at all, never reliable anymore.", bucket: "2026-11-21", targetKeys: [{ key: "k1", label: "K1" }], engagementScore: 15 },
    { id: "d4", platform: "web" as const, title: "Release Note v2.1", text: "v2.1 schema migration published at 12:00 UTC.", bucket: "2026-11-21", targetKeys: [{ key: "k1", label: "K1" }], engagementScore: 5 },
  ];

  const { summary, items } = await runSentimentAnalysisTask(sampleDocs, { lang: "zh" });
  const byId = new Map(items.map((it) => [it.contentId, it]));
  assert.equal(byId.get("d1")?.sentimentLabel, "positive");
  assert.equal(byId.get("d2")?.sentimentLabel, "negative");
  assert.equal(byId.get("d3")?.sentimentLabel, "negative", "Negation flips 'good'/'reliable' to negative");
  assert.equal(byId.get("d4")?.sentimentLabel, "unclassified", "Objective release note without sentiment cues stays unclassified");
  assert.equal(summary.unclassifiedCount, 1);
  assert.equal(summary.classifiedCount, 3);

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => runSentimentAnalysisTask(sampleDocs, { signal: ac.signal }), /cancelled/i);
});

test("Phase 2: deterministic NMF topic discovery clusters separable themes reproducibly", async () => {
  const docs = [
    { id: "p1", platform: "reddit" as const, title: "Pricing tiers", text: "billing quota subscription price expensive cost invoice", bucket: "2026-11-20", targetKeys: [{ key: "k1", label: "K1" }], engagementScore: 20 },
    { id: "p2", platform: "reddit" as const, title: "Monthly fee", text: "monthly subscription price billing plan budget cost", bucket: "2026-11-20", targetKeys: [{ key: "k1", label: "K1" }], engagementScore: 18 },
    { id: "p3", platform: "reddit" as const, title: "Overcharge billing", text: "invoice billing charge subscription cost expensive", bucket: "2026-11-21", targetKeys: [{ key: "k1", label: "K1" }], engagementScore: 15 },
    { id: "l1", platform: "x" as const, title: "Latency issue", text: "latency timeout crash slow database query freeze", bucket: "2026-11-20", targetKeys: [{ key: "k2", label: "K2" }], engagementScore: 30 },
    { id: "l2", platform: "x" as const, title: "Slow query", text: "slow database timeout query latency outage error", bucket: "2026-11-21", targetKeys: [{ key: "k2", label: "K2" }], engagementScore: 25 },
    { id: "l3", platform: "x" as const, title: "Server freeze", text: "database query latency slow crash timeout freeze", bucket: "2026-11-22", targetKeys: [{ key: "k2", label: "K2" }], engagementScore: 22 },
  ];

  const run1 = await runTopicDiscoveryTask(docs, { numTopics: 2, lang: "en" });
  const run2 = await runTopicDiscoveryTask(docs, { numTopics: 2, lang: "en" });
  assert.equal(run1.summary.topics.length, 2);
  assert.deepEqual(run1.summary.topics.map((t) => t.label), run2.summary.topics.map((t) => t.label), "NMF must be deterministic");

  const map1 = new Map(run1.items.map((it) => [it.contentId, it.topicIndex]));
  assert.equal(map1.get("p1"), map1.get("p2"));
  assert.equal(map1.get("p2"), map1.get("p3"));
  assert.equal(map1.get("l1"), map1.get("l2"));
  assert.notEqual(map1.get("p1"), map1.get("l1"));
});

test("Phase 2: runL2ResearchComparison enforces Jaccard overlap math (20% on §5.12 B dataset) & cache hit/invalidation + L2/L3 route auth", async (t) => {
  clearL2ResearchCacheForTests();
  const projectId = "99999999-9999-9999-9999-999999999902";
  const srcA = "11111111-1111-1111-1111-111111111101";
  const srcB = "11111111-1111-1111-1111-111111111102";
  const batchA1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01";
  const batchA2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02";
  const batchB1 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01";

  let projectRevision = 1;
  const mockProject = () => ({
    id: projectId,
    name: "Dataset B L2 Project",
    description: null,
    revision: projectRevision,
    dataset_mode: "batch",
    owner_user_id: adminActor.userId,
    visibility: "private",
    thread_aware: true,
    created_at: new Date("2026-11-20T00:00:00.000Z"),
    updated_at: new Date("2026-11-24T00:00:00.000Z"),
    source_ids: [srcA, srcB],
    can_edit: true,
    enabled_batch_count: 3,
    total_batch_count: 3,
    batch_ids: [batchA1, batchA2, batchB1],
    enabled_batch_ids: [batchA1, batchA2, batchB1],
  });

  const handleQuery = async (sqlText: string, _params: unknown[] = []) => {
    const sql = sqlText.replace(/\s+/g, " ").trim();
    if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK") || sql.startsWith("SET ")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM intel_research_cache") || sql.includes("INSERT INTO intel_research_cache")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM monitor_project p")) {
      return { rows: [mockProject()], rowCount: 1 };
    }
    if (sql.includes("FROM monitor_project_batch WHERE project_id=$1")) {
      return {
        rows: [
          { batch_id: batchA1, status: "enabled" },
          { batch_id: batchA2, status: "enabled" },
          { batch_id: batchB1, status: "enabled" },
        ],
        rowCount: 3,
      };
    }
    if (sql.includes("FROM collection_batch b JOIN collection_source cs")) {
      return {
        rows: [
          { batchId: batchA1, jobId: null, sourceId: srcA, sourceLabel: "Keyword A", platform: "reddit", provider: "official", deliveryMode: "direct", label: "Batch A1", itemCount: 3, visibility: "shared", createdAt: "2026-11-20T00:00:00.000Z" },
          { batchId: batchA2, jobId: null, sourceId: srcA, sourceLabel: "Keyword A", platform: "reddit", provider: "official", deliveryMode: "direct", label: "Batch A2", itemCount: 1, visibility: "shared", createdAt: "2026-11-21T00:00:00.000Z" },
          { batchId: batchB1, jobId: null, sourceId: srcB, sourceLabel: "Keyword B", platform: "x", provider: "official", deliveryMode: "direct", label: "Batch B1", itemCount: 2, visibility: "shared", createdAt: "2026-11-22T00:00:00.000Z" },
        ],
        rowCount: 3,
      };
    }
    if (sql.includes("FROM collection_source cs")) {
      const mkDate = new Date("2026-11-20T00:00:00.000Z");
      return {
        rows: [
          { id: srcA, label: "Keyword A", platform: "reddit", primary_provider: "official", fallback_provider: null, delivery_mode: "direct", target: { type: "search", query: "Keyword A" }, content_kind: "post", state: "enabled", created_at: mkDate, updated_at: mkDate, revision: 1, schedule: {}, tier: "tier1", owner_entity_id: adminActor.userId, source_group: null, tags: [], locale: null, fetch_policy: {}, feed_lane: "discussion", quality_grade: null, health: {}, automatic_collection_blocked: false, coverage: "full", usage_domain: "research" },
          { id: srcB, label: "Keyword B", platform: "x", primary_provider: "official", fallback_provider: null, delivery_mode: "direct", target: { type: "search", query: "Keyword B" }, content_kind: "post", state: "enabled", created_at: mkDate, updated_at: mkDate, revision: 1, schedule: {}, tier: "tier1", owner_entity_id: adminActor.userId, source_group: null, tags: [], locale: null, fetch_policy: {}, feed_lane: "discussion", quality_grade: null, health: {}, automatic_collection_blocked: false, coverage: "full", usage_domain: "research" },
        ],
        rowCount: 2,
      };
    }
    if (sql.includes("MAX(GREATEST") || sql.includes("latest_discovery_at")) {
      return { rows: [{ latest_at: "2026-11-23T08:05:00.000Z" }], rowCount: 1 };
    }
    if (sql.includes("MIN(") && sql.includes("MAX(") && sql.includes("AS undated_count")) {
      return { rows: [{ total_count: 5, undated_count: 0, min_ts: new Date("2026-11-20T10:00:00Z"), max_ts: new Date("2026-11-23T08:00:00Z") }], rowCount: 1 };
    }
    if (sql.includes("AS exclusive_count") && sql.includes("FROM object_memberships om")) {
      return {
        rows: [
          { obj_key: "search:keyword a", obj_label: "Keyword A", obj_type: "search", content_count: 4, posts_count: 3, comments_count: 1, exclusive_count: 3, avg_eng: 30, reported_comments_sum: "18" },
          { obj_key: "search:keyword b", obj_label: "Keyword B", obj_type: "search", content_count: 2, posts_count: 1, comments_count: 1, exclusive_count: 1, avg_eng: 27, reported_comments_sum: "12" },
        ],
        rowCount: 2,
      };
    }
    if (sql.includes("AS inter_cnt FROM object_memberships a")) {
      return {
        rows: [
          { row_key: "search:keyword a", col_key: "search:keyword a", inter_cnt: 4 },
          { row_key: "search:keyword a", col_key: "search:keyword b", inter_cnt: 1 },
          { row_key: "search:keyword b", col_key: "search:keyword a", inter_cnt: 1 },
          { row_key: "search:keyword b", col_key: "search:keyword b", inter_cnt: 2 },
        ],
        rowCount: 4,
      };
    }
    if (sql.includes("AS obj_keys FROM dedup_content dc")) {
      return {
        rows: [
          { id: "c1", title: "Cursor agent comparison", body_text: "fast workflow reliability", clean_excerpt: "fast workflow", ts_utc: new Date("2026-11-20T10:00:00Z"), engagement_score: 52, obj_keys: ["search:keyword a", "search:keyword b"] },
          { id: "c2", title: "Cursor pricing feedback", body_text: "expensive plan", clean_excerpt: "expensive", ts_utc: new Date("2026-11-21T10:00:00Z"), engagement_score: 24, obj_keys: ["search:keyword a"] },
          { id: "c5", title: "Windsurf comment", body_text: "cascade speed", clean_excerpt: "cascade speed", ts_utc: new Date("2026-11-23T08:00:00Z"), engagement_score: 2, obj_keys: ["search:keyword b"] },
        ],
        rowCount: 3,
      };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = { query: handleQuery, release: () => undefined } as unknown as PoolClient;
  const pool = { query: handleQuery, connect: async () => client } as unknown as Pool;

  const first = await runL2ResearchComparison(pool, adminActor, projectId, {
    batchIds: [batchA1, batchA2, batchB1],
    lang: "zh",
  });
  assert.equal(first.cacheStatus, "miss");

  const cellAB = first.analyses.overlapMatrix.data.cells.find(
    (c) => c.rowKey === "search:keyword a" && c.colKey === "search:keyword b",
  );
  assert.equal(cellAB?.intersectionCount, 1);
  assert.equal(cellAB?.unionCount, 5);
  assert.equal(cellAB?.jaccardPct, 20);

  // Second identical request hits cache
  const second = await runL2ResearchComparison(pool, adminActor, projectId, {
    batchIds: [batchA1, batchA2, batchB1],
    lang: "zh",
  });
  assert.equal(second.cacheStatus, "hit");

  // Version change invalidates cache
  projectRevision = 2;
  const third = await runL2ResearchComparison(pool, adminActor, projectId, {
    batchIds: [batchA1, batchA2, batchB1],
    lang: "zh",
  });
  assert.equal(third.cacheStatus, "miss");

  // Route authentication guard checks
  const app = await buildApp({
    pool,
    origin: "https://research.example.test",
    sessionSecret: "research-l2-l3-test-session-secret-01",
    publicRead: true,
    mfa: { key: Buffer.alloc(32, 8), required: true },
  });
  t.after(() => app.close());

  for (const [method, url] of [
    ["POST", `/v1/projects/${projectId}/research/l2`],
    ["GET", `/v1/projects/${projectId}/research/tasks`],
    ["POST", `/v1/projects/${projectId}/research/tasks`],
  ] as const) {
    const res = await app.inject({
      method,
      url,
      headers: method === "POST" ? { origin: "https://research.example.test" } : undefined,
      payload: method === "POST" ? {} : undefined,
    });
    assert.equal(res.statusCode, 401, `${method} ${url} must require authentication`);
  }
});
