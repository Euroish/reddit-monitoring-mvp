export type RuntimeEnvironment = Record<string, string | undefined>;

/** Configuration errors name the setting, never echo a URL, credential or secret. */
export function environmentBoolean(env: RuntimeEnvironment, key: string, fallback: boolean, strict = false): boolean {
  const value = env[key];
  if (value === undefined) return fallback;
  const yes = strict ? ["true"] : ["true", "1", "yes"];
  const no = strict ? ["false"] : ["false", "0", "no"];
  if (yes.includes(value)) return true;
  if (no.includes(value)) return false;
  throw new Error(`${key} must be ${strict ? "true or false" : "true/false, 1/0 or yes/no"}`);
}

export function environmentInteger(env: RuntimeEnvironment, key: string, fallback: number, min: number, max: number): number {
  const value = env[key];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}

export function environmentEnum<T extends string>(env: RuntimeEnvironment, key: string, allowed: readonly T[], fallback: T): T {
  const value = env[key];
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) throw new Error(`${key} must be one of ${allowed.join(", ")}`);
  return value as T;
}

function validateUrl(env: RuntimeEnvironment, key: string, protocols: string[], originOnly = false): void {
  if (env[key] === undefined) return;
  try {
    const value = new URL(env[key]!);
    if (/[\u0000-\u0020\u007f]/.test(env[key]!) || !protocols.includes(value.protocol) || !value.hostname || (originOnly && (value.username || value.password || value.pathname !== "/" || value.search || value.hash))) throw new Error();
  } catch { throw new Error(`${key}: invalid URL; use a valid ${originOnly ? "origin" : "URL"} with ${protocols.join(" or ")}`); }
}

/** Validate known settings only; unrelated environment variables and legacy extensions remain allowed. */
export function validateRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  environmentEnum(env, "NODE_ENV", ["development", "test", "production"], "development");
  environmentEnum(env, "SOURCE_RUN_MODE", ["demo", "live"], "live");
  environmentBoolean(env, "SOURCE_NETWORK_ENABLED", false, true);
  environmentEnum(env, "REDDIT_RUN_MODE", ["mock", "live"], "mock");
  environmentEnum(env, "REDDIT_CRAWL_MODE", ["live", "backfill"], "live");
  for (const key of ["REDDIT_LIVE_PROVIDER", "REDDIT_BACKFILL_PROVIDER"]) environmentEnum(env, key, ["http", "scrapling"], "http");
  environmentEnum(env, "REDDIT_CANDIDATE_FILTER_MODE", ["and", "or"], "or");
  // Retain existing legacy transport/profile spellings while rejecting unknown values.
  environmentEnum(env, "REDDIT_HTTP_TRANSPORT", ["fetch", "powershell", "auto"], "fetch");
  environmentEnum(env, "REDDIT_SCRAPLING_PROFILE", ["http", "dynamic", "stealth"], "http");
  for (const key of ["API_SESSION_COOKIE_SECURE", "API_ALLOW_INSECURE_SESSION_COOKIE", "API_RATE_LIMIT_ENABLED", "REDDIT_POST_LIMIT_ADAPTIVE", "REDDIT_SCRAPLING_CB_ROUTE_TO_HTTP", "REDDIT_SUPPRESS_HTTP_FALLBACK", "REDDIT_CB_ENABLED", "REDDIT_CB_ROUTE_TO_FALLBACK", "REDDIT_PROVIDER_CAPABILITY_REQUIRED", "REDDIT_RETENTION_PRUNE_ENABLED"]) {
    // Source networking is deliberately stricter than compatibility flags.
    environmentBoolean(env, key, false);
  }
  for (const key of ["PORT", "LOCAL_WEB_PORT", "PGPORT"]) environmentInteger(env, key, 3000, 1, 65535);
  const integers: [string, number, number][] = [
    ["PG_POOL_MAX", 1, 100], ["PG_CONNECTION_TIMEOUT_MS", 1, 3_600_000], ["PG_IDLE_TIMEOUT_MS", 1, 3_600_000], ["PG_QUERY_TIMEOUT_MS", 1, 3_600_000],
    ["API_CORS_MAX_AGE_SECONDS", 0, 86400], ["API_RATE_LIMIT_POINTS", 1, 1_000_000], ["API_RATE_LIMIT_DURATION_SECONDS", 1, 86400],
    ["TWITTERAPI_IO_TIMEOUT_MS", 100, 120000], ["REDDIT_HTTP_TIMEOUT_MS", 1, 3_600_000], ["REDDIT_SCRAPLING_TIMEOUT_MS", 1, 3_600_000], ["REDDIT_SCRAPLING_MAX_RETRIES", 0, 20],
    ["REDDIT_POST_LIMIT", 1, 5000], ["REDDIT_POST_LIMIT_BASE", 1, 5000], ["REDDIT_POST_LIMIT_BOOST", 1, 5000], ["REDDIT_BACKFILL_POST_LIMIT", 1, 5000],
    ["REDDIT_BACKFILL_MAX_ITERATIONS_PER_TARGET", 0, 10000], ["REDDIT_BACKFILL_TARGET_DAYS", 1, 36500],
    ["REDDIT_CANDIDATE_MIN_SCORE", 0, 1_000_000_000], ["REDDIT_CANDIDATE_MIN_COMMENTS", 0, 1_000_000_000],
  ];
  for (const [key, min, max] of integers) environmentInteger(env, key, min, min, max);
  validateUrl(env, "DATABASE_URL", ["postgres:", "postgresql:"]);
  validateUrl(env, "TEST_SOURCE_DATABASE_URL", ["postgres:", "postgresql:"]);
  validateUrl(env, "VITE_API_PROXY_TARGET", ["http:", "https:"], true);
}
