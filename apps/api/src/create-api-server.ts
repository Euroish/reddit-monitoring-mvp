import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { RateLimiterMemory, type RateLimiterRes } from "rate-limiter-flexible";
import type {
  ApiErrorResponse,
  ApiHealthResponse,
  ApiReadinessQueueBucket,
  ApiReadinessResponse,
  CrawlMode,
  CreateKeywordQueryRequest,
  CreateKeywordQueryResponse,
  CreateSubredditTargetRequest,
  CreateSubredditTargetResponse,
  GetKeywordQueryResponse,
  MarketTrendResponse,
  RunMode,
  SubredditDailyTrendResponse,
  SubredditTrendResponse,
  TriggerPhase1RunRequest,
  TriggerPhase1RunResponse,
} from "../../../packages/contracts/src/http";
import { dispatchRedditPhase1Run } from "../../../src/application/use-cases/dispatch-reddit-phase1-run.use-case";
import { prepareTriggeredRedditPhase1Run } from "../../../src/application/use-cases/trigger-reddit-phase1-run.use-case";
import { runKeywordPulseQuery } from "../../../src/application/services/keyword-pulse-query.service";
import {
  buildKeywordQueryDataQuality,
  toDominantSourceType,
} from "../../../src/application/services/keyword-query-metrics";
import { buildSubredditDailyInsights } from "../../../src/application/services/subreddit-daily-insights.service";
import { buildSubredditTrendReadModel } from "../../../src/application/services/subreddit-trend-read-model";
import type { RedditConnector } from "../../../src/connectors/reddit/reddit-connector.interface";
import { DefaultRedditMapper } from "../../../src/connectors/reddit/reddit.mapper";
import type { RedditMapper } from "../../../src/connectors/reddit/reddit-mapper.interface";
import type { KeywordQuerySessionRepository } from "../../../src/domain/repositories/keyword-query-session-repository";
import { stableUuidFromString } from "../../../src/shared/ids/stable-id";
import type { AccountRepository } from "../../../src/domain/repositories/account-repository";
import type { CollectionJobRepository } from "../../../src/domain/repositories/collection-job-repository";
import type { ContentRepository } from "../../../src/domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../../../src/domain/repositories/crawl-cursor-repository";
import type { KeywordTrendDailyRepository } from "../../../src/domain/repositories/keyword-trend-daily-repository";
import type { MetricsSnapshotRepository } from "../../../src/domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../../../src/domain/repositories/monitor-target-repository";
import type { PostSearchDocumentRepository } from "../../../src/domain/repositories/post-search-document-repository";
import type { ProviderHealthWindowRepository } from "../../../src/domain/repositories/provider-health-window-repository";
import type { RawEventRepository } from "../../../src/domain/repositories/raw-event-repository";
import type { SubredditTrendPointRepository } from "../../../src/domain/repositories/subreddit-trend-point-repository";
import { LIVE_COLLECTION_WINDOW_MINUTES } from "../../../src/workers/reddit-phase1-defaults";
import {
  BadRequestError,
  resolveCrawlMode,
  normalizeKeywordQueryText,
  normalizeSubredditName,
  parseOptionalIntegerParam,
  resolveDailyRange,
  resolveRunMode,
  resolveTrendRange,
} from "./api-validation";

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BadRequestError("invalid JSON body", "invalid_json");
  }
}

type ApiLogLevel = "info" | "error";

interface ApiRequestLog {
  level: ApiLogLevel;
  event: "api.request.completed";
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  targetId?: string;
  canonicalName?: string;
  mode?: RunMode;
  errorCode?: string;
}

export interface ApiRepositoryBundle {
  monitorTargetRepository: MonitorTargetRepository;
  collectionJobRepository: CollectionJobRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  rawEventRepository: RawEventRepository;
  accountRepository: AccountRepository;
  contentRepository: ContentRepository;
  keywordTrendDailyRepository?: KeywordTrendDailyRepository;
  keywordQuerySessionRepository?: KeywordQuerySessionRepository;
  postSearchDocumentRepository?: PostSearchDocumentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
}

export interface CreateApiServerOptions {
  repositories: ApiRepositoryBundle;
  createConnector: (mode: RunMode, crawlMode?: CrawlMode) => RedditConnector;
  redditMapper?: RedditMapper;
  now?: () => string;
  logger?: (event: ApiRequestLog) => void;
  requestIdGenerator?: () => string;
  auth?: {
    bearerToken?: string;
    protectedPathPrefixes?: string[];
  };
  cors?: {
    allowedOrigins?: string[];
    allowedMethods?: string[];
    allowedHeaders?: string[];
    maxAgeSeconds?: number;
  };
  rateLimit?: {
    enabled?: boolean;
    points?: number;
    durationSeconds?: number;
  };
}

function defaultApiLogger(event: ApiRequestLog): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(event));
}

function toApiError(args: {
  requestId: string;
  message: string;
  code: string;
}): ApiErrorResponse {
  return {
    ok: false,
    requestId: args.requestId,
    error: args.message,
    errorCode: args.code,
  };
}

function toBodySnippet(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= 140 ? trimmed : `${trimmed.slice(0, 137)}...`;
}

function parseKeywordList(value: string | null): string[] {
  if (value == null) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(",")
        .map((keyword) => keyword.trim().toLowerCase())
        .filter((keyword) => keyword.length >= 2),
    ),
  );
}

function toQueueBucket(args: {
  queuedDue: number;
  queuedDelayed: number;
  retryingDue: number;
  retryingDelayed: number;
  running: number;
  deadLetter: number;
}): ApiReadinessQueueBucket {
  return {
    backlog: args.queuedDue + args.retryingDue,
    scheduled: args.queuedDelayed + args.retryingDelayed,
    running: args.running,
    deadLetter: args.deadLetter,
  };
}

function toRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Number((numerator / denominator).toFixed(6));
}

function toDuplicatePostRate(args: {
  duplicatePostCount: number;
  candidateCount: number;
  filteredOutCount: number;
  acceptedCount: number;
}): number | null {
  return toRate(
    args.duplicatePostCount,
    args.candidateCount > 0 ? args.candidateCount : args.acceptedCount,
  );
}

function toAverage(total: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  return Number((total / count).toFixed(3));
}

function toProviderSwitchShare(
  totalRequestCount: number,
  providerRequestCount: number,
): number | null {
  if (totalRequestCount <= 0) {
    return null;
  }
  return Number(
    (((totalRequestCount - providerRequestCount) / totalRequestCount) || 0).toFixed(6),
  );
}

