import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool, QueryResultRow } from "pg";
import { kaixCollectionBudget, providerResourceReservation } from "../../../packages/contracts/src/collection-budget";
import type { Actor } from "../../../packages/contracts/src/access";
import {
  ResearchPlanCollectInput,
  ResearchPlanPreviewInput,
  type ResearchCollectionRestriction,
  type ResearchPlanPreviewRequest,
} from "../../../packages/contracts/src/collection";
import { IdempotencyHeaders } from "../../../packages/contracts/src/common";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { countSourceSamples } from "../content/index";
import { fail } from "../../shared/errors";
import { notifyChannel } from "../../platform/pg-notify";
import { transaction } from "../../storage/db";
import { loadEffectivePolicyForUser, viewerCollectionDemand, type EffectivePolicy } from "./policy";
import { batchMembership, type RequireWritableProject } from "./batches";
import { enqueueOnDemandCollection } from "./managed";
import { sourceSelect } from "./sql";
import {
  collectionRequestRestriction,
  isCollectionBudgetDisabled,
  providerFilterCapabilities,
  queryHintsRestriction,
} from "./config";

export type ProviderCredentialDiagnostic = "ok" | "missing" | "network_disabled";
export type CredentialStateResolver = (provider: string) => ProviderCredentialDiagnostic;

const PRIMARY_ON_DEMAND_PROVIDER: Record<"reddit" | "x" | "bluesky", string> = {
  reddit: "kaix",
  x: "twitterapis",
  bluesky: "bluesky_appview",
};

