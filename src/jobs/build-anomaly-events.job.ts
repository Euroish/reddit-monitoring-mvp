import type { AnomalyEvent } from "../domain/entities/anomaly-event";
import type { KeywordTrendDaily } from "../domain/entities/keyword-trend-daily";
import type { PostGrowthAgeBucket } from "../domain/entities/post-growth-fact";
import type { AnomalyEventRepository } from "../domain/repositories/anomaly-event-repository";
import type { KeywordTrendDailyRepository } from "../domain/repositories/keyword-trend-daily-repository";
import type { PostGrowthFactRepository } from "../domain/repositories/post-growth-fact-repository";
import type { SubredditDailyFactRepository } from "../domain/repositories/subreddit-daily-fact-repository";
import type { SubredditTrendPointRepository } from "../domain/repositories/subreddit-trend-point-repository";
import { ANOMALY_EVENT_DEFAULTS } from "./anomaly-event-defaults";

const ANOMALY_ALGORITHM_VERSION = ANOMALY_EVENT_DEFAULTS.algorithmVersion;
const VOLUME_SCORE_MIN = ANOMALY_EVENT_DEFAULTS.minScore.volume;
const QUALITY_SCORE_MIN = ANOMALY_EVENT_DEFAULTS.minScore.quality;
const KEYWORD_SCORE_MIN = ANOMALY_EVENT_DEFAULTS.minScore.keyword;
const DRIVER_SCORE_MIN = ANOMALY_EVENT_DEFAULTS.minScore.driver;
const QUALITY_TIER_SCORE_MIN = ANOMALY_EVENT_DEFAULTS.qualityTierScoreMin;
const QUALITY_BASELINE_FLOOR_BY_TIER = ANOMALY_EVENT_DEFAULTS.qualityBaselineFloorByTier;
const MAX_KEYWORD_EVENTS_PER_DAY = ANOMALY_EVENT_DEFAULTS.maxKeywordEventsPerDay;
const DRIVER_EVENT_LIMIT = ANOMALY_EVENT_DEFAULTS.driverEventLimit;

export interface BuildAnomalyEventsDependencies {
  anomalyEventRepository: AnomalyEventRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  subredditDailyFactRepository?: SubredditDailyFactRepository;
  keywordTrendDailyRepository?: KeywordTrendDailyRepository;
  postGrowthFactRepository?: PostGrowthFactRepository;
}

export interface BuildAnomalyEventsInput {
  targetId: string;
  fromIso: string;
  toIso: string;
}

export async function buildAnomalyEventsJob(
  deps: BuildAnomalyEventsDependencies,
  input: BuildAnomalyEventsInput,
): Promise<AnomalyEvent[]> {
  const fromDate = new Date(input.fromIso);
  const toDate = new Date(input.toIso);
  if (
    !Number.isFinite(fromDate.getTime()) ||
    !Number.isFinite(toDate.getTime()) ||
    fromDate > toDate
  ) {
    return [];
  }

  const fromDay = toUtcDay(input.fromIso);
  const toDay = toUtcDay(input.toIso);
  const [trendPoints, dailyFacts, keywordRows, driverRows] = await Promise.all([
    deps.subredditTrendPointRepository.listByTargetInRange({
      targetId: input.targetId,
      from: input.fromIso,
      to: input.toIso,
    }),
    deps.subredditDailyFactRepository?.listByTargetInRange({
      targetId: input.targetId,
      fromDay,
      toDay,
    }) ?? Promise.resolve([]),
    deps.keywordTrendDailyRepository?.listByTargetInRange({
      targetId: input.targetId,
      fromDay,
      toDay,
      tracks: ["auto_keyword", "explicit_query"],
    }) ?? Promise.resolve([]),
    deps.postGrowthFactRepository?.listTopByTargetInRange({
      targetId: input.targetId,
      fromIso: input.fromIso,
      toIso: input.toIso,
      limit: DRIVER_EVENT_LIMIT,
    }) ?? Promise.resolve([]),
  ]);

  const candidateRows: AnomalyEvent[] = [];
  candidateRows.push(...buildVolumeEvents(input.targetId, trendPoints));
  candidateRows.push(...buildQualityEvents(input.targetId, dailyFacts));
  candidateRows.push(...buildKeywordEvents(input.targetId, keywordRows));
  candidateRows.push(...buildDriverEvents(input.targetId, driverRows));

  const rows = dedupeAndSort(candidateRows);
  if (rows.length > 0) {
    await deps.anomalyEventRepository.upsertMany(rows);
  }
  return rows;
}

