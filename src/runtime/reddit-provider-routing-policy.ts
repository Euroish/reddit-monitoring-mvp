import {
  resolveRedditLiveProvider,
  resolveRedditScraplingProfile,
  type RedditLiveProvider,
} from "../connectors/reddit/create-reddit-connector";
import type { RedditScraplingProfile } from "../connectors/reddit/reddit-scrapling.connector";
import type { CrawlCursorRepository } from "../domain/repositories/crawl-cursor-repository";
import type {
  ProviderHealthAggregate,
  ProviderHealthWindowRepository,
} from "../domain/repositories/provider-health-window-repository";
import { REDDIT_PROVIDER_HEALTH_THRESHOLDS } from "./reddit-provider-health-thresholds";
import { parseSubredditList } from "./runtime-parsing";

export interface RedditProviderRoutingPolicyContext {
  defaultLiveProvider: RedditLiveProvider;
  defaultScraplingProfile: RedditScraplingProfile;
  scraplingPrimaryCanonicalNames: string[];
  providerHealthLookbackMinutes: number;
  suppressHttpFallback: boolean;
}

export interface RedditTargetExecutionRoute {
  selectedProvider: RedditLiveProvider;
  providerHint: string;
  providerOverride: RedditLiveProvider;
  scraplingProfile: RedditScraplingProfile | null;
  promotedToScrapling: boolean;
  routingClass:
    | "default_provider"
    | "scrapling_promoted"
    | "scrapling_dynamic_escalation"
    | "scrapling_http_fallback";
  reasons: string[];
}

export interface RedditRoutingPolicySummary {
  defaultLiveProvider: RedditLiveProvider;
  targetCount: number;
  promotedScraplingTargetCount: number;
  demotedHttpTargetCount: number;
  byProvider: Array<{
    provider: string;
    targetCount: number;
  }>;
  byScraplingProfile: Array<{
    profile: RedditScraplingProfile;
    targetCount: number;
  }>;
}

export function resolveRedditProviderRoutingPolicyContextFromEnv(
  env: NodeJS.ProcessEnv,
): RedditProviderRoutingPolicyContext {
  const lookbackMinutes = Number.parseInt(
    env.REDDIT_PROVIDER_POLICY_LOOKBACK_MINUTES ?? "",
    10,
  );
  return {
    defaultLiveProvider: resolveRedditLiveProvider(env.REDDIT_LIVE_PROVIDER),
    defaultScraplingProfile: resolveRedditScraplingProfile(
      env.REDDIT_SCRAPLING_PROFILE,
    ),
    scraplingPrimaryCanonicalNames: parseSubredditList(
      env.REDDIT_SCRAPLING_PRIMARY_SUBREDDITS,
    ).map(toCanonicalSubredditName),
    providerHealthLookbackMinutes:
      Number.isFinite(lookbackMinutes) && lookbackMinutes > 0
        ? lookbackMinutes
        : REDDIT_PROVIDER_HEALTH_THRESHOLDS.providerHealthLookbackMinutes,
    suppressHttpFallback: env.REDDIT_SUPPRESS_HTTP_FALLBACK === "true",
  };
}

