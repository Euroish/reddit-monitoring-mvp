import type { Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool, QueryResultRow } from "pg";
import { providerResourceReservation } from "../../../packages/contracts/src/collection-budget";
import { ResearchPlanPreviewInput, type Actor } from "../../../packages/contracts/src/source-content";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../storage/db";
import { loadEffectivePolicyForUser, viewerCollectionDemand, type EffectivePolicy } from "./policy";
import { sourceSelect } from "./sql";

type PlanBody = Static<typeof ResearchPlanPreviewInput>;

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

function buildFieldPolicy(isViewer: boolean, effective: EffectivePolicy) {
  return {
    canEditTarget: true,
    canChooseProvider: !isViewer || effective.allowProviderChoice,
    canUseFallback: !isViewer,
    canIncludeComments: !isViewer || effective.maxCommentsPerPost > 0,
    maxLookbackDays: isViewer ? effective.maxLookbackDays : 365,
    maxBatchLimit: isViewer ? effective.maxBatchLimit : 300,
    maxCommentsPerPost: isViewer ? effective.maxCommentsPerPost : 50,
  };
}

function collectPolicyBlockers(isViewer: boolean, effective: EffectivePolicy, body: PlanBody, spanDays: number): string[] {
  if (!isViewer) return [];
  const blockers: string[] = [];
  if (!effective.manualCollectEnabled) blockers.push(`Manual collection is disabled for ${effective.planTier} tier`);
  if (spanDays > effective.maxLookbackDays + 0.05) {
    blockers.push(`Window (${Math.ceil(spanDays)}d) exceeds plan max lookback (${effective.maxLookbackDays}d)`);
  }
  if (body.limit > effective.maxBatchLimit) {
    blockers.push(`Limit (${body.limit}) exceeds plan max (${effective.maxBatchLimit})`);
  }
  if (body.includeComments && (body.maxCommentsPerPost ?? 15) > effective.maxCommentsPerPost) {
    blockers.push(`Comments per post exceeds plan max (${effective.maxCommentsPerPost})`);
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
): Promise<string[]> {
  const blockers: string[] = [];
  if (!provider?.capability.enabled) {
    blockers.push(`Provider ${providerName} is disabled or missing credentials/networking`);
  }
  if (matched.automatic_collection_blocked) {
    blockers.push("Source is blocked pending review of an unresolved paid request");
  }
  if (isViewer && !effective.allowedProviders.includes(providerName)) {
    blockers.push(`Provider ${providerName} is not enabled for ${effective.planTier} tier`);
  }
  if (isViewer && effective.allowedSourceIds !== null && !effective.allowedSourceIds.includes(matched.id)) {
    blockers.push("This source is outside your allowed collection scope");
  }
  const budgetRow = (
    await pool.query<{
      enabled: boolean;
      daily_requests: number;
      monthly_requests: number;
      daily_resources: number;
      monthly_resources: number;
    }>(
      "SELECT enabled, daily_requests, monthly_requests, daily_resources, monthly_resources FROM source_provider_budget WHERE provider=$1",
      [providerName],
    )
  ).rows[0];
  if (
    budgetRow &&
    (!budgetRow.enabled ||
      Math.min(budgetRow.daily_requests, budgetRow.monthly_requests, budgetRow.daily_resources, budgetRow.monthly_resources) <= 0)
  ) {
    blockers.push(`System channel budget for ${providerName} is disabled or zero`);
  }
  return blockers;
}

async function previewMatchedSource(
  pool: Pool,
  actor: Actor,
  providers: ContentProvider[],
  effective: EffectivePolicy,
  body: PlanBody,
  matched: QueryResultRow,
  normalizedTarget: string | null,
  policyBlockers: string[],
  fieldPolicy: ReturnType<typeof buildFieldPolicy>,
) {
  const isViewer = actor.role === "viewer";
  const providerName: string =
    body.useFallback && !isViewer && matched.fallback_provider ? matched.fallback_provider : matched.primary_provider;
  const provider = providers.find(
    (p) => p.capability.provider === providerName && p.capability.platform === matched.platform,
  );
  const blockers = [
    ...policyBlockers,
    ...(await collectSourceBlockers(pool, isViewer, effective, matched, providerName, provider)),
  ];
  const pageSize = providerName === "twitterapis" ? Math.min(body.limit, 20) : body.limit;
  const systemResources = provider
    ? providerResourceReservation({
        provider: providerName,
        targetType: matched.target.type,
        pageSize,
        includeComments: body.includeComments,
        maxCommentsPerPost: body.maxCommentsPerPost,
        requestResourceUpperBound: provider.capability.requestResourceUpperBound,
      })
    : pageSize;
  const personalResources = viewerCollectionDemand(providerName, matched.target.type, pageSize, {
    includeComments: body.includeComments,
    maxCommentsPerPost: body.maxCommentsPerPost,
  }).resources;

  const { rows: [inv] } = await pool.query<{ count: string }>(
    `SELECT COUNT(DISTINCT d.content_id)::text AS count
     FROM content_discovery d
     JOIN content c ON c.id = d.content_id
     WHERE d.collection_source_id = $1 AND c.created_at_source >= $2::timestamptz AND c.created_at_source < $3::timestamptz`,
    [matched.id, body.from, body.to],
  );
  const existingItemCount = Number(inv?.count ?? 0);
  const { rows: reusableBatches } = await pool.query<{
    id: string;
    label: string;
    itemCount: number;
    visibility: "private" | "shared";
    createdAt: string;
  }>(
    `SELECT id, label, item_count AS "itemCount", visibility, created_at AS "createdAt"
     FROM collection_batch
     WHERE collection_source_id = $1 AND item_count > 0
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
    estimate: { requests: 1, systemResources, personalResources },
    blockers,
    fieldPolicy,
  };
}

export async function planRoutes(app: FastifyInstance, pool: Pool, providers: ContentProvider[]) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.post(
    "/v1/research/collection-plans/preview",
    { schema: { body: ResearchPlanPreviewInput } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser") fail(403, "Browser session required");
      const body = request.body;
      const fromMs = Date.parse(body.from);
      const toMs = Date.parse(body.to);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) fail(422, "Invalid collection window");
      const isViewer = actor.role === "viewer";
      const effective = await loadEffectivePolicyForUser(pool, actor.userId);
      const policyBlockers = collectPolicyBlockers(isViewer, effective, body, (toMs - fromMs) / 86_400_000);
      const fieldPolicy = buildFieldPolicy(isViewer, effective);

      const { rows: candidateRows } = await pool.query(
        `${sourceSelect}
         WHERE cs.usage_domain = 'research' AND cs.delivery_mode = 'pull' AND cs.state = 'active'
           AND ($1::uuid[] IS NULL OR cs.id = ANY($1::uuid[]))
         ORDER BY cs.created_at, cs.id`,
        [actor.allowedSourceIds],
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
            ...policyBlockers,
            "Target is not registered as an active research source yet; an administrator must approve and create it in Operations.",
          ],
          fieldPolicy,
        };
      }
      return previewMatchedSource(pool, actor, providers, effective, body, matched, normalizedTarget, policyBlockers, fieldPolicy);
    },
  );
}
