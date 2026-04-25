export const DEFAULT_PHASE1_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;

export const DEFAULT_REDDIT_POST_LIMIT_BASE = 16;
export const DEFAULT_REDDIT_POST_LIMIT_BOOST = 40;
export const DEFAULT_REDDIT_BACKFILL_POST_LIMIT = 100;
export const DEFAULT_REDDIT_BACKFILL_MAX_ITERATIONS_PER_TARGET = 24;

export const LIVE_COLLECTION_WINDOW_MINUTES = 5;
export const BACKFILL_COLLECTION_WINDOW_MINUTES = 15;

export function resolveCollectionWindowMinutes(
  mode: "live" | "backfill" | undefined,
): number {
  return mode === "backfill"
    ? BACKFILL_COLLECTION_WINDOW_MINUTES
    : LIVE_COLLECTION_WINDOW_MINUTES;
}
