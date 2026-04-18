import assert from "node:assert/strict";
import test from "node:test";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAnomalyEventRepository,
  InMemoryContentRepository,
  InMemoryKeywordTrendDailyRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryPostGrowthFactRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { materializeTouchedTargets } from "../../workers/reddit-phase1-scheduler";

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
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentRows[0]!.id,
      granularity: "15m",
      metricName: "score",
      metricValue: 420,
      collectionJobId: jobId,
    },
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentRows[0]!.id,
      granularity: "15m",
      metricName: "num_comments",
      metricValue: 120,
      collectionJobId: jobId,
    },
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentRows[1]!.id,
      granularity: "15m",
      metricName: "score",
      metricValue: 80,
      collectionJobId: jobId,
    },
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentRows[1]!.id,
      granularity: "15m",
      metricName: "num_comments",
      metricValue: 26,
      collectionJobId: jobId,
    },
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentRows[2]!.id,
      granularity: "15m",
      metricName: "score",
      metricValue: 35,
      collectionJobId: jobId,
    },
    {
      snapshotAt: "2026-04-13T11:30:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentRows[2]!.id,
      granularity: "15m",
      metricName: "num_comments",
      metricValue: 11,
      collectionJobId: jobId,
    },
  ]);

  const materializedCount = await materializeTouchedTargets({
    repos: {
      contentRepository,
      metricsSnapshotRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      keywordTrendDailyRepository,
      anomalyEventRepository,
      subredditTrendPointRepository,
    },
    targets: [
      {
        targetId,
        crawlMode: "live",
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
