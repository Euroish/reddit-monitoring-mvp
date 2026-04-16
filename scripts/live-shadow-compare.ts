import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createRedditConnector,
  resolveRedditLiveProvider,
  resolveRedditScraplingProfile,
  type RedditLiveProvider,
} from "../src/connectors/reddit/create-reddit-connector";
import { DefaultRedditMapper } from "../src/connectors/reddit/reddit.mapper";
import {
  buildShadowParityResult,
  evaluateShadowParityGate,
  type ShadowProviderSample,
} from "../src/application/services/shadow-parity.service";

interface ProviderSnapshot {
  subreddit: string;
  round: number;
  provider: ShadowProviderSample;
  aboutStatus: number | null;
  aboutErrorMessage?: string;
  externalIds: string[];
}

interface ShadowRunRecord {
  subreddit: string;
  round: number;
  baseline: ProviderSnapshot;
  shadow: ProviderSnapshot;
  parity: ReturnType<typeof buildShadowParityResult>;
  parityGatePassed: boolean;
}

function parseSubredditList(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const unique = new Set<string>();
  for (const token of raw.split(",")) {
    const normalized = token.trim().replace(/^r\//i, "").toLowerCase();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
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

function resolveNowTag(now: Date): string {
  return now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function summarizeProvider(records: ShadowRunRecord[], lane: "baseline" | "shadow") {
  const samples = records.map((item) => item[lane].provider);
  const successCount = samples.filter((sample) => isSuccessfulStatus(sample.status)).length;
  const failedCount = samples.length - successCount;
  const avgDurationMs = average(samples.map((sample) => sample.durationMs));
  const avgExtractedCount = average(samples.map((sample) => sample.extractedCount));
  const avgDuplicateWithinResponse = average(
    samples.map((sample) => sample.duplicateWithinResponse),
  );
  const avgIngestLagSeconds = averageNullable(
    samples.map((sample) => sample.avgIngestLagSeconds),
  );
  return {
    provider: records[0]?.[lane]?.provider.provider ?? null,
    totalSamples: samples.length,
    successCount,
    failedCount,
    successRate: samples.length > 0 ? round(successCount / samples.length, 6) : null,
    avgDurationMs: round(avgDurationMs, 3),
    avgExtractedCount: round(avgExtractedCount, 3),
    avgDuplicateWithinResponse: round(avgDuplicateWithinResponse, 3),
    avgIngestLagSeconds:
      avgIngestLagSeconds == null ? null : round(avgIngestLagSeconds, 3),
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value != null);
  if (filtered.length === 0) {
    return null;
  }
  return average(filtered);
}

function round(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function isSuccessfulStatus(status: number | null): boolean {
  return status != null && status >= 200 && status < 300;
}

function summarizeParity(records: ShadowRunRecord[]) {
  const gatePassCount = records.filter((record) => record.parityGatePassed).length;
  return {
    totalComparisons: records.length,
    gatePassCount,
    gatePassRate:
      records.length > 0 ? round(gatePassCount / records.length, 6) : null,
    avgOverlapJaccard: averageNullable(
      records.map((record) => record.parity.overlapJaccard),
    ),
    avgExtractedDelta: average(records.map((record) => record.parity.extractedDelta)),
    avgLagDeltaSeconds: averageNullable(
      records.map((record) => record.parity.avgIngestLagDeltaSeconds),
    ),
  };
}

async function collectProviderSnapshot(args: {
  connector: ReturnType<typeof createRedditConnector>;
  provider: string;
  subreddit: string;
  round: number;
  limit: number;
  nowIso: string;
}): Promise<ProviderSnapshot> {
  const mapper = new DefaultRedditMapper();
  const targetId = `shadow:${args.subreddit}`;
  const requestIdPrefix = `shadow:${args.provider}:${args.subreddit}:r${args.round}`;

  let aboutStatus: number | null = null;
  let aboutErrorMessage: string | undefined;
  try {
    const about = await args.connector.collectSubredditAbout(
      {
        subreddit: args.subreddit,
      },
      {
        requestId: `${requestIdPrefix}:about`,
        now: args.nowIso,
      },
    );
    aboutStatus = about.raw.httpStatus;
  } catch (error) {
    aboutErrorMessage = error instanceof Error ? error.message : String(error);
  }

  const startedMs = Date.now();
  try {
    const page = await args.connector.collectSubredditPosts(
      {
        subreddit: args.subreddit,
        limit: args.limit,
      },
      {
        requestId: `${requestIdPrefix}:posts`,
        now: args.nowIso,
      },
    );
    const durationMs = Date.now() - startedMs;
    const upserts = mapper.toPostUpserts(targetId, page.raw, {
      requestId: `${requestIdPrefix}:map`,
      now: args.nowIso,
    });
    const externalIds = upserts.map((item) => item.externalId);
    const uniqueExternalIds = new Set(externalIds);
    const avgIngestLagSeconds = resolveAverageIngestLagSeconds(
      upserts.map((item) => item.createdAtSource),
      args.nowIso,
    );
    return {
      subreddit: args.subreddit,
      round: args.round,
      aboutStatus,
      aboutErrorMessage,
      externalIds,
      provider: {
        provider: args.provider,
        status: page.raw.httpStatus,
        durationMs,
        extractedCount: page.raw.payload.data.children.length,
        uniqueExternalCount: uniqueExternalIds.size,
        duplicateWithinResponse: Math.max(0, externalIds.length - uniqueExternalIds.size),
        avgIngestLagSeconds,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedMs;
    const message = error instanceof Error ? error.message : String(error);
    return {
      subreddit: args.subreddit,
      round: args.round,
      aboutStatus,
      aboutErrorMessage,
      externalIds: [],
      provider: {
        provider: args.provider,
        status: null,
        durationMs,
        extractedCount: 0,
        uniqueExternalCount: 0,
        duplicateWithinResponse: 0,
        avgIngestLagSeconds: null,
        errorMessage: message,
      },
    };
  }
}

function resolveAverageIngestLagSeconds(createdAtSources: string[], nowIso: string): number | null {
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(nowMs)) {
    return null;
  }
  const lags: number[] = [];
  for (const createdAt of createdAtSources) {
    const createdMs = new Date(createdAt).getTime();
    if (!Number.isFinite(createdMs) || createdMs > nowMs) {
      continue;
    }
    lags.push((nowMs - createdMs) / 1000);
  }
  if (lags.length === 0) {
    return null;
  }
  return average(lags);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const baselineProvider = resolveRedditLiveProvider(
    process.env.REDDIT_SHADOW_BASE_PROVIDER ?? "http",
  );
  const shadowProvider = resolveRedditLiveProvider(
    process.env.REDDIT_SHADOW_PROVIDER ?? "scrapling",
  );
  if (baselineProvider === shadowProvider) {
    throw new Error(
      `REDDIT_SHADOW_BASE_PROVIDER and REDDIT_SHADOW_PROVIDER must differ (both are ${baselineProvider})`,
    );
  }

  const subreddits = parseSubredditList(
    process.env.REDDIT_SHADOW_SUBREDDITS ?? process.env.REDDIT_RUN_SUBREDDIT ?? "machinelearning",
  );
  if (subreddits.length === 0) {
    throw new Error("No subreddits provided for shadow comparison");
  }

  const rounds = parsePositiveInt(process.env.REDDIT_SHADOW_ROUNDS, 1);
  const limit = parsePositiveInt(process.env.REDDIT_SHADOW_POST_LIMIT, 25);
  const roundPauseMs = parseNonNegativeInt(process.env.REDDIT_SHADOW_ROUND_PAUSE_MS, 0);
  const minJaccard = parsePositiveFloat(process.env.REDDIT_SHADOW_MIN_JACCARD, 0.35);
  const maxExtractedDeltaAbs = parsePositiveInt(
    process.env.REDDIT_SHADOW_MAX_EXTRACTED_DELTA_ABS,
    10,
  );
  const requireStatusMatch = parseBoolean(
    process.env.REDDIT_SHADOW_REQUIRE_STATUS_MATCH,
    true,
  );

  const connectorArgs = {
    mode: "live" as const,
    accessToken: process.env.REDDIT_ACCESS_TOKEN,
    userAgent: process.env.REDDIT_USER_AGENT,
    httpTransport: resolveRedditHttpTransportSafe(process.env.REDDIT_HTTP_TRANSPORT),
    httpTimeoutMs: parsePositiveInt(process.env.REDDIT_HTTP_TIMEOUT_MS, 12_000),
    scraplingProfile: resolveRedditScraplingProfile(
      process.env.REDDIT_SCRAPLING_PROFILE,
    ),
    scraplingPythonExecutable: process.env.REDDIT_SCRAPLING_PYTHON,
    scraplingBridgeScriptPath: process.env.REDDIT_SCRAPLING_BRIDGE_SCRIPT,
    scraplingTimeoutMs: parsePositiveInt(
      process.env.REDDIT_SCRAPLING_TIMEOUT_MS,
      parsePositiveInt(process.env.REDDIT_HTTP_TIMEOUT_MS, 12_000),
    ),
    scraplingMaxRetries: parsePositiveInt(process.env.REDDIT_SCRAPLING_MAX_RETRIES, 2),
    circuitBreaker: {
      enabled: false,
    },
  };

  const baselineConnector = createRedditConnector({
    ...connectorArgs,
    liveProvider: baselineProvider,
  });
  const shadowConnector = createRedditConnector({
    ...connectorArgs,
    liveProvider: shadowProvider,
  });

  const records: ShadowRunRecord[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (const subreddit of subreddits) {
      const nowIso = new Date().toISOString();
      const [baseline, shadow] = await Promise.all([
        collectProviderSnapshot({
          connector: baselineConnector,
          provider: baselineProvider,
          subreddit,
          round,
          limit,
          nowIso,
        }),
        collectProviderSnapshot({
          connector: shadowConnector,
          provider: shadowProvider,
          subreddit,
          round,
          limit,
          nowIso,
        }),
      ]);

      const parity = buildShadowParityResult({
        baseline: baseline.provider,
        shadow: shadow.provider,
        baselineExternalIds: baseline.externalIds,
        shadowExternalIds: shadow.externalIds,
      });
      const parityGatePassed = evaluateShadowParityGate({
        parity,
        minJaccard,
        maxExtractedDeltaAbs,
        requireStatusMatch,
      });

      records.push({
        subreddit,
        round,
        baseline,
        shadow,
        parity,
        parityGatePassed,
      });
    }

    if (round < rounds) {
      await sleep(roundPauseMs);
    }
  }

  const summary = {
    baseline: summarizeProvider(records, "baseline"),
    shadow: summarizeProvider(records, "shadow"),
    parity: summarizeParity(records),
  };

  const now = new Date();
  const outputPath = path.resolve(
    process.cwd(),
    "docs",
    `live-shadow-compare-${resolveNowTag(now)}.json`,
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = {
    generatedAt: now.toISOString(),
    baselineProvider,
    shadowProvider,
    scraplingProfile: resolveRedditScraplingProfile(
      process.env.REDDIT_SCRAPLING_PROFILE,
    ),
    config: {
      rounds,
      limit,
      roundPauseMs,
      minJaccard,
      maxExtractedDeltaAbs,
      requireStatusMatch,
      subreddits,
    },
    summary,
    records,
  };
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        event: "reddit.shadow_compare.completed",
        outputPath,
        summary,
      },
      null,
      2,
    ),
  );
}

function resolveRedditHttpTransportSafe(value: string | undefined): "auto" | "fetch" | "powershell" {
  if (value === "fetch" || value === "powershell") {
    return value;
  }
  return "auto";
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        event: "reddit.shadow_compare.failed",
        message,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

