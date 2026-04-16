export interface ShadowPromotionPolicy {
  minSamples: number;
  minBaselineSuccessRate: number;
  minShadowSuccessRate: number;
  minParityGatePassRate: number;
  minJaccardP50: number;
  minJaccardMin: number;
  maxAbsExtractedDeltaP95: number;
  maxAbsLagDeltaSecondsP95: number;
  maxDurationRatioP95: number;
}

export interface ShadowCompareProviderSnapshot {
  provider: string;
  status: number | null;
  durationMs: number;
  extractedCount: number;
  uniqueExternalCount: number;
  duplicateWithinResponse: number;
  avgIngestLagSeconds: number | null;
  errorMessage?: string;
}

export interface ShadowCompareRecord {
  subreddit: string;
  round: number;
  baseline: {
    provider: ShadowCompareProviderSnapshot;
  };
  shadow: {
    provider: ShadowCompareProviderSnapshot;
  };
  parity: {
    statusMatch: boolean;
    bothSucceeded: boolean;
    extractedDelta: number;
    overlapJaccard: number | null;
    avgIngestLagDeltaSeconds: number | null;
  };
  parityGatePassed: boolean;
}

export interface ShadowCompareSnapshot {
  generatedAt: string;
  baselineProvider: string;
  shadowProvider: string;
  records: ShadowCompareRecord[];
}

export interface ShadowPromotionSubredditPlan {
  subreddit: string;
  sampleCount: number;
  baselineSuccessRate: number;
  shadowSuccessRate: number;
  parityGatePassRate: number;
  jaccardP50: number | null;
  jaccardMin: number | null;
  absExtractedDeltaP95: number;
  absLagDeltaSecondsP95: number | null;
  durationRatioP95: number | null;
  eligible: boolean;
  recommendation:
    | "promote_scrapling_primary_with_http_fallback"
    | "keep_shadow_only";
  blockingReasons: string[];
}

export interface ShadowPromotionPlanResult {
  policy: ShadowPromotionPolicy;
  snapshotCount: number;
  subreddits: ShadowPromotionSubredditPlan[];
  eligibleSubreddits: string[];
}

export const DEFAULT_SHADOW_PROMOTION_POLICY: ShadowPromotionPolicy = {
  minSamples: 4,
  minBaselineSuccessRate: 0.99,
  minShadowSuccessRate: 0.99,
  minParityGatePassRate: 0.95,
  minJaccardP50: 0.95,
  minJaccardMin: 0.9,
  maxAbsExtractedDeltaP95: 3,
  maxAbsLagDeltaSecondsP95: 120,
  maxDurationRatioP95: 6,
};

export function buildShadowPromotionPlan(args: {
  snapshots: ShadowCompareSnapshot[];
  policy?: Partial<ShadowPromotionPolicy>;
}): ShadowPromotionPlanResult {
  const policy = {
    ...DEFAULT_SHADOW_PROMOTION_POLICY,
    ...(args.policy ?? {}),
  };

  const recordsBySubreddit = new Map<string, ShadowCompareRecord[]>();
  for (const snapshot of args.snapshots) {
    for (const record of snapshot.records) {
      const bucket = recordsBySubreddit.get(record.subreddit) ?? [];
      bucket.push(record);
      recordsBySubreddit.set(record.subreddit, bucket);
    }
  }

  const subreddits: ShadowPromotionSubredditPlan[] = [];
  for (const [subreddit, records] of recordsBySubreddit.entries()) {
    const plan = buildSubredditPlan({
      subreddit,
      records,
      policy,
    });
    subreddits.push(plan);
  }

  subreddits.sort((left, right) => left.subreddit.localeCompare(right.subreddit));
  return {
    policy,
    snapshotCount: args.snapshots.length,
    eligibleSubreddits: subreddits
      .filter((item) => item.eligible)
      .map((item) => item.subreddit),
    subreddits,
  };
}

