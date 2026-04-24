import { floorToWindow } from "../../../src/shared/time/windowing";
import type { CrawlMode, RunMode } from "../../../packages/contracts/src/http";
import { normalizeQueryV2 } from "../../../src/application/services/query-normalization-v2.service";

export class BadRequestError extends Error {
  constructor(
    message: string,
    public readonly code = "bad_request",
  ) {
    super(message);
  }
}

const SUBREDDIT_PATTERN = /^[a-z0-9_]{3,21}$/;
const TREND_WINDOW_MINUTES = 360;
const DEFAULT_TREND_LOOKBACK_MINUTES = 72 * 60;
const MAX_TREND_LOOKBACK_MINUTES = 30 * 24 * 60;
const DEFAULT_DAILY_LOOKBACK_MINUTES = 14 * 24 * 60;
const MAX_DAILY_LOOKBACK_MINUTES = 90 * 24 * 60;
const WORKBENCH_RANGE_PRESET_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;
const DEFAULT_GLOBAL_KEYWORD_LOOKBACK_DAYS = 30;
const MAX_GLOBAL_KEYWORD_LOOKBACK_DAYS = 30;
const MAX_KEYWORD_QUERY_LENGTH = 160;

export function normalizeSubredditName(value: string): string {
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  if (!SUBREDDIT_PATTERN.test(normalized)) {
    throw new BadRequestError(
      "invalid subreddit format: use letters/numbers/underscore, length 3-21",
      "invalid_subreddit",
    );
  }
  return normalized;
}

export function resolveRunMode(requested?: string): RunMode | null {
  if (!requested || requested === "live") {
    return "live";
  }
  if (requested === "mock") {
    return "mock";
  }
  return null;
}

export function resolveCrawlMode(requested?: string): CrawlMode | null {
  if (!requested || requested === "live") {
    return "live";
  }
  if (requested === "backfill") {
    return "backfill";
  }
  return null;
}

function parseIsoParam(value: string | null, name: string): string | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError(`${name} must be a valid ISO datetime`, "invalid_datetime");
  }
  return date.toISOString();
}

export function parseOptionalIntegerParam(args: {
  value: string | null;
  name: string;
  min: number;
  max: number;
}): number | undefined {
  if (args.value === null) {
    return undefined;
  }

  const parsed = Number(args.value);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestError(`${args.name} must be an integer`, "invalid_query_param");
  }
  if (parsed < args.min || parsed > args.max) {
    throw new BadRequestError(
      `${args.name} must be between ${args.min} and ${args.max}`,
      "invalid_query_param",
    );
  }

  return parsed;
}

export function resolveTrendRange(params: URLSearchParams, nowIso: string): { fromIso: string; toIso: string } {
  const requestedTo = parseIsoParam(params.get("to"), "to") ?? nowIso;
  const requestedFrom =
    parseIsoParam(params.get("from"), "from") ??
    new Date(new Date(requestedTo).getTime() - DEFAULT_TREND_LOOKBACK_MINUTES * 60 * 1000).toISOString();

  const fromDate = new Date(requestedFrom);
  const toDate = new Date(requestedTo);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new BadRequestError("from must be <= to", "invalid_range");
  }

  const rangeMinutes = (toDate.getTime() - fromDate.getTime()) / (60 * 1000);
  if (rangeMinutes > MAX_TREND_LOOKBACK_MINUTES) {
    throw new BadRequestError(
      `range too large: max ${MAX_TREND_LOOKBACK_MINUTES} minutes`,
      "range_too_large",
    );
  }

  const fromIso = floorToWindow(requestedFrom, TREND_WINDOW_MINUTES);
  const toIso = floorToWindow(requestedTo, TREND_WINDOW_MINUTES);
  if (new Date(fromIso).getTime() > new Date(toIso).getTime()) {
    throw new BadRequestError("aligned from must be <= aligned to", "invalid_range");
  }

  return { fromIso, toIso };
}

export function resolveDailyRange(params: URLSearchParams, nowIso: string): { fromIso: string; toIso: string } {
  const toIso = parseIsoParam(params.get("to"), "to") ?? nowIso;
  const fromIso =
    parseIsoParam(params.get("from"), "from") ??
    new Date(new Date(toIso).getTime() - DEFAULT_DAILY_LOOKBACK_MINUTES * 60 * 1000).toISOString();

  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new BadRequestError("from must be <= to", "invalid_range");
  }

  const rangeMinutes = (toDate.getTime() - fromDate.getTime()) / (60 * 1000);
  if (rangeMinutes > MAX_DAILY_LOOKBACK_MINUTES) {
    throw new BadRequestError(
      `range too large: max ${MAX_DAILY_LOOKBACK_MINUTES} minutes`,
      "range_too_large",
    );
  }

  return { fromIso, toIso };
}

