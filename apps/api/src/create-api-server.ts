import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { RateLimiterMemory, type RateLimiterRes } from "rate-limiter-flexible";
import type {
  ApiErrorResponse,
  ApiHealthResponse,
  SubredditAnomalyFeedResponse,
  SubredditAnomalyIncidentFeedResponse,
  ApiReadinessResponse,
  ApiStorageObservabilityResponse,
  MarketWorkbenchResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthLogoutResponse,
  AuthMeResponse,
  AuthUserView,
  CreateSavedWorkbenchViewRequest,
  CreateSavedWorkbenchViewResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  CrawlMode,
  CreateKeywordQueryRequest,
  CreateKeywordQueryResponse,
  CreateSubredditTargetRequest,
  CreateSubredditTargetResponse,
  GetKeywordQueryResponse,
  ListSavedWorkbenchViewsResponse,
  MarketTrendResponse,
  RegisterAppUserRequest,
  RegisterAppUserResponse,
  RunMode,
  GlobalKeywordDailyTrendResponse,
  SubredditDriverPostsResponse,
  SubredditDailyTrendResponse,
  SubredditTrendResponse,
  TargetComparisonWorkbenchResponse,
  TargetWorkbenchResponse,
  WorkbenchComparableSeriesId,
  SavedWorkbenchViewResponseItem,
  TriggerPhase1RunRequest,
  TriggerPhase1RunResponse,
} from "../../../packages/contracts/src/http";
import type { AppUser } from "../../../src/domain/entities/app-user";
import { dispatchRedditPhase1Run } from "../../../src/application/use-cases/dispatch-reddit-phase1-run.use-case";
import { prepareTriggeredRedditPhase1Run } from "../../../src/application/use-cases/trigger-reddit-phase1-run.use-case";
import { activateAppUser } from "../../../src/application/use-cases/activate-app-user.use-case";
import { createAppInvite } from "../../../src/application/use-cases/create-app-invite.use-case";
import { getCurrentAppUser } from "../../../src/application/use-cases/get-current-app-user.use-case";
import { AuthError, loginAppUser } from "../../../src/application/use-cases/login-app-user.use-case";
import { logoutAppUser } from "../../../src/application/use-cases/logout-app-user.use-case";
import {
  RegisterAppUserError,
  registerAppUser,
} from "../../../src/application/use-cases/register-app-user.use-case";
import { PasswordHashingService } from "../../../src/application/services/password-hashing.service";
import { runKeywordPulseQuery } from "../../../src/application/services/keyword-pulse-query.service";
import { SessionTokenService } from "../../../src/application/services/session-token.service";
import {
  buildKeywordQueryDataQuality,
  toDominantSourceType,
} from "../../../src/application/services/keyword-query-metrics";
import {
  matchesNormalizedQueryV2,
  normalizeQueryV2,
} from "../../../src/application/services/query-normalization-v2.service";
import { buildSubredditAnomalyIncidentReadModel } from "../../../src/application/services/subreddit-anomaly-incident-read-model.service";
import { buildSubredditAnomalyFeedReadModel } from "../../../src/application/services/subreddit-anomaly-feed-read-model.service";
import { buildSubredditDailyInsights } from "../../../src/application/services/subreddit-daily-insights.service";
import { buildSubredditDriverPostReadModel } from "../../../src/application/services/subreddit-driver-post-read-model.service";
import { buildGlobalKeywordDailyTrendReadModel } from "../../../src/application/services/global-keyword-daily-trend-read-model.service";
import { buildSubredditTrendReadModel } from "../../../src/application/services/subreddit-trend-read-model";
import {
  buildTargetComparisonWorkbenchReadModel,
  COMPARABLE_WORKBENCH_SERIES_IDS,
} from "../../../src/application/services/target-comparison-workbench-read-model.service";
import { buildMarketWorkbenchReadModel } from "../../../src/application/services/market-workbench-read-model.service";
import { buildTargetWorkbenchReadModel } from "../../../src/application/services/target-workbench-read-model.service";
import type { RedditConnector } from "../../../src/connectors/reddit/reddit-connector.interface";
import { DefaultRedditMapper } from "../../../src/connectors/reddit/reddit.mapper";
import type { RedditMapper } from "../../../src/connectors/reddit/reddit-mapper.interface";
import type { RedditScraplingProfile } from "../../../src/connectors/reddit/reddit-scrapling.connector";
import type { AnomalySignalType } from "../../../src/domain/entities/anomaly-event";
import type { PostGrowthAgeBucket } from "../../../src/domain/entities/post-growth-fact";
import type { KeywordQuerySessionRepository } from "../../../src/domain/repositories/keyword-query-session-repository";
import { stableUuidFromString } from "../../../src/shared/ids/stable-id";
import type { AccountRepository } from "../../../src/domain/repositories/account-repository";
import type { AppInviteRepository } from "../../../src/domain/repositories/app-invite-repository";
import type { AppSessionRepository } from "../../../src/domain/repositories/app-session-repository";
import type { AppUserRepository } from "../../../src/domain/repositories/app-user-repository";
import type { AnomalyEventRepository } from "../../../src/domain/repositories/anomaly-event-repository";
import type { CollectionJobRepository } from "../../../src/domain/repositories/collection-job-repository";
import type { ContentRepository } from "../../../src/domain/repositories/content-repository";
import type { CrawlCursorRepository } from "../../../src/domain/repositories/crawl-cursor-repository";
import type { KeywordTrendDailyRepository } from "../../../src/domain/repositories/keyword-trend-daily-repository";
import type { MetricsSnapshotRepository } from "../../../src/domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../../../src/domain/repositories/monitor-target-repository";
import type { PostGrowthFactRepository } from "../../../src/domain/repositories/post-growth-fact-repository";
import type { PostSearchDocumentRepository } from "../../../src/domain/repositories/post-search-document-repository";
import type { ProviderHealthWindowRepository } from "../../../src/domain/repositories/provider-health-window-repository";
import type { SavedWorkbenchViewRepository } from "../../../src/domain/repositories/saved-workbench-view-repository";
import type { RawEventRepository } from "../../../src/domain/repositories/raw-event-repository";
import type { SubredditDailyFactRepository } from "../../../src/domain/repositories/subreddit-daily-fact-repository";
import type { SubredditCollectionCoverageRepository } from "../../../src/domain/repositories/subreddit-collection-coverage-repository";
import type { SubredditTrendPointRepository } from "../../../src/domain/repositories/subreddit-trend-point-repository";
import type { StorageObservabilityRepository } from "../../../src/domain/repositories/storage-observability-repository";
import {
  BadRequestError,
  resolveCrawlMode,
  normalizeKeywordQueryText,
  normalizeSubredditName,
  parseOptionalIntegerParam,
  resolveDailyRange,
  resolveGlobalKeywordDailyRange,
  resolveRunMode,
  resolveTrendRange,
  resolveWorkbenchDailyRange,
} from "./api-validation";
import { buildReadinessState } from "./readyz-observability";
import { resolveRedditProviderRoutingPolicyContextFromEnv } from "../../../src/runtime/reddit-provider-routing-policy";
import { parseBooleanFlag } from "../../../src/runtime/runtime-parsing";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  DEFAULT_SESSION_COOKIE_NAME,
  readCookieValue,
} from "./auth-cookie";
import { canUseOpsWrite, resolveSessionActor, type ApiActor } from "./auth-guard";

const MAX_JSON_BODY_BYTES = 1_048_576;

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body, null, 2));
}

