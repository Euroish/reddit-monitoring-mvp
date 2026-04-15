export interface JobRetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function resolveJobRetryPolicy(env: NodeJS.ProcessEnv = process.env): JobRetryPolicy {
  return {
    maxRetries: parsePositiveInt(env.COLLECTION_JOB_MAX_RETRIES, 2),
    baseDelayMs: parsePositiveInt(env.COLLECTION_JOB_RETRY_BASE_MS, 60_000),
    maxDelayMs: parsePositiveInt(env.COLLECTION_JOB_RETRY_MAX_MS, 15 * 60 * 1000),
  };
}

export function computeRetryDelayMs(retryCount: number, policy: JobRetryPolicy): number {
  const exponent = Math.max(0, retryCount - 1);
  const rawDelay = policy.baseDelayMs * 2 ** exponent;
  return Math.min(policy.maxDelayMs, rawDelay);
}
