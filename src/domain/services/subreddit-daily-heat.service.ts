import type { SubredditDailyFact } from "../entities/subreddit-daily-fact";

export interface SubredditDailyHeatDraft {
  targetId: string;
  day: string;
  postVolume: number;
  qualifiedPostVolume: number;
  sampledPostVolume: number;
  scoreSum: number;
  commentSum: number;
  subscriberCount: number;
  activeUserCount: number;
  activePostRatio: number;
  dispersionScore: number;
  impactScoreSum: number;
  impactPostVolume: number;
  topImpactShare: number;
  subredditTier: SubredditDailyFact["subredditTier"];
  qualityThresholdScore: number;
  qualityThresholdComments: number;
  explainPayload: Record<string, unknown>;
}

const ALGORITHM_VERSION = "daily_fact_v1";
const EMA7_ALPHA = 2 / (7 + 1);
const EMA30_ALPHA = 2 / (30 + 1);

export function scoreSubredditDailyFacts(
  drafts: SubredditDailyHeatDraft[],
): SubredditDailyFact[] {
  const sorted = [...drafts].sort((a, b) => a.day.localeCompare(b.day));
  const result: SubredditDailyFact[] = [];
  let previousHeatPrice = 0;
  let previousEma7 = 0;
  let previousEma30 = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const draft = sorted[index];
    const sampleReliability =
      draft.postVolume > 0 ? draft.sampledPostVolume / draft.postVolume : 0;
    const qualifiedShare =
      draft.postVolume > 0 ? draft.qualifiedPostVolume / draft.postVolume : 0;
    const heatRaw =
      draft.postVolume <= 0 && draft.scoreSum <= 0 && draft.commentSum <= 0
        ? 0
        : 0.12 * log1p(draft.postVolume) +
          0.22 * log1p(draft.scoreSum) +
          0.2 * log1p(draft.commentSum) +
          0.08 * log1p(draft.activeUserCount) +
          0.08 * draft.dispersionScore +
          0.18 * log1p(draft.impactScoreSum) +
          0.07 * qualifiedShare +
          0.05 * sampleReliability -
          0.04 * clamp(draft.topImpactShare, 0, 1);
    const heatPrice = toFixedNumber(clamp(100 * Math.tanh(Math.max(0, heatRaw) / 8), 0, 100));
    const heatChangePct =
      index === 0
        ? 0
        : toFixedNumber((heatPrice - previousHeatPrice) / Math.max(previousHeatPrice, 1));
    const ema7 =
      index === 0
        ? heatPrice
        : toFixedNumber(previousEma7 + EMA7_ALPHA * (heatPrice - previousEma7));
    const ema30 =
      index === 0
        ? heatPrice
        : toFixedNumber(previousEma30 + EMA30_ALPHA * (heatPrice - previousEma30));

    result.push({
      targetId: draft.targetId,
      day: draft.day,
      postVolume: draft.postVolume,
      qualifiedPostVolume: draft.qualifiedPostVolume,
      sampledPostVolume: draft.sampledPostVolume,
      scoreSum: draft.scoreSum,
      commentSum: draft.commentSum,
      subscriberCount: draft.subscriberCount,
      activeUserCount: draft.activeUserCount,
      activePostRatio: toFixedNumber(draft.activePostRatio),
      dispersionScore: toFixedNumber(draft.dispersionScore),
      impactScoreSum: toFixedNumber(draft.impactScoreSum),
      impactPostVolume: draft.impactPostVolume,
      topImpactShare: toFixedNumber(draft.topImpactShare),
      heatPrice,
      heatChangePct,
      ema7,
      ema30,
      subredditTier: draft.subredditTier,
      qualityThresholdScore: draft.qualityThresholdScore,
      qualityThresholdComments: draft.qualityThresholdComments,
      algorithmVersion: ALGORITHM_VERSION,
      explainPayload: {
        ...draft.explainPayload,
        heatRaw: toFixedNumber(heatRaw),
        sampleReliability: toFixedNumber(sampleReliability),
        qualifiedShare: toFixedNumber(qualifiedShare),
      },
    });

    previousHeatPrice = heatPrice;
    previousEma7 = ema7;
    previousEma30 = ema30;
  }

  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function log1p(value: number): number {
  return Math.log(1 + Math.max(0, value));
}

function toFixedNumber(value: number): number {
  return Number(value.toFixed(6));
}