class RequestBodyTooLargeError extends Error {
  public readonly code = "request_body_too_large";

  constructor() {
    super("request body too large");
  }
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
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
  appUserRepository?: AppUserRepository;
  appInviteRepository?: AppInviteRepository;
  appSessionRepository?: AppSessionRepository;
  anomalyEventRepository: AnomalyEventRepository;
  contentRepository: ContentRepository;
  keywordTrendDailyRepository?: KeywordTrendDailyRepository;
  keywordQuerySessionRepository?: KeywordQuerySessionRepository;
  postSearchDocumentRepository?: PostSearchDocumentRepository;
  postGrowthFactRepository: PostGrowthFactRepository;
  postEngagementRepository?: import("../../../src/domain/repositories/post-engagement-repository").PostEngagementRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditDailyFactRepository: SubredditDailyFactRepository;
  subredditCollectionCoverageRepository?: SubredditCollectionCoverageRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
  savedWorkbenchViewRepository?: SavedWorkbenchViewRepository;
  storageObservabilityRepository?: StorageObservabilityRepository;
}

function parseAnomalySignalTypeList(value: string | null): AnomalySignalType[] | undefined {
  if (value == null) {
    return undefined;
  }

  const requested = Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
  if (requested.length === 0) {
    return undefined;
  }

  const valid = new Set<AnomalySignalType>(["volume", "quality", "keyword", "driver"]);
  const signalTypes: AnomalySignalType[] = [];
  for (const item of requested) {
    if (!valid.has(item as AnomalySignalType)) {
      throw new BadRequestError(
        `invalid signalType query: ${item}`,
        "invalid_query_param",
      );
    }
    signalTypes.push(item as AnomalySignalType);
  }
  return signalTypes;
}

export interface CreateApiServerOptions {
  repositories: ApiRepositoryBundle;
  createConnector: (
    mode: RunMode,
    crawlMode?: CrawlMode,
    providerOverride?: string,
    scraplingProfileOverride?: RedditScraplingProfile,
  ) => RedditConnector;
  redditMapper?: RedditMapper;
  now?: () => string;
  logger?: (event: ApiRequestLog) => void;
  requestIdGenerator?: () => string;
  auth?: {
    bearerToken?: string;
    protectedPathPrefixes?: string[];
    sessionCookieName?: string;
    sessionCookieSecure?: boolean;
    sessionTtlSeconds?: number;
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

function parseComparisonTargetList(value: string | null): string[] {
  if (value == null) {
    throw new BadRequestError("targets query is required", "missing_targets");
  }
  const targets = Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => `r/${normalizeSubredditName(item.replace(/^r\//i, ""))}`),
    ),
  );
  if (targets.length < 2) {
    throw new BadRequestError("at least two comparison targets are required", "invalid_query_param");
  }
  if (targets.length > 6) {
    throw new BadRequestError("at most six comparison targets are supported", "invalid_query_param");
  }
  return targets;
}

function parseComparisonSeriesList(value: string | null): WorkbenchComparableSeriesId[] {
  if (value == null || value.trim().length === 0) {
    return ["heat_price"];
  }
  const allowed = new Set<string>(COMPARABLE_WORKBENCH_SERIES_IDS);
  const seriesIds = Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
  if (seriesIds.length === 0) {
    return ["heat_price"];
  }
  for (const seriesId of seriesIds) {
    if (!allowed.has(seriesId)) {
      throw new BadRequestError(`invalid comparison series: ${seriesId}`, "invalid_query_param");
    }
  }
  return seriesIds as WorkbenchComparableSeriesId[];
}

function normalizeCanonicalSubreddit(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestError(`${fieldName} is required`, "invalid_query_param");
  }
  return `r/${normalizeSubredditName(value.trim().replace(/^r\//i, ""))}`;
}

function parseSavedWorkbenchViewName(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestError("name is required", "invalid_request_body");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new BadRequestError("name must be between 2 and 80 characters", "invalid_request_body");
  }
  return name;
}

function parseStringArray(value: unknown, fieldName: string, maxItems: number): string[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestError(`${fieldName} must be an array`, "invalid_request_body");
  }
  const items = Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  );
  if (items.length > maxItems) {
    throw new BadRequestError(`${fieldName} supports at most ${maxItems} items`, "invalid_request_body");
  }
  return items;
}

