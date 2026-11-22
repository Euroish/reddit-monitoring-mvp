import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool, PoolClient } from "pg";
import { PlanTier, type Actor } from "../../../packages/contracts/src/access";
import { ParamsId } from "../../../packages/contracts/src/common";
import { PlanPolicyInput, UserQuotaOverrideInput } from "../../../packages/contracts/src/collection";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import {
  getUserQuotaRecord,
  getUserRoleStatus,
  listUsersForQuotaSummary,
  updateUserQuotaOverride,
  writeAuditLog,
} from "../access/index";

export interface QuotaOverride {
  manualCollectEnabled?: boolean | null;
  allowedProviders?: string[] | null;
  allowedSourceIds?: string[] | null;
  dailyRequests?: number | null;
  dailyResources?: number | null;
  maxBatchLimit?: number | null;
}

export interface EffectivePolicy {
  planTier: "free" | "pro";
  manualCollectEnabled: boolean;
  allowedProviders: string[];
  allowedSourceIds: string[] | null;
  dailyRequests: number | null;
  dailyResources: number | null;
  maxBatchLimit: number;
  maxCommentsPerPost: number;
  hasOverride: boolean;
}

interface PolicyRow {
  plan_tier: "free" | "pro";
  manual_collect_enabled: boolean;
  allowed_providers: string[];
  allowed_source_ids: string[] | null;
  daily_requests: number | null;
  daily_resources: number | null;
  max_batch_limit: number;
  max_comments_per_post: number;
  updated_at: string;
  revision: number;
}

export function resolveEffectivePolicy(policy: PolicyRow, override: QuotaOverride | null): EffectivePolicy {
  const o = override ?? {};
  return {
    planTier: policy.plan_tier,
    manualCollectEnabled:
      typeof o.manualCollectEnabled === "boolean" ? o.manualCollectEnabled : policy.manual_collect_enabled,
    allowedProviders: Array.isArray(o.allowedProviders) ? o.allowedProviders : policy.allowed_providers,
    allowedSourceIds: o.allowedSourceIds !== undefined ? o.allowedSourceIds : policy.allowed_source_ids,
    dailyRequests: o.dailyRequests !== undefined ? o.dailyRequests : policy.daily_requests,
    dailyResources: o.dailyResources !== undefined ? o.dailyResources : policy.daily_resources,
    maxBatchLimit: typeof o.maxBatchLimit === "number" ? o.maxBatchLimit : policy.max_batch_limit,
    maxCommentsPerPost: policy.max_comments_per_post,
    hasOverride: Boolean(override && Object.keys(override).length > 0),
  };
}

export async function loadEffectivePolicyForUser(
  client: Pool | PoolClient,
  userId: string,
  lockForUpdate = false,
): Promise<EffectivePolicy> {
  const userRow = await getUserQuotaRecord(client, userId, lockForUpdate);
  if (!userRow || userRow.status !== "active") fail(401, "Account no longer active");
  const policyRow = (
    await client.query<PolicyRow>("SELECT * FROM plan_collection_policy WHERE plan_tier=$1", [userRow.plan_tier])
  ).rows[0];
  if (!policyRow) fail(lockForUpdate ? 403 : 500, lockForUpdate ? "Collection policy unavailable" : "Plan policy missing");
  return resolveEffectivePolicy(policyRow, userRow.quota_override as QuotaOverride | null);
}

export function requestedCommentLimit(
  provider: string, targetType: string, pageSize: number,
  request: { includeComments?: boolean; maxCommentsPerPost?: number },
) {
  if (targetType === "post") {
    if (provider === "kaix") return Math.min(pageSize, request.maxCommentsPerPost ?? 50);
    if (provider === "red_crawler") return pageSize;
  }
  return request.includeComments ? request.maxCommentsPerPost ?? 15 : undefined;
}

export function viewerCollectionDemand(
  provider: string, targetType: string, limit: number,
  request: { includeComments?: boolean; maxCommentsPerPost?: number },
) {
  const commentLimit = requestedCommentLimit(provider, targetType, limit, request);
  const resources = provider === "kaix" && commentLimit !== undefined
    ? (targetType === "post" ? commentLimit + 1 : limit * (commentLimit + 1))
    : limit;
  return { provider, limit, resources, includeComments: commentLimit !== undefined, maxCommentsPerPost: commentLimit };
}