export function resolveWorkbenchDailyRange(
  params: URLSearchParams,
  nowIso: string,
): {
  fromIso: string;
  toIso: string;
  timeframe: "1d";
  rangePreset?: keyof typeof WORKBENCH_RANGE_PRESET_DAYS;
} {
  const requestedTimeframe = params.get("timeframe") ?? "1d";
  if (requestedTimeframe !== "1d") {
    throw new BadRequestError(
      "timeframe must be 1d until intraday workbench facts are available",
      "invalid_timeframe",
    );
  }

  const requestedRange = params.get("range");
  const rangePreset = parseWorkbenchRangePreset(requestedRange);
  const toIso = parseIsoParam(params.get("to"), "to") ?? nowIso;
  const fromIso =
    parseIsoParam(params.get("from"), "from") ??
    (rangePreset
      ? new Date(
          new Date(toIso).getTime() -
            (WORKBENCH_RANGE_PRESET_DAYS[rangePreset] - 1) * 24 * 60 * 60 * 1000,
        ).toISOString()
      : new Date(new Date(toIso).getTime() - DEFAULT_DAILY_LOOKBACK_MINUTES * 60 * 1000).toISOString());

  const resolved = resolveDailyRange(
    new URLSearchParams({
      from: fromIso,
      to: toIso,
    }),
    nowIso,
  );

  return {
    ...resolved,
    timeframe: "1d",
    ...(rangePreset ? { rangePreset } : {}),
  };
}

function parseWorkbenchRangePreset(
  value: string | null,
): keyof typeof WORKBENCH_RANGE_PRESET_DAYS | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  if (value === "7d" || value === "30d" || value === "90d") {
    return value;
  }
  throw new BadRequestError("range must be one of 7d, 30d, 90d", "invalid_range_preset");
}

export function resolveGlobalKeywordDailyRange(
  params: URLSearchParams,
  nowIso: string,
): { fromIso: string; toIso: string } {
  const toIso = parseIsoParam(params.get("to"), "to") ?? nowIso;
  const fromIso =
    parseIsoParam(params.get("from"), "from") ??
    new Date(
      new Date(toIso).getTime() -
        (DEFAULT_GLOBAL_KEYWORD_LOOKBACK_DAYS - 1) * 24 * 60 * 60 * 1000,
    ).toISOString();

  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new BadRequestError("from must be <= to", "invalid_range");
  }

  const dayCount = countUtcDaysInclusive(fromIso, toIso);
  if (dayCount > MAX_GLOBAL_KEYWORD_LOOKBACK_DAYS) {
    throw new BadRequestError(
      `range too large: max ${MAX_GLOBAL_KEYWORD_LOOKBACK_DAYS} days`,
      "range_too_large",
    );
  }

  return { fromIso, toIso };
}

function countUtcDaysInclusive(fromIso: string, toIso: string): number {
  const fromDay = new Date(`${toUtcDay(fromIso)}T00:00:00.000Z`);
  const toDay = new Date(`${toUtcDay(toIso)}T00:00:00.000Z`);
  if (Number.isNaN(fromDay.getTime()) || Number.isNaN(toDay.getTime())) {
    return 0;
  }
  const diffDays = Math.floor((toDay.getTime() - fromDay.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays + 1;
}

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function normalizeKeywordQueryText(value: string): string {
  try {
    const normalized = normalizeQueryV2(value);
    if (normalized.normalizedQueryText.length < 2) {
      throw new BadRequestError("query must contain at least 2 characters", "invalid_query");
    }
    if (normalized.normalizedQueryText.length > MAX_KEYWORD_QUERY_LENGTH) {
      throw new BadRequestError(
        `query must be <= ${MAX_KEYWORD_QUERY_LENGTH} characters`,
        "invalid_query",
      );
    }
    return normalized.normalizedQueryText;
  } catch (error) {
    if (error instanceof BadRequestError) {
      throw error;
    }
    throw new BadRequestError("query must be a valid searchable query", "invalid_query");
  }
}
