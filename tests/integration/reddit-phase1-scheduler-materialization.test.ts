import assert from "node:assert/strict";
import test from "node:test";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAnomalyEventRepository,
  InMemoryContentRepository,
  InMemoryKeywordTrendDailyRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryPostEngagementRepository,
  InMemoryPostGrowthFactRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { materializeTouchedTargets } from "../../workers/reddit-phase1-scheduler";
import type { TouchedTarget } from "../../workers/reddit-phase1-scheduler";

class TrackingSubredditDailyFactRepository extends InMemorySubredditDailyFactRepository {
  constructor(private readonly order: string[]) {
    super();
  }

  public override async upsertMany(facts: Awaited<ReturnType<InMemorySubredditDailyFactRepository["all"]>>): Promise<void> {
    this.order.push("daily");
    await super.upsertMany(facts);
  }
}

class TrackingSubredditTrendPointRepository extends InMemorySubredditTrendPointRepository {
  constructor(private readonly order: string[]) {
    super();
  }

  public override async upsertMany(points: Awaited<ReturnType<InMemorySubredditTrendPointRepository["all"]>>): Promise<void> {
    this.order.push("trend");
    await super.upsertMany(points);
  }
}

class TrackingPostGrowthFactRepository extends InMemoryPostGrowthFactRepository {
  constructor(private readonly order: string[]) {
    super();
  }

  public override async upsertMany(rows: Awaited<ReturnType<InMemoryPostGrowthFactRepository["all"]>>): Promise<void> {
    this.order.push("driver");
    await super.upsertMany(rows);
  }
}

class TrackingKeywordTrendDailyRepository extends InMemoryKeywordTrendDailyRepository {
  constructor(private readonly order: string[]) {
    super();
  }

  public override async upsertMany(rows: Awaited<ReturnType<InMemoryKeywordTrendDailyRepository["all"]>>): Promise<void> {
    this.order.push("keyword");
    await super.upsertMany(rows);
  }
}

class TrackingAnomalyEventRepository extends InMemoryAnomalyEventRepository {
  constructor(private readonly order: string[]) {
    super();
  }

  public override async upsertMany(rows: Awaited<ReturnType<InMemoryAnomalyEventRepository["all"]>>): Promise<void> {
    this.order.push("anomaly");
    await super.upsertMany(rows);
  }
}

test("materializeTouchedTargets runs replay materialization in deterministic anomaly order", async () => {
  const nowIso = "2026-04-13T12:00:00.000Z";
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const jobId = stableUuidFromString("job:materialization:test");
  const order: string[] = [];

  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const subredditDailyFactRepository = new TrackingSubredditDailyFactRepository(order);
  const subredditTrendPointRepository = new TrackingSubredditTrendPointRepository(order);
  const postGrowthFactRepository = new TrackingPostGrowthFactRepository(order);
  const keywordTrendDailyRepository = new TrackingKeywordTrendDailyRepository(order);
  const anomalyEventRepository = new TrackingAnomalyEventRepository(order);

  const contentRows = [
    createContent({
      targetId,
      externalId: "t3_driver_1",
      title: "LLM agent tooling is surging",
      createdAtSource: "2026-04-13T10:40:00.000Z",
    }),
    createContent({
      targetId,
      externalId: "t3_driver_2",
      title: "LLM deployment walkthrough",
      createdAtSource: "2026-04-13T10:48:00.000Z",
    }),
    createContent({
      targetId,
      externalId: "t3_driver_3",
      title: "LLM benchmark update",
      createdAtSource: "2026-04-13T10:55:00.000Z",
    }),
  ];
  await contentRepository.upsertMany(contentRows);
  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "new_posts_15m",
      metricValue: 9,
      collectionJobId: jobId,
    },
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 180000,
      collectionJobId: jobId,
    },
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "active_users",
      metricValue: 5100,
      collectionJobId: jobId,
    },
  ]);
  await postEngagementRepository.upsertLatestMany([
    {
      contentId: contentRows[0]!.id,
      targetId,
      source: "reddit",
      observedAt: "2026-04-13T11:30:00.000Z",
      score: 420,
      numComments: 120,
      collectionJobId: jobId,
    },
    {
      contentId: contentRows[1]!.id,
      targetId,
      source: "reddit",
      observedAt: "2026-04-13T11:30:00.000Z",
      score: 80,
      numComments: 26,
      collectionJobId: jobId,
    },
    {
      contentId: contentRows[2]!.id,
      targetId,
      source: "reddit",
      observedAt: "2026-04-13T11:30:00.000Z",
      score: 35,
      numComments: 11,
      collectionJobId: jobId,
    },
  ]);
  await postEngagementRepository.upsertWindowedMany(
    contentRows.map((row, index) => ({
      targetId,
      contentId: row.id,
      source: "reddit" as const,
      windowStart: "2026-04-13T06:00:00.000Z",
      windowEnd: "2026-04-13T12:00:00.000Z",
      observedAt: "2026-04-13T11:30:00.000Z",
      score: [420, 80, 35][index],
      numComments: [120, 26, 11][index],
      collectionJobId: jobId,
    })),
  );

  const materializedCount = await materializeTouchedTargets({
    repos: {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      keywordTrendDailyRepository,
      anomalyEventRepository,
      subredditTrendPointRepository,
    },
    targets: [
      {
        targetId,
        canonicalName: "r/machinelearning",
        crawlMode: "live",
        scope: {
          affectedDays: ["2026-04-13"],
          affectedWindows: [
            {
              granularity: "6h",
              start: "2026-04-13T06:00:00.000Z",
              end: "2026-04-13T12:00:00.000Z",
            },
          ],
          reasons: ["coverage_update", "engagement_update", "new_content"],
        },
      },
    ],
    nowIso,
    env: {},
    runMode: "live",
  });

  assert.equal(materializedCount, 1);
  assert.deepEqual(order, ["daily", "trend", "driver", "keyword", "anomaly"]);
  assert.equal(anomalyEventRepository.all().length > 0, true);
});