export async function resolveRedditTargetExecutionRoute(args: {
  targetId: string;
  canonicalName: string;
  crawlMode: "live" | "backfill";
  nowIso: string;
  defaultProviderHint?: string;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  policyContext: RedditProviderRoutingPolicyContext;
}): Promise<RedditTargetExecutionRoute> {
  const normalizedProviderHint = normalizeProviderHint(
    args.defaultProviderHint,
    args.policyContext.defaultLiveProvider,
  );
  const canonicalName = toCanonicalSubredditName(args.canonicalName);
  const promotedToScrapling =
    args.crawlMode === "live" &&
    (normalizedProviderHint === "scrapling" ||
      args.policyContext.scraplingPrimaryCanonicalNames.includes(canonicalName));

  if (args.crawlMode !== "live" || !promotedToScrapling) {
    const selectedProvider = resolveRedditLiveProvider(normalizedProviderHint);
    return {
      selectedProvider,
      providerHint: normalizedProviderHint,
      providerOverride: selectedProvider,
      scraplingProfile:
        normalizedProviderHint === "scrapling"
          ? args.policyContext.defaultScraplingProfile
          : null,
      promotedToScrapling,
      routingClass: "default_provider",
      reasons: ["default_provider"],
    };
  }

  const fromIso = new Date(
    new Date(args.nowIso).getTime() -
      args.policyContext.providerHealthLookbackMinutes * 60 * 1000,
  ).toISOString();
  const recoveryFromIso = new Date(
    new Date(args.nowIso).getTime() -
      REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingTransportRecoveryLookbackMinutes *
        60 *
        1000,
  ).toISOString();
  const [providerAggregates, recoveryAggregates, liveCursors] = await Promise.all([
    args.providerHealthWindowRepository?.summarizeByProviderInRange({
      targetId: args.targetId,
      from: fromIso,
      to: args.nowIso,
      mode: "live",
    }) ?? Promise.resolve([]),
    args.providerHealthWindowRepository?.summarizeByProviderInRange({
      targetId: args.targetId,
      from: recoveryFromIso,
      to: args.nowIso,
      mode: "live",
    }) ?? Promise.resolve([]),
    args.crawlCursorRepository?.list({
      targetId: args.targetId,
      mode: "live",
    }) ?? Promise.resolve([]),
  ]);
  const scraplingAggregate = providerAggregates.find(
    (aggregate) => aggregate.provider === "scrapling",
  );
  const scraplingRecoveryAggregate = recoveryAggregates.find(
    (aggregate) => aggregate.provider === "scrapling",
  );
  const scraplingCursor = liveCursors.find((cursor) => cursor.provider === "scrapling");
  const scraplingCursorLagSeconds = toLagSeconds(
    args.nowIso,
    scraplingCursor?.lastFetchedAt ?? scraplingCursor?.updatedAt,
  );
  const hasRecentScraplingEvidence =
    (scraplingAggregate?.requestCount ?? 0) > 0;
  const scraplingHealth = evaluateProviderAggregate(scraplingAggregate);
  const scraplingRecoveryHealth = evaluateProviderAggregate(scraplingRecoveryAggregate);
  const scraplingEvidence = evaluateScraplingProfileEvidence(scraplingAggregate);
  const hasSufficientTransportSamples =
    (scraplingAggregate?.requestCount ?? 0) >=
    REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingTransportMinRequestCountForFallback;
  const hasSufficientRecoverySamples =
    (scraplingRecoveryAggregate?.requestCount ?? 0) >=
    REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingTransportRecoveryMinRequestCount;
  const transportDegradedFromLookback =
    hasSufficientTransportSamples && isTransportDegraded(scraplingHealth);
  const transportRecoveredRecently =
    hasSufficientRecoverySamples && !isTransportDegraded(scraplingRecoveryHealth);
  const hasRecentRecoveryTransportEvidence =
    (scraplingRecoveryAggregate?.requestCount ?? 0) > 0;
  const cursorStalled =
    hasRecentScraplingEvidence &&
    scraplingCursorLagSeconds != null &&
    scraplingCursorLagSeconds >
      REDDIT_PROVIDER_HEALTH_THRESHOLDS.cursorStallThresholdSeconds;
  const transportDegraded =
    transportDegradedFromLookback && !transportRecoveredRecently;
  const transportRecoveredReason =
    transportDegradedFromLookback && transportRecoveredRecently
      ? "scrapling_transport_recently_recovered"
      : null;
  const shouldRecoveryProbe =
    transportDegraded &&
    cursorStalled &&
    scraplingCursorLagSeconds != null &&
    scraplingCursorLagSeconds >=
      REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingRecoveryProbeMinCursorLagSeconds;
  const shouldRecoveryProbeOnMissingRecentEvidence =
    transportDegraded && !hasRecentRecoveryTransportEvidence;
  const recoveryProbeProfile =
    args.policyContext.defaultScraplingProfile === "http"
      ? "dynamic"
      : args.policyContext.defaultScraplingProfile;
  const hasSufficientDynamicExhaustedSamples =
    (scraplingAggregate?.requestCount ?? 0) >=
    REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingDynamicExhaustedMinRequestCount;
  const dynamicExhaustedSignal = scraplingHealth.emptyRateElevated;
  const dynamicRecoveryExhaustedSignal =
    scraplingRecoveryHealth.emptyRateElevated;
  const suppressedHttpFallbackReason = "http_fallback_suppressed_provider_capability_failure";

  if (transportDegraded) {
    const reasons = ["scrapling_transport_degraded"];
    if (scraplingHealth.fetchSuccessLow) {
      reasons.push("scrapling_fetch_success_low");
    }
    if (scraplingHealth.fallbackElevated) {
      reasons.push("scrapling_fallback_elevated");
    }
    if (scraplingHealth.errorElevated) {
      reasons.push("scrapling_error_rate_elevated");
    }
    if (scraplingHealth.rateLimitElevated) {
      reasons.push("scrapling_rate_limit_elevated");
    }
    if (scraplingHealth.timeoutElevated) {
      reasons.push("scrapling_timeout_elevated");
    }
    if (scraplingHealth.circuitOpenElevated) {
      reasons.push("scrapling_circuit_open_elevated");
    }
    if (cursorStalled) {
      reasons.push("scrapling_cursor_stalled");
    }
    if (scraplingEvidence.dynamicProfileDominant) {
      reasons.push("scrapling_dynamic_profile_recent");
    }
    if (shouldRecoveryProbe) {
      const probeReasons = ["scrapling_recovery_probe", ...reasons];
      if (recoveryProbeProfile !== args.policyContext.defaultScraplingProfile) {
        probeReasons.unshift("scrapling_recovery_probe_dynamic_profile");
      }
      return {
        selectedProvider: "scrapling",
        providerHint: "scrapling",
        providerOverride: "scrapling",
        scraplingProfile: recoveryProbeProfile,
        promotedToScrapling: true,
        routingClass: "scrapling_promoted",
        reasons: probeReasons,
      };
    }
    if (shouldRecoveryProbeOnMissingRecentEvidence) {
      const probeReasons = [
        "scrapling_recovery_probe_no_recent_transport_samples",
        ...reasons,
      ];
      if (recoveryProbeProfile !== args.policyContext.defaultScraplingProfile) {
        probeReasons.unshift("scrapling_recovery_probe_dynamic_profile");
      }
      return {
        selectedProvider: "scrapling",
        providerHint: "scrapling",
        providerOverride: "scrapling",
        scraplingProfile: recoveryProbeProfile,
        promotedToScrapling: true,
        routingClass: "scrapling_promoted",
        reasons: probeReasons,
      };
    }
    if (args.policyContext.suppressHttpFallback) {
      return {
        selectedProvider: "scrapling",
        providerHint: "scrapling",
        providerOverride: "scrapling",
        scraplingProfile: recoveryProbeProfile,
        promotedToScrapling: true,
        routingClass: "scrapling_promoted",
        reasons: [suppressedHttpFallbackReason, ...reasons],
      };
    }
    return {
      selectedProvider: "http",
      providerHint: "http",
      providerOverride: "http",
      scraplingProfile: null,
      promotedToScrapling: true,
      routingClass: "scrapling_http_fallback",
      reasons,
    };
  }

  const dynamicExhausted =
    hasSufficientDynamicExhaustedSamples &&
    scraplingEvidence.dynamicProfileReady &&
    dynamicExhaustedSignal &&
    hasSufficientRecoverySamples &&
    dynamicRecoveryExhaustedSignal;

  if (dynamicExhausted) {
    const reasons = ["scrapling_dynamic_exhausted_http_fallback"];
    if (scraplingHealth.emptyRateElevated) {
      reasons.push("scrapling_empty_window_elevated");
    }
    if (scraplingHealth.staleHeadElevated) {
      reasons.push("scrapling_stale_head_elevated");
    }
    reasons.push("scrapling_dynamic_profile_recent");
    reasons.push("scrapling_session_key_evidence_ready");
    if (args.policyContext.suppressHttpFallback) {
      return {
        selectedProvider: "scrapling",
        providerHint: "scrapling",
        providerOverride: "scrapling",
        scraplingProfile: "dynamic",
        promotedToScrapling: true,
        routingClass: "scrapling_dynamic_escalation",
        reasons: [suppressedHttpFallbackReason, ...reasons],
      };
    }
    return {
      selectedProvider: "http",
      providerHint: "http",
      providerOverride: "http",
      scraplingProfile: null,
      promotedToScrapling: true,
      routingClass: "scrapling_http_fallback",
      reasons,
    };
  }

  const shouldEscalateDynamic =
    args.policyContext.defaultScraplingProfile === "http" &&
    scraplingEvidence.httpProfileReady &&
    (scraplingHealth.emptyRateElevated || scraplingHealth.staleHeadElevated);

  if (shouldEscalateDynamic) {
    const reasons = ["scrapling_dynamic_escalation"];
    if (scraplingHealth.emptyRateElevated) {
      reasons.push("scrapling_empty_window_elevated");
    }
    if (scraplingHealth.staleHeadElevated) {
      reasons.push("scrapling_stale_head_elevated");
    }
    reasons.push("scrapling_http_profile_recent");
    reasons.push("scrapling_session_key_evidence_ready");
    return {
      selectedProvider: "scrapling",
      providerHint: "scrapling",
      providerOverride: "scrapling",
      scraplingProfile: "dynamic",
      promotedToScrapling: true,
      routingClass: "scrapling_dynamic_escalation",
      reasons,
    };
  }

  const shouldKeepDynamicSteadyState =
    args.policyContext.defaultScraplingProfile === "http" &&
    scraplingEvidence.dynamicProfileReady;

  if (shouldKeepDynamicSteadyState) {
    const reasons = ["scrapling_dynamic_steady_state"];
    if (
      hasSufficientDynamicExhaustedSamples &&
      dynamicExhaustedSignal &&
      !dynamicExhausted
    ) {
      reasons.push("scrapling_dynamic_exhausted_deferred_recovery_window");
    }
    reasons.push("scrapling_dynamic_profile_recent");
    reasons.push("scrapling_session_key_evidence_ready");
    if (transportRecoveredReason) {
      reasons.push(transportRecoveredReason);
    }
    return {
      selectedProvider: "scrapling",
      providerHint: "scrapling",
      providerOverride: "scrapling",
      scraplingProfile: "dynamic",
      promotedToScrapling: true,
      routingClass: "scrapling_dynamic_escalation",
      reasons,
    };
  }

  return {
    selectedProvider: "scrapling",
    providerHint: "scrapling",
    providerOverride: "scrapling",
    scraplingProfile: args.policyContext.defaultScraplingProfile,
    promotedToScrapling: true,
    routingClass: "scrapling_promoted",
    reasons: transportRecoveredReason
      ? ["scrapling_promoted", transportRecoveredReason]
      : ["scrapling_promoted"],
  };
}