export async function admitViewerCollection(
  client: PoolClient,
  actor: Actor,
  req: {
    provider: string;
    sourceId: string;
    limit: number;
    resources: number;
    includeComments?: boolean;
    maxCommentsPerPost?: number;
  },
) {
  if (actor.clientKind !== "browser" || actor.role !== "viewer") return;
  const effective = await loadEffectivePolicyForUser(client, actor.userId, true);

  if (!effective.manualCollectEnabled) {
    fail(403, `Manual collection is disabled for ${effective.planTier} tier`);
  }
  if (!effective.allowedProviders.includes(req.provider)) {
    fail(403, `Provider ${req.provider} is not enabled for your plan`);
  }
  if (effective.allowedSourceIds !== null && !effective.allowedSourceIds.includes(req.sourceId)) {
    fail(403, "This source is outside your allowed collection scope");
  }
  if (req.limit > effective.maxBatchLimit) {
    fail(422, `Requested limit ${req.limit} exceeds your plan max (${effective.maxBatchLimit})`);
  }
  if (req.includeComments && (req.maxCommentsPerPost ?? 15) > effective.maxCommentsPerPost) {
    fail(422, `Comment hydration exceeds your plan max (${effective.maxCommentsPerPost})`);
  }

  await client.query(
    `INSERT INTO user_provider_usage(user_id,provider,day,requests_reserved,requests_executed,resources_reserved)
     VALUES($1,$2,(NOW() AT TIME ZONE 'UTC')::date,0,0,0) ON CONFLICT (user_id,provider,day) DO NOTHING`,
    [actor.userId, req.provider],
  );
  const usageRows = (
    await client.query<{ requests_reserved: number; resources_reserved: number }>(
      `SELECT requests_reserved, resources_reserved FROM user_provider_usage
       WHERE user_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date FOR UPDATE`,
      [actor.userId],
    )
  ).rows;
  const usedRequests = usageRows.reduce((s, r) => s + r.requests_reserved, 0);
  const usedResources = usageRows.reduce((s, r) => s + r.resources_reserved, 0);
  if (effective.dailyRequests !== null && usedRequests + 1 > effective.dailyRequests) {
    fail(429, "Daily user collection request quota reached");
  }
  if (effective.dailyResources !== null && usedResources + req.resources > effective.dailyResources) {
    fail(429, "Daily user collection resource quota reached");
  }
  await client.query(
    `UPDATE user_provider_usage
     SET requests_reserved=requests_reserved+1, resources_reserved=resources_reserved+$3
     WHERE user_id=$1 AND provider=$2 AND day=(NOW() AT TIME ZONE 'UTC')::date`,
    [actor.userId, req.provider, req.resources],
  );
}

export async function recordUserExecutedRequest(client: PoolClient, jobId: string, provider: string) {
  const row = (
    await client.query<{ requested_by_user_id: string | null; requested_by_client_kind: string | null }>(
      "SELECT requested_by_user_id, requested_by_client_kind FROM source_collection_job WHERE id=$1",
      [jobId],
    )
  ).rows[0];
  if (!row?.requested_by_user_id || row.requested_by_client_kind !== "browser") return;
  await client.query(
    `INSERT INTO user_provider_usage(user_id,provider,day,requests_reserved,requests_executed,resources_reserved)
     VALUES($1,$2,(NOW() AT TIME ZONE 'UTC')::date,0,1,0)
     ON CONFLICT (user_id,provider,day) DO UPDATE
     SET requests_executed=user_provider_usage.requests_executed+1`,
    [row.requested_by_user_id, provider],
  );
}

