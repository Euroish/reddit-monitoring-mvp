export const DEFAULT_PHASE1_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

export const DEFAULT_REDDIT_POST_LIMIT_BASE = 16;
export const DEFAULT_REDDIT_POST_LIMIT_BOOST = 40;
export const DEFAULT_REDDIT_BACKFILL_POST_LIMIT = 100;
export const DEFAULT_REDDIT_BACKFILL_MAX_ITERATIONS_PER_TARGET = 24;
export const DEFAULT_REDDIT_LIVE_WINDOW_HOURS = 8;
export const DEFAULT_REDDIT_LIVE_WINDOW_OVERLAP_MINUTES = 30;
export const DEFAULT_REDDIT_ACTIVE_POST_TRACKING_HOURS = 48;

export const LIVE_COLLECTION_WINDOW_MINUTES = 5;
export const BACKFILL_COLLECTION_WINDOW_MINUTES = 15;

export function resolveCollectionWindowMinutes(
  mode: "live" | "backfill" | undefined,
): number {
  return mode === "backfill"
    ? BACKFILL_COLLECTION_WINDOW_MINUTES
    : LIVE_COLLECTION_WINDOW_MINUTES;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function resolveLiveWindowHours(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(env.REDDIT_LIVE_WINDOW_HOURS, DEFAULT_REDDIT_LIVE_WINDOW_HOURS);
}

export function resolveLiveWindowOverlapMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(
    env.REDDIT_LIVE_WINDOW_OVERLAP_MINUTES,
    DEFAULT_REDDIT_LIVE_WINDOW_OVERLAP_MINUTES,
  );
}

export function resolveActivePostTrackingHours(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(
    env.REDDIT_ACTIVE_POST_TRACKING_HOURS,
    DEFAULT_REDDIT_ACTIVE_POST_TRACKING_HOURS,
  );
}