function buildVolumeEvents(
  targetId: string,
  trendPoints: Awaited<ReturnType<SubredditTrendPointRepository["listByTargetInRange"]>>,
): AnomalyEvent[] {
  const rows: AnomalyEvent[] = [];
  for (const point of trendPoints) {
    const score = clamp(
      Math.max(
        point.anomalyScore ?? 0,
        0.7 * normalizeTrendScore(point.trendScore ?? 0) + 0.3 * clamp(point.surgeScore ?? 0, 0, 1),
      ),
      0,
      1,
    );
    if (score < VOLUME_SCORE_MIN) {
      continue;
    }

    rows.push({
      targetId,
      signalType: "volume",
      signalKey: "subreddit",
      observedAt: point.windowEnd,
      windowStart: point.windowStart,
      windowEnd: point.windowEnd,
      anomalyScore: toFixedNumber(score),
      algorithmVersion: ANOMALY_ALGORITHM_VERSION,
      explainPayload: {
        source: "subreddit_trend_point",
        trendWindow: {
          granularity: point.granularity ?? "6h",
          newPosts: point.newPosts,
          deltaNewPostsVsPrevWindow: point.deltaNewPostsVsPrevWindow,
          trendScore: point.trendScore,
          anomalyScore: point.anomalyScore ?? 0,
          surgeScore: point.surgeScore ?? 0,
        },
      },
    });
  }

  return rows;
}

