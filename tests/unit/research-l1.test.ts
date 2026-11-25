import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../packages/contracts/src/access";
import { buildApp } from "../../apps/api/src/app";
import {
  buildAnalysisCsv,
  buildAnalysisTxt,
  safeCsvCell,
} from "../../apps/web/src/lib/researchExport";
import { compileContentFilter } from "../../src/modules/content/search";
import {
  interpretEngagement,
  interpretKeywords,
  interpretKinds,
  interpretPlatforms,
  interpretScale,
  interpretSources,
  interpretTrend,
} from "../../src/modules/projects/research-interpret";
import {
  deriveTargetIdentity,
  resolveResearchContext,
  runL1ResearchOverview,
} from "../../src/modules/projects/index";

const adminActor: Actor = {
  sessionId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000010",
  email: "admin@siftline.test",
  role: "admin",
  clientKind: "browser",
  scopes: [],
  allowedSourceIds: null,
};

const viewerActor: Actor = {
  sessionId: "00000000-0000-0000-0000-000000000002",
  userId: "00000000-0000-0000-0000-000000000099",
  email: "viewer@siftline.test",
  role: "viewer",
  clientKind: "browser",
  scopes: [],
  allowedSourceIds: [],
};

test("Phase 1: compileContentFilter supports sourceIds, batchIds, platforms, kinds, communities, languages, timeBasis while keeping single EXISTS for basic filter", () => {
  const basic = compileContentFilter(
    adminActor,
    { sourceId: "11111111-1111-1111-1111-111111111111", query: "cursor" },
  );
  assert.equal((basic.text.match(/EXISTS/g) ?? []).length, 1);

  const extended = compileContentFilter(
    adminActor,
    {
      sourceIds: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
      batchIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"],
      platforms: ["reddit", "x"],
      kinds: ["post", "comment"],
      communities: ["LocalLLaMA", "MachineLearning"],
      languages: ["en", "zh"],
      timeBasis: "collected",
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-24T00:00:00.000Z",
    },
  );
  assert.match(extended.text, /p\.code=ANY\(/);
  assert.match(extended.text, /c\.kind=ANY\(/);
  assert.match(extended.text, /c\.community_name=ANY\(/);
  assert.match(extended.text, /c\.language=ANY\(/);
  assert.match(extended.text, /c\.first_seen_at>=/);
  assert.match(extended.text, /b\.id=ANY\(/);

  // Viewer without allowedSourceIds fails closed when requesting private/unowned batches
  const closedViewer = compileContentFilter(viewerActor, {
    batchIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1"],
  });
  assert.match(closedViewer.text, /d\.collection_source_id=ANY\(\$/);
  assert.deepEqual(closedViewer.values[0], []);
});

test("Phase 1: deriveTargetIdentity groups targets cleanly across search, community, account, and fallback source", () => {
  assert.deepEqual(
    deriveTargetIdentity({ id: "s1", label: "x", target: { type: "search", query: "  Cursor IDE " } }),
    { key: "search:cursor ide", label: "Cursor IDE", targetType: "search" },
  );
  assert.deepEqual(
    deriveTargetIdentity({ id: "s2", label: "r/LocalLLaMA", target: { type: "community", community: "r/LocalLLaMA" } }),
    { key: "community:localllama", label: "r/LocalLLaMA", targetType: "community" },
  );
  assert.deepEqual(
    deriveTargetIdentity({ id: "s3", label: "@karpathy", target: { type: "account", account: "@karpathy" } }),
    { key: "account:karpathy", label: "@karpathy", targetType: "account" },
  );
  assert.deepEqual(
    deriveTargetIdentity({ id: "s4", label: "HN RSS", target: {} }),
    { key: "source:s4", label: "HN RSS", targetType: "source" },
  );
});

test("Phase 1: rule-based chart interpretations handle empty, single, tie, zero-denom, overlap, and undated edge cases", () => {
  const emptyScale = interpretScale(
    {
      deduplicatedContentCount: 0,
      threadAnchorCount: 0,
      postsCount: 0,
      commentsCount: 0,
      articlesCount: 0,
      sourcesCount: 0,
      communitiesCount: 0,
      authorsCount: 0,
      reportedPlatformCommentsSum: 0,
      undatedCount: 0,
      multiTargetOverlapCount: 0,
    },
    true,
    "zh",
  );
  assert.match(emptyScale.summaryText, /未选择/);

  const overlapScale = interpretScale(
    {
      deduplicatedContentCount: 5,
      threadAnchorCount: 3,
      postsCount: 3,
      commentsCount: 2,
      articlesCount: 0,
      sourcesCount: 2,
      communitiesCount: 2,
      authorsCount: 4,
      reportedPlatformCommentsSum: 14,
      undatedCount: 1,
      multiTargetOverlapCount: 1,
    },
    false,
    "zh",
  );
  assert.match(overlapScale.summaryText, /5 条/);
  assert.ok(overlapScale.summaryBullets.some((b) => b.includes("多") || b.includes("同时命中")));
  assert.ok(overlapScale.summaryBullets.some((b) => b.includes("缺少原始发布时间")));

  const singleTrend = interpretTrend(
    [{ bucket: "2026-11-20", totalCount: 3, postsCount: 2, commentsCount: 1, articlesCount: 0, byPlatform: [] }],
    0,
    false,
    "zh",
  );
  assert.match(singleTrend.summaryText, /1 个时间分桶/);

  const tieKw = interpretKeywords(
    [
      { targetKey: "k1", label: "Alpha", targetType: "search", platforms: ["reddit"], contentCount: 3, sharePct: 60, overlapCount: 1, exclusiveCount: 2, postsCount: 2, commentsCount: 1, articlesCount: 0 },
      { targetKey: "k2", label: "Beta", targetType: "search", platforms: ["reddit"], contentCount: 3, sharePct: 60, overlapCount: 1, exclusiveCount: 2, postsCount: 1, commentsCount: 2, articlesCount: 0 },
    ],
    5,
    1,
    "zh",
  );
  assert.match(tieKw.summaryText, /并列/);

  const singlePlatform = interpretPlatforms(
    [{ platform: "reddit", contentCount: 4, postsCount: 2, commentsCount: 2, articlesCount: 0, sharePct: 100 }],
    4,
    "en",
  );
  assert.match(singlePlatform.summaryText, /100\.0%/);
  assert.match(singlePlatform.summaryText, /Reddit/);

  const emptySource = interpretSources([], [], 0, "zh");
  assert.match(emptySource.summaryText, /暂无/);

  const zeroKind = interpretKinds({ posts: 0, comments: 0, articles: 0, total: 0 }, [], "en");
  assert.match(zeroKind.summaryText, /No content type/);

  const zeroDenomEngagement = interpretEngagement(
    [
      {
        platform: "reddit",
        sampleCount: 2,
        postCount: 2,
        primaryMetricLabel: "Score",
        totalPrimaryMetric: 0,
        avgPrimaryMetric: 0,
        reportedRepliesSum: 0,
        collectedCommentsCount: 0,
        totalViews: 0,
        totalReposts: 0,
        avgEngagementScore: 0,
        avgDiscussionRatio: 0,
      },
    ],
    { reportedPlatformComments: 0, collectedComments: 0 },
    "zh",
  );
  assert.match(zeroDenomEngagement.summaryText, /累计 Score 0/);
});

test("Phase 1: researchExport CSV escapes formula injection and embeds UTF-8 BOM & provenance metadata", () => {
  assert.equal(safeCsvCell("=CMD('calc')"), "\"'=CMD('calc')\"");
  assert.equal(safeCsvCell("+1+1"), "\"'+1+1\"");
  assert.equal(safeCsvCell("-risk"), "\"'-risk\"");
  assert.equal(safeCsvCell("@SUM(A1)"), "\"'@SUM(A1)\"");

  const csv = buildAnalysisCsv(
    {
      projectName: "Cursor Research",
      analysisId: "L1-03",
      analysisTitle: "关键词分布",
      methodVersion: "1.0.0",
      dataVersion: "v-123",
      keywords: ["Cursor", "Windsurf"],
      batchesCount: 3,
      timeRangeLabel: "2026-11-01 ~ 2026-11-24",
      coverageLabel: "项目已采集样本",
      methodologyNote: "COUNT(DISTINCT c.id) with membership bridge",
      generatedAt: "2026-11-24T12:00:00.000Z",
    },
    [
      { key: "targetLabel", label: "关键词" },
      { key: "count", label: "条数" },
    ],
    [{ targetLabel: "=evil", count: 4 }],
  );
  assert.ok(csv.startsWith("\uFEFF"), "CSV must start with UTF-8 BOM for Excel compatibility");
  assert.match(csv, /L1-03/);
  assert.match(csv, /'=evil/);

  const txt = buildAnalysisTxt(
    {
      projectName: "Cursor Research",
      analysisId: "L1-03",
      analysisTitle: "关键词分布",
      methodVersion: "1.0.0",
      dataVersion: "v-123",
      keywords: ["Cursor"],
      batchesCount: 1,
      timeRangeLabel: "All",
      coverageLabel: "Stored",
      methodologyNote: "Distinct count",
      generatedAt: "2026-11-24T12:00:00.000Z",
    },
    "Summary line",
    ["Bullet 1", "Bullet 2"],
    [{ key: "a", label: "A" }],
    [{ a: "1" }],
  );
  assert.match(txt, /SIFTLINE 研究分析导出报告/);
  assert.match(txt, /Bullet 1/);
});

test("Phase 1: §5.12 B dataset deduplication invariant & L1 overview + empty selection + route RBAC", async (t) => {
  const projectId = "99999999-9999-9999-9999-999999999901";
  const srcA = "11111111-1111-1111-1111-111111111101";
  const srcB = "11111111-1111-1111-1111-111111111102";
  const batchA1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01";
  const batchA2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02";
  const batchB1 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01";

  const mockProject = {
    id: projectId,
    name: "Dataset B Project",
    description: null,
    revision: 1,
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
  };

  const datasetItems = [
    { id: "c1", kind: "post", platform_id: "reddit", platform: "reddit", community_name: "r/LocalLLaMA", created_at_source: "2026-11-20T10:00:00.000Z", first_seen_at: "2026-11-20T11:00:00.000Z", author_handle: "u1", metric_score: 40, metric_comments: 12, metric_views: 0, metric_likes: 40, metric_reposts: 0, metric_bookmarks: 0, engagement_score: 52, title: "Post 1 shared between A1 and B1", clean_excerpt: "Body 1", url: "https://reddit.com/1", source_id: srcA },
    { id: "c2", kind: "post", platform_id: "reddit", platform: "reddit", community_name: "r/LocalLLaMA", created_at_source: "2026-11-21T10:00:00.000Z", first_seen_at: "2026-11-21T11:00:00.000Z", author_handle: "u2", metric_score: 20, metric_comments: 4, metric_views: 0, metric_likes: 20, metric_reposts: 0, metric_bookmarks: 0, engagement_score: 24, title: "Post 2 in A1", clean_excerpt: "Body 2", url: "https://reddit.com/2", source_id: srcA },
    { id: "c3", kind: "comment", platform_id: "reddit", platform: "reddit", community_name: "r/LocalLLaMA", created_at_source: "2026-11-21T12:00:00.000Z", first_seen_at: "2026-11-21T12:05:00.000Z", author_handle: "u3", metric_score: 5, metric_comments: 0, metric_views: 0, metric_likes: 5, metric_reposts: 0, metric_bookmarks: 0, engagement_score: 5, title: null, clean_excerpt: "Comment 3 in A1", url: "https://reddit.com/3", source_id: srcA },
    { id: "c4", kind: "post", platform_id: "x", platform: "x", community_name: null, created_at_source: "2026-11-22T09:00:00.000Z", first_seen_at: "2026-11-22T09:05:00.000Z", author_handle: "u4", metric_score: 10, metric_comments: 2, metric_views: 100, metric_likes: 10, metric_reposts: 3, metric_bookmarks: 1, engagement_score: 16, title: "Post 4 only in A2", clean_excerpt: "Body 4", url: "https://x.com/4", source_id: srcA },
    { id: "c5", kind: "comment", platform_id: "x", platform: "x", community_name: null, created_at_source: "2026-11-23T08:00:00.000Z", first_seen_at: "2026-11-23T08:05:00.000Z", author_handle: "u5", metric_score: 2, metric_comments: 0, metric_views: 20, metric_likes: 2, metric_reposts: 0, metric_bookmarks: 0, engagement_score: 2, title: null, clean_excerpt: "Comment 5 only in B1", url: "https://x.com/5", source_id: srcB },
  ] as const;

  // §5.12 memberships: c1 belongs to both A1 (Keyword A) and B1 (Keyword B)!
  const batchLinks = [
    { batchId: batchA1, contentId: "c1" },
    { batchId: batchA1, contentId: "c2" },
    { batchId: batchA1, contentId: "c3" },
    { batchId: batchA2, contentId: "c4" },
    { batchId: batchB1, contentId: "c1" },
    { batchId: batchB1, contentId: "c5" },
  ];

  let l1AggQueryCount = 0;

  // Minimal SQL interpreter for our research + project queries against the in-memory fixture
  const handleQuery = async (sqlText: string, params: unknown[] = []) => {
    const sql = sqlText.replace(/\s+/g, " ").trim();
    if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK") || sql.startsWith("SET LOCAL") || sql.startsWith("SET TRANSACTION")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM monitor_project p")) {
      if (params[1] === projectId || params[1] === null) return { rows: [mockProject], rowCount: 1 };
      return { rows: [], rowCount: 0 };
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
      const requested = Array.isArray(params[0]) ? (params[0] as string[]) : [];
      const allBatches = [
        { batchId: batchA1, jobId: null, sourceId: srcA, sourceLabel: "Keyword A", platform: "reddit", provider: "official", deliveryMode: "direct", label: "Batch A1", itemCount: 3, visibility: "shared", createdAt: "2026-11-20T00:00:00.000Z" },
        { batchId: batchA2, jobId: null, sourceId: srcA, sourceLabel: "Keyword A", platform: "reddit", provider: "official", deliveryMode: "direct", label: "Batch A2", itemCount: 1, visibility: "shared", createdAt: "2026-11-21T00:00:00.000Z" },
        { batchId: batchB1, jobId: null, sourceId: srcB, sourceLabel: "Keyword B", platform: "x", provider: "official", deliveryMode: "direct", label: "Batch B1", itemCount: 2, visibility: "shared", createdAt: "2026-11-22T00:00:00.000Z" },
      ].filter((b) => requested.length === 0 || requested.includes(b.batchId));
      return { rows: allBatches, rowCount: allBatches.length };
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
    if (sql.includes("COUNT(DISTINCT c.id)::int AS total_count")) {
      return { rows: [{ min_created: "2026-11-20T10:00:00.000Z", max_created: "2026-11-23T08:00:00.000Z", total_count: datasetItems.length }], rowCount: 1 };
    }
    if (sql.includes("ARRAY_AGG(DISTINCT c.community_name")) {
      return { rows: [{ communities: ["r/LocalLLaMA"], languages: ["en"], platforms: ["reddit", "x"] }], rowCount: 1 };
    }

    // Extract selected batch IDs from params
    const selectedBatches =
      params.find(
        (p): p is string[] =>
          Array.isArray(p) && p.length > 0 && p.every((v) => v === batchA1 || v === batchA2 || v === batchB1),
      ) ?? [batchA1, batchA2, batchB1];
    const activeLinks = batchLinks.filter((l) => sql.includes("AS scale_row")
      ? (params[0] as string[]).includes(l.contentId)
      : selectedBatches.includes(l.batchId));
    const dedupIds = [...new Set(activeLinks.map((l) => l.contentId))];
    const activeItems = datasetItems.filter((item) => dedupIds.includes(item.id));
    const batchTargetMap = new Map<string, { targetKey: string; targetLabel: string; targetType: string }>([
      [batchA1, { targetKey: "search:keyword a", targetLabel: "Keyword A", targetType: "search" }],
      [batchA2, { targetKey: "search:keyword a", targetLabel: "Keyword A", targetType: "search" }],
      [batchB1, { targetKey: "search:keyword b", targetLabel: "Keyword B", targetType: "search" }],
    ]);

    if (sql.includes("SELECT rm.content_id, rm.target_key")) {
      return { rows: activeLinks.map((l) => {
        const target = batchTargetMap.get(l.batchId)!;
        return { content_id: l.contentId, target_key: target.targetKey, target_label: target.targetLabel,
          target_type: target.targetType, source_id: l.batchId === batchB1 ? srcB : srcA };
      }), rowCount: activeLinks.length };
    }
    if (sql.includes("AS scale_row") && sql.includes("AS trend_rows")) {
      assert.match(sql, /dedup_content AS MATERIALIZED \(/);
      assert.match(sql, /scoped_memberships AS \( SELECT \* FROM UNNEST/);
      assert.deepEqual(params[0], [...new Set(params[1] as string[])]);
      assert.doesNotMatch(sql.split("anchors AS")[0], /body_text|clean_excerpt/);
      l1AggQueryCount += 1;

      const targetCountsByContent = new Map<string, Set<string>>();
      const byTarget = new Map<string, { target_key: string; target_label: string; target_type: string; platforms: Set<string>; ids: Set<string>; posts: Set<string>; comments: Set<string> }>();
      for (const link of activeLinks) {
        const tInfo = batchTargetMap.get(link.batchId)!;
        if (!targetCountsByContent.has(link.contentId)) targetCountsByContent.set(link.contentId, new Set());
        targetCountsByContent.get(link.contentId)!.add(tInfo.targetKey);
        const cur = byTarget.get(tInfo.targetKey) ?? { target_key: tInfo.targetKey, target_label: tInfo.targetLabel, target_type: tInfo.targetType, platforms: new Set(), ids: new Set(), posts: new Set(), comments: new Set() };
        cur.ids.add(link.contentId);
        const item = datasetItems.find((d) => d.id === link.contentId)!;
        cur.platforms.add(item.platform);
        if (item.kind === "post") cur.posts.add(link.contentId);
        if (item.kind === "comment") cur.comments.add(link.contentId);
        byTarget.set(tInfo.targetKey, cur);
      }
      const overlapCount = [...targetCountsByContent.values()].filter((s) => s.size > 1).length;

      const byDayPlat = new Map<string, { bucket_utc: string; platform: string; total_cnt: number; posts_cnt: number; comments_cnt: number; articles_cnt: number }>();
      for (const item of activeItems) {
        const day = item.created_at_source.slice(0, 10) + "T00:00:00.000Z";
        const key = `${day}|${item.platform}`;
        const cur = byDayPlat.get(key) ?? { bucket_utc: day, platform: item.platform, total_cnt: 0, posts_cnt: 0, comments_cnt: 0, articles_cnt: 0 };
        cur.total_cnt += 1;
        if (item.kind === "post") cur.posts_cnt += 1;
        if (item.kind === "comment") cur.comments_cnt += 1;
        byDayPlat.set(key, cur);
      }

      const byPlat = new Map<string, typeof activeItems[number][]>();
      for (const i of activeItems) {
        if (!byPlat.has(i.platform)) byPlat.set(i.platform, []);
        byPlat.get(i.platform)!.push(i);
      }

      const commList = activeItems.filter((i) => i.community_name === "r/LocalLLaMA");
      const sourceRows = [srcA, srcB].map((sid) => {
        const list = activeItems.filter((i) => i.source_id === sid);
        return list.length ? { source_id: sid, source_label: sid === srcA ? "Keyword A" : "Keyword B", platform: sid === srcA ? "reddit" : "x", content_count: list.length, posts_count: list.filter((i) => i.kind === "post").length, comments_count: list.filter((i) => i.kind === "comment").length, avg_eng: 15 } : null;
      }).filter(Boolean);

      return {
        rows: [{
          scale_row: {
            total_count: activeItems.length,
            anchor_count: activeItems.filter((i) => i.kind === "post").length,
            posts_count: activeItems.filter((i) => i.kind === "post").length,
            comments_count: activeItems.filter((i) => i.kind === "comment").length,
            articles_count: 0,
            sources_count: new Set(activeItems.map((i) => i.source_id)).size,
            communities_count: new Set(activeItems.map((i) => i.community_name).filter(Boolean)).size,
            authors_count: new Set(activeItems.map((i) => i.author_handle)).size,
            reported_comments_sum: String(activeItems.filter((i) => i.kind !== "comment").reduce((acc, i) => acc + i.metric_comments, 0)),
            undated_count: 0,
            overlap_count: overlapCount,
          },
          trend_rows: [...byDayPlat.values()],
          keyword_rows: [...byTarget.values()].map((entry) => ({
            target_key: entry.target_key,
            target_label: entry.target_label,
            target_type: entry.target_type,
            platforms: [...entry.platforms].sort(),
            content_count: entry.ids.size,
            posts_count: entry.posts.size,
            comments_count: entry.comments.size,
            articles_count: 0,
            exclusive_count: [...entry.ids].filter((cid) => (targetCountsByContent.get(cid)?.size ?? 0) === 1).length,
          })),
          platform_rows: [...byPlat.entries()].map(([platform, list]) => ({
            platform,
            content_count: list.length,
            posts_count: list.filter((i) => i.kind === "post").length,
            comments_count: list.filter((i) => i.kind === "comment").length,
            articles_count: 0,
          })),
          community_rows: commList.length ? [{ community_name: "r/LocalLLaMA", platform: "reddit", content_count: commList.length, posts_count: commList.filter((i) => i.kind === "post").length, comments_count: commList.filter((i) => i.kind === "comment").length, avg_eng: 20 }] : [],
          source_rows: sourceRows,
          engagement_rows: [...byPlat.entries()].map(([platform, list]) => {
            const posts = list.filter((i) => i.kind !== "comment");
            return {
              platform,
              sample_count: list.length,
              post_count: posts.length,
              sum_score: String(posts.reduce((a, i) => a + i.metric_score, 0)),
              sum_likes: String(posts.reduce((a, i) => a + i.metric_likes, 0)),
              sum_comments: String(posts.reduce((a, i) => a + i.metric_comments, 0)),
              collected_comments: list.filter((i) => i.kind === "comment").length,
              sum_views: String(posts.reduce((a, i) => a + i.metric_views, 0)),
              sum_reposts: String(posts.reduce((a, i) => a + i.metric_reposts, 0)),
              avg_eng: posts.length ? posts.reduce((a, i) => a + i.engagement_score, 0) / posts.length : 0,
              avg_disc: 0.2,
            };
          }),
          top_rows: activeItems.map((i) => ({ ...i, created_at_source: i.created_at_source, metric_views: String(i.metric_views), intent_tag: null, target_labels: [] })),
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = {
    query: handleQuery,
    release: () => undefined,
  } as unknown as PoolClient;

  const pool = {
    query: handleQuery,
    connect: async () => client,
  } as unknown as Pool;

  // 1. Full §5.12 B dataset (A1 + A2 + B1)
  const run = () => runL1ResearchOverview(pool, adminActor, projectId, {
    batchIds: [batchA1, batchA2, batchB1],
    lang: "zh",
  });
  const [fullL1, coalesced] = await Promise.all([run(), run()]);
  assert.strictEqual(fullL1, coalesced);
  assert.equal(l1AggQueryCount, 1, "concurrent L1 requests must share a single aggregation");
  assert.equal(fullL1.analyses.scale.data.deduplicatedContentCount, 5);
  assert.equal(fullL1.analyses.scale.data.postsCount, 3);
  assert.equal(fullL1.analyses.scale.data.commentsCount, 2);
  assert.equal(fullL1.analyses.scale.data.multiTargetOverlapCount, 1);

  const kwA = fullL1.analyses.keywords.data.rows.find((r) => r.label === "Keyword A");
  const kwB = fullL1.analyses.keywords.data.rows.find((r) => r.label === "Keyword B");
  assert.equal(kwA?.contentCount, 4);
  assert.equal(kwB?.contentCount, 2);
  assert.equal(kwA?.overlapCount, 1);
  assert.equal(kwB?.overlapCount, 1);

  // 2. Uncheck batch A2 -> total becomes 4
  const subsetL1 = await runL1ResearchOverview(pool, adminActor, projectId, {
    batchIds: [batchA1, batchB1],
    lang: "zh",
  });
  assert.equal(subsetL1.analyses.scale.data.deduplicatedContentCount, 4);

  // 3. Clear all batches -> emptySelection true & 0 results
  const emptyCtx = await resolveResearchContext(pool, adminActor, projectId, { batchIds: [] });
  assert.equal(emptyCtx.scope.emptySelection, true);
  const emptyL1 = await runL1ResearchOverview(pool, adminActor, projectId, { batchIds: [], lang: "zh" });
  assert.equal(emptyL1.analyses.scale.data.deduplicatedContentCount, 0);
  assert.match(emptyL1.analyses.scale.summaryText, /未选择/);

  // 4. Route auth & RBAC via buildApp
  const app = await buildApp({
    pool,
    origin: "https://research.example.test",
    sessionSecret: "research-l1-test-session-secret-001",
    publicRead: true,
    mfa: { key: Buffer.alloc(32, 7), required: true },
  });
  t.after(() => app.close());

  const unauthScope = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/research/scope` });
  assert.equal(unauthScope.statusCode, 401);

  const unauthL1 = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/research/l1`,
    headers: { origin: "https://research.example.test" },
    payload: {},
  });
  assert.equal(unauthL1.statusCode, 401);
});
