import type { Content } from "../domain/entities/content";
import type { PostEngagementLatest, PostEngagementWindow } from "../domain/entities/post-engagement";
import type { PostGrowthAgeBucket, PostGrowthFact } from "../domain/entities/post-growth-fact";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { PostEngagementRepository } from "../domain/repositories/post-engagement-repository";
import type { PostGrowthFactRepository } from "../domain/repositories/post-growth-fact-repository";

const MAX_AGE_MINUTES = 24 * 60;
const ONE_HOUR_MINUTES = 60;
const SIX_HOURS_MINUTES = 6 * 60;
const COMMENT_VELOCITY_WEIGHT = 0.5;
const DRIVER_SCORE_BASE = 50;
const DRIVER_SCORE_ZSCALE = 15;

export interface BuildPostGrowthFactsDependencies {
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  postEngagementRepository?: PostEngagementRepository;
  postGrowthFactRepository: PostGrowthFactRepository;
}

export interface BuildPostGrowthFactsInput {
  targetId: string;
  fromIso: string;
  toIso: string;
}

interface CandidateGrowthRow {
  targetId: string;
  contentId: string;
  ageBucket: PostGrowthAgeBucket;
  observedAt: string;
  ageMinutes: number;
  score: number;
  comments: number;
  scoreVelocityPerHour: number;
  commentVelocityPerHour: number;
  combinedVelocity: number;
  createdAtSource: string;
  previousObservedAt: string;
  previousScore: number;
  previousComments: number;
  observationIntervalMinutes: number;
}

export async function buildPostGrowthFactsJob(
  deps: BuildPostGrowthFactsDependencies,
  input: BuildPostGrowthFactsInput,
): Promise<PostGrowthFact[]> {
  const fromDate = new Date(input.fromIso);
  const toDate = new Date(input.toIso);
  if (
    !Number.isFinite(fromDate.getTime()) ||
    !Number.isFinite(toDate.getTime()) ||
    fromDate > toDate
  ) {
    return [];
  }

  const contentFromIso = new Date(fromDate.getTime() - MAX_AGE_MINUTES * 60 * 1000).toISOString();
  const contents = await deps.contentRepository.findByTargetCreatedAtRange({
    targetId: input.targetId,
    from: contentFromIso,
    to: input.toIso,
    limit: 100_000,
  });
  const contentIds = contents.map((content) => content.id);
  const latestMetricsByContentId = new Map<string, PostEngagementLatest>();
  let windows: PostEngagementWindow[] = [];
  if (deps.postEngagementRepository && contentIds.length > 0) {
    const [rows, observedWindows] = await Promise.all([deps.postEngagementRepository.listLatestByContentIdsInRange({
      contentIds,
      from: input.fromIso,
      to: input.toIso,
    }), deps.postEngagementRepository.listWindowedByTargetInRange({
      targetId: input.targetId,
      from: new Date(fromDate.getTime() - MAX_AGE_MINUTES * 60 * 1000).toISOString(),
      to: input.toIso,
    })]);
    windows = observedWindows;
    for (const row of rows) {
      latestMetricsByContentId.set(row.contentId, row);
    }
  }

  const contentById = new Map(contents.map((content) => [content.id, content] as const));
  const candidates = buildCandidates(input.targetId, contentById, latestMetricsByContentId, windows);
  if (candidates.length === 0) {
    return [];
  }

  const candidatesByBucket = groupByAgeBucket(candidates);
  const output: PostGrowthFact[] = [];
  for (const [bucket, rows] of candidatesByBucket.entries()) {
    const cohortPostCount = rows.length;
    const scoreVelocities = rows.map((row) => row.scoreVelocityPerHour);
    const commentVelocities = rows.map((row) => row.commentVelocityPerHour);
    const combinedVelocities = rows.map((row) => row.combinedVelocity);

    const medianScoreVelocity = median(scoreVelocities);
    const medianCommentVelocity = median(commentVelocities);
    const medianCombinedVelocity = median(combinedVelocities);
    const madCombinedVelocity = median(
      combinedVelocities.map((value) => Math.abs(value - medianCombinedVelocity)),
    );
    const robustScale = madCombinedVelocity > 0 ? madCombinedVelocity * 1.4826 : 0;

    for (const row of rows) {
      const velocityZScore =
        robustScale > 0 ? (row.combinedVelocity - medianCombinedVelocity) / robustScale : 0;
      const driverScore = clamp(
        DRIVER_SCORE_BASE + velocityZScore * DRIVER_SCORE_ZSCALE,
        0,
        100,
      );
      output.push({
        targetId: row.targetId,
        contentId: row.contentId,
        ageBucket: bucket,
        observedAt: row.observedAt,
        ageMinutes: row.ageMinutes,
        score: row.score,
        comments: row.comments,
        scoreVelocityPerHour: Number(row.scoreVelocityPerHour.toFixed(6)),
        commentVelocityPerHour: Number(row.commentVelocityPerHour.toFixed(6)),
        cohortPostCount,
        cohortMedianScoreVelocity: Number(medianScoreVelocity.toFixed(6)),
        cohortMedianCommentVelocity: Number(medianCommentVelocity.toFixed(6)),
        velocityZScore: Number(velocityZScore.toFixed(6)),
        driverScore: Number(driverScore.toFixed(6)),
        algorithmVersion: "post_growth_v2_observation_delta",
        explainPayload: {
          sourceMetrics: {
            createdAtSource: row.createdAtSource,
            observedAt: row.observedAt,
            ageMinutes: row.ageMinutes,
            score: row.score,
            comments: row.comments,
          },
          measurement: {
            method: "adjacent_recorded_observation_delta",
            scope: "stored_reddit_engagement_observations",
            from: row.previousObservedAt,
            to: row.observedAt,
            intervalMinutes: row.observationIntervalMinutes,
            previousScore: row.previousScore,
            previousComments: row.previousComments,
            scoreDelta: row.score - row.previousScore,
            commentDelta: row.comments - row.previousComments,
            signedScore: true,
          },
          cohort: {
            ageBucket: bucket,
            cohortPostCount,
            medianScoreVelocity: Number(medianScoreVelocity.toFixed(6)),
            medianCommentVelocity: Number(medianCommentVelocity.toFixed(6)),
            medianCombinedVelocity: Number(medianCombinedVelocity.toFixed(6)),
            madCombinedVelocity: Number(madCombinedVelocity.toFixed(6)),
          },
          normalized: {
            combinedVelocity: Number(row.combinedVelocity.toFixed(6)),
            velocityZScore: Number(velocityZScore.toFixed(6)),
          },
        },
      });
    }
  }

  output.sort((a, b) => {
    const byObserved = a.observedAt.localeCompare(b.observedAt);
    if (byObserved !== 0) {
      return byObserved;
    }
    const byBucket = a.ageBucket.localeCompare(b.ageBucket);
    if (byBucket !== 0) {
      return byBucket;
    }
    return a.contentId.localeCompare(b.contentId);
  });

  await deps.postGrowthFactRepository.upsertMany(output);
  return output;
}