function buildQualityEvents(
  targetId: string,
  dailyFacts: Awaited<ReturnType<SubredditDailyFactRepository["listByTargetInRange"]>>,
): AnomalyEvent[] {
  const rows: AnomalyEvent[] = [];
  const sorted = [...dailyFacts].sort((a, b) => a.day.localeCompare(b.day));
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    if (current.postVolume <= 0) {
      continue;
    }
    const baselineCandidates = sorted
      .slice(Math.max(0, index - 7), index)
      .filter((item) => item.postVolume > 0)
      .map((item) => item.qualifiedPostVolume / item.postVolume);
    if (baselineCandidates.length < 2) {
      continue;
    }

    const qualityRate = current.qualifiedPostVolume / current.postVolume;
    const baselineRate = median(baselineCandidates);
    const direction = qualityRate >= baselineRate ? "up" : "down";
    const signedDelta = qualityRate - baselineRate;
    const baselineFloor = QUALITY_BASELINE_FLOOR_BY_TIER[current.subredditTier] ?? 0.08;
    const deviation = Math.abs(signedDelta) / Math.max(baselineFloor, baselineRate);
    const score = clamp(
      0.75 * clamp(deviation, 0, 1) + 0.25 * clamp(Math.abs(current.heatChangePct), 0, 1),
      0,
      1,
    );
    const qualityScoreMin = QUALITY_TIER_SCORE_MIN[current.subredditTier] ?? QUALITY_SCORE_MIN;
    if (score < qualityScoreMin) {
      continue;
    }

    const windowStart = `${current.day}T00:00:00.000Z`;
    const windowEnd = new Date(new Date(windowStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
    rows.push({
      targetId,
      signalType: "quality",
      signalKey: direction === "up" ? "quality_up" : "quality_down",
      observedAt: windowEnd,
      windowStart,
      windowEnd,
      anomalyScore: toFixedNumber(score),
      algorithmVersion: ANOMALY_ALGORITHM_VERSION,
      explainPayload: {
        source: "subreddit_daily_fact",
        day: current.day,
        direction,
        subredditTier: current.subredditTier,
        qualityRate: toFixedNumber(qualityRate),
        baselineRate: toFixedNumber(baselineRate),
        signedDelta: toFixedNumber(signedDelta),
        deviation: toFixedNumber(clamp(deviation, 0, 10)),
        qualityScoreMin: toFixedNumber(qualityScoreMin),
        baselineFloor: toFixedNumber(baselineFloor),
        qualifiedPostVolume: current.qualifiedPostVolume,
        postVolume: current.postVolume,
        heatChangePct: toFixedNumber(current.heatChangePct),
      },
    });
  }

  return rows;
}

function buildKeywordEvents(targetId: string, rows: KeywordTrendDaily[]): AnomalyEvent[] {
  const byDay = new Map<string, KeywordTrendDaily[]>();
  for (const row of rows) {
    const current = byDay.get(row.day) ?? [];
    current.push(row);
    byDay.set(row.day, current);
  }

  const output: AnomalyEvent[] = [];
  for (const [day, dayRows] of byDay.entries()) {
    const selected = [...dayRows]
      .sort((left, right) => {
        const byHeat = right.keywordHeat - left.keywordHeat;
        if (byHeat !== 0) {
          return byHeat;
        }
        const byMatched = right.matchedPosts - left.matchedPosts;
        if (byMatched !== 0) {
          return byMatched;
        }
        return left.normalizedQueryText.localeCompare(right.normalizedQueryText);
      })
      .slice(0, MAX_KEYWORD_EVENTS_PER_DAY);

    for (const row of selected) {
      const support = clamp(row.matchedPosts / Math.max(1, Math.ceil(row.sampledPosts * 0.08)), 0, 1);
      const score = clamp(
        0.7 * row.keywordHeat + 0.2 * row.qualifiedMentionRate + 0.1 * support,
        0,
        1,
      );
      if (score < KEYWORD_SCORE_MIN) {
        continue;
      }
      const windowStart = `${day}T00:00:00.000Z`;
      const windowEnd = new Date(
        new Date(windowStart).getTime() + 24 * 60 * 60 * 1000,
      ).toISOString();
      output.push({
        targetId,
        signalType: "keyword",
        signalKey: row.normalizedQueryText,
        observedAt: windowEnd,
        windowStart,
        windowEnd,
        anomalyScore: toFixedNumber(score),
        algorithmVersion: ANOMALY_ALGORITHM_VERSION,
        explainPayload: {
          source: "keyword_trend_daily",
          day,
          track: row.track,
          queryScope: row.queryScope,
          keyword: row.keyword,
          normalizedQueryText: row.normalizedQueryText,
          keywordHeat: toFixedNumber(row.keywordHeat),
          mentionRate: toFixedNumber(row.mentionRate),
          qualifiedMentionRate: toFixedNumber(row.qualifiedMentionRate),
          matchedPosts: row.matchedPosts,
          sampledPosts: row.sampledPosts,
          support: toFixedNumber(support),
        },
      });
    }
  }

  return output;
}

function buildDriverEvents(
  targetId: string,
  rows: Awaited<ReturnType<PostGrowthFactRepository["listTopByTargetInRange"]>>,
): AnomalyEvent[] {
  const output: AnomalyEvent[] = [];
  for (const row of rows) {
    const score = clamp(row.driverScore / 100, 0, 1);
    if (score < DRIVER_SCORE_MIN) {
      continue;
    }
    const windowDurationMinutes = resolveBucketWindowMinutes(row.ageBucket);
    const observedAtTime = new Date(row.observedAt).getTime();
    const windowStart = new Date(
      observedAtTime - windowDurationMinutes * 60 * 1000,
    ).toISOString();
    output.push({
      targetId,
      signalType: "driver",
      signalKey: row.contentId,
      observedAt: row.observedAt,
      windowStart,
      windowEnd: row.observedAt,
      anomalyScore: toFixedNumber(score),
      algorithmVersion: ANOMALY_ALGORITHM_VERSION,
      explainPayload: {
        source: "post_growth_fact",
        contentId: row.contentId,
        ageBucket: row.ageBucket,
        ageMinutes: row.ageMinutes,
        driverScore: toFixedNumber(row.driverScore),
        velocityZScore: toFixedNumber(row.velocityZScore),
        scoreVelocityPerHour: toFixedNumber(row.scoreVelocityPerHour),
        commentVelocityPerHour: toFixedNumber(row.commentVelocityPerHour),
      },
    });
  }

  return output;
}

function dedupeAndSort(rows: AnomalyEvent[]): AnomalyEvent[] {
  const deduped = new Map<string, AnomalyEvent>();
  for (const row of rows) {
    const key = `${row.targetId}|${row.signalType}|${row.signalKey}|${row.observedAt}`;
    const current = deduped.get(key);
    if (!current || row.anomalyScore > current.anomalyScore) {
      deduped.set(key, row);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => {
    const byObserved = left.observedAt.localeCompare(right.observedAt);
    if (byObserved !== 0) {
      return byObserved;
    }
    const bySignal = left.signalType.localeCompare(right.signalType);
    if (bySignal !== 0) {
      return bySignal;
    }
    return left.signalKey.localeCompare(right.signalKey);
  });
}

function resolveBucketWindowMinutes(ageBucket: PostGrowthAgeBucket): number {
  if (ageBucket === "1h") {
    return 60;
  }
  if (ageBucket === "6h") {
    return 6 * 60;
  }
  return 24 * 60;
}

function normalizeTrendScore(trendScore: number): number {
  return clamp((trendScore + 1) / 2, 0, 1);
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

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function toFixedNumber(value: number): number {
  return Number(value.toFixed(6));
}