function toSavedWorkbenchViewResponseItem(
  view: Awaited<ReturnType<SavedWorkbenchViewRepository["upsert"]>>,
): SavedWorkbenchViewResponseItem {
  return {
    id: view.id,
    name: view.name,
    viewKind: view.viewKind,
    primaryTarget: view.primaryTarget,
    compareTargets: view.compareTargets,
    keywords: view.keywords,
    seriesIds: view.seriesIds,
    routePath: view.routePath,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function parseAgeBucketList(value: string | null): PostGrowthAgeBucket[] | undefined {
  if (value == null) {
    return undefined;
  }

  const requested = Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
  if (requested.length === 0) {
    return undefined;
  }

  const valid = new Set<PostGrowthAgeBucket>(["1h", "6h", "24h"]);
  const ageBuckets: PostGrowthAgeBucket[] = [];
  for (const item of requested) {
    if (!valid.has(item as PostGrowthAgeBucket)) {
      throw new BadRequestError(
        `invalid ageBucket query: ${item}`,
        "invalid_query_param",
      );
    }
    ageBuckets.push(item as PostGrowthAgeBucket);
  }
  return ageBuckets;
}

async function resolveDriverKeywordMatches(args: {
  postSearchDocumentRepository?: PostSearchDocumentRepository;
  normalizedQueries: Array<ReturnType<typeof normalizeQueryV2>>;
  canonicalName: string;
  fromIso: string;
  toIso: string;
  limit: number;
}): Promise<Map<string, string[]>> {
  const matchesByContentId = new Map<string, Set<string>>();
  if (args.normalizedQueries.length === 0) {
    return new Map();
  }
  if (!args.postSearchDocumentRepository) {
    throw new Error("post search document repository is required for keyword-scoped drivers");
  }

  const searchLimit = Math.max(args.limit, 200);
  for (const query of args.normalizedQueries) {
    const documents = await args.postSearchDocumentRepository.search({
      tokens: query.searchTokens,
      canonicalSubreddit: args.canonicalName,
      limit: searchLimit,
      createdAtFrom: args.fromIso,
      createdAtTo: args.toIso,
    });
    for (const document of documents) {
      const haystack = `${document.title} ${document.bodySnippet ?? ""}`;
      if (!matchesNormalizedQueryV2(haystack, query)) {
        continue;
      }
      const current = matchesByContentId.get(document.contentId) ?? new Set<string>();
      current.add(query.normalizedQueryText);
      matchesByContentId.set(document.contentId, current);
    }
  }

  return new Map(
    Array.from(matchesByContentId.entries()).map(([contentId, queryTexts]) => [
      contentId,
      Array.from(queryTexts).sort((a, b) => a.localeCompare(b)),
    ]),
  );
}

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function toKeywordQueryView(args: {
  record: NonNullable<Awaited<ReturnType<KeywordQuerySessionRepository["findById"]>>>;
}): import("../../../packages/contracts/src/http").KeywordQueryView {
  const sourceTypeSummary = args.record.session.sourceTypeSummary;
  const explainPayload = args.record.session.explainPayload;
  const observedDocumentCount = Number(explainPayload.totalScopeDocs ?? 0);
  const seededDocumentCount = Number(explainPayload.seededRows ?? 0);
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
    coverage: {
      scope: "observed_corpus" as const,
      label: args.record.session.canonicalSubreddit
        ? "Observed subreddit corpus"
        : "Observed monitored corpus",
      description: args.record.session.canonicalSubreddit
        ? "Results are computed only from locally indexed posts for this subreddit scope."
        : "Results are computed only from locally indexed posts across monitored targets.",
      observedDocumentCount,
      matchedDocumentCount: args.record.session.supportCount,
      seededDocumentCount,
    },
    degradedReason: args.record.session.degradedReason,
    explainPayload,
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
    args.res.setHeader("Access-Control-Allow-Credentials", "true");
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

function toRateLimitKey(req: IncomingMessage, actor: ApiActor | null): string {
  if (actor?.type === "session") {
    return `user:${actor.userId}`;
  }
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

function toAuthUserView(user: AppUser): AuthUserView {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}

function isPrivilegedWritePath(pathname: string): boolean {
  return (
    pathname === "/v1/targets/subreddit" ||
    pathname === "/v1/runs/reddit-phase1" ||
    pathname === "/auth/invites" ||
    /^\/auth\/users\/[^/]+\/activate$/.test(pathname)
  );
}

function isAuthAdminPath(pathname: string): boolean {
  return pathname === "/auth/invites" || /^\/auth\/users\/[^/]+\/activate$/.test(pathname);
}

function isSupportedAppUserRole(value: unknown): value is AppUser["role"] {
  return value === "owner" || value === "admin" || value === "viewer";
}

function canUseOpsRead(actor: ApiActor | null): boolean {
  return (
    actor?.type === "session" &&
    isSupportedAppUserRole(actor.role) &&
    (actor.role === "admin" || actor.role === "owner")
  );
}

function parseUserIdFromActivatePath(pathname: string): string | null {
  const match = /^\/auth\/users\/([^/]+)\/activate$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function createApiServer(options: CreateApiServerOptions): Server {
  const repos = options.repositories;
  const now = options.now ?? (() => new Date().toISOString());
  const redditMapper = options.redditMapper ?? new DefaultRedditMapper();
  const logger = options.logger ?? defaultApiLogger;
  const requestIdGenerator = options.requestIdGenerator ?? randomUUID;
  const bearerToken = options.auth?.bearerToken?.trim() || undefined;
  const protectedPathPrefixes = options.auth?.protectedPathPrefixes ?? ["/v1/"];
  const sessionCookieName = options.auth?.sessionCookieName ?? DEFAULT_SESSION_COOKIE_NAME;
  const sessionCookieSecure = options.auth?.sessionCookieSecure ?? false;
  const sessionTtlSeconds = Math.max(60, options.auth?.sessionTtlSeconds ?? 7 * 24 * 60 * 60);
  const sessionTokenService = new SessionTokenService();
  const passwordHashingService = new PasswordHashingService();
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

      let actor: ApiActor | null = null;
      const bearerIsValid = bearerToken ? isBearerTokenValid(req, bearerToken) : false;
      const needsPrivilegedAuth = isPrivilegedWritePath(pathname);
      const needsAuth =
        (Boolean(bearerToken) &&
          protectedPathPrefixes.some((prefix) => pathname.startsWith(prefix))) ||
        pathname === "/v1/ops/readyz" ||
        pathname === "/v1/ops/storage" ||
        isAuthAdminPath(pathname);
      if (bearerIsValid) {
        actor = { type: "machine" };
      } else if (needsAuth) {
        actor = await resolveSessionActor({
          req,
          nowIso: now(),
          appUserRepository: repos.appUserRepository,
          appSessionRepository: repos.appSessionRepository,
          cookieName: sessionCookieName,
          sessionTokenService,
        });
        if (!actor) {
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
      }

      if (actor && needsPrivilegedAuth && !canUseOpsWrite(actor)) {
        respond({
          statusCode: 403,
          body: toApiError({
            requestId,
            message: "forbidden",
            code: "forbidden",
          }),
          errorCode: "forbidden",
        });
        return;
      }

      const isKeywordQueryRoute =
        pathname === "/v1/keyword-queries" || pathname.startsWith("/v1/keyword-queries/");
      const isQueryRoute =
        (req.method === "GET" && pathname.startsWith("/v1/trends/")) ||
        ((req.method === "GET" || req.method === "POST") && isKeywordQueryRoute);
      if (!actor && isQueryRoute) {
        actor = await resolveSessionActor({
          req,
          nowIso: now(),
          appUserRepository: repos.appUserRepository,
          appSessionRepository: repos.appSessionRepository,
          cookieName: sessionCookieName,
          sessionTokenService,
        });
      }
      if (queryRateLimiter && isQueryRoute) {
        try {
          const key = toRateLimitKey(req, actor);
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

      if (req.method === "POST" && pathname === "/auth/login") {
        if (!repos.appUserRepository || !repos.appSessionRepository) {
          respond({
            statusCode: 503,
            body: toApiError({
              requestId,
              message: "auth repositories are unavailable",
              code: "auth_unavailable",
            }),
            errorCode: "auth_unavailable",
          });
          return;
        }

        const body = await readJsonBody<AuthLoginRequest>(req);
        if (
          !body ||
          typeof body.email !== "string" ||
          typeof body.password !== "string" ||
          body.email.trim() === "" ||
          body.password === ""
        ) {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "email and password are required",
              code: "invalid_login_request",
            }),
            errorCode: "invalid_login_request",
          });
          return;
        }

        try {
          const result = await loginAppUser(
            {
              appUserRepository: repos.appUserRepository,
              appSessionRepository: repos.appSessionRepository,
              passwordHashingService,
              sessionTokenService,
              sessionTtlSeconds,
              now,
            },
            {
              email: body.email,
              password: body.password,
            },
          );
          res.setHeader(
            "Set-Cookie",
            buildSessionCookie({
              name: sessionCookieName,
              token: result.token,
              maxAgeSeconds: sessionTtlSeconds,
              secure: sessionCookieSecure,
            }),
          );
          const payload: AuthLoginResponse = {
            ok: true,
            requestId,
            user: toAuthUserView(result.user),
          };
          respond({
            statusCode: 200,
            body: payload,
          });
          return;
        } catch (error) {
          if (error instanceof AuthError) {
            respond({
              statusCode: 401,
              body: toApiError({
                requestId,
                message: "invalid email or password",
                code: error.code,
              }),
              errorCode: error.code,
            });
            return;
          }
          throw error;
        }
      }

      if (req.method === "POST" && pathname === "/auth/logout") {
        if (!repos.appSessionRepository) {
          respond({
            statusCode: 503,
            body: toApiError({
              requestId,
              message: "auth repositories are unavailable",
              code: "auth_unavailable",
            }),
            errorCode: "auth_unavailable",
          });
          return;
        }

        const token = readCookieValue(req.headers.cookie, sessionCookieName);
        if (token) {
          await logoutAppUser({
            appSessionRepository: repos.appSessionRepository,
            tokenHash: sessionTokenService.hashToken(token),
          });
        }
        res.setHeader(
          "Set-Cookie",
          buildClearSessionCookie({ name: sessionCookieName, secure: sessionCookieSecure }),
        );
        const payload: AuthLogoutResponse = {
          ok: true,
          requestId,
        };
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/auth/register") {
        if (!repos.appUserRepository || !repos.appInviteRepository) {
          respond({
            statusCode: 503,
            body: toApiError({
              requestId,
              message: "auth repositories are unavailable",
              code: "auth_unavailable",
            }),
            errorCode: "auth_unavailable",
          });
          return;
        }

        const body = await readJsonBody<RegisterAppUserRequest>(req);
        if (
          !body ||
          typeof body.email !== "string" ||
          typeof body.password !== "string" ||
          typeof body.inviteCode !== "string"
        ) {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "email, password, and inviteCode are required",
              code: "invalid_register_request",
            }),
            errorCode: "invalid_register_request",
          });
          return;
        }

        try {
          const user = await registerAppUser(
            {
              appUserRepository: repos.appUserRepository,
              appInviteRepository: repos.appInviteRepository,
              passwordHashingService,
              sessionTokenService,
              now,
            },
            {
              email: body.email,
              password: body.password,
              inviteCode: body.inviteCode,
              displayName: typeof body.displayName === "string" ? body.displayName : undefined,
            },
          );
          const payload: RegisterAppUserResponse = {
            ok: true,
            requestId,
            user: toAuthUserView(user),
          };
          respond({
            statusCode: 201,
            body: payload,
          });
          return;
        } catch (error) {
          if (error instanceof RegisterAppUserError) {
            respond({
              statusCode: error.code === "email_already_registered" ? 409 : 400,
              body: toApiError({
                requestId,
                message: error.message,
                code: error.code,
              }),
              errorCode: error.code,
            });
            return;
          }
          throw error;
        }
      }

      if (req.method === "POST" && pathname === "/auth/invites") {
        if (!repos.appInviteRepository) {
          respond({
            statusCode: 503,
            body: toApiError({
              requestId,
              message: "auth repositories are unavailable",
              code: "auth_unavailable",
            }),
            errorCode: "auth_unavailable",
          });
          return;
        }

        const body = await readJsonBody<CreateInviteRequest>(req);
        const roleOnAccept = body?.roleOnAccept ?? "viewer";
        const maxUses = body?.maxUses ?? 1;
        const expiresAt = typeof body?.expiresAt === "string" ? body.expiresAt : undefined;
        if (
          !isSupportedAppUserRole(roleOnAccept) ||
          !Number.isInteger(maxUses) ||
          maxUses < 1 ||
          maxUses > 100 ||
          (expiresAt && Number.isNaN(new Date(expiresAt).getTime()))
        ) {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "invalid invite request",
              code: "invalid_invite_request",
            }),
            errorCode: "invalid_invite_request",
          });
          return;
        }

        const result = await createAppInvite(
          {
            appInviteRepository: repos.appInviteRepository,
            sessionTokenService,
            now,
          },
          {
            roleOnAccept,
            maxUses,
            expiresAt,
          },
        );
        const payload: CreateInviteResponse = {
          ok: true,
          requestId,
          invite: {
            id: result.invite.id,
            roleOnAccept: result.invite.roleOnAccept,
            maxUses: result.invite.maxUses,
            usedCount: result.invite.usedCount,
            expiresAt: result.invite.expiresAt,
            createdAt: result.invite.createdAt,
          },
          code: result.code,
        };
        respond({
          statusCode: 201,
          body: payload,
        });
        return;
      }

      if (req.method === "POST" && pathname.startsWith("/auth/users/") && pathname.endsWith("/activate")) {
        if (!repos.appUserRepository) {
          respond({
            statusCode: 503,
            body: toApiError({
              requestId,
              message: "auth repositories are unavailable",
              code: "auth_unavailable",
            }),
            errorCode: "auth_unavailable",
          });
          return;
        }

        const userId = parseUserIdFromActivatePath(pathname);
        if (!userId) {
          respond({
            statusCode: 400,
            body: toApiError({
              requestId,
              message: "invalid user id",
              code: "invalid_user_id",
            }),
            errorCode: "invalid_user_id",
          });
          return;
        }

        const user = await activateAppUser({
          appUserRepository: repos.appUserRepository,
          userId,
          nowIso: now(),
        });
        if (!user) {
          respond({
            statusCode: 404,
            body: toApiError({
              requestId,
              message: "user not found",
              code: "user_not_found",
            }),
            errorCode: "user_not_found",
          });
          return;
        }

        const payload: AuthMeResponse = {
          ok: true,
          requestId,
          user: toAuthUserView(user),
        };
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/auth/me") {
        if (!repos.appUserRepository || !repos.appSessionRepository) {
          respond({
            statusCode: 503,
            body: toApiError({
              requestId,
              message: "auth repositories are unavailable",
              code: "auth_unavailable",
            }),
            errorCode: "auth_unavailable",
          });
          return;
        }

        const token = readCookieValue(req.headers.cookie, sessionCookieName);
        const current = token
          ? await getCurrentAppUser({
              appUserRepository: repos.appUserRepository,
              appSessionRepository: repos.appSessionRepository,
              tokenHash: sessionTokenService.hashToken(token),
              nowIso: now(),
            })
          : null;
        if (!current) {
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

        const payload: AuthMeResponse = {
          ok: true,
          requestId,
          user: toAuthUserView(current.user),
        };
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      if (req.method === "GET" && (pathname === "/readyz" || pathname === "/v1/ops/readyz")) {
        if (pathname === "/v1/ops/readyz") {
          if (!canUseOpsRead(actor)) {
            respond({
              statusCode: 403,
              body: toApiError({
                requestId,
                message: "forbidden: requires ops capability",
                code: "forbidden",
              }),
              errorCode: "forbidden",
            });
            return;
          }
        }
        const nowIso = now();
        const routingPolicyContext = resolveRedditProviderRoutingPolicyContextFromEnv(
          process.env,
        );
        const providerCapabilityRequiredConfigured =
          typeof process.env.REDDIT_PROVIDER_CAPABILITY_REQUIRED === "string" &&
          process.env.REDDIT_PROVIDER_CAPABILITY_REQUIRED.trim().length > 0;
        const readiness = await buildReadinessState({
          repositories: repos,
          nowIso,
          routingPolicyContext,
          providerCapabilityRequirement: providerCapabilityRequiredConfigured
            ? {
                required: parseBooleanFlag(
                  process.env.REDDIT_PROVIDER_CAPABILITY_REQUIRED,
                  false,
                ),
                provider: routingPolicyContext.defaultLiveProvider,
              }
            : undefined,
        });
        const payload: ApiReadinessResponse = {
          ok: readiness.isReady,
          requestId,
          service: "reddit-monitoring-mvp",
          nowIso,
          status: readiness.status,
          checks: readiness.checks,
          queue: readiness.queue,
          observability: readiness.observability,
          activeSessions: readiness.activeSessions,
          activeTargets: readiness.activeTargets,
          degradedReasons: readiness.degradedReasons,
        };

        respond({
          statusCode: pathname === "/v1/ops/readyz" || readiness.isReady ? 200 : 503,
          body: payload,
          level: readiness.isReady ? "info" : "error",
          errorCode: readiness.isReady ? undefined : "not_ready",
        });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/ops/storage") {
        if (!canUseOpsRead(actor)) {
          respond({
            statusCode: 403,
            body: toApiError({
              requestId,
              message: "forbidden: requires ops capability",
              code: "forbidden",
            }),
            errorCode: "forbidden",
          });
          return;
        }
        if (!repos.storageObservabilityRepository) {
          respond({
            statusCode: 501,
            body: toApiError({
              requestId,
              message: "storage observability is not configured",
              code: "feature_not_ready",
            }),
            errorCode: "feature_not_ready",
          });
          return;
        }

        const snapshot = await repos.storageObservabilityRepository.getSnapshot();
        const payload: ApiStorageObservabilityResponse = {
          ok: true,
          requestId,
          service: "reddit-monitoring-mvp",
          capturedAtIso: snapshot.capturedAtIso,
          databaseSizeBytes: snapshot.databaseSizeBytes,
          tables: snapshot.tables,
        };
        respond({
          statusCode: 200,
          body: payload,
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

        const runAsync =
          crawlMode === "backfill" ? false : resolveAsyncRunPreference(body?.async, true);
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
        let backfillPostLimit: number | undefined;
        if (body?.backfillPostLimit != null) {
          if (
            !Number.isInteger(body.backfillPostLimit) ||
            body.backfillPostLimit < 1 ||
            body.backfillPostLimit > 1000
          ) {
            respond({
              statusCode: 400,
              body: toApiError({
                requestId,
                message: "backfillPostLimit must be an integer between 1 and 1000",
                code: "invalid_backfill_post_limit",
              }),
              errorCode: "invalid_backfill_post_limit",
            });
            return;
          }
          backfillPostLimit = body.backfillPostLimit;
        }
        let backfillMaxIterationsPerTarget: number | undefined;
        if (body?.backfillMaxIterationsPerTarget != null) {
          if (
            !Number.isInteger(body.backfillMaxIterationsPerTarget) ||
            body.backfillMaxIterationsPerTarget < 1 ||
            body.backfillMaxIterationsPerTarget > 120
          ) {
            respond({
              statusCode: 400,
              body: toApiError({
                requestId,
                message:
                  "backfillMaxIterationsPerTarget must be an integer between 1 and 120",
                code: "invalid_backfill_max_iterations",
              }),
              errorCode: "invalid_backfill_max_iterations",
            });
            return;
          }
          backfillMaxIterationsPerTarget = body.backfillMaxIterationsPerTarget;
        }
        let backfillTargetDays: number | undefined;
        if (body?.backfillTargetDays != null) {
          if (
            !Number.isInteger(body.backfillTargetDays) ||
            body.backfillTargetDays < 1 ||
            body.backfillTargetDays > 30
          ) {
            respond({
              statusCode: 400,
              body: toApiError({
                requestId,
                message: "backfillTargetDays must be an integer between 1 and 30",
                code: "invalid_backfill_target_days",
              }),
              errorCode: "invalid_backfill_target_days",
            });
            return;
          }
          backfillTargetDays = body.backfillTargetDays;
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
              backfillPostLimit,
              backfillMaxIterationsPerTarget,
              backfillTargetDays,
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
            backfillPostLimit,
            backfillMaxIterationsPerTarget,
            backfillTargetDays,
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

        normalizeKeywordQueryText(body.query);
        const queryText = body.query.trim().replace(/\s+/g, " ");
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
        pathname.startsWith("/v1/trends/keywords/") &&
        pathname.endsWith("/daily")
      ) {
        if (!repos.keywordTrendDailyRepository) {
          throw new Error("keyword trend daily repository is required for keyword trend reads");
        }
        const queryRaw = pathname
          .replace("/v1/trends/keywords/", "")
          .replace(/\/daily$/, "");
        const queryText = decodeURIComponent(queryRaw).trim();
        if (/^r\/[a-z0-9_]{3,21}\s*:/i.test(queryText)) {
          throw new BadRequestError(
            `invalid keyword query scope for global trend endpoint: ${queryText}`,
            "invalid_query_param",
          );
        }
        const normalizedQuery = (() => {
          try {
            const parsed = normalizeQueryV2(queryText);
            if (parsed.queryScope === "subreddit") {
              return normalizeQueryV2(`global:${queryText}`);
            }
            return parsed;
          } catch {
            throw new BadRequestError(
              `invalid keyword query: ${queryText}`,
              "invalid_query_param",
            );
          }
        })();
        if (normalizedQuery.queryScope !== "global") {
          throw new BadRequestError(
            `invalid keyword query scope for global trend endpoint: ${queryText}`,
            "invalid_query_param",
          );
        }

        const { fromIso, toIso } = resolveGlobalKeywordDailyRange(url.searchParams, now());
        const rows = await repos.keywordTrendDailyRepository.listByQueryInRange({
          normalizedQueryText: normalizedQuery.normalizedQueryText,
          fromDay: toUtcDay(fromIso),
          toDay: toUtcDay(toIso),
          track: "explicit_query",
          queryScope: "global",
        });
        const readModel = buildGlobalKeywordDailyTrendReadModel({
          normalizedQueryText: normalizedQuery.normalizedQueryText,
          rows,
          fromIso,
          toIso,
        });

        const payload: GlobalKeywordDailyTrendResponse = {
          ok: true,
          requestId,
          generatedAtIso: now(),
          queryText,
          normalizedQueryText: normalizedQuery.normalizedQueryText,
          queryScope: "global",
          fromIso: readModel.fromIso,
          toIso: readModel.toIso,
          dayCount: readModel.dayCount,
          days: readModel.days,
        };
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      if (pathname === "/v1/workbench/saved-views") {
        if (!repos.savedWorkbenchViewRepository) {
          respond({
            statusCode: 501,
            body: toApiError({
              requestId,
              message: "saved workbench views are not configured",
              code: "feature_not_ready",
            }),
            errorCode: "feature_not_ready",
          });
          return;
        }

        if (!actor) {
          actor = await resolveSessionActor({
            req,
            nowIso: now(),
            appUserRepository: repos.appUserRepository,
            appSessionRepository: repos.appSessionRepository,
            cookieName: sessionCookieName,
            sessionTokenService,
          });
        }
        if (!actor || actor.type !== "session") {
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

        if (req.method === "GET") {
          const limit =
            parseOptionalIntegerParam({
              value: url.searchParams.get("limit"),
              name: "limit",
              min: 1,
              max: 50,
            }) ?? 12;
          const views = await repos.savedWorkbenchViewRepository.listByUser({
            userId: actor.userId,
            limit,
          });
          const payload: ListSavedWorkbenchViewsResponse = {
            ok: true,
            requestId,
            views: views.map(toSavedWorkbenchViewResponseItem),
          };
          respond({
            statusCode: 200,
            body: payload,
          });
          return;
        }

        if (req.method === "POST") {
          const body = await readJsonBody<CreateSavedWorkbenchViewRequest>(req);
          if (!body) {
            throw new BadRequestError("request body is required", "invalid_request_body");
          }
          if (body.viewKind !== "target" && body.viewKind !== "comparison") {
            throw new BadRequestError("invalid viewKind", "invalid_request_body");
          }
          const compareTargets = parseStringArray(body.compareTargets, "compareTargets", 6)
            .map((target) => normalizeCanonicalSubreddit(target, "compareTargets"));
          const keywords = parseStringArray(body.keywords, "keywords", 12)
            .map((keyword) => keyword.toLowerCase());
          const seriesIds = parseComparisonSeriesList(
            Array.isArray(body.seriesIds) ? body.seriesIds.join(",") : null,
          );
          const routePath = typeof body.routePath === "string" ? body.routePath.trim() : "";
          if (!routePath.startsWith("/target/") || routePath.length > 400) {
            throw new BadRequestError("invalid routePath", "invalid_request_body");
          }
          const nowIso = now();
          const view = await repos.savedWorkbenchViewRepository.upsert({
            id: randomUUID(),
            userId: actor.userId,
            name: parseSavedWorkbenchViewName(body.name),
            viewKind: body.viewKind,
            primaryTarget: normalizeCanonicalSubreddit(body.primaryTarget, "primaryTarget"),
            compareTargets,
            keywords,
            seriesIds,
            routePath,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          const payload: CreateSavedWorkbenchViewResponse = {
            ok: true,
            requestId,
            view: toSavedWorkbenchViewResponseItem(view),
          };
          respond({
            statusCode: 201,
            body: payload,
          });
          return;
        }
      }

      if (req.method === "GET" && pathname === "/v1/workbench/compare") {
        const canonicalNames = parseComparisonTargetList(url.searchParams.get("targets"));
        const seriesIds = parseComparisonSeriesList(url.searchParams.get("series"));
        const { fromIso, toIso, timeframe, rangePreset } = resolveWorkbenchDailyRange(
          url.searchParams,
          now(),
        );
        const fromDay = toUtcDay(fromIso);
        const toDay = toUtcDay(toIso);

        const targets = await Promise.all(
          canonicalNames.map((canonicalName) =>
            repos.monitorTargetRepository.findByCanonicalName(canonicalName),
          ),
        );
        const missingCanonicalName = canonicalNames.find((_, index) => !targets[index]);
        if (missingCanonicalName) {
          respond({
            statusCode: 404,
            body: toApiError({
              requestId,
              message: `target not found: ${missingCanonicalName}`,
              code: "target_not_found",
            }),
            canonicalName: missingCanonicalName,
            errorCode: "target_not_found",
          });
          return;
        }

        const resolvedTargets = targets.filter((target): target is NonNullable<typeof target> =>
          Boolean(target),
        );
        const dailyFactsByTargetId = new Map<string, Awaited<ReturnType<SubredditDailyFactRepository["listByTargetInRange"]>>>();
        const coverageByTargetId = new Map<string, Awaited<ReturnType<SubredditCollectionCoverageRepository["listByTargetInRange"]>>>();
        const [dailyFactGroups, coverageGroups] = await Promise.all([
          Promise.all(
            resolvedTargets.map((target) =>
              repos.subredditDailyFactRepository.listByTargetInRange({
                targetId: target.id,
                fromDay,
                toDay,
              }),
            ),
          ),
          Promise.all(
            resolvedTargets.map((target) =>
              repos.subredditCollectionCoverageRepository?.listByTargetInRange({
                targetId: target.id,
                fromDay,
                toDay,
              }) ?? Promise.resolve([]),
            ),
          ),
        ]);
        for (const [index, facts] of dailyFactGroups.entries()) {
          dailyFactsByTargetId.set(resolvedTargets[index]!.id, facts);
        }
        for (const [index, coverageRows] of coverageGroups.entries()) {
          coverageByTargetId.set(resolvedTargets[index]!.id, coverageRows);
        }

        const payload: TargetComparisonWorkbenchResponse = buildTargetComparisonWorkbenchReadModel({
          requestId,
          generatedAtIso: now(),
          targets: resolvedTargets,
          fromIso,
          toIso,
          timeframe,
          rangePreset,
          dailyFactsByTargetId,
          coverageByTargetId,
          seriesIds,
        });
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      if (req.method === "GET" && pathname === "/v1/workbench/market") {
        const { fromIso, toIso } = resolveTrendRange(url.searchParams, now());
        const rankingLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("rankingLimit"),
            name: "rankingLimit",
            min: 1,
            max: 100,
          }) ?? 12;
        const breakoutLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("breakoutLimit"),
            name: "breakoutLimit",
            min: 1,
            max: 50,
          }) ?? 8;
        const anomalyLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("anomalyLimit"),
            name: "anomalyLimit",
            min: 1,
            max: 50,
          }) ?? 8;
        const targets = await repos.monitorTargetRepository.findActiveSubreddits();
        const targetIds = targets.map((target) => target.id);
        const breakoutContentFromIso = new Date(
          new Date(fromIso).getTime() - 24 * 60 * 60 * 1000,
        ).toISOString();

        const [latestTrendPoints, breakoutFactsGroups, breakoutContentsGroups, anomalyGroups] =
          await Promise.all([
            repos.subredditTrendPointRepository.listLatestByTargetsInRange({
              targetIds,
              from: fromIso,
              to: toIso,
            }),
            Promise.all(
              targets.map((target) =>
                repos.postGrowthFactRepository.listTopByTargetInRange({
                  targetId: target.id,
                  fromIso,
                  toIso,
                  limit: 1,
                }),
              ),
            ),
            Promise.all(
              targets.map((target) =>
                repos.contentRepository.findByTargetCreatedAtRange({
                  targetId: target.id,
                  from: breakoutContentFromIso,
                  to: toIso,
                  limit: 250,
                }),
              ),
            ),
            Promise.all(
              targets.map((target) =>
                repos.anomalyEventRepository.listByTargetInRange({
                  targetId: target.id,
                  fromIso,
                  toIso,
                  limit: anomalyLimit,
                }),
              ),
            ),
          ]);

        const breakoutFactsByTargetId = new Map<string, Awaited<ReturnType<PostGrowthFactRepository["listTopByTargetInRange"]>>>();
        const breakoutContentsByTargetId = new Map<string, Awaited<ReturnType<ContentRepository["findByTargetCreatedAtRange"]>>>();
        const anomalyEventsByTargetId = new Map<string, Awaited<ReturnType<AnomalyEventRepository["listByTargetInRange"]>>>();

        for (const [index, target] of targets.entries()) {
          breakoutFactsByTargetId.set(target.id, breakoutFactsGroups[index] ?? []);
          breakoutContentsByTargetId.set(target.id, breakoutContentsGroups[index] ?? []);
          anomalyEventsByTargetId.set(target.id, anomalyGroups[index] ?? []);
        }

        const payload: MarketWorkbenchResponse = buildMarketWorkbenchReadModel({
          requestId,
          generatedAtIso: now(),
          fromIso,
          toIso,
          targets,
          latestTrendPoints,
          breakoutFactsByTargetId,
          breakoutContentsByTargetId,
          anomalyEventsByTargetId,
          rankingLimit,
          breakoutLimit,
          anomalyLimit,
        });
        respond({
          statusCode: 200,
          body: payload,
        });
        return;
      }

      if (req.method === "GET" && pathname.startsWith("/v1/workbench/target/")) {
        const subredditRaw = pathname.replace("/v1/workbench/target/", "");
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

        const { fromIso, toIso, timeframe, rangePreset } = resolveWorkbenchDailyRange(
          url.searchParams,
          now(),
        );
        const keywordLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("keywordLimit"),
            name: "keywordLimit",
            min: 1,
            max: 30,
          }) ?? 10;
        const driverLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("driverLimit"),
            name: "driverLimit",
            min: 1,
            max: 50,
          }) ?? 10;
        const anomalyLimit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("anomalyLimit"),
            name: "anomalyLimit",
            min: 1,
            max: 50,
          }) ?? 10;
        const rawKeywords = parseKeywordList(url.searchParams.get("keywords"));
        const normalizedQueries = rawKeywords.map((keyword) => {
          try {
            const query = normalizeQueryV2(keyword, canonicalName);
            return { ...query, raw: keyword };
          } catch {
            throw new BadRequestError(
              `invalid keywords query: ${keyword}`,
              "invalid_query_param",
            );
          }
        });
        const explicitQueryTexts = normalizedQueries.map((query) => query.normalizedQueryText);
        const queryScopes =
          normalizedQueries.length > 0
            ? Array.from(new Set(normalizedQueries.map((query) => query.queryScope)))
            : undefined;
        const tracks =
          normalizedQueries.length > 0 ? (["explicit_query"] as const) : undefined;
        const fromDay = toUtcDay(fromIso);
        const toDay = toUtcDay(toIso);
        const [
          dailyFacts,
          trendPoints,
          keywordDailyRows,
          postGrowthFacts,
          contents,
          anomalyEvents,
          providerHealthWindows,
          collectionCoverage,
          liveCursor,
          backfillCursor,
          queryMatchesByContentId,
        ] = await Promise.all([
          repos.subredditDailyFactRepository.listByTargetInRange({
            targetId: target.id,
            fromDay,
            toDay,
          }),
          repos.subredditTrendPointRepository.listByTargetInRange({
            targetId: target.id,
            from: fromIso,
            to: toIso,
          }),
          repos.keywordTrendDailyRepository?.listByTargetInRange({
            targetId: target.id,
            fromDay,
            toDay,
            keywords: explicitQueryTexts,
            tracks: tracks ? [...tracks] : undefined,
            queryScopes,
            limit: keywordLimit,
          }) ?? Promise.resolve([]),
          repos.postGrowthFactRepository.listTopByTargetInRange({
            targetId: target.id,
            fromIso,
            toIso,
            limit: driverLimit,
          }),
          repos.contentRepository.findByTargetCreatedAtRange({
            targetId: target.id,
            from: fromIso,
            to: toIso,
            limit: Math.max(driverLimit * 5, 100),
          }),
          repos.anomalyEventRepository.listByTargetInRange({
            targetId: target.id,
            fromIso,
            toIso,
            limit: anomalyLimit,
          }),
          repos.providerHealthWindowRepository?.listByTargetInRange({
            targetId: target.id,
            from: fromIso,
            to: toIso,
            mode: "live",
          }) ?? Promise.resolve([]),
          repos.subredditCollectionCoverageRepository?.listByTargetInRange({
            targetId: target.id,
            fromDay,
            toDay,
          }) ?? Promise.resolve([]),
          repos.crawlCursorRepository
            ?.list({
              targetId: target.id,
              mode: "live",
            })
            .then((rows) => rows[0] ?? null) ?? Promise.resolve(null),
          repos.crawlCursorRepository
            ?.list({
              targetId: target.id,
              mode: "backfill",
            })
            .then((rows) => rows[0] ?? null) ?? Promise.resolve(null),
          resolveDriverKeywordMatches({
            postSearchDocumentRepository: repos.postSearchDocumentRepository,
            normalizedQueries,
            canonicalName,
            fromIso: new Date(new Date(fromIso).getTime() - 24 * 60 * 60 * 1000).toISOString(),
            toIso,
            limit: Math.max(driverLimit * 10, 200),
          }),
        ]);

        const payload: TargetWorkbenchResponse = buildTargetWorkbenchReadModel({
          requestId,
          generatedAtIso: now(),
          target,
          fromIso,
          toIso,
          timeframe,
          rangePreset,
          dailyFacts,
          trendPoints,
          keywordDailyRows,
          postGrowthFacts,
          contents,
          anomalyEvents,
          providerHealthWindows,
          collectionCoverage,
          liveCursor,
          backfillCursor,
          keywords: explicitQueryTexts,
          normalizedQueries: normalizedQueries.map((query) => ({
            raw: query.raw,
            normalizedQueryText: query.normalizedQueryText,
            queryScope: query.queryScope,
            scopeCanonicalSubreddit: query.scopeCanonicalSubreddit,
          })),
          matchedQueriesByContentId: queryMatchesByContentId,
          keywordLimit,
          driverLimit,
          anomalyLimit,
        });
        respond({
          statusCode: 200,
          body: payload,
          targetId: target.id,
          canonicalName,
        });
        return;
      }

      if (
        req.method === "GET" &&
        pathname.startsWith("/v1/trends/subreddit/") &&
        pathname.endsWith("/anomalies/incidents")
      ) {
        const subredditRaw = pathname
          .replace("/v1/trends/subreddit/", "")
          .replace(/\/anomalies\/incidents$/, "");
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
        const limit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("limit"),
            name: "limit",
            min: 1,
            max: 100,
          }) ?? 20;
        const signalTypes = parseAnomalySignalTypeList(url.searchParams.get("signalType"));
        const events = await repos.anomalyEventRepository.listByTargetInRange({
          targetId: target.id,
          fromIso,
          toIso,
          signalTypes,
          limit: Math.max(limit * 3, 100),
        });
        const readModel = buildSubredditAnomalyIncidentReadModel({
          events,
          limit,
        });

        const payload: SubredditAnomalyIncidentFeedResponse = {
          ok: true,
          requestId,
          generatedAtIso: now(),
          targetId: target.id,
          canonicalName,
          fromIso,
          toIso,
          signalTypes: signalTypes ?? ["volume", "quality", "keyword", "driver"],
          incidents: readModel.incidents.map((incident) => ({
            incidentId: incident.incidentId,
            windowStart: incident.windowStart,
            windowEnd: incident.windowEnd,
            observedAt: incident.observedAt,
            mergedScore: incident.mergedScore,
            severity: incident.severity,
            dominantSignalType: incident.dominantSignalType,
            signalTypes: incident.signalTypes,
            signalCount: incident.signalCount,
            algorithmVersion: incident.algorithmVersion,
            explainPayload: incident.explainPayload,
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

      if (
        req.method === "GET" &&
        pathname.startsWith("/v1/trends/subreddit/") &&
        pathname.endsWith("/anomalies")
      ) {
        const subredditRaw = pathname
          .replace("/v1/trends/subreddit/", "")
          .replace(/\/anomalies$/, "");
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
        const limit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("limit"),
            name: "limit",
            min: 1,
            max: 100,
          }) ?? 25;
        const signalTypes = parseAnomalySignalTypeList(url.searchParams.get("signalType"));

        const events = await repos.anomalyEventRepository.listByTargetInRange({
          targetId: target.id,
          fromIso,
          toIso,
          signalTypes,
          limit,
        });
        const readModel = buildSubredditAnomalyFeedReadModel({
          events,
          limit,
        });

        const payload: SubredditAnomalyFeedResponse = {
          ok: true,
          requestId,
          generatedAtIso: now(),
          targetId: target.id,
          canonicalName,
          fromIso,
          toIso,
          signalTypes: signalTypes ?? ["volume", "quality", "keyword", "driver"],
          events: readModel.events.map((event) => ({
            eventId: event.eventId,
            signalType: event.signalType,
            signalKey: event.signalKey,
            observedAt: event.observedAt,
            windowStart: event.windowStart,
            windowEnd: event.windowEnd,
            anomalyScore: event.anomalyScore,
            severity: event.severity,
            algorithmVersion: event.algorithmVersion,
            explainPayload: event.explainPayload,
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

      if (
        req.method === "GET" &&
        pathname.startsWith("/v1/trends/subreddit/") &&
        pathname.endsWith("/drivers")
      ) {
        const subredditRaw = pathname
          .replace("/v1/trends/subreddit/", "")
          .replace(/\/drivers$/, "");
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
        const limit =
          parseOptionalIntegerParam({
            value: url.searchParams.get("limit"),
            name: "limit",
            min: 1,
            max: 50,
          }) ?? 20;
        const ageBuckets = parseAgeBucketList(url.searchParams.get("ageBucket"));
        const rawKeywords = parseKeywordList(url.searchParams.get("keywords"));
        const normalizedQueries = rawKeywords.map((keyword) => {
          try {
            const query = normalizeQueryV2(keyword, canonicalName);
            if (query.queryScope !== "subreddit" || query.scopeCanonicalSubreddit !== canonicalName) {
              throw new BadRequestError(
                `invalid keywords query for subreddit driver feed: ${keyword}`,
                "invalid_query_param",
              );
            }
            return query;
          } catch (error) {
            if (error instanceof BadRequestError) {
              throw error;
            }
            throw new BadRequestError(
              `invalid keywords query: ${keyword}`,
              "invalid_query_param",
            );
          }
        });
        const contentFromIso = new Date(
          new Date(fromIso).getTime() - 24 * 60 * 60 * 1000,
        ).toISOString();
        const candidateLimit =
          normalizedQueries.length > 0 ? Math.max(limit * 10, 200) : limit;

        const [driverFacts, contents, queryMatchesByContentId] = await Promise.all([
          repos.postGrowthFactRepository.listTopByTargetInRange({
            targetId: target.id,
            fromIso,
            toIso,
            ageBuckets,
            limit: candidateLimit,
          }),
          repos.contentRepository.findByTargetCreatedAtRange({
            targetId: target.id,
            from: contentFromIso,
            to: toIso,
            limit: 100_000,
          }),
          resolveDriverKeywordMatches({
            postSearchDocumentRepository: repos.postSearchDocumentRepository,
            normalizedQueries,
            canonicalName,
            fromIso: contentFromIso,
            toIso,
            limit: candidateLimit,
          }),
        ]);
        const filteredDriverFacts =
          queryMatchesByContentId.size > 0
            ? driverFacts.filter((fact) => queryMatchesByContentId.has(fact.contentId))
            : normalizedQueries.length > 0
              ? []
              : driverFacts;
        const drivers = buildSubredditDriverPostReadModel({
          facts: filteredDriverFacts.slice(0, limit),
          contents,
          matchedQueriesByContentId: queryMatchesByContentId,
        });

        const payload: SubredditDriverPostsResponse = {
          ok: true,
          requestId,
          generatedAtIso: now(),
          targetId: target.id,
          canonicalName,
          fromIso,
          toIso,
          ageBuckets: ageBuckets ?? ["1h", "6h", "24h"],
          drivers: drivers.map((driver) => ({
            id: driver.id,
            externalId: driver.externalId,
            title: driver.title,
            permalink: driver.permalink,
            createdAtSource: driver.createdAtSource,
            url: driver.url,
            bodySnippet: toBodySnippet(driver.bodyText),
            observedAt: driver.observedAt,
            ageBucket: driver.ageBucket,
            ageMinutes: driver.ageMinutes,
            score: driver.score,
            comments: driver.comments,
            scoreVelocityPerHour: driver.scoreVelocityPerHour,
            commentVelocityPerHour: driver.commentVelocityPerHour,
            velocityZScore: driver.velocityZScore,
            driverScore: driver.driverScore,
            labels: driver.labels,
            matchedQueries: driver.matchedQueries,
            algorithmVersion: driver.algorithmVersion,
            explainPayload: driver.explainPayload,
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
        const rawKeywords = parseKeywordList(url.searchParams.get("keywords"));
        const normalizedQueries = rawKeywords.map((keyword) => {
          try {
            return normalizeQueryV2(keyword, canonicalName);
          } catch {
            throw new BadRequestError(
              `invalid keywords query: ${keyword}`,
              "invalid_query_param",
            );
          }
        });
        const explicitQueryTexts = normalizedQueries.map((query) => query.normalizedQueryText);
        const queryScopes =
          normalizedQueries.length > 0
            ? Array.from(new Set(normalizedQueries.map((query) => query.queryScope)))
            : undefined;
        const tracks =
          normalizedQueries.length > 0 ? (["explicit_query"] as const) : undefined;
        const [dailyFacts, points, keywordDailyRows, coverageRows] = await Promise.all([
          repos.subredditDailyFactRepository.listByTargetInRange({
            targetId: target.id,
            fromDay: toUtcDay(fromIso),
            toDay: toUtcDay(toIso),
          }),
          repos.subredditTrendPointRepository.listByTargetInRange({
            targetId: target.id,
            from: fromIso,
            to: toIso,
          }),
          repos.keywordTrendDailyRepository?.listByTargetInRange({
            targetId: target.id,
            fromDay: toUtcDay(fromIso),
            toDay: toUtcDay(toIso),
            keywords: explicitQueryTexts,
            tracks: tracks ? [...tracks] : undefined,
            queryScopes,
            limit: keywordLimit,
          }) ?? Promise.resolve([]),
          repos.subredditCollectionCoverageRepository?.listByTargetInRange({
            targetId: target.id,
            fromDay: toUtcDay(fromIso),
            toDay: toUtcDay(toIso),
          }) ?? Promise.resolve([]),
        ]);
        const coverageByDay = new Map(coverageRows.map((coverage) => [coverage.day, coverage]));

        const readModel = buildSubredditDailyInsights({
          dailyFacts,
          points,
          posts: [],
          keywordDailyRows,
          fromIso,
          toIso,
          keywords: explicitQueryTexts,
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
          daily: readModel.daily.map((point) => ({
            day: point.day,
            observedNewPosts: point.totalNewPosts,
            observedQualifiedPosts: point.qualifiedPostVolume,
            totalNewPosts:
              coverageByDay.get(point.day)?.coverageStatus === "complete"
                ? point.totalNewPosts
                : null,
            totalQualifiedPosts:
              coverageByDay.get(point.day)?.coverageStatus === "complete"
                ? point.qualifiedPostVolume
                : null,
            coverageStatus: coverageByDay.get(point.day)?.coverageStatus ?? "unknown",
            ...(coverageByDay.get(point.day)?.coverageBasis
              ? { coverageBasis: coverageByDay.get(point.day)!.coverageBasis }
              : {}),
            valueSemantics:
              point.pointQuality === "missing"
                ? "missing"
                : coverageByDay.get(point.day)?.coverageStatus === "complete"
                  ? "complete_total"
                  : "observed_total",
            totalDiscussion: point.totalDiscussion,
            postChangePct: point.postChangePct,
            discussionChangePct: point.discussionChangePct,
            postSpikeScore: point.postSpikeScore,
            isPostSpike: point.isPostSpike,
            postVolume: point.postVolume,
            qualifiedPostVolume: point.qualifiedPostVolume,
            heatPrice: point.heatPrice,
            heatChangePct: point.heatChangePct,
            ema7: point.ema7,
            ema30: point.ema30,
            subscriberCount: point.subscriberCount,
            activeUserCount: point.activeUserCount,
            subredditTier: point.subredditTier,
            qualityThresholdScore: point.qualityThresholdScore,
            qualityThresholdComments: point.qualityThresholdComments,
            algorithmVersion: point.algorithmVersion,
            explainPayload: point.explainPayload,
          })),
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
          coverage: {
            scope: "monitored_targets",
            label: "Top monitored subreddits",
            description:
              "Rankings are computed only across active monitored subreddits with trend points in the requested range.",
            monitoredTargetCount: rankItems.length,
          },
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
      if (error instanceof RequestBodyTooLargeError) {
        respond({
          statusCode: 413,
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