function buildSubredditPlan(args: {
  subreddit: string;
  records: ShadowCompareRecord[];
  policy: ShadowPromotionPolicy;
}): ShadowPromotionSubredditPlan {
  const sampleCount = args.records.length;
  const baselineSuccessRate = rate(
    args.records.filter((record) => isSuccessfulStatus(record.baseline.provider.status)).length,
    sampleCount,
  );
  const shadowSuccessRate = rate(
    args.records.filter((record) => isSuccessfulStatus(record.shadow.provider.status)).length,
    sampleCount,
  );
  const parityGatePassRate = rate(
    args.records.filter((record) => record.parityGatePassed).length,
    sampleCount,
  );
  const jaccards = args.records
    .map((record) => record.parity.overlapJaccard)
    .filter((value): value is number => value != null);
  const jaccardP50 = quantile(jaccards, 0.5);
  const jaccardMin = jaccards.length > 0 ? Math.min(...jaccards) : null;
  const absExtractedDeltas = args.records.map((record) =>
    Math.abs(record.parity.extractedDelta),
  );
  const absExtractedDeltaP95 = quantile(absExtractedDeltas, 0.95) ?? 0;
  const absLagDeltas = args.records
    .map((record) => record.parity.avgIngestLagDeltaSeconds)
    .filter((value): value is number => value != null)
    .map((value) => Math.abs(value));
  const absLagDeltaSecondsP95 = quantile(absLagDeltas, 0.95);
  const durationRatios = args.records
    .map((record) => {
      const baselineDuration = record.baseline.provider.durationMs;
      const shadowDuration = record.shadow.provider.durationMs;
      if (baselineDuration <= 0) {
        return null;
      }
      return shadowDuration / baselineDuration;
    })
    .filter((value): value is number => value != null && Number.isFinite(value));
  const durationRatioP95 = quantile(durationRatios, 0.95);

  const blockingReasons: string[] = [];
  if (sampleCount < args.policy.minSamples) {
    blockingReasons.push(
      `sample_count_below_min:${sampleCount}<${args.policy.minSamples}`,
    );
  }
  if (baselineSuccessRate < args.policy.minBaselineSuccessRate) {
    blockingReasons.push(
      `baseline_success_rate_below_min:${baselineSuccessRate.toFixed(3)}<${args.policy.minBaselineSuccessRate.toFixed(3)}`,
    );
  }
  if (shadowSuccessRate < args.policy.minShadowSuccessRate) {
    blockingReasons.push(
      `shadow_success_rate_below_min:${shadowSuccessRate.toFixed(3)}<${args.policy.minShadowSuccessRate.toFixed(3)}`,
    );
  }
  if (parityGatePassRate < args.policy.minParityGatePassRate) {
    blockingReasons.push(
      `parity_gate_pass_rate_below_min:${parityGatePassRate.toFixed(3)}<${args.policy.minParityGatePassRate.toFixed(3)}`,
    );
  }
  if (jaccardP50 == null || jaccardP50 < args.policy.minJaccardP50) {
    blockingReasons.push(
      `jaccard_p50_below_min:${formatNullable(jaccardP50)}<${args.policy.minJaccardP50.toFixed(3)}`,
    );
  }
  if (jaccardMin == null || jaccardMin < args.policy.minJaccardMin) {
    blockingReasons.push(
      `jaccard_min_below_min:${formatNullable(jaccardMin)}<${args.policy.minJaccardMin.toFixed(3)}`,
    );
  }
  if (absExtractedDeltaP95 > args.policy.maxAbsExtractedDeltaP95) {
    blockingReasons.push(
      `extracted_delta_p95_above_max:${absExtractedDeltaP95.toFixed(3)}>${args.policy.maxAbsExtractedDeltaP95.toFixed(3)}`,
    );
  }
  if (
    absLagDeltaSecondsP95 != null &&
    absLagDeltaSecondsP95 > args.policy.maxAbsLagDeltaSecondsP95
  ) {
    blockingReasons.push(
      `lag_delta_p95_above_max:${absLagDeltaSecondsP95.toFixed(3)}>${args.policy.maxAbsLagDeltaSecondsP95.toFixed(3)}`,
    );
  }
  if (
    durationRatioP95 == null ||
    durationRatioP95 > args.policy.maxDurationRatioP95
  ) {
    blockingReasons.push(
      `duration_ratio_p95_above_max:${formatNullable(durationRatioP95)}>${args.policy.maxDurationRatioP95.toFixed(3)}`,
    );
  }

  const eligible = blockingReasons.length === 0;
  return {
    subreddit: args.subreddit,
    sampleCount,
    baselineSuccessRate: round(baselineSuccessRate, 6),
    shadowSuccessRate: round(shadowSuccessRate, 6),
    parityGatePassRate: round(parityGatePassRate, 6),
    jaccardP50: jaccardP50 == null ? null : round(jaccardP50, 6),
    jaccardMin: jaccardMin == null ? null : round(jaccardMin, 6),
    absExtractedDeltaP95: round(absExtractedDeltaP95, 6),
    absLagDeltaSecondsP95:
      absLagDeltaSecondsP95 == null ? null : round(absLagDeltaSecondsP95, 6),
    durationRatioP95:
      durationRatioP95 == null ? null : round(durationRatioP95, 6),
    eligible,
    recommendation: eligible
      ? "promote_scrapling_primary_with_http_fallback"
      : "keep_shadow_only",
    blockingReasons,
  };
}

function formatNullable(value: number | null): string {
  return value == null ? "null" : value.toFixed(3);
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  if (sorted.length === 1) {
    return sorted[0] ?? null;
  }
  const position = (sorted.length - 1) * clamp(q, 0, 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower == null || upper == null) {
    return null;
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  const weight = position - lowerIndex;
  return lower + (upper - lower) * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function isSuccessfulStatus(status: number | null): boolean {
  return status != null && status >= 200 && status < 300;
}

