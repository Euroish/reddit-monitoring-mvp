import assert from "node:assert/strict";
import test from "node:test";
import { buildPostGrowthFactsJob } from "../../src/jobs/build-post-growth-facts.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryPostEngagementRepository,
  InMemoryPostGrowthFactRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildPostGrowthFactsJob materializes 1h/6h/24h rows with cohort normalization", async () => {
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
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
  await postEngagementRepository.upsertLatestMany([
    engagement(targetId, content1hA, 90, 18, observedAt, "job:1ha"),
    engagement(targetId, content1hB, 36, 6, observedAt, "job:1hb"),
    engagement(targetId, content6h, 84, 12, observedAt, "job:6h"),
    engagement(targetId, content24h, 120, 20, observedAt, "job:24h"),
    engagement(targetId, contentOld, 300, 50, observedAt, "job:old"),
  ]);
  await postEngagementRepository.upsertWindowedMany([
    { ...engagement(targetId, content1hA, 30, 6, "2026-04-17T11:30:00.000Z", "job:prior1ha"), windowStart: "2026-04-17T11:30:00.000Z", windowEnd: "2026-04-17T11:45:00.000Z" },
    { ...engagement(targetId, content1hB, 30, 4, "2026-04-17T11:30:00.000Z", "job:prior1hb"), windowStart: "2026-04-17T11:30:00.000Z", windowEnd: "2026-04-17T11:45:00.000Z" },
    { ...engagement(targetId, content6h, 40, 4, "2026-04-17T09:00:00.000Z", "job:prior6h"), windowStart: "2026-04-17T06:00:00.000Z", windowEnd: "2026-04-17T12:00:00.000Z" },
    { ...engagement(targetId, content24h, 30, 4, "2026-04-16T18:00:00.000Z", "job:prior24h"), windowStart: "2026-04-16T18:00:00.000Z", windowEnd: "2026-04-17T00:00:00.000Z" },
  ]);

  const rows = await buildPostGrowthFactsJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
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
  assert.equal(rows.every((row) => row.algorithmVersion === "post_growth_v2_observation_delta"), true);
  assert.equal(rows.find((row) => row.contentId === content1hA)?.scoreVelocityPerHour, 120);
  assert.equal(rows.find((row) => row.contentId === content1hA)?.commentVelocityPerHour, 24);
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

test("growth requires two actual metric observations and preserves measured negative score changes", async () => {
  const targetId = stableUuidFromString("reddit:target:growth-evidence-target");
  const contentId = stableUuidFromString("reddit:content:growth-evidence-content");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const postGrowthFactRepository = new InMemoryPostGrowthFactRepository();
  await contentRepository.upsertMany([{ id: contentId, source: "reddit", targetId, externalId: "t3_delta", kind: "post", title: "Delta evidence", permalink: "/r/test/comments/delta", createdAtSource: "2026-04-17T10:00:00.000Z", firstSeenAt: "2026-04-17T10:00:00.000Z", lastSeenAt: "2026-04-17T10:00:00.000Z" }]);
  await postEngagementRepository.upsertLatestMany([engagement(targetId, contentId, -4, 0, "2026-04-17T12:00:00.000Z", "job:delta-current")]);
  const deps = { contentRepository, metricsSnapshotRepository, postEngagementRepository, postGrowthFactRepository };
  const input = { targetId, fromIso: "2026-04-17T11:00:00.000Z", toIso: "2026-04-17T12:30:00.000Z" };
  assert.deepEqual(await buildPostGrowthFactsJob(deps, input), [], "single cumulative snapshot has no calculable measured velocity");
  await postEngagementRepository.upsertWindowedMany([{ ...engagement(targetId, contentId, 2, 0, "2026-04-17T11:00:00.000Z", "job:delta-prior"), windowStart: "2026-04-17T06:00:00.000Z", windowEnd: "2026-04-17T12:00:00.000Z" }]);
  const rows = await buildPostGrowthFactsJob(deps, input);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.score, -4);
  assert.equal(rows[0]?.scoreVelocityPerHour, -6);
  assert.equal(rows[0]?.commentVelocityPerHour, 0);
  assert.deepEqual(rows[0]?.explainPayload.measurement, { method: "adjacent_recorded_observation_delta", scope: "stored_reddit_engagement_observations", from: "2026-04-17T11:00:00.000Z", to: "2026-04-17T12:00:00.000Z", intervalMinutes: 60, previousScore: 2, previousComments: 0, scoreDelta: -6, commentDelta: 0, signedScore: true });
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

function engagement(
  targetId: string,
  contentId: string,
  score: number,
  numComments: number,
  observedAt: string,
  jobSeed: string,
) {
  return {
    contentId,
    targetId,
    source: "reddit" as const,
    observedAt,
    score,
    numComments,
    collectionJobId: stableUuidFromString(jobSeed),
  };
}
