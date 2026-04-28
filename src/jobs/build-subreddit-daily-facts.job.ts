import type { Content } from "../domain/entities/content";
import type { MetricsSnapshot } from "../domain/entities/metrics-snapshot";
import type { SubredditDailyFact } from "../domain/entities/subreddit-daily-fact";
import { scoreSubredditDailyFacts } from "../domain/services/subreddit-daily-heat.service";
import {
  isQualifiedDailyPost,
  resolveDailyQualityThreshold,
} from "../domain/services/quality-threshold.service";
import { resolveSubredditTier } from "../domain/services/subreddit-tiering.service";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { SubredditDailyFactRepository } from "../domain/repositories/subreddit-daily-fact-repository";

const IMPACT_COMMENT_WEIGHT = 1.25;
const HIGH_IMPACT_THRESHOLD = 6;

export interface BuildSubredditDailyFactsDependencies {
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
}

export interface BuildSubredditDailyFactsInput {
  targetId: string;
  fromIso: string;
  toIso: string;
}

export async function buildSubredditDailyFactsJob(
  deps: BuildSubredditDailyFactsDependencies,
  input: BuildSubredditDailyFactsInput,
): Promise<SubredditDailyFact[]> {
  const days = enumerateUtcDays(input.fromIso, input.toIso);
  if (days.length === 0) {
    return [];
  }

  const aboutFromIso = new Date(
    new Date(`${days[0]}T00:00:00.000Z`).getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const [posts, engagementSnapshots, aboutSnapshots] = await Promise.all([
    deps.contentRepository.findByTargetCreatedAtRange({
      targetId: input.targetId,
      from: input.fromIso,
      to: input.toIso,
      limit: 50_000,
      totalEligibleOnly: true,
    }),
    deps.metricsSnapshotRepository.listByTargetInRange({
      targetId: input.targetId,
      from: input.fromIso,
      to: input.toIso,
      metricNames: ["score", "num_comments", "new_posts_15m"],
    }),
    deps.metricsSnapshotRepository.listByTargetInRange({
      targetId: input.targetId,
      from: aboutFromIso,
      to: input.toIso,
      metricNames: ["subscribers", "active_users"],
    }),
  ]);

  const postsByDay = groupPostsByDay(posts);
  const latestMetricsByContentId = resolveLatestPostMetricsByContentId(engagementSnapshots);
  const observedDays = resolveObservedDays(days, posts, engagementSnapshots);
  const aboutSignalsByDay = resolveAboutSignalsByDay(days, aboutSnapshots);

  const drafts = days.flatMap((day) => {
    if (!observedDays.has(day)) {
      return [];
    }
    const dayPosts = postsByDay.get(day) ?? [];
    const postSignals = dayPosts.map((post) => {
      const metrics = latestMetricsByContentId.get(post.id) ?? { score: 0, comments: 0 };
      const score = Math.max(0, metrics.score);
      const comments = Math.max(0, metrics.comments);
      const sampled = latestMetricsByContentId.has(post.id);
      const impactContribution = log1p(score) + IMPACT_COMMENT_WEIGHT * log1p(comments);
      return {
        score,
        comments,
        sampled,
        active: score > 0 || comments > 0,
        impactContribution,
      };
    });
    const about = aboutSignalsByDay.get(day) ?? {
      subscribers: 0,
      activeUsers: 0,
      carryMode: "empty" as const,
    };
    const subredditTier = resolveSubredditTier(about.subscribers);
    const qualityThreshold = resolveDailyQualityThreshold({
      tier: subredditTier,
      posts: postSignals,
    });

    let scoreSum = 0;
    let commentSum = 0;
    let sampledPostVolume = 0;
    let qualifiedPostVolume = 0;
    let activePostCount = 0;
    let impactScoreSum = 0;
    let impactPostVolume = 0;
    const impactContributions: number[] = [];

    for (const signal of postSignals) {
      scoreSum += signal.score;
      commentSum += signal.comments;
      if (signal.sampled) {
        sampledPostVolume += 1;
      }
      if (signal.active) {
        activePostCount += 1;
      }
      if (
        isQualifiedDailyPost({
          score: signal.score,
          comments: signal.comments,
          threshold: qualityThreshold,
        })
      ) {
        qualifiedPostVolume += 1;
      }
      impactScoreSum += signal.impactContribution;
      impactContributions.push(signal.impactContribution);
      if (signal.impactContribution >= HIGH_IMPACT_THRESHOLD) {
        impactPostVolume += 1;
      }
    }

    const unsampledObservedDay = dayPosts.length > 0 && sampledPostVolume === 0;

    return [{
      targetId: input.targetId,
      day,
      postVolume: dayPosts.length,
      qualifiedPostVolume,
      sampledPostVolume,
      scoreSum: Math.round(scoreSum),
      commentSum: Math.round(commentSum),
      subscriberCount: about.subscribers,
      activeUserCount: about.activeUsers,
      activePostRatio:
        sampledPostVolume > 0 ? activePostCount / sampledPostVolume : 0,
      dispersionScore: computeDispersionScore(
        postSignals.map((signal) => signal.score + 0.5 * signal.comments),
      ),
      impactScoreSum,
      impactPostVolume,
      topImpactShare: computeTopShare(impactContributions, 3),
      subredditTier,
      qualityThresholdScore: qualityThreshold.score,
      qualityThresholdComments: qualityThreshold.comments,
      explainPayload: {
        sampledPostVolume,
        percentileScore: qualityThreshold.percentileScore,
        percentileComments: qualityThreshold.percentileComments,
        subscriberCount: about.subscribers,
        activeUserCount: about.activeUsers,
        observedDay: true,
        unsampledObservedDay,
        aboutSnapshotCarryMode: about.carryMode,
      },
    }];
  });

  const facts = scoreSubredditDailyFacts(drafts);
  await deps.subredditDailyFactRepository.replaceRange({
    targetId: input.targetId,
    fromDay: days[0]!,
    toDay: days[days.length - 1]!,
    facts,
  });
  return facts;
}

function enumerateUtcDays(fromIso: string, toIso: string): string[] {
  const start = new Date(fromIso);
  const end = new Date(toIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    return [];
  }
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const finalDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const days: string[] = [];
  while (cursor <= finalDay) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function groupPostsByDay(posts: Content[]): Map<string, Content[]> {
  const byDay = new Map<string, Content[]>();
  for (const post of posts) {
    const day = toUtcDay(post.createdAtSource);
    const current = byDay.get(day) ?? [];
    current.push(post);
    byDay.set(day, current);
  }
  return byDay;
}

function resolveLatestPostMetricsByContentId(
  snapshots: MetricsSnapshot[],
): Map<string, { score: number; comments: number }> {
  const latestMetricByContentAndName = new Map<string, { snapshotAt: string; value: number }>();

  for (const snapshot of snapshots) {
    if (!snapshot.contentId) {
      continue;
    }
    const key = `${snapshot.contentId}|${snapshot.metricName}`;
    const current = latestMetricByContentAndName.get(key);
    if (!current || snapshot.snapshotAt > current.snapshotAt) {
      latestMetricByContentAndName.set(key, {
        snapshotAt: snapshot.snapshotAt,
        value: Number(snapshot.metricValue),
      });
    }
  }

  const result = new Map<string, { score: number; comments: number }>();
  for (const [key, metric] of latestMetricByContentAndName.entries()) {
    const [contentId, metricName] = key.split("|", 2);
    if (!contentId || !metricName) {
      continue;
    }
    const current = result.get(contentId) ?? { score: 0, comments: 0 };
    if (metricName === "score") {
      current.score = metric.value;
    }
    if (metricName === "num_comments") {
      current.comments = metric.value;
    }
    result.set(contentId, current);
  }
  return result;
}

function resolveObservedDays(
  days: string[],
  posts: Content[],
  snapshots: MetricsSnapshot[],
): Set<string> {
  const daySet = new Set(days);
  const observed = new Set<string>();

  for (const post of posts) {
    const day = toUtcDay(post.createdAtSource);
    if (daySet.has(day)) {
      observed.add(day);
    }
  }

  for (const snapshot of snapshots) {
    if (snapshot.metricName !== "new_posts_15m") {
      continue;
    }
    const day = toUtcDay(snapshot.snapshotAt);
    if (daySet.has(day)) {
      observed.add(day);
    }
  }

  return observed;
}

function resolveAboutSignalsByDay(
  days: string[],
  snapshots: MetricsSnapshot[],
): Map<string, {
  subscribers: number;
  activeUsers: number;
  carryMode: "historical_backfill" | "forward_fill" | "snapshot_exact" | "empty";
}> {
  const sortedSnapshots = [...snapshots].sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
  const result = new Map<string, {
    subscribers: number;
    activeUsers: number;
    carryMode: "historical_backfill" | "forward_fill" | "snapshot_exact" | "empty";
  }>();
  let currentSubscribers = 0;
  let currentActiveUsers = 0;
  let currentCarryMode: "historical_backfill" | "forward_fill" | "snapshot_exact" | "empty" = "empty";
  let snapshotIndex = 0;

  if (sortedSnapshots.length > 0) {
    const earliestSubscribers = sortedSnapshots.find((snapshot) => snapshot.metricName === "subscribers");
    const earliestActiveUsers = sortedSnapshots.find((snapshot) => snapshot.metricName === "active_users");
    if (earliestSubscribers) {
      currentSubscribers = Math.max(0, Math.round(Number(earliestSubscribers.metricValue)));
      currentCarryMode = "historical_backfill";
    }
    if (earliestActiveUsers) {
      currentActiveUsers = Math.max(0, Math.round(Number(earliestActiveUsers.metricValue)));
      currentCarryMode = currentCarryMode === "empty" ? "historical_backfill" : currentCarryMode;
    }
  }

  for (const day of days) {
    const dayEndIso = `${day}T23:59:59.999Z`;
    let daySawSnapshot = false;
    while (
      snapshotIndex < sortedSnapshots.length &&
      sortedSnapshots[snapshotIndex]!.snapshotAt <= dayEndIso
    ) {
      const snapshot = sortedSnapshots[snapshotIndex]!;
      if (snapshot.metricName === "subscribers") {
        currentSubscribers = Math.max(0, Math.round(Number(snapshot.metricValue)));
      }
      if (snapshot.metricName === "active_users") {
        currentActiveUsers = Math.max(0, Math.round(Number(snapshot.metricValue)));
      }
      daySawSnapshot = true;
      snapshotIndex += 1;
    }
    result.set(day, {
      subscribers: currentSubscribers,
      activeUsers: currentActiveUsers,
      carryMode: daySawSnapshot
        ? "snapshot_exact"
        : currentCarryMode === "historical_backfill"
          ? "historical_backfill"
          : currentCarryMode === "empty"
            ? "empty"
            : "forward_fill",
    });
    if (daySawSnapshot) {
      currentCarryMode = "forward_fill";
    }
  }

  return result;
}

function computeDispersionScore(contributions: number[]): number {
  const nonNegative = contributions.map((value) => Math.max(0, value));
  const total = nonNegative.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || nonNegative.length <= 1) {
    return 0;
  }

  let concentration = 0;
  for (const value of nonNegative) {
    const share = value / total;
    concentration += share * share;
  }

  const count = nonNegative.length;
  const normalizedDiversity = (1 - concentration) / (1 - 1 / count);
  return Number(Math.min(1, Math.max(0, normalizedDiversity)).toFixed(6));
}

function computeTopShare(values: number[], topN: number): number {
  if (values.length === 0) {
    return 0;
  }
  const nonNegative = values.map((value) => Math.max(0, value));
  const total = nonNegative.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }
  const topSum = [...nonNegative]
    .sort((a, b) => b - a)
    .slice(0, topN)
    .reduce((sum, value) => sum + value, 0);
  return Number(Math.min(1, Math.max(0, topSum / total)).toFixed(6));
}

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function log1p(value: number): number {
  return Math.log(1 + Math.max(0, value));
}