export function summarizeRedditRoutingPolicy(
  routes: RedditTargetExecutionRoute[],
  policyContext: RedditProviderRoutingPolicyContext,
): RedditRoutingPolicySummary {
  const providerCounts = new Map<string, number>();
  const profileCounts = new Map<RedditScraplingProfile, number>();

  for (const route of routes) {
    providerCounts.set(
      route.selectedProvider,
      (providerCounts.get(route.selectedProvider) ?? 0) + 1,
    );
    if (route.scraplingProfile) {
      profileCounts.set(
        route.scraplingProfile,
        (profileCounts.get(route.scraplingProfile) ?? 0) + 1,
      );
    }
  }

  return {
    defaultLiveProvider: policyContext.defaultLiveProvider,
    targetCount: routes.length,
    promotedScraplingTargetCount: routes.filter((route) => route.promotedToScrapling)
      .length,
    demotedHttpTargetCount: routes.filter(
      (route) => route.routingClass === "scrapling_http_fallback",
    ).length,
    byProvider: Array.from(providerCounts.entries())
      .map(([provider, targetCount]) => ({
        provider,
        targetCount,
      }))
      .sort((left, right) => left.provider.localeCompare(right.provider)),
    byScraplingProfile: Array.from(profileCounts.entries())
      .map(([profile, targetCount]) => ({
        profile,
        targetCount,
      }))
      .sort((left, right) => left.profile.localeCompare(right.profile)),
  };
}

