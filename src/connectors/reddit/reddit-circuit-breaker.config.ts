import type { CreateRedditConnectorOptions } from "./create-reddit-connector";

export function resolveRedditCircuitBreakerOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  args: {
    defaultEnabled?: boolean;
  } = {},
): NonNullable<CreateRedditConnectorOptions["circuitBreaker"]> {
  const enabled = parseBoolean(env.REDDIT_CB_ENABLED, args.defaultEnabled ?? true);
  return {
    enabled,
    timeoutMs: parsePositiveInt(env.REDDIT_CB_TIMEOUT_MS, 12_000),
    errorThresholdPercentage: clamp(
      parsePositiveFloat(env.REDDIT_CB_ERROR_THRESHOLD_PERCENT, 50),
      1,
      100,
    ),
    resetTimeoutMs: parsePositiveInt(env.REDDIT_CB_RESET_TIMEOUT_MS, 15_000),
    volumeThreshold: parsePositiveInt(env.REDDIT_CB_VOLUME_THRESHOLD, 5),
    rollingCountTimeoutMs: parsePositiveInt(env.REDDIT_CB_ROLLING_COUNT_TIMEOUT_MS, 10_000),
    rollingCountBuckets: parsePositiveInt(env.REDDIT_CB_ROLLING_COUNT_BUCKETS, 10),
    routeToFallbackOnError: parseBoolean(env.REDDIT_CB_ROUTE_TO_FALLBACK, true),
  };
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

