import assert from "node:assert/strict";
import test from "node:test";
import { buildPostGrowthFactsJob } from "../../src/jobs/build-post-growth-facts.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryPostGrowthFactRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildPostGrowthFactsJob materializes 1h/6h/24h rows with cohort normalization", async () => {
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postGrowthFactRepository = new InMemoryPostGrowthFactRepository();

  const content1hA = stableUuidFromString("reddit:content:t3_1ha");
  const content1hB = stableUuidFromString("reddit:content:t3_1hb");
  const content6h = stableUuidFromString("reddit:content:t3_6h");
  const content24h = stableUuidFromString("reddit:content:t3_24h");
  const contentOld = stableUuidFromString("reddit:content:t3_old");

  await contentRepository.upsertMany([
    {
      id: content1hA,
      source: "reddit",
      targetId,
      externalId: "t3_1ha",
      kind: "post",
      title: "Fast mover A",
      permalink: "/r/machinelearning/comments/1ha",
      createdAtSource: "2026-04-17T11:20:00.000Z",
      firstSeenAt: "2026-04-17T11:20:00.000Z",
      lastSeenAt: "2026-04-17T11:20:00.000Z",
    },
    {
      id: content1hB,
      source: "reddit",
      targetId,
      externalId: "t3_1hb",
      kind: "post",
      title: "Fast mover B",
      permalink: "/r/machinelearning/comments/1hb",
      createdAtSource: "2026-04-17T11:05:00.000Z",
      firstSeenAt: "2026-04-17T11:05:00.000Z",
      lastSeenAt: "2026-04-17T11:05:00.000Z",
    },
    {
      id: content6h,
      source: "reddit",
      targetId,
      externalId: "t3_6h",
      kind: "post",
      title: "Mid window mover",
      permalink: "/r/machinelearning/comments/6h",
      createdAtSource: "2026-04-17T08:30:00.000Z",
      firstSeenAt: "2026-04-17T08:30:00.000Z",
      lastSeenAt: "2026-04-17T08:30:00.000Z",
    },
    {
      id: content24h,
      source: "reddit",
      targetId,
      externalId: "t3_24h",
      kind: "post",
      title: "Day window mover",
      permalink: "/r/machinelearning/comments/24h",
      createdAtSource: "2026-04-16T16:00:00.000Z",
      firstSeenAt: "2026-04-16T16:00:00.000Z",
      lastSeenAt: "2026-04-16T16:00:00.000Z",
    },
    {
      id: contentOld,
      source: "reddit",
      targetId,
      externalId: "t3_old",
      kind: "post",
      title: "Too old",
      permalink: "/r/machinelearning/comments/old",
      createdAtSource: "2026-04-15T10:00:00.000Z",
      firstSeenAt: "2026-04-15T10:00:00.000Z",
      lastSeenAt: "2026-04-15T10:00:00.000Z",
    },
  ]);

  const observedAt = "2026-04-17T12:00:00.000Z";
  await metricsSnapshotRepository.appendMany([
    metric(targetId, content1hA, "score", 90, observedAt, "job:1ha:score"),
    metric(targetId, content1hA, "num_comments", 18, observedAt, "job:1ha:comments"),
    metric(targetId, content1hB, "score", 36, observedAt, "job:1hb:score"),
    metric(targetId, content1hB, "num_comments", 6, observedAt, "job:1hb:comments"),
    metric(targetId, content6h, "score", 84, observedAt, "job:6h:score"),
    metric(targetId, content6h, "num_comments", 12, observedAt, "job:6h:comments"),
    metric(targetId, content24h, "score", 120, observedAt, "job:24h:score"),
    metric(targetId, content24h, "num_comments", 20, observedAt, "job:24h:comments"),
    metric(targetId, contentOld, "score", 300, observedAt, "job:old:score"),
    metric(targetId, contentOld, "num_comments", 50, observedAt, "job:old:comments"),
  ]);

  const rows = await buildPostGrowthFactsJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postGrowthFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-17T00:00:00.000Z",
      toIso: "2026-04-17T12:30:00.000Z",
    },
  );

  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((row) => row.ageBucket).sort(),
    ["1h", "1h", "24h", "6h"],
  );
  assert.equal(rows.every((row) => row.algorithmVersion === "post_growth_v1"), true);
  assert.equal(rows.every((row) => row.driverScore >= 0 && row.driverScore <= 100), true);
  assert.equal(rows.every((row) => row.explainPayload && typeof row.explainPayload === "object"), true);

  const firstHourRows = rows.filter((row) => row.ageBucket === "1h");
  assert.equal(firstHourRows.length, 2);
  assert.equal(firstHourRows[0]?.cohortPostCount, 2);
  assert.equal(firstHourRows[1]?.cohortPostCount, 2);
  assert.equal(
    firstHourRows.some((row) => row.velocityZScore > 0) &&
      firstHourRows.some((row) => row.velocityZScore < 0),
    true,
  );

  const singleCohortRows = rows.filter((row) => row.ageBucket !== "1h");
  assert.equal(singleCohortRows.every((row) => row.cohortPostCount === 1), true);
  assert.equal(singleCohortRows.every((row) => row.velocityZScore === 0), true);

  assert.equal(postGrowthFactRepository.all().length, 4);
});

test("buildPostGrowthFactsJob skips invalid range", async () => {
  const rows = await buildPostGrowthFactsJob(
    {
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      postGrowthFactRepository: new InMemoryPostGrowthFactRepository(),
    },
    {
      targetId: stableUuidFromString("reddit:target:r/datascience"),
      fromIso: "2026-04-18T00:00:00.000Z",
      toIso: "2026-04-17T00:00:00.000Z",
    },
  );

  assert.deepEqual(rows, []);
});

function metric(
  targetId: string,
  contentId: string,
  metricName: "score" | "num_comments",
  metricValue: number,
  snapshotAt: string,
  jobSeed: string,
) {
  return {
    snapshotAt,
    source: "reddit" as const,
    targetId,
    contentId,
    granularity: "15m" as const,
    metricName,
    metricValue,
    collectionJobId: stableUuidFromString(jobSeed),
  };
}