function normalizeProviderHint(
  value: string | undefined,
  fallbackProvider: RedditLiveProvider,
): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "http" || normalized === "apify" || normalized === "scrapling") {
    return normalized;
  }
  return fallbackProvider;
}

function toCanonicalSubredditName(value: string): string {
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  return `r/${normalized}`;
}

function toRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function toAverage(total: number, count: number): number | null {
  return count > 0 ? total / count : null;
}

function toDuplicatePostRate(aggregate: ProviderHealthAggregate): number | null {
  const denominator =
    aggregate.candidateCount > 0 ? aggregate.candidateCount : aggregate.acceptedCount;
  return denominator > 0 ? aggregate.duplicatePostCount / denominator : null;
}

function toLagSeconds(nowIso: string, observedAtIso: string | undefined): number | null {
  if (!observedAtIso) {
    return null;
  }
  const nowMs = Date.parse(nowIso);
  const observedAtMs = Date.parse(observedAtIso);
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedAtMs)) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - observedAtMs) / 1000));
}

function evaluateProviderAggregate(aggregate: ProviderHealthAggregate | undefined): {
  fetchSuccessLow: boolean;
  fallbackElevated: boolean;
  emptyRateElevated: boolean;
  errorElevated: boolean;
  rateLimitElevated: boolean;
  timeoutElevated: boolean;
  circuitOpenElevated: boolean;
  staleHeadElevated: boolean;
} {
  if (!aggregate || aggregate.requestCount <= 0) {
    return {
      fetchSuccessLow: false,
      fallbackElevated: false,
      emptyRateElevated: false,
      errorElevated: false,
      rateLimitElevated: false,
      timeoutElevated: false,
      circuitOpenElevated: false,
      staleHeadElevated: false,
    };
  }

  const fetchSuccessRate = toRate(aggregate.successCount, aggregate.requestCount);
  const fallbackRate = toRate(aggregate.fallbackCount, aggregate.requestCount);
  const emptyRate = toRate(aggregate.emptyResponseCount, aggregate.requestCount);
  const errorRate = toRate(aggregate.errorCount, aggregate.requestCount);
  const rateLimitRate = toRate(aggregate.rateLimitCount, aggregate.requestCount);
  const timeoutRate = toRate(aggregate.timeoutCount, aggregate.requestCount);
  const circuitOpenRate = toRate(aggregate.circuitOpenCount, aggregate.requestCount);
  const duplicatePostRate = toDuplicatePostRate(aggregate);
  const ingestLagSeconds = toAverage(
    aggregate.ingestLagSecondsSum,
    aggregate.ingestLagSampleCount,
  );

  return {
    fetchSuccessLow:
      fetchSuccessRate != null &&
      fetchSuccessRate < REDDIT_PROVIDER_HEALTH_THRESHOLDS.providerHealthSuccessRateMin,
    fallbackElevated:
      fallbackRate != null &&
      fallbackRate > REDDIT_PROVIDER_HEALTH_THRESHOLDS.providerHealthFallbackRateMax,
    emptyRateElevated:
      emptyRate != null &&
      emptyRate > REDDIT_PROVIDER_HEALTH_THRESHOLDS.providerHealthEmptyRateMax,
    errorElevated:
      errorRate != null &&
      errorRate > REDDIT_PROVIDER_HEALTH_THRESHOLDS.providerHealthErrorRateMax,
    rateLimitElevated:
      rateLimitRate != null &&
      rateLimitRate > REDDIT_PROVIDER_HEALTH_THRESHOLDS.providerHealthRateLimitRateMax,
    timeoutElevated:
      timeoutRate != null &&
      timeoutRate > REDDIT_PROVIDER_HEALTH_THRESHOLDS.providerHealthTimeoutRateMax,
    circuitOpenElevated:
      circuitOpenRate != null &&
      circuitOpenRate > REDDIT_PROVIDER_HEALTH_THRESHOLDS.providerHealthCircuitOpenRateMax,
    staleHeadElevated:
      duplicatePostRate != null &&
      ingestLagSeconds != null &&
      duplicatePostRate >=
        REDDIT_PROVIDER_HEALTH_THRESHOLDS.staleHeadDuplicatePostRateMin &&
      ingestLagSeconds >=
        REDDIT_PROVIDER_HEALTH_THRESHOLDS.staleHeadIngestLagSecondsMin,
  };
}