function normalizeTargetValue(targetType: string, raw: string): string {
  const trimmed = raw.trim();
  if (targetType === "community") return trimmed.replace(/^r\//i, "").toLowerCase();
  if (targetType === "account") return trimmed.replace(/^@/, "").toLowerCase();
  return trimmed.toLowerCase();
}

function sourceTargetMatches(target: Record<string, unknown>, targetType: string, normalized: string): boolean {
  if (target.type !== targetType) return false;
  const field =
    targetType === "community" ? target.community : targetType === "account" ? target.account : target.query;
  return typeof field === "string" && normalizeTargetValue(targetType, field) === normalized;
}

function buildFieldPolicy(
  isViewer: boolean,
  effective: EffectivePolicy,
  providerName?: string,
  targetType?: string,
) {
  return {
    canEditTarget: true,
    canChooseProvider: !isViewer || effective.allowProviderChoice,
    canUseFallback: !isViewer || effective.allowProviderChoice,
    canIncludeComments: !isViewer || effective.maxCommentsPerPost > 0,
    maxLookbackDays: isViewer ? effective.maxLookbackDays : 365,
    maxBatchLimit: isViewer ? effective.maxBatchLimit : 10000,
    maxCommentsPerPost: isViewer ? effective.maxCommentsPerPost : 500,
    supportedFilters: providerFilterCapabilities(providerName ?? "", targetType ?? ""),
  };
}

type Restriction = { code: ResearchCollectionRestriction; message: string };

function hasInvalidCredentialError(health: unknown): boolean {
  if (!health || typeof health !== "object") return false;
  const err = (health as { lastError?: unknown }).lastError;
  return typeof err === "string" && /401|403|invalid api key|unauthorized|invalid credential|bad credentials/i.test(err);
}

function providerDiagnosticBlocker(
  providerName: string,
  provider: ContentProvider | undefined,
  getCredentialState?: CredentialStateResolver,
  health?: unknown,
): Restriction | null {
  if (provider?.capability.enabled) {
    if (hasInvalidCredentialError(health)) {
      return {
        code: "credential_invalid",
        message: `Provider ${providerName} credential was rejected upstream; an administrator should test and rotate it in Settings`,
      };
    }
    return null;
  }
  const state = getCredentialState?.(providerName);
  if (state === "missing") {
    return {
      code: "credential_missing",
      message: `Provider ${providerName} API key is not configured; ask an administrator to add it in Settings -> Provider Keys`,
    };
  }
  if (state === "network_disabled") {
    return {
      code: "network_disabled",
      message: `External network collection is disabled for ${providerName} (SOURCE_NETWORK_ENABLED is off)`,
    };
  }
  return {
    code: "provider_unavailable",
    message: `Provider ${providerName} is disabled or missing credentials/networking`,
  };
}

function collectPolicyBlockers(
  isViewer: boolean,
  effective: EffectivePolicy,
  body: ResearchPlanPreviewRequest,
  spanDays: number,
): Restriction[] {
  if (!isViewer) return [];
  const blockers: Restriction[] = [];
  if (!effective.manualCollectEnabled) blockers.push({ code: "manual_disabled", message: `Manual collection is disabled for ${effective.planTier} tier` });
  if (body.useFallback && !effective.allowProviderChoice) blockers.push({ code: "provider_choice", message: "Your plan does not allow choosing a backup provider" });
  if (spanDays > effective.maxLookbackDays + 0.05) {
    blockers.push({ code: "scope_limit", message: `Window (${Math.ceil(spanDays)}d) exceeds plan max lookback (${effective.maxLookbackDays}d)` });
  }
  if (body.limit > effective.maxBatchLimit) {
    blockers.push({ code: "scope_limit", message: `Limit (${body.limit}) exceeds plan max (${effective.maxBatchLimit})` });
  }
  if (body.includeComments && (body.maxCommentsPerPost ?? 15) > effective.maxCommentsPerPost) {
    blockers.push({ code: "scope_limit", message: `Comments per post exceeds plan max (${effective.maxCommentsPerPost})` });
  }
  return blockers;
}

async function collectProviderRunBlockers(
  pool: Pool,
  isViewer: boolean,
  effective: EffectivePolicy,
  providerName: string,
  provider: ContentProvider | undefined,
  getCredentialState?: CredentialStateResolver,
  health?: unknown,
): Promise<Restriction[]> {
  const blockers: Restriction[] = [];
  const diag = providerDiagnosticBlocker(providerName, provider, getCredentialState, health);
  if (diag) blockers.push(diag);
  if (isViewer && !effective.allowedProviders.includes(providerName)) {
    blockers.push({ code: "source_access", message: `Provider ${providerName} is not enabled for ${effective.planTier} tier` });
  }
  if (await isCollectionBudgetDisabled(pool, providerName)) {
    blockers.push({ code: "budget_unavailable", message: `System channel budget for ${providerName} is disabled or zero` });
  }
  return blockers;
}

async function collectSourceBlockers(
  pool: Pool,
  isViewer: boolean,
  effective: EffectivePolicy,
  matched: QueryResultRow,
  providerName: string,
  provider: ContentProvider | undefined,
  getCredentialState?: CredentialStateResolver,
): Promise<Restriction[]> {
  const blockers = await collectProviderRunBlockers(
    pool, isViewer, effective, providerName, provider, getCredentialState, matched.health,
  );
  if (matched.automatic_collection_blocked) {
    blockers.push({ code: "charge_unresolved", message: "Source is blocked pending review of an unresolved paid request" });
  }
  if (matched.state !== "active") blockers.push({ code: "source_inactive", message: "Research source is paused or archived" });
  if (isViewer && effective.allowedSourceIds !== null && !effective.allowedSourceIds.includes(matched.id)) {
    blockers.push({ code: "source_access", message: "This source is outside your allowed collection scope" });
  }
  return blockers;
}

async function previewQuotaBlockers(pool: Pool, userId: string | undefined, effective: EffectivePolicy, personalResources: number) {
  if (effective.dailyRequests === null && effective.dailyResources === null) return [];
  const { rows: [usage] } = await pool.query<{ requests: number; resources: number }>(
    `SELECT COALESCE(SUM(requests_reserved),0)::int AS requests,
            COALESCE(SUM(resources_reserved),0)::int AS resources
     FROM user_provider_usage WHERE user_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date`,
    [userId],
  );
  const blockers: Restriction[] = [];
  if (effective.dailyRequests !== null && usage.requests + 1 > effective.dailyRequests)
    blockers.push({ code: "quota_exhausted", message: "Daily user collection request quota reached" });
  if (effective.dailyResources !== null && usage.resources + personalResources > effective.dailyResources)
    blockers.push({ code: "quota_exhausted", message: "Daily user collection resource quota reached" });
  return blockers;
}

function estimateResources(
  providerName: string,
  provider: ContentProvider | undefined,
  targetType: string,
  body: ResearchPlanPreviewRequest,
) {
  if (providerName === "kaix") {
    const { requests, systemResources, personalResources } = kaixCollectionBudget(targetType, body.limit, body);
    if (requests > 1) return { requests, systemResources, personalResources };
  }
  const pageSize = providerName === "twitterapis" ? Math.min(body.limit, 20)
    : providerName === "scrapebadger" ? Math.min(body.limit, 100)
    : body.limit;
  const maxPages = providerName === "twitterapis" ? Math.min(500, Math.ceil(body.limit / 20))
    : providerName === "scrapebadger" ? Math.min(500, Math.ceil(body.limit / 100))
    : 1;
  const perPageSystem = provider
    ? providerResourceReservation({
        provider: providerName,
        targetType,
        pageSize,
        includeComments: body.includeComments,
        maxCommentsPerPost: body.maxCommentsPerPost,
        requestResourceUpperBound: provider.capability.requestResourceUpperBound,
      })
    : pageSize;
  const systemResources = perPageSystem * maxPages;
  const personalResources = viewerCollectionDemand(providerName, targetType, body.limit, {
    includeComments: body.includeComments,
    maxCommentsPerPost: body.maxCommentsPerPost,
  }).resources;
  return { requests: maxPages, systemResources, personalResources };
}

async function previewMatchedSource(
  pool: Pool,
  actor: Actor,
  providers: ContentProvider[],
  effective: EffectivePolicy,
  body: ResearchPlanPreviewRequest,
  matched: QueryResultRow,
  normalizedTarget: string | null,
  policyBlockers: Restriction[],
  getCredentialState?: CredentialStateResolver,
) {
  const isViewer = actor.role === "viewer";
  const allowFallback = !isViewer || effective.allowProviderChoice;
  const fallbackRequested = Boolean(body.useFallback) && allowFallback;
  const providerName: string =
    fallbackRequested && matched.fallback_provider ? matched.fallback_provider : matched.primary_provider;
  const provider = providers.find(
    (p) => p.capability.provider === providerName && p.capability.platform === matched.platform,
  );
  const fieldPolicy = buildFieldPolicy(isViewer, effective, providerName, String(matched.target?.type ?? ""));
  const blockers = [
    ...policyBlockers,
    ...(await collectSourceBlockers(pool, isViewer, effective, matched, providerName, provider, getCredentialState)),
  ];
  if (fallbackRequested && !matched.fallback_provider) {
    blockers.push({ code: "provider_choice", message: "No fallback provider configured for this source" });
  }
  const restriction =
    collectionRequestRestriction(providerName, matched.platform, matched.target.type, body)
    ?? queryHintsRestriction(providerName, matched.target.type, body.queryHints);
  if (restriction) blockers.push({ code: "unsupported_scope", message: restriction });
  const estimate = estimateResources(providerName, provider, matched.target.type, body);
  if (isViewer) blockers.push(...await previewQuotaBlockers(pool, actor.userId, effective, estimate.personalResources));

  const existingItemCount = await countSourceSamples(pool, matched.id, body.from, body.to,
    isViewer ? batchMembership(undefined, actor) : undefined);
  const { rows: reusableBatches } = await pool.query<{
    id: string;
    label: string;
    itemCount: number;
    visibility: "private" | "shared";
    createdAt: string;
  }>(
    `SELECT id, label, item_count AS "itemCount", visibility, created_at AS "createdAt"
     FROM collection_batch
     WHERE collection_source_id = $1 AND item_count > 0 AND discarded_at IS NULL
       AND (NOT $2::boolean OR visibility = 'shared' OR created_by_user_id = $3::uuid)
     ORDER BY created_at DESC LIMIT 5`,
    [matched.id, isViewer, actor.userId ?? null],
  );

  return {
    resolutionStatus: blockers.length === 0 ? ("matched_source" as const) : ("blocked" as const),
    executable: blockers.length === 0,
    matchedSource: {
      id: matched.id,
      label: matched.label,
      platform: matched.platform,
      provider: providerName,
      target: matched.target,
      lastSuccessAt: matched.last_success_at?.toISOString() ?? null,
    },
    resolvedTarget: {
      platform: matched.platform,
      type: matched.target.type,
      value: normalizedTarget ?? (matched.target.community ?? matched.target.account ?? matched.target.query ?? ""),
    },
    coverage: {
      status: existingItemCount > 0 ? ("unknown" as const) : ("empty" as const),
      existingItemCount,
      lastSuccessAt: matched.last_success_at?.toISOString() ?? null,
      note:
        existingItemCount > 0
          ? "Existing stored samples found for this window, but full upstream coverage cannot be guaranteed without running a check. You can reuse an authorized batch below (0 API cost) or confirm collection."
          : "No stored samples found in this window.",
    },
    reusableBatches,
    estimate,
    blockers: blockers.map(item => item.message),
    restrictions: [...new Set(blockers.map(item => item.code))],
    fieldPolicy,
  };
}

async function previewUnmatchedTarget(
  pool: Pool,
  actor: Actor,
  providers: ContentProvider[],
  effective: EffectivePolicy,
  body: ResearchPlanPreviewRequest,
  normalizedTarget: string | null,
  policyBlockers: Restriction[],
  getCredentialState?: CredentialStateResolver,
) {
  const isViewer = actor.role === "viewer";
  const allowOnDemand = actor.allowedSourceIds === null && (!isViewer || effective.allowedSourceIds === null);
  const providerName = body.platform ? PRIMARY_ON_DEMAND_PROVIDER[body.platform] : undefined;
  const provider = providerName
    ? providers.find((p) => p.capability.platform === body.platform && p.capability.provider === providerName)
    : undefined;
  const fieldPolicy = buildFieldPolicy(isViewer, effective, providerName, body.targetType);

  if (!body.platform || !body.targetType || !body.targetValue || !provider || !allowOnDemand) {
    return {
      resolutionStatus: "needs_admin_source" as const,
      executable: false,
      matchedSource: null,
      resolvedTarget: body.targetType && body.targetValue
        ? { platform: body.platform ?? null, type: body.targetType, value: normalizedTarget ?? body.targetValue.trim() }
        : null,
      coverage: {
        status: "empty" as const,
        existingItemCount: 0,
        lastSuccessAt: null,
        note: "No registered research source matches this target yet. Ask an administrator to register it in Operations.",
      },
      reusableBatches: [],
      estimate: { requests: 0, systemResources: 0, personalResources: 0 },
      blockers: [
        ...policyBlockers.map(item => item.message),
        "Target is not registered as an active research source yet; an administrator must approve and create it in Operations.",
      ],
      restrictions: ["target_unavailable" as const, ...new Set(policyBlockers.map(item => item.code))],
      fieldPolicy,
    };
  }

  const blockers = [
    ...policyBlockers,
    ...(await collectProviderRunBlockers(pool, isViewer, effective, providerName!, provider, getCredentialState)),
  ];
  const rawTarget =
    body.targetType === "community"
      ? { type: "community" as const, community: body.targetValue }
      : body.targetType === "account"
        ? { type: "account" as const, account: body.targetValue }
        : { type: "search" as const, query: body.targetValue };
  try {
    provider.normalizeTarget(rawTarget, "post");
  } catch (err) {
    blockers.push({ code: "unsupported_scope", message: err instanceof Error ? err.message : "Invalid target format" });
  }
  const restriction =
    collectionRequestRestriction(providerName!, body.platform, body.targetType, body)
    ?? queryHintsRestriction(providerName!, body.targetType, body.queryHints);
  if (restriction) blockers.push({ code: "unsupported_scope", message: restriction });
  const estimate = estimateResources(providerName!, provider, body.targetType, body);
  if (isViewer) blockers.push(...await previewQuotaBlockers(pool, actor.userId, effective, estimate.personalResources));

  return {
    resolutionStatus: blockers.length === 0 ? ("on_demand_available" as const) : ("blocked" as const),
    executable: blockers.length === 0,
    matchedSource: null,
    resolvedTarget: {
      platform: body.platform,
      type: body.targetType,
      value: normalizedTarget ?? body.targetValue.trim(),
    },
    coverage: {
      status: "empty" as const,
      existingItemCount: 0,
      lastSuccessAt: null,
      note:
        blockers.length === 0
          ? "No registered source is required; starting this run will provision the target automatically under your quota."
          : "Target is recognized for on-demand research, but current policy/budget blockers must be resolved first.",
    },
    reusableBatches: [],
    estimate,
    blockers: blockers.map(item => item.message),
    restrictions: [...new Set(blockers.map(item => item.code))],
    fieldPolicy,
  };
}

export async function planRoutes(
  app: FastifyInstance,
  pool: Pool,
  providers: ContentProvider[],
  requireWritableProject?: RequireWritableProject,
  getCredentialState?: CredentialStateResolver,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.post(
    "/v1/research/collection-plans/preview",
    { config: { auth: { access: "viewer_write", browserOnly: true } }, schema: { body: ResearchPlanPreviewInput } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser") fail(403, "Browser session required");
      const body = request.body;
      if (body.projectId) {
        if (!requireWritableProject) fail(500, "Project scope resolver is unavailable");
        await requireWritableProject(pool, actor, body.projectId);
      }
      const fromMs = Date.parse(body.from);
      const toMs = Date.parse(body.to);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) fail(422, "Invalid collection window");
      const isViewer = actor.role === "viewer";
      const effective = await loadEffectivePolicyForUser(pool, actor.userId);
      const policyBlockers = collectPolicyBlockers(isViewer, effective, body, (toMs - fromMs) / 86_400_000);

      const { rows: candidateRows } = await pool.query(
        `${sourceSelect}
         WHERE cs.usage_domain = 'research' AND cs.delivery_mode = 'pull'
           AND ($1::uuid[] IS NULL OR cs.id = ANY($1::uuid[]))
           AND ($2::uuid[] IS NULL OR cs.id = ANY($2::uuid[]))
         ORDER BY (cs.state='active') DESC, cs.created_at, cs.id`,
        [actor.allowedSourceIds, isViewer ? effective.allowedSourceIds : null],
      );
      let matched = body.sourceId ? candidateRows.find((r) => r.id === body.sourceId) : undefined;
      let normalizedTarget: string | null = null;
      if (!matched && body.platform && body.targetType && body.targetValue) {
        normalizedTarget = normalizeTargetValue(body.targetType, body.targetValue);
        matched = candidateRows.find(
          (r) =>
            r.platform === body.platform &&
            sourceTargetMatches((r.target ?? {}) as Record<string, unknown>, body.targetType!, normalizedTarget!),
        );
      }
      if (!matched) {
        return previewUnmatchedTarget(
          pool, actor, providers, effective, body, normalizedTarget, policyBlockers, getCredentialState,
        );
      }
      return previewMatchedSource(
        pool, actor, providers, effective, body, matched, normalizedTarget, policyBlockers, getCredentialState,
      );
    },
  );
  api.post(
    "/v1/research/collection-plans/collect",
    {
      config: { auth: { access: "viewer_write", browserOnly: true } },
      schema: { body: ResearchPlanCollectInput, headers: IdempotencyHeaders },
    },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser") fail(403, "Browser session required");
      const outcome = await transaction(pool, async (client) => {
        if (!requireWritableProject) fail(500, "Project scope resolver is unavailable");
        const proj = await requireWritableProject(client, actor, request.body.projectId) as
          | { visibility?: "private" | "shared" }
          | undefined;
        return enqueueOnDemandCollection(client, actor, providers, {
          ...request.body,
          projectVisibility: proj?.visibility ?? (actor.role === "viewer" ? "private" : undefined),
          requestKey: request.headers["idempotency-key"],
        });
      });
      if (outcome.created) await notifyChannel(pool, "collection_jobs_ready");
      return { jobId: outcome.jobId, sourceId: outcome.sourceId };
    },
  );
}