test("materializeTouchedTargets narrows rebuild windows from explicit scope", async () => {
  const nowIso = "2026-04-28T09:30:00.000Z";
  const targetId = stableUuidFromString("reddit:target:r/programming");
  const jobId = stableUuidFromString("job:materialization:scope");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const postGrowthFactRepository = new InMemoryPostGrowthFactRepository();
  const keywordTrendDailyRepository = new InMemoryKeywordTrendDailyRepository();
  const anomalyEventRepository = new InMemoryAnomalyEventRepository();

  const oldContent = createContent({
    targetId,
    externalId: "t3_old_scope",
    title: "Older post that should stay out of narrowed rebuild",
    createdAtSource: "2026-04-25T10:10:00.000Z",
  });
  const recentContent = createContent({
    targetId,
    externalId: "t3_recent_scope",
    title: "Recent post that should be rebuilt",
    createdAtSource: "2026-04-27T18:10:00.000Z",
  });
  await contentRepository.upsertMany([oldContent, recentContent]);
  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-25T10:15:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "new_posts_15m",
      metricValue: 4,
      collectionJobId: jobId,
    },
    {
      snapshotAt: "2026-04-27T18:15:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "new_posts_15m",
      metricValue: 6,
      collectionJobId: jobId,
    },
  ]);
  await postEngagementRepository.upsertLatestMany([
    {
      contentId: oldContent.id,
      targetId,
      source: "reddit",
      observedAt: "2026-04-25T10:20:00.000Z",
      score: 80,
      numComments: 8,
      collectionJobId: jobId,
    },
    {
      contentId: recentContent.id,
      targetId,
      source: "reddit",
      observedAt: "2026-04-27T18:20:00.000Z",
      score: 160,
      numComments: 20,
      collectionJobId: jobId,
    },
  ]);
  await postEngagementRepository.upsertWindowedMany([
    {
      targetId,
      contentId: oldContent.id,
      source: "reddit",
      windowStart: "2026-04-25T06:00:00.000Z",
      windowEnd: "2026-04-25T12:00:00.000Z",
      observedAt: "2026-04-25T10:20:00.000Z",
      score: 80,
      numComments: 8,
      collectionJobId: jobId,
    },
    {
      targetId,
      contentId: recentContent.id,
      source: "reddit",
      windowStart: "2026-04-27T18:00:00.000Z",
      windowEnd: "2026-04-28T00:00:00.000Z",
      observedAt: "2026-04-27T18:20:00.000Z",
      score: 160,
      numComments: 20,
      collectionJobId: jobId,
    },
  ]);

  const materializedCount = await materializeTouchedTargets({
    repos: {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      keywordTrendDailyRepository,
      anomalyEventRepository,
      subredditTrendPointRepository,
    },
    targets: [createTouchedTargetFixture({
      targetId,
      canonicalName: "r/programming",
      crawlMode: "live",
      affectedDays: ["2026-04-27"],
      affectedWindows: [
        {
          granularity: "6h",
          start: "2026-04-27T18:00:00.000Z",
          end: "2026-04-28T00:00:00.000Z",
        },
      ],
      reasons: ["engagement_update"],
    })],
    nowIso,
    env: {},
    runMode: "live",
  });

  assert.equal(materializedCount, 1);
  assert.deepEqual(
    subredditTrendPointRepository.all().map((point) => point.windowStart),
    ["2026-04-27T18:00:00.000Z"],
  );
  assert.deepEqual(
    postGrowthFactRepository.all().map((fact) => fact.contentId),
    [recentContent.id],
  );
});

function createContent(args: {
  targetId: string;
  externalId: string;
  title: string;
  createdAtSource: string;
}) {
  const id = stableUuidFromString(`reddit:content:${args.externalId}`);
  return {
    id,
    source: "reddit" as const,
    targetId: args.targetId,
    externalId: args.externalId,
    kind: "post" as const,
    title: args.title,
    bodyText: `${args.title} details`,
    permalink: `/r/machinelearning/comments/${args.externalId}/post`,
    createdAtSource: args.createdAtSource,
    firstSeenAt: args.createdAtSource,
    lastSeenAt: args.createdAtSource,
  };
}

function createTouchedTargetFixture(args: {
  targetId: string;
  canonicalName: string;
  crawlMode: "live" | "backfill";
  affectedDays: string[];
  affectedWindows: TouchedTarget["scope"]["affectedWindows"];
  reasons: TouchedTarget["scope"]["reasons"];
}): TouchedTarget {
  return {
    targetId: args.targetId,
    canonicalName: args.canonicalName,
    crawlMode: args.crawlMode,
    scope: {
      affectedDays: args.affectedDays,
      affectedWindows: args.affectedWindows,
      reasons: args.reasons,
    },
  };
}