function isTransportDegraded(health: {
  fetchSuccessLow: boolean;
  fallbackElevated: boolean;
  errorElevated: boolean;
  rateLimitElevated: boolean;
  timeoutElevated: boolean;
  circuitOpenElevated: boolean;
}): boolean {
  return (
    health.fetchSuccessLow ||
    health.fallbackElevated ||
    health.errorElevated ||
    health.rateLimitElevated ||
    health.timeoutElevated ||
    health.circuitOpenElevated
  );
}

function evaluateScraplingProfileEvidence(
  aggregate: ProviderHealthAggregate | undefined,
): {
  sessionKeyObservedRate: number | null;
  sessionKeyReuseRate: number | null;
  httpProfileShare: number | null;
  dynamicProfileShare: number | null;
  httpProfileReady: boolean;
  dynamicProfileReady: boolean;
  dynamicProfileDominant: boolean;
} {
  if (!aggregate || aggregate.requestCount <= 0) {
    return {
      sessionKeyObservedRate: null,
      sessionKeyReuseRate: null,
      httpProfileShare: null,
      dynamicProfileShare: null,
      httpProfileReady: false,
      dynamicProfileReady: false,
      dynamicProfileDominant: false,
    };
  }

  const sessionKeyObservedRate = toRate(
    aggregate.scraplingSessionKeyCount,
    aggregate.requestCount,
  );
  const sessionKeyReuseRate = toRate(
    aggregate.scraplingSessionKeyReuseCount,
    aggregate.scraplingSessionKeyCount,
  );
  const httpProfileShare = toRate(
    aggregate.scraplingHttpProfileCount,
    aggregate.requestCount,
  );
  const dynamicProfileShare = toRate(
    aggregate.scraplingDynamicProfileCount,
    aggregate.requestCount,
  );
  const sessionKeyEvidenceReady =
    sessionKeyObservedRate != null &&
    sessionKeyObservedRate >=
      REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingSessionKeyObservedRateMin &&
    sessionKeyReuseRate != null &&
    sessionKeyReuseRate >=
      REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingSessionKeyReuseRateMin;
  const httpProfileReady =
    sessionKeyEvidenceReady &&
    httpProfileShare != null &&
    httpProfileShare >= REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingHttpProfileShareMin;
  const dynamicProfileReady =
    sessionKeyEvidenceReady &&
    dynamicProfileShare != null &&
    dynamicProfileShare >=
      REDDIT_PROVIDER_HEALTH_THRESHOLDS.scraplingDynamicProfileShareMin;

  return {
    sessionKeyObservedRate,
    sessionKeyReuseRate,
    httpProfileShare,
    dynamicProfileShare,
    httpProfileReady,
    dynamicProfileReady,
    dynamicProfileDominant: dynamicProfileReady,
  };
}