function isProviderStaleHeadElevated(args: {
  duplicatePostRate: number | null;
  ingestLagSeconds: number | null;
}): boolean {
  if (args.duplicatePostRate == null || args.ingestLagSeconds == null) {
    return false;
  }

  return args.duplicatePostRate >= 0.55 && args.ingestLagSeconds >= 5400;
}

function toLagSeconds(nowIso: string, observedAtIso: string | undefined): number | null {
  if (!observedAtIso) {
    return null;
  }
  const nowMs = new Date(nowIso).getTime();
  const observedAtMs = new Date(observedAtIso).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedAtMs)) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - observedAtMs) / 1000));
}

function toNullableRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function toKeywordQueryView(args: {
  record: NonNullable<Awaited<ReturnType<KeywordQuerySessionRepository["findById"]>>>;
}) {
  const sourceTypeSummary = args.record.session.sourceTypeSummary;
  return {
    queryId: args.record.session.id,
    queryText: args.record.session.queryText,
    normalizedQueryText: args.record.session.normalizedQueryText,
    canonicalSubreddit: args.record.session.canonicalSubreddit,
    status: args.record.session.status,
    coverageLevel: args.record.session.coverageLevel,
    supportCount: args.record.session.supportCount,
    confidenceLevel: args.record.session.confidenceLevel,
    mentionRate: args.record.session.mentionRate,
    qualifiedMentionRate: args.record.session.qualifiedMentionRate,
    sourceType: {
      primary: toDominantSourceType(sourceTypeSummary),
      breakdown: sourceTypeSummary,
    },
    dataQuality: buildKeywordQueryDataQuality({
      coverageLevel: args.record.session.coverageLevel,
      confidenceLevel: args.record.session.confidenceLevel,
      supportCount: args.record.session.supportCount,
      mentionRate: args.record.session.mentionRate,
      qualifiedMentionRate: args.record.session.qualifiedMentionRate,
      degradedReason: args.record.session.degradedReason,
    }),
    sourceTypeSummary,
    degradedReason: args.record.session.degradedReason,
    explainPayload: args.record.session.explainPayload,
    createdAt: args.record.session.createdAt,
    updatedAt: args.record.session.updatedAt,
    samplePosts: args.record.samples.map((sample) => ({
      rank: sample.rank,
      contentId: sample.contentId,
      sourceType: sample.sourceType,
      dataQuality: sample.dataQuality,
      canonicalSubreddit: sample.canonicalSubreddit,
      title: sample.title,
      permalink: sample.permalink,
      createdAtSource: sample.createdAtSource,
      matchScore: sample.matchScore,
    })),
    pulsePoints5m: args.record.pulsePoints5m.map((point) => ({
      bucketStart: point.bucketStart,
      bucketEnd: point.bucketEnd,
      sourceType: point.sourceType,
      mentionCount: point.mentionCount,
      qualifiedMentionCount: point.qualifiedMentionCount,
      mentionRate: point.mentionRate,
      qualifiedMentionRate: point.qualifiedMentionRate,
      dataQuality: point.dataQuality,
      representativeSamples: point.representativeSamples.map((sample) => ({
        rank: sample.rank,
        contentId: sample.contentId,
        sourceType: sample.sourceType,
        dataQuality: sample.dataQuality,
        canonicalSubreddit: sample.canonicalSubreddit,
        title: sample.title,
        permalink: sample.permalink,
        createdAtSource: sample.createdAtSource,
        matchScore: sample.matchScore,
      })),
      updatedAt: point.updatedAt,
    })),
  };
}

function decodeSubredditPathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new BadRequestError(
      "invalid subreddit format: path segment must be valid URL encoding",
      "invalid_subreddit",
    );
  }
}

function resolveAsyncRunPreference(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no") {
      return false;
    }
  }
  return fallback;
}

function resolveRequestId(req: IncomingMessage, fallback: () => string): string {
  const headerValue = req.headers["x-request-id"];
  const requestId = typeof headerValue === "string" ? headerValue.trim() : "";
  if (!requestId || requestId.length > 128) {
    return fallback();
  }
  return requestId;
}

function appendVaryHeader(res: ServerResponse, value: string): void {
  const existing = res.getHeader("Vary");
  if (!existing) {
    res.setHeader("Vary", value);
    return;
  }
  const normalized = String(existing)
    .split(",")
    .map((item) => item.trim().toLowerCase());
  if (!normalized.includes(value.toLowerCase())) {
    res.setHeader("Vary", `${existing}, ${value}`);
  }
}

function resolveAllowedOrigin(args: {
  origin?: string;
  allowedOrigins: string[];
}): string | null {
  if (!args.origin) {
    return null;
  }
  if (args.allowedOrigins.includes("*")) {
    return "*";
  }
  return args.allowedOrigins.includes(args.origin) ? args.origin : null;
}

function applyCorsHeaders(args: {
  req: IncomingMessage;
  res: ServerResponse;
  allowedOrigins: string[];
}): { origin?: string; blocked: boolean } {
  if (args.allowedOrigins.length === 0) {
    return { blocked: false };
  }

  const originHeader = args.req.headers.origin;
  const origin = typeof originHeader === "string" ? originHeader.trim() : undefined;
  if (!origin) {
    return { blocked: false };
  }

  const allowedOrigin = resolveAllowedOrigin({
    origin,
    allowedOrigins: args.allowedOrigins,
  });
  if (!allowedOrigin) {
    return { origin, blocked: true };
  }

  args.res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  if (allowedOrigin !== "*") {
    appendVaryHeader(args.res, "Origin");
  }
  return { origin: allowedOrigin, blocked: false };
}

function applyPreflightHeaders(args: {
  req: IncomingMessage;
  res: ServerResponse;
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
}): void {
  args.res.setHeader("Access-Control-Allow-Methods", args.allowedMethods.join(", "));

  const requestedHeaders = args.req.headers["access-control-request-headers"];
  const requested = typeof requestedHeaders === "string" ? requestedHeaders.trim() : "";
  const allowHeaders = requested.length > 0 ? requested : args.allowedHeaders.join(", ");
  args.res.setHeader("Access-Control-Allow-Headers", allowHeaders);
  args.res.setHeader("Access-Control-Max-Age", String(args.maxAgeSeconds));
}

function readBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const [scheme, token] = header.trim().split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

function resolveClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  const socketIp = req.socket.remoteAddress?.trim();
  if (!socketIp) {
    return "unknown";
  }
  return socketIp;
}

function toRateLimitKey(req: IncomingMessage): string {
  const token = readBearerToken(req);
  if (token) {
    return `user:${stableUuidFromString(`api-rate-limit:${token}`)}`;
  }
  return `ip:${resolveClientIp(req)}`;
}

function isRateLimiterRes(value: unknown): value is RateLimiterRes {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RateLimiterRes>;
  return (
    typeof candidate.msBeforeNext === "number" &&
    typeof candidate.remainingPoints === "number" &&
    typeof candidate.consumedPoints === "number"
  );
}

function isBearerTokenValid(req: IncomingMessage, expectedToken: string): boolean {
  const providedToken = readBearerToken(req);
  if (!providedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function createApiServer(options: CreateApiServerOptions): Server {
  const repos = options.repositories;
  const now = options.now ?? (() => new Date().toISOString());
  const redditMapper = options.redditMapper ?? new DefaultRedditMapper();
  const logger = options.logger ?? defaultApiLogger;
  const requestIdGenerator = options.requestIdGenerator ?? randomUUID;
  const bearerToken = options.auth?.bearerToken?.trim() || undefined;
  const protectedPathPrefixes = options.auth?.protectedPathPrefixes ?? ["/v1/"];
  const corsAllowedOrigins =
    options.cors?.allowedOrigins?.map((origin) => origin.trim()).filter((origin) => origin.length > 0) ??
    [];
  const corsAllowedMethods =
    options.cors?.allowedMethods?.map((method) => method.trim().toUpperCase()).filter(Boolean) ??
    ["GET", "POST", "OPTIONS"];
  const corsAllowedHeaders =
    options.cors?.allowedHeaders?.map((header) => header.trim()).filter(Boolean) ??
    ["content-type", "authorization", "x-request-id"];
  const corsMaxAgeSeconds = Math.max(0, options.cors?.maxAgeSeconds ?? 300);
  const rateLimitEnabled = options.rateLimit?.enabled ?? true;
  const rateLimitPoints = Math.max(1, options.rateLimit?.points ?? 60);
  const rateLimitDurationSeconds = Math.max(1, options.rateLimit?.durationSeconds ?? 60);
  const queryRateLimiter = rateLimitEnabled
    ? new RateLimiterMemory({
        keyPrefix: "api_query",
        points: rateLimitPoints,
        duration: rateLimitDurationSeconds,
      })
    : null;

  return createServer(async (req, res) => {
    const requestId = resolveRequestId(req, requestIdGenerator);
    const startedAtMs = Date.now();
    let pathForLog = req.url ?? "/";
    const methodForLog = req.method ?? "UNKNOWN";
    res.setHeader("x-request-id", requestId);

    const respond = (args: {
      statusCode: number;
      body: unknown;
      level?: ApiLogLevel;
      targetId?: string;
      canonicalName?: string;
      mode?: RunMode;
      errorCode?: string;
    }): void => {
      sendJson(res, args.statusCode, args.body);
      logger({
        level: args.level ?? (args.statusCode >= 500 ? "error" : "info"),
        event: "api.request.completed",
        requestId,
        method: methodForLog,
        path: pathForLog,
        statusCode: args.statusCode,
        durationMs: Date.now() - startedAtMs,
        targetId: args.targetId,
        canonicalName: args.canonicalName,
        mode: args.mode,
        errorCode: args.errorCode,
      });
    };

    const respondNoContent = (statusCode: number): void => {
      res.statusCode = statusCode;
      res.end();
      logger({
        level: statusCode >= 500 ? "error" : "info",
        event: "api.request.completed",
        requestId,
        method: methodForLog,
        path: pathForLog,
        statusCode,
        durationMs: Date.now() - startedAtMs,
      });
    };

    try {
      if (!req.url || !req.method) {
        respond({
          statusCode: 400,
          body: toApiError({
            requestId,
            message: "invalid request",
            code: "invalid_request",
          }),
          errorCode: "invalid_request",
        });
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const pathname = url.pathname;
      pathForLog = pathname;

      const corsResult = applyCorsHeaders({
        req,
        res,
        allowedOrigins: corsAllowedOrigins,
      });
      if (corsResult.blocked) {
        respond({
          statusCode: 403,
          body: toApiError({
            requestId,
            message: "CORS origin is not allowed",
            code: "cors_origin_not_allowed",
          }),
          errorCode: "cors_origin_not_allowed",
        });
        return;
      }

      if (req.method === "OPTIONS") {
        applyPreflightHeaders({
          req,
          res,
          allowedMethods: corsAllowedMethods,
          allowedHeaders: corsAllowedHeaders,
          maxAgeSeconds: corsMaxAgeSeconds,
        });
        respondNoContent(204);
        return;
      }

      const needsAuth =
        Boolean(bearerToken) &&
        protectedPathPrefixes.some((prefix) => pathname.startsWith(prefix));
      if (needsAuth && bearerToken && !isBearerTokenValid(req, bearerToken)) {
        respond({
          statusCode: 401,
          body: toApiError({
            requestId,
            message: "unauthorized",
            code: "unauthorized",
          }),
          errorCode: "unauthorized",
        });
        return;
      }

      const isKeywordQueryRoute =
        pathname === "/v1/keyword-queries" || pathname.startsWith("/v1/keyword-queries/");
      const isQueryRoute =
        (req.method === "GET" && pathname.startsWith("/v1/trends/")) ||
        ((req.method === "GET" || req.method === "POST") && isKeywordQueryRoute);
      if (queryRateLimiter && isQueryRoute) {
        try {
          const key = toRateLimitKey(req);
          const rateLimitRes = await queryRateLimiter.consume(key);
          res.setHeader("x-ratelimit-limit", String(rateLimitPoints));
          res.setHeader(
            "x-ratelimit-remaining",
            String(Math.max(0, rateLimitRes.remainingPoints)),
          );
          res.setHeader(
            "x-ratelimit-reset",
            String(Math.ceil((Date.now() + rateLimitRes.msBeforeNext) / 1000)),
          );
        } catch (rateLimitError) {
          if (isRateLimiterRes(rateLimitError)) {
            const retryAfterSeconds = Math.max(
              1,
              Math.ceil(rateLimitError.msBeforeNext / 1000),
            );
            res.setHeader("retry-after", String(retryAfterSeconds));
            res.setHeader("x-ratelimit-limit", String(rateLimitPoints));
            res.setHeader("x-ratelimit-remaining", "0");
            res.setHeader(
              "x-ratelimit-reset",
              String(Math.ceil((Date.now() + rateLimitError.msBeforeNext) / 1000)),
            );
            respond({
              statusCode: 429,
              body: toApiError({
                requestId,
                message: "rate limit exceeded",
                code: "rate_limited",
              }),
              errorCode: "rate_limited",
            });
            return;
          }

          respond({
            statusCode: 503,
            body: toApiError({
              requestId,
              message: "rate limiter unavailable",
              code: "rate_limiter_unavailable",
            }),
            level: "error",
            errorCode: "rate_limiter_unavailable",
          });
          return;
        }
      }

      if (req.method === "GET" && pathname === "/healthz") {
        const payload: ApiHealthResponse = {
          ok: true,
          requestId,
          service: "reddit-monitoring-mvp",
          nowIso: now(),
        };
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/readyz") {
        const nowIso = now();
        const activeSessionStatuses = [
          "queued",
          "initial_ready",
          "live_refreshing",
        ] as const;
        const activeSessionLookbackMinutes = 30;
        const providerHealthLookbackMinutes = 30;
        const providerHealthSuccessRateMin = 0.7;
        const providerHealthFallbackRateMax = 0.6;
        const providerHealthEmptyRateMax = 0.85;
        const providerHealthDiffRateMax = 0.3;
        const providerHealthErrorRateMax = 0.25;
        const providerHealthRateLimitRateMax = 0.15;
        const providerHealthTimeoutRateMax = 0.12;
        const providerHealthCircuitOpenRateMax = 0.08;
        const providerHealthSwitchShareMax = 0.2;
        const cursorStallThresholdSeconds = LIVE_COLLECTION_WINDOW_MINUTES * 3 * 60;
        const activeSessionUpdatedSinceIso = new Date(
          new Date(nowIso).getTime() - activeSessionLookbackMinutes * 60 * 1000,
        ).toISOString();
        const providerHealthFromIso = new Date(
          new Date(nowIso).getTime() - providerHealthLookbackMinutes * 60 * 1000,
        ).toISOString();
        let storageCheck: ApiReadinessResponse["checks"]["storage"] = "ok";
        let queueCheck: ApiReadinessResponse["checks"]["queue"] = "ok";
        let activeTargets = 0;
        let activeSessions = 0;
        let queue = {
          backlog: 0,
          scheduled: 0,
          running: 0,
          deadLetter: 0,
          byMode: {
            live: { backlog: 0, scheduled: 0, running: 0, deadLetter: 0 },
            backfill: { backlog: 0, scheduled: 0, running: 0, deadLetter: 0 },
            default: { backlog: 0, scheduled: 0, running: 0, deadLetter: 0 },
          },
        };
        let observability: ApiReadinessResponse["observability"] = {
          fetchSuccessRate: null,
          fallbackRate: null,
          emptyWindowRate: null,
          duplicatePostRate: null,
          ingestLagSeconds: null,
          providerDiffRate: null,
          errorRate: null,
          rateLimitRate: null,
          timeoutRate: null,
          circuitOpenRate: null,
          providerSwitchShare: null,
          cursorStallRate: null,
          cursorLagSecondsMax: null,
          byProvider: [],
        };
        const degradedReasons: string[] = [];
        const staleHeadProviders = new Set<string>();

        try {
          const targets = await repos.monitorTargetRepository.findActiveSubreddits();
          activeTargets = targets.length;
        } catch {
          storageCheck = "error";
          degradedReasons.push("storage_unavailable");
        }

        try {
          const summary = await repos.collectionJobRepository.getOperationalSummary(nowIso);
          queue = {
            ...toQueueBucket(summary),
            byMode: {
              live: toQueueBucket(summary.byMode.live),
              backfill: toQueueBucket(summary.byMode.backfill),
              default: toQueueBucket(summary.byMode.default),
            },
          };
          if (summary.deadLetter > 0) {
            queueCheck = "degraded";
            degradedReasons.push("dead_letter_jobs_present");
          }
        } catch {
          queueCheck = "error";
          if (!degradedReasons.includes("queue_unavailable")) {
            degradedReasons.push("queue_unavailable");
          }
        }

        if (repos.keywordQuerySessionRepository) {
          try {
            activeSessions = await repos.keywordQuerySessionRepository.countActiveSessions({
              statuses: [...activeSessionStatuses],
              updatedSinceIso: activeSessionUpdatedSinceIso,
            });
          } catch {
            if (!degradedReasons.includes("keyword_session_observability_unavailable")) {
              degradedReasons.push("keyword_session_observability_unavailable");
            }
          }
        } else {
          activeSessions = queue.running;
        }

        if (repos.providerHealthWindowRepository) {
          try {
            const aggregates = await repos.providerHealthWindowRepository.summarizeByProviderInRange({
              from: providerHealthFromIso,
              to: nowIso,
              mode: "live",
            });
            const totals = aggregates.reduce(
              (summary, item) => {
                summary.requestCount += item.requestCount;
                summary.successCount += item.successCount;
                summary.emptyResponseCount += item.emptyResponseCount;
                summary.fallbackCount += item.fallbackCount;
                summary.candidateCount += item.candidateCount;
                summary.acceptedCount += item.acceptedCount;
                summary.filteredOutCount += item.filteredOutCount;
                summary.duplicatePostCount += item.duplicatePostCount;
                summary.ingestLagSecondsSum += item.ingestLagSecondsSum;
                summary.ingestLagSampleCount += item.ingestLagSampleCount;
                summary.providerDiffCount += item.providerDiffCount;
                summary.providerDiffSampleCount += item.providerDiffSampleCount;
                summary.errorCount += item.errorCount;
                summary.rateLimitCount += item.rateLimitCount;
                summary.timeoutCount += item.timeoutCount;
                summary.circuitOpenCount += item.circuitOpenCount;
                return summary;
              },
              {
                requestCount: 0,
                successCount: 0,
                emptyResponseCount: 0,
                fallbackCount: 0,
                candidateCount: 0,
                acceptedCount: 0,
                filteredOutCount: 0,
                duplicatePostCount: 0,
                ingestLagSecondsSum: 0,
                ingestLagSampleCount: 0,
                providerDiffCount: 0,
                providerDiffSampleCount: 0,
                errorCount: 0,
                rateLimitCount: 0,
                timeoutCount: 0,
                circuitOpenCount: 0,
              },
            );
            observability.byProvider = aggregates.map((item) => {
              return {
                provider: item.provider,
                mode: item.mode,
                fetchSuccessRate: toRate(item.successCount, item.requestCount),
                fallbackRate: toRate(item.fallbackCount, item.requestCount),
                emptyWindowRate: toRate(item.emptyResponseCount, item.requestCount),
                duplicatePostRate: toDuplicatePostRate({
                  duplicatePostCount: item.duplicatePostCount,
                  candidateCount: item.candidateCount,
                  filteredOutCount: item.filteredOutCount,
                  acceptedCount: item.acceptedCount,
                }),
                ingestLagSeconds: toAverage(
                  item.ingestLagSecondsSum,
                  item.ingestLagSampleCount,
                ),
                providerDiffRate: toRate(
                  item.providerDiffCount,
                  item.providerDiffSampleCount,
                ),
                errorRate: toRate(item.errorCount, item.requestCount),
                rateLimitRate: toRate(item.rateLimitCount, item.requestCount),
                timeoutRate: toRate(item.timeoutCount, item.requestCount),
                circuitOpenRate: toRate(item.circuitOpenCount, item.requestCount),
                providerSwitchShare: toProviderSwitchShare(
                  totals.requestCount,
                  item.requestCount,
                ),
                cursorStallRate: null,
                cursorLagSecondsMax: null,
              };
            });
            observability.fetchSuccessRate = toRate(
              totals.successCount,
              totals.requestCount,
            );
            observability.fallbackRate = toRate(
              totals.fallbackCount,
              totals.requestCount,
            );
            observability.emptyWindowRate = toRate(
              totals.emptyResponseCount,
              totals.requestCount,
            );
            observability.duplicatePostRate = toDuplicatePostRate({
              duplicatePostCount: totals.duplicatePostCount,
              candidateCount: totals.candidateCount,
              filteredOutCount: totals.filteredOutCount,
              acceptedCount: totals.acceptedCount,
            });
            observability.ingestLagSeconds = toAverage(
              totals.ingestLagSecondsSum,
              totals.ingestLagSampleCount,
            );
            observability.providerDiffRate = toRate(
              totals.providerDiffCount,
              totals.providerDiffSampleCount,
            );
            observability.errorRate = toRate(
              totals.errorCount,
              totals.requestCount,
            );
            observability.rateLimitRate = toRate(
              totals.rateLimitCount,
              totals.requestCount,
            );
            observability.timeoutRate = toRate(
              totals.timeoutCount,
              totals.requestCount,
            );
            observability.circuitOpenRate = toRate(
              totals.circuitOpenCount,
              totals.requestCount,
            );
            observability.providerSwitchShare = toProviderSwitchShare(
              totals.requestCount,
              Math.max(0, ...aggregates.map((item) => item.requestCount)),
            );
            for (const item of aggregates) {
              if (item.requestCount <= 0) {
                continue;
              }
              const successRate = item.successCount / item.requestCount;
              const fallbackRate = item.fallbackCount / item.requestCount;
              const emptyRate = item.emptyResponseCount / item.requestCount;
              const diffRate =
                item.providerDiffSampleCount > 0
                  ? item.providerDiffCount / item.providerDiffSampleCount
                  : 0;
              const errorRate = item.errorCount / item.requestCount;
              const rateLimitRate = item.rateLimitCount / item.requestCount;
              const timeoutRate = item.timeoutCount / item.requestCount;
              const circuitOpenRate = item.circuitOpenCount / item.requestCount;
              const duplicatePostRate = toDuplicatePostRate({
                duplicatePostCount: item.duplicatePostCount,
                candidateCount: item.candidateCount,
                filteredOutCount: item.filteredOutCount,
                acceptedCount: item.acceptedCount,
              });
              const ingestLagSeconds = toAverage(
                item.ingestLagSecondsSum,
                item.ingestLagSampleCount,
              );
              const providerSwitchShare =
                totals.requestCount > 0
                  ? (totals.requestCount - item.requestCount) / totals.requestCount
                  : 0;
              if (successRate < providerHealthSuccessRateMin) {
                const reason = `provider_fetch_success_low:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (fallbackRate > providerHealthFallbackRateMax) {
                const reason = `provider_fallback_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (emptyRate > providerHealthEmptyRateMax) {
                const reason = `provider_empty_window_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (diffRate > providerHealthDiffRateMax) {
                const reason = `provider_diff_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (errorRate > providerHealthErrorRateMax) {
                const reason = `provider_error_rate_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (rateLimitRate > providerHealthRateLimitRateMax) {
                const reason = `provider_rate_limit_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (timeoutRate > providerHealthTimeoutRateMax) {
                const reason = `provider_timeout_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (circuitOpenRate > providerHealthCircuitOpenRateMax) {
                const reason = `provider_circuit_open_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (providerSwitchShare > providerHealthSwitchShareMax) {
                const reason = `provider_switch_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
              if (
                isProviderStaleHeadElevated({
                  duplicatePostRate,
                  ingestLagSeconds,
                })
              ) {
                staleHeadProviders.add(item.provider);
                const reason = `provider_stale_head_elevated:${item.provider}`;
                if (!degradedReasons.includes(reason)) {
                  degradedReasons.push(reason);
                }
              }
            }
          } catch {
            if (!degradedReasons.includes("provider_health_unavailable")) {
              degradedReasons.push("provider_health_unavailable");
            }
          }
        }

        if (repos.crawlCursorRepository) {
          try {
            const liveCursors = await repos.crawlCursorRepository.list({
              mode: "live",
            });
            const byProvider = new Map<
              string,
              {
                totalCount: number;
                stalledCount: number;
                maxLagSeconds: number | null;
              }
            >();
            let totalCursorCount = 0;
            let stalledCursorCount = 0;
            let maxLagSeconds: number | null = null;

            for (const cursor of liveCursors) {
              const lagSeconds = toLagSeconds(
                nowIso,
                cursor.lastFetchedAt ?? cursor.updatedAt,
              );
              const current = byProvider.get(cursor.provider) ?? {
                totalCount: 0,
                stalledCount: 0,
                maxLagSeconds: null,
              };
              current.totalCount += 1;
              totalCursorCount += 1;

              if (lagSeconds != null) {
                current.maxLagSeconds =
                  current.maxLagSeconds == null
                    ? lagSeconds
                    : Math.max(current.maxLagSeconds, lagSeconds);
                maxLagSeconds =
                  maxLagSeconds == null ? lagSeconds : Math.max(maxLagSeconds, lagSeconds);
                if (lagSeconds > cursorStallThresholdSeconds) {
                  current.stalledCount += 1;
                  stalledCursorCount += 1;
                }
              }

              byProvider.set(cursor.provider, current);
            }

            observability.cursorStallRate = toNullableRate(
              stalledCursorCount,
              totalCursorCount,
            );
            observability.cursorLagSecondsMax = maxLagSeconds;

            const existingProviders = new Set(
              observability.byProvider.map((item) => item.provider),
            );
            observability.byProvider = observability.byProvider.map((item) => {
              const stats = byProvider.get(item.provider);
              return {
                ...item,
                cursorStallRate: stats
                  ? toNullableRate(stats.stalledCount, stats.totalCount)
                  : null,
                cursorLagSecondsMax: stats?.maxLagSeconds ?? null,
              };
            });
            for (const [provider, stats] of byProvider.entries()) {
              if (existingProviders.has(provider)) {
                continue;
              }
              observability.byProvider.push({
                provider,
                mode: "live",
                fetchSuccessRate: null,
                fallbackRate: null,
                emptyWindowRate: null,
                duplicatePostRate: null,
                ingestLagSeconds: null,
                providerDiffRate: null,
                errorRate: null,
                rateLimitRate: null,
                timeoutRate: null,
                circuitOpenRate: null,
                providerSwitchShare: null,
                cursorStallRate: toNullableRate(stats.stalledCount, stats.totalCount),
                cursorLagSecondsMax: stats.maxLagSeconds,
              });
            }
            for (const [provider, stats] of byProvider.entries()) {
              if (stats.stalledCount <= 0) {
                continue;
              }
              const reason = `provider_cursor_stalled:${provider}`;
              if (!degradedReasons.includes(reason)) {
                degradedReasons.push(reason);
              }
              if (staleHeadProviders.has(provider)) {
                const combinedReason = `provider_data_stalled:${provider}`;
                if (!degradedReasons.includes(combinedReason)) {
                  degradedReasons.push(combinedReason);
                }
              }
            }
          } catch {
            if (!degradedReasons.includes("crawl_cursor_observability_unavailable")) {
              degradedReasons.push("crawl_cursor_observability_unavailable");
            }
          }
        }

        const isReady = storageCheck === "ok" && queueCheck !== "error";
        const payload: ApiReadinessResponse = {
          ok: isReady,
          requestId,
          service: "reddit-monitoring-mvp",
          nowIso,
          status: isReady ? (degradedReasons.length > 0 ? "degraded" : "ready") : "not_ready",
          checks: {
            storage: storageCheck,
            queue: queueCheck,
          },
          queue,
          observability,
          activeSessions,
          activeTargets,
          degradedReasons,
        };

        respond({
          statusCode: isReady ? 200 : 503,
          body: payload,
          level: isReady ? "info" : "error",
          errorCode: isReady ? undefined : "not_ready",
        });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/targets/subreddit") {
        const body = await readJsonBody<CreateSubredditTargetRequest>(req);
        if (!body || typeof body.subreddit !== "string" || body.subreddit.trim() === "") {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "subreddit is required",
              code: "missing_subreddit",
            }),
            errorCode: "missing_subreddit",
          });
          return;
        }

        const nowIso = now();
        const subreddit = normalizeSubredditName(body.subreddit);
        const canonicalName = `r/${subreddit}`;
        const targetId = stableUuidFromString(`reddit:target:${canonicalName}`);

        await repos.monitorTargetRepository.upsert({
          id: targetId,
          source: "reddit",
          targetType: "subreddit",
          canonicalName,
          status: "active",
          config: {},
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const payload: CreateSubredditTargetResponse = {
          ok: true,
          requestId,
          targetId,
          canonicalName,
        };
        respond({
          statusCode: 200,
          body: payload,
          targetId,
          canonicalName,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/runs/reddit-phase1") {
        const body = await readJsonBody<TriggerPhase1RunRequest>(req);
        const requestedMode = body?.mode ?? process.env.REDDIT_RUN_MODE;
        const mode = resolveRunMode(requestedMode);
        if (!mode) {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "mode must be live or mock",
              code: "invalid_run_mode",
            }),
            errorCode: "invalid_run_mode",
          });
          return;
        }
        const requestedCrawlMode = body?.crawlMode ?? process.env.REDDIT_CRAWL_MODE;
        const crawlMode = resolveCrawlMode(requestedCrawlMode);
        if (!crawlMode) {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "crawlMode must be live or backfill",
              code: "invalid_crawl_mode",
            }),
            errorCode: "invalid_crawl_mode",
          });
          return;
        }

        const requestedSubreddit =
          typeof body?.subreddit === "string" && body.subreddit.trim().length > 0
            ? normalizeSubredditName(body.subreddit)
            : undefined;

        const runAsync = resolveAsyncRunPreference(body?.async, true);
        let postLimit: number | undefined;
        if (body?.postLimit != null) {
          if (!Number.isInteger(body.postLimit) || body.postLimit < 1 || body.postLimit > 200) {
            respond({
              statusCode: 400,
              body: toApiError({
                requestId,
                message: "postLimit must be an integer between 1 and 200",
                code: "invalid_post_limit",
              }),
              errorCode: "invalid_post_limit",
            });
            return;
          }
          postLimit = body.postLimit;
        }
        if (runAsync) {
          const runRequest = await dispatchRedditPhase1Run(
            {
              repositories: {
                monitorTargetRepository: repos.monitorTargetRepository,
                collectionJobRepository: repos.collectionJobRepository,
                crawlCursorRepository: repos.crawlCursorRepository,
              },
              now,
              env: process.env,
            },
            {
              mode,
              crawlMode,
              subreddit: requestedSubreddit,
              postLimit,
            },
          );
          const payload: TriggerPhase1RunResponse = {
            ok: true,
            requestId,
            mode,
            crawlMode,
            nowIso: runRequest.nowIso,
            subreddit: runRequest.canonicalName,
            requestedCanonicalNames: runRequest.requestedCanonicalNames,
            processedCanonicalNames: [],
          };
          respond({
            statusCode: 202,
            body: payload,
            canonicalName: runRequest.canonicalName,
            mode,
          });
          return;
        }

        const runRequest = await prepareTriggeredRedditPhase1Run(
          {
            repositories: repos,
            createConnector: options.createConnector,
            redditMapper,
            now,
            env: process.env,
          },
          {
            mode,
            crawlMode,
            subreddit: requestedSubreddit,
            postLimit,
            continueOnError: true,
          },
        );

        const runResult = await runRequest.execute();

        const payload: TriggerPhase1RunResponse = {
          ok: true,
          requestId,
          mode,
          crawlMode,
          nowIso: runRequest.nowIso,
          subreddit: runRequest.canonicalName,
          requestedCanonicalNames: runResult.requestedCanonicalNames,
          processedCanonicalNames: runResult.processedCanonicalNames,
        };
        respond({
          statusCode: 200,
          body: payload,
          canonicalName: runRequest.canonicalName,
          mode,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/v1/keyword-queries") {
        if (!repos.postSearchDocumentRepository || !repos.keywordQuerySessionRepository) {
          respond({
            statusCode: 501,
            body: toApiError({
              requestId,
              message: "keyword query engine is not configured",
              code: "feature_not_ready",
            }),
            errorCode: "feature_not_ready",
          });
          return;
        }

        const body = await readJsonBody<CreateKeywordQueryRequest>(req);
        if (!body || typeof body.query !== "string") {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "query is required",
              code: "missing_query",
            }),
            errorCode: "missing_query",
          });
          return;
        }

        const queryText = normalizeKeywordQueryText(body.query);
        const subreddit =
          typeof body.subreddit === "string" && body.subreddit.trim().length > 0
            ? normalizeSubredditName(body.subreddit)
            : undefined;
        const limit =
          body.limit == null
            ? 10
            : parseOptionalIntegerParam({
                value: String(body.limit),
                name: "limit",
                min: 1,
                max: 30,
              }) ?? 10;
        const nowIso = now();
        const runResult = await runKeywordPulseQuery({
          input: {
            queryText,
            canonicalSubreddit: subreddit ? `r/${subreddit}` : undefined,
            limit,
            nowIso,
          },
          postSearchDocumentRepository: repos.postSearchDocumentRepository,
          keywordQuerySessionRepository: repos.keywordQuerySessionRepository,
        });

        const payload: CreateKeywordQueryResponse = {
          ok: true,
          requestId,
          result: toKeywordQueryView({
            record: {
              session: runResult.session,
              samples: runResult.samples,
              pulsePoints5m: runResult.pulsePoints5m,
            },
          }),
        };
        respond({
          statusCode: 200,
          body: payload,
          canonicalName: subreddit ? `r/${subreddit}` : undefined,
        });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/v1/keyword-queries/")) {
        if (!repos.keywordQuerySessionRepository) {
          respond({
            statusCode: 501,
            body: toApiError({
              requestId,
              message: "keyword query engine is not configured",
              code: "feature_not_ready",
            }),
            errorCode: "feature_not_ready",
          });
          return;
        }

        const queryIdRaw = pathname.replace("/v1/keyword-queries/", "");
        const queryId = queryIdRaw.trim();
        if (!queryId) {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "query id is required",
              code: "missing_query_id",
            }),
            errorCode: "missing_query_id",
          });
          return;
        }
        const sampleLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("sampleLimit"),
            name: "sampleLimit",
            min: 1,
            max: 50,
          }) ?? 20;

        const record = await repos.keywordQuerySessionRepository.findById(queryId, sampleLimit);
        if (!record) {
          respond({
            statusCode: 404,
            body: toApiError({
              requestId,
              message: `keyword query not found: ${queryId}`,
              code: "query_not_found",
            }),
            errorCode: "query_not_found",
          });
          return;
        }

        const payload: GetKeywordQueryResponse = {
          ok: true,
          requestId,
          result: toKeywordQueryView({ record }),
        };
        respond({
          statusCode: 200,
          body: payload,
          canonicalName: record.session.canonicalSubreddit,
        });
        return;
      }

      if (
        req.method === "GET" &&
        pathname.startsWith("/v1/trends/subreddit/") &&
        pathname.endsWith("/daily")
      ) {
        const subredditRaw = pathname
          .replace("/v1/trends/subreddit/", "")
          .replace(/\/daily$/, "");
        const subreddit = normalizeSubredditName(decodeSubredditPathSegment(subredditRaw));

        const canonicalName = `r/${subreddit}`;
        const target = await repos.monitorTargetRepository.findByCanonicalName(canonicalName);
        if (!target) {
          respond({
            statusCode: 404,
            body: toApiError({
              requestId,
              message: `target not found: ${canonicalName}`,
              code: "target_not_found",
            }),
            canonicalName,
            errorCode: "target_not_found",
          });
          return;
        }

        const { fromIso, toIso } = resolveDailyRange(url.searchParams, now());
        const keywordLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("keywordLimit"),
            name: "keywordLimit",
            min: 1,
            max: 30,
          }) ?? 10;
        const keywords = parseKeywordList(url.searchParams.get("keywords"));
        const [points, keywordDailyRows] = await Promise.all([
          repos.subredditTrendPointRepository.listByTargetInRange({
            targetId: target.id,
            from: fromIso,
            to: toIso,
          }),
          repos.keywordTrendDailyRepository?.listByTargetInRange({
            targetId: target.id,
            fromDay: toUtcDay(fromIso),
            toDay: toUtcDay(toIso),
            keywords,
            limit: keywordLimit,
          }) ?? Promise.resolve([]),
        ]);

        const posts =
          keywordDailyRows.length === 0
            ? await repos.contentRepository.findByTargetCreatedAtRange({
                targetId: target.id,
                from: fromIso,
                to: toIso,
                limit: 10000,
              })
            : [];

        const readModel = buildSubredditDailyInsights({
          points,
          posts,
          keywordDailyRows,
          fromIso,
          toIso,
          keywords,
          keywordLimit,
        });

        const payload: SubredditDailyTrendResponse = {
          ok: true,
          requestId,
          generatedAtIso: now(),
          targetId: target.id,
          canonicalName,
          fromIso: readModel.fromIso,
          toIso: readModel.toIso,
          dayCount: readModel.dayCount,
          daily: readModel.daily,
          keywordHeat: readModel.keywordHeat,
        };
        respond({
          statusCode: 200,
          body: payload,
          targetId: target.id,
          canonicalName,
        });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/v1/trends/subreddit/")) {
        const subredditRaw = pathname.replace("/v1/trends/subreddit/", "");
        const subreddit = normalizeSubredditName(decodeSubredditPathSegment(subredditRaw));

        const canonicalName = `r/${subreddit}`;
        const target = await repos.monitorTargetRepository.findByCanonicalName(canonicalName);
        if (!target) {
          respond({
            statusCode: 404,
            body: toApiError({
              requestId,
              message: `target not found: ${canonicalName}`,
              code: "target_not_found",
            }),
            canonicalName,
            errorCode: "target_not_found",
          });
          return;
        }

        const { fromIso, toIso } = resolveTrendRange(url.searchParams, now());
        const recentPostsLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("recentPostsLimit"),
            name: "recentPostsLimit",
            min: 1,
            max: 50,
          }) ?? 20;

        const [points, recentPosts] = await Promise.all([
          repos.subredditTrendPointRepository.listByTargetInRange({
            targetId: target.id,
            from: fromIso,
            to: toIso,
          }),
          repos.contentRepository.findRecentByTarget(target.id, recentPostsLimit),
        ]);
        const trendReadModel = buildSubredditTrendReadModel(points);

        const payload: SubredditTrendResponse = {
          ok: true,
          requestId,
          generatedAtIso: now(),
          targetId: target.id,
          canonicalName,
          fromIso,
          toIso,
          timeline: trendReadModel.timeline,
          summary: trendReadModel.summary,
          topMovers: trendReadModel.topMovers,
          recentAnomalies: trendReadModel.recentAnomalies,
          points: points.map((point) => ({
            windowStart: point.windowStart,
            windowEnd: point.windowEnd,
            newPosts: point.newPosts,
            scoreSum: point.scoreSum,
            commentSum: point.commentSum,
            highScorePostCount: point.highScorePostCount,
            sampledPostCount: point.sampledPostCount,
            activePostRatio: point.activePostRatio,
            deltaNewPostsVsPrevWindow: point.deltaNewPostsVsPrevWindow,
            deltaActiveUsersVsPrevWindow: point.deltaActiveUsersVsPrevWindow,
            heatChangePct: point.heatChangePct,
            heatIndex: point.heatIndex,
            surgeScore: point.surgeScore,
            dispersionScore: point.dispersionScore,
            trendScore: point.trendScore,
            velocityScore: point.velocityScore,
            accelerationScore: point.accelerationScore,
            baselineDeviationScore: point.baselineDeviationScore,
            changeScore: point.changeScore,
            anomalyScore: point.anomalyScore,
            algorithmVersion: point.algorithmVersion,
            sampleCount: point.sampleCount,
            windowComplete: point.windowComplete,
            scoreComponents: point.scoreComponents,
          })),
          recentPosts: recentPosts.map((post) => ({
            id: post.id,
            externalId: post.externalId,
            title: post.title,
            permalink: post.permalink,
            createdAtSource: post.createdAtSource,
            url: post.url,
            bodySnippet: toBodySnippet(post.bodyText),
          })),
        };
        respond({
          statusCode: 200,
          body: payload,
          targetId: target.id,
          canonicalName,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/trends/market") {
        const { fromIso, toIso } = resolveTrendRange(url.searchParams, now());
        const rankingLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("limit"),
            name: "limit",
            min: 1,
            max: 200,
          }) ?? 20;
        const targets = await repos.monitorTargetRepository.findActiveSubreddits();
        const targetById = new Map(targets.map((target) => [target.id, target]));
        const latestByTarget = await repos.subredditTrendPointRepository.listLatestByTargetsInRange({
          targetIds: targets.map((target) => target.id),
          from: fromIso,
          to: toIso,
        });

        const rankItems = latestByTarget
          .map((point) => {
            const target = targetById.get(point.targetId);
            if (!target) {
              return null;
            }
            return {
              targetId: point.targetId,
              canonicalName: target.canonicalName,
              windowStart: point.windowStart,
              windowEnd: point.windowEnd,
              newPosts: point.newPosts,
              sampledPostCount: point.sampledPostCount ?? 0,
              heatIndex: point.heatIndex ?? 0,
              heatChangePct: point.heatChangePct ?? 0,
              surgeScore: point.surgeScore ?? 0,
              dispersionScore: point.dispersionScore ?? 0,
              trendScore: point.trendScore,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        const payload: MarketTrendResponse = {
          ok: true,
          requestId,
          generatedAtIso: now(),
          fromIso,
          toIso,
          targetCount: rankItems.length,
          rankings: {
            byHeat: [...rankItems]
              .sort((a, b) => {
                const byHeat = b.heatIndex - a.heatIndex;
                if (byHeat !== 0) {
                  return byHeat;
                }
                return b.windowStart.localeCompare(a.windowStart);
              })
              .slice(0, rankingLimit),
            bySurge: [...rankItems]
              .sort((a, b) => {
                const bySurge = b.surgeScore - a.surgeScore;
                if (bySurge !== 0) {
                  return bySurge;
                }
                return b.windowStart.localeCompare(a.windowStart);
              })
              .slice(0, rankingLimit),
            byDispersion: [...rankItems]
              .sort((a, b) => {
                const byDispersion = b.dispersionScore - a.dispersionScore;
                if (byDispersion !== 0) {
                  return byDispersion;
                }
                return b.windowStart.localeCompare(a.windowStart);
              })
              .slice(0, rankingLimit),
          },
        };
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      respond({
        statusCode: 404,
        body: toApiError({
          requestId,
          message: "not found",
          code: "route_not_found",
        }),
        errorCode: "route_not_found",
      });
    } catch (error) {
      if (error instanceof BadRequestError) {
        respond({
          statusCode: 400,
          body: toApiError({
            requestId,
            message: error.message,
            code: error.code,
          }),
          errorCode: error.code,
        });
        return;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "api.request.unhandled_error",
          requestId,
          path: pathForLog,
          method: methodForLog,
          error: message,
        }),
      );
      respond({
        statusCode: 500,
        body: toApiError({
          requestId,
          message: "internal server error",
          code: "internal_error",
        }),
        level: "error",
        errorCode: "internal_error",
      });
    }
  });
}