function buildCandidates(
  targetId: string,
  contentById: Map<string, Content>,
  latestMetricsByContentId: Map<string, PostEngagementLatest>,
  windows: PostEngagementWindow[],
): CandidateGrowthRow[] {
  const rows: CandidateGrowthRow[] = [];
  const windowsByContent = new Map<string, PostEngagementWindow[]>();
  for (const window of windows) {
    const current = windowsByContent.get(window.contentId) ?? [];
    current.push(window);
    windowsByContent.set(window.contentId, current);
  }
  for (const [contentId, metrics] of latestMetricsByContentId.entries()) {
    const content = contentById.get(contentId);
    if (!content) {
      continue;
    }
    const ageMinutes = diffMinutes(metrics.observedAt, content.createdAtSource);
    if (ageMinutes < 0 || ageMinutes > MAX_AGE_MINUTES) {
      continue;
    }
    const ageBucket = resolveAgeBucket(ageMinutes);
    const previous = (windowsByContent.get(contentId) ?? [])
      .filter((row) => row.observedAt < metrics.observedAt && row.observedAt >= content.createdAtSource)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    // A single cumulative snapshot or missing metric cannot establish a measured velocity.
    if (!previous || ![metrics.score, metrics.numComments, previous.score, previous.numComments].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    const observationIntervalMinutes = (Date.parse(metrics.observedAt) - Date.parse(previous.observedAt)) / 60_000;
    if (observationIntervalMinutes <= 0 || observationIntervalMinutes > MAX_AGE_MINUTES) continue;
    const score = metrics.score!;
    const comments = metrics.numComments!;
    const scoreVelocityPerHour = (score - previous.score!) * 60 / observationIntervalMinutes;
    const commentVelocityPerHour = (comments - previous.numComments!) * 60 / observationIntervalMinutes;
    rows.push({
      targetId,
      contentId,
      ageBucket,
      observedAt: metrics.observedAt,
      ageMinutes,
      score,
      comments,
      scoreVelocityPerHour,
      commentVelocityPerHour,
      combinedVelocity:
        scoreVelocityPerHour + COMMENT_VELOCITY_WEIGHT * commentVelocityPerHour,
      createdAtSource: content.createdAtSource,
      previousObservedAt: previous.observedAt,
      previousScore: previous.score!,
      previousComments: previous.numComments!,
      observationIntervalMinutes,
    });
  }
  return rows;
}

function groupByAgeBucket(rows: CandidateGrowthRow[]): Map<PostGrowthAgeBucket, CandidateGrowthRow[]> {
  const grouped = new Map<PostGrowthAgeBucket, CandidateGrowthRow[]>();
  for (const row of rows) {
    const current = grouped.get(row.ageBucket) ?? [];
    current.push(row);
    grouped.set(row.ageBucket, current);
  }
  return grouped;
}

function resolveAgeBucket(ageMinutes: number): PostGrowthAgeBucket {
  if (ageMinutes <= ONE_HOUR_MINUTES) {
    return "1h";
  }
  if (ageMinutes <= SIX_HOURS_MINUTES) {
    return "6h";
  }
  return "24h";
}

function diffMinutes(lateIso: string, earlyIso: string): number {
  const late = new Date(lateIso).getTime();
  const early = new Date(earlyIso).getTime();
  if (!Number.isFinite(late) || !Number.isFinite(early)) {
    return -1;
  }
  return Math.floor((late - early) / (60 * 1000));
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
