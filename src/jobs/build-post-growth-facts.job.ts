import type { Content } from "../domain/entities/content";
import type { MetricsSnapshot } from "../domain/entities/metrics-snapshot";
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
  const latestMetricsByContentId = new Map<
    string,
    { observedAt: string; score?: number; comments?: number }
  >();
  if (deps.postEngagementRepository && contentIds.length > 0) {
    const rows = await deps.postEngagementRepository.listLatestByContentIdsInRange({
      contentIds,
      from: input.fromIso,
      to: input.toIso,
    });
    for (const row of rows) {
      latestMetricsByContentId.set(row.contentId, {
        observedAt: row.observedAt,
        score: row.score,
        comments: row.numComments,
      });
    }
  }

  const contentById = new Map(contents.map((content) => [content.id, content] as const));
  const candidates = buildCandidates(input.targetId, contentById, latestMetricsByContentId);
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
        algorithmVersion: "post_growth_v1",
        explainPayload: {
          sourceMetrics: {
            createdAtSource: row.createdAtSource,
            observedAt: row.observedAt,
            ageMinutes: row.ageMinutes,
            score: row.score,
            comments: row.comments,
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

function resolveLatestMetricsByContentId(
  snapshots: MetricsSnapshot[],
): Map<string, { observedAt: string; score?: number; comments?: number }> {
  const latestByContent = new Map<string, { observedAt: string; score?: number; comments?: number }>();

  for (const snapshot of snapshots) {
    if (!snapshot.contentId) {
      continue;
    }
    const current = latestByContent.get(snapshot.contentId);
    if (!current || snapshot.snapshotAt >= current.observedAt) {
      const next = current
        ? { ...current, observedAt: snapshot.snapshotAt }
        : { observedAt: snapshot.snapshotAt };
      if (snapshot.metricName === "score") {
        next.score = Number(snapshot.metricValue);
      }
      if (snapshot.metricName === "num_comments") {
        next.comments = Number(snapshot.metricValue);
      }
      latestByContent.set(snapshot.contentId, next);
    }
  }

  return latestByContent;
}

function buildCandidates(
  targetId: string,
  contentById: Map<string, Content>,
  latestMetricsByContentId: Map<string, { observedAt: string; score?: number; comments?: number }>,
): CandidateGrowthRow[] {
  const rows: CandidateGrowthRow[] = [];
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
    const score = Math.max(0, Math.round(metrics.score ?? 0));
    const comments = Math.max(0, Math.round(metrics.comments ?? 0));
    const ageHours = Math.max(ageMinutes / 60, 1 / 60);
    const scoreVelocityPerHour = score / ageHours;
    const commentVelocityPerHour = comments / ageHours;
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