export async function isViewerJobStillAuthorized(db: Pool | PoolClient, job: {
  requested_by_user_id: string | null;
  requested_by_client_kind: string | null;
  provider: string;
  collection_source_id: string;
  page_size: number;
}, commentLimit?: number): Promise<boolean> {
  if (!job.requested_by_user_id || job.requested_by_client_kind !== "browser") return true;
  const user = await getUserRoleStatus(db, job.requested_by_user_id);
  if (!user || user.status !== "active") return false;
  if (user.role !== "viewer") return true;
  const effective = await loadEffectivePolicyForUser(db, job.requested_by_user_id);
  if (!effective.manualCollectEnabled) return false;
  if (!effective.allowedProviders.includes(job.provider)) return false;
  if (job.page_size > effective.maxBatchLimit || (commentLimit ?? 0) > effective.maxCommentsPerPost) return false;
  if (effective.allowedSourceIds !== null && !effective.allowedSourceIds.includes(job.collection_source_id)) {
    return false;
  }
  return true;
}

export async function policyRoutes(app: FastifyInstance, pool: Pool, providers: ContentProvider[]) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get("/v1/quotas/summary", { config: { auth: { access: "authenticated" } } }, async (request) => {
    const actor = request.actor!;
    if (actor.clientKind !== "browser") fail(403, "Browser session required");
    const effective = await loadEffectivePolicyForUser(pool, actor.userId);
    const myRows = (
      await pool.query<{
        provider: string;
        requests_reserved: number;
        requests_executed: number;
        resources_reserved: number;
      }>(
        `SELECT provider, requests_reserved, requests_executed, resources_reserved
         FROM user_provider_usage WHERE user_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date ORDER BY provider`,
        [actor.userId],
      )
    ).rows;
    const myTotals = myRows.reduce(
      (acc, r) => ({
        requestsReserved: acc.requestsReserved + r.requests_reserved,
        requestsExecuted: acc.requestsExecuted + r.requests_executed,
        resourcesReserved: acc.resourcesReserved + r.resources_reserved,
      }),
      { requestsReserved: 0, requestsExecuted: 0, resourcesReserved: 0 },
    );
    const utcNow = new Date();
    const resetsAtUtc = new Date(Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), utcNow.getUTCDate() + 1)).toISOString();

    if (actor.role === "viewer") {
      return {
        scope: "personal" as const,
        resetsAtUtc,
        effectivePolicy: effective,
        myUsage: { ...myTotals, byProvider: myRows },
        providerAvailability: providers.map((p) => ({
          provider: p.capability.provider,
          platform: p.capability.platform,
          enabled: p.capability.enabled,
          planAllowed: effective.manualCollectEnabled && effective.allowedProviders.includes(p.capability.provider),
        })),
      };
    }

    const planRows = (await pool.query<PolicyRow>("SELECT * FROM plan_collection_policy ORDER BY plan_tier")).rows;
    const [usersList, usageList] = await Promise.all([
      listUsersForQuotaSummary(pool),
      pool.query<{
        user_id: string;
        requests_reserved: number;
        requests_executed: number;
        resources_reserved: number;
      }>(
        `SELECT user_id,
           COALESCE(SUM(requests_reserved), 0)::int AS requests_reserved,
           COALESCE(SUM(requests_executed), 0)::int AS requests_executed,
           COALESCE(SUM(resources_reserved), 0)::int AS resources_reserved
         FROM user_provider_usage
         WHERE day=(NOW() AT TIME ZONE 'UTC')::date
         GROUP BY user_id`,
      ),
    ]);
    const usageByUser = new Map(usageList.rows.map((u) => [u.user_id, u]));
    const usersRows = usersList.map((u) => {
      const uUsage = usageByUser.get(u.id);
      return {
        ...u,
        quota_override: u.quota_override as QuotaOverride | null,
        requests_reserved: uUsage?.requests_reserved ?? 0,
        requests_executed: uUsage?.requests_executed ?? 0,
        resources_reserved: uUsage?.resources_reserved ?? 0,
      };
    });

    return {
      scope: "admin" as const,
      resetsAtUtc,
      effectivePolicy: effective,
      myUsage: { ...myTotals, byProvider: myRows },
      planPolicies: planRows.map((p) => ({
        planTier: p.plan_tier,
        manualCollectEnabled: p.manual_collect_enabled,
        allowedProviders: p.allowed_providers,
        allowedSourceIds: p.allowed_source_ids,
        dailyRequests: p.daily_requests,
        dailyResources: p.daily_resources,
        maxBatchLimit: p.max_batch_limit,
        maxCommentsPerPost: p.max_comments_per_post,
        updatedAt: p.updated_at,
        revision: p.revision,
      })),
      users: usersRows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        planTier: u.plan_tier,
        quotaOverride: u.quota_override,
        todayUsage: {
          requestsReserved: u.requests_reserved,
          requestsExecuted: u.requests_executed,
          resourcesReserved: u.resources_reserved,
        },
      })),
    };
  });

  api.put(
    "/v1/quotas/plans/:tier",
    { config: { auth: { access: "admin_mfa" } }, schema: { params: Type.Object({ tier: PlanTier }), body: PlanPolicyInput } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser" || actor.role !== "owner") {
        fail(403, "Owner browser session required to modify plan policies");
      }
      const validProviders = new Set(providers.map((p) => p.capability.provider));
      for (const p of request.body.allowedProviders) {
        if (!validProviders.has(p)) fail(422, `Unknown provider: ${p}`);
      }
      return transaction(pool, async (client) => {
        const res = await client.query<PolicyRow>(
          `UPDATE plan_collection_policy
           SET manual_collect_enabled=$2, allowed_providers=$3, allowed_source_ids=$4,
               daily_requests=$5, daily_resources=$6, max_batch_limit=$7,
               max_comments_per_post=$8, updated_by=$9, updated_at=NOW(), revision=revision+1
           WHERE plan_tier=$1 AND revision=$10
           RETURNING *`,
          [
            request.params.tier,
            request.body.manualCollectEnabled,
            request.body.allowedProviders,
            request.body.allowedSourceIds,
            request.body.dailyRequests,
            request.body.dailyResources,
            request.body.maxBatchLimit,
            request.body.maxCommentsPerPost,
            actor.userId,
            request.body.revision,
          ],
        );
        if (!res.rowCount) fail(409, "Plan policy changed; reload before saving");
        const updated = res.rows[0];
        await writeAuditLog(client, {
          actorUserId: actor.userId,
          action: "collection.plan_policy.updated",
          resourceType: "plan_collection_policy",
          resourceId: request.params.tier,
          meta: {
            planTier: request.params.tier,
            manualCollectEnabled: updated.manual_collect_enabled,
            allowedProviders: updated.allowed_providers,
            dailyRequests: updated.daily_requests,
            dailyResources: updated.daily_resources,
          },
        });
        return {
          policy: {
            planTier: updated.plan_tier,
            manualCollectEnabled: updated.manual_collect_enabled,
            allowedProviders: updated.allowed_providers,
            allowedSourceIds: updated.allowed_source_ids,
            dailyRequests: updated.daily_requests,
            dailyResources: updated.daily_resources,
            maxBatchLimit: updated.max_batch_limit,
            maxCommentsPerPost: updated.max_comments_per_post,
            updatedAt: updated.updated_at,
            revision: updated.revision,
          },
        };
      });
    },
  );

  api.put(
    "/v1/quotas/users/:id",
    { config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId, body: Type.Union([UserQuotaOverrideInput, Type.Null()]) } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser" || actor.role === "viewer") {
        fail(403, "Administrator browser session required");
      }
      if (request.body && request.body.allowedProviders) {
        const validProviders = new Set(providers.map((p) => p.capability.provider));
        for (const p of request.body.allowedProviders) {
          if (!validProviders.has(p)) fail(422, `Unknown provider: ${p}`);
        }
      }
      return transaction(pool, async (client) => {
        const target = await getUserRoleStatus(client, request.params.id, true);
        if (!target) fail(404, "User not found");
        if (actor.role !== "owner" && target.role !== "viewer") {
          fail(403, "Admins can only manage quota overrides for viewer accounts");
        }
        const cleaned =
          request.body && Object.keys(request.body).length > 0 ? request.body : null;
        await updateUserQuotaOverride(client, request.params.id, cleaned ? JSON.stringify(cleaned) : null);
        await writeAuditLog(client, {
          actorUserId: actor.userId,
          action: "collection.user_quota.updated",
          resourceType: "app_user",
          resourceId: request.params.id,
          meta: { hasOverride: Boolean(cleaned) },
        });
        return { updated: true, quotaOverride: cleaned };
      });
    },
  );
}
