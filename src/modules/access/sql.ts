import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";

import { hashPassword } from "./password";
export { hashPassword, verifyPassword } from "./password";

export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const browserIdlePolicy = `s.expires_at=s.created_at+interval '7 days' OR
             s.last_seen_at>NOW()-CASE
               WHEN u.role<>'viewer' THEN interval '30 minutes'
               WHEN s.expires_at>s.created_at+interval '1 day' THEN interval '7 days'
               ELSE interval '2 hours'
             END`;

export async function findActor(
  pool: Pool,
  token: string,
  clientKind: "browser" | "machine",
  requireMfa = false,
): Promise<Actor | null> {
  const row = (
    await pool.query(
      `WITH valid AS MATERIALIZED (
         SELECT s.id,s.client_kind,s.scopes,s.allowed_source_ids,u.id AS user_id,u.email,u.role,u.plan_tier
         FROM app_session s JOIN app_user u ON u.id=s.user_id
         WHERE s.token_hash=$1 AND s.client_kind=$2 AND s.expires_at>NOW()
           AND u.status='active' AND s.credential_version=u.credential_version
           AND ($2='machine' OR (${browserIdlePolicy}))
           AND ($2='machine' OR s.mfa_verified_at IS NOT NULL OR
             ((NOT $3::boolean OR u.role='viewer') AND NOT EXISTS (SELECT 1 FROM app_auth_mfa WHERE user_id=u.id)))
       ), touch AS (
         UPDATE app_session s SET last_seen_at=NOW() FROM valid v
         WHERE s.id=v.id AND $2='browser'
           AND s.expires_at<>s.created_at+interval '7 days'
           AND s.last_seen_at<=NOW()-interval '5 minutes'
       )
       SELECT * FROM valid`,
      [tokenHash(token), clientKind, requireMfa],
    )
  ).rows[0];
  return row
    ? {
        sessionId: row.id,
        userId: row.user_id,
        email: row.email,
        role: row.role,
        planTier: row.plan_tier ?? "free",
        clientKind: row.client_kind,
        scopes: row.scopes,
        allowedSourceIds: row.allowed_source_ids,
      }
    : null;
}
export async function createSession(
  client: Pool | PoolClient,
  userId: string,
  kind: Actor["clientKind"],
  scopes: readonly string[],
  sourceIds: string[] | null,
  days: number,
  label?: string,
) {
  const token = randomBytes(32).toString("base64url");
  const row = (
    await client.query(
      `INSERT INTO app_session(id,user_id,token_hash,expires_at,credential_version,client_kind,label,scopes,allowed_source_ids)
    SELECT $1,id,$2,NOW()+make_interval(days=>$3),credential_version,$4,$5,$6,$7 FROM app_user WHERE id=$8 AND status='active' RETURNING id`,
      [
        randomUUID(),
        tokenHash(token),
        days,
        kind,
        label ?? null,
        scopes,
        sourceIds,
        userId,
      ],
    )
  ).rows[0];
  if (!row) fail(401, "Account no longer active");
  return { token, id: row.id as string };
}
export async function createLoginSession(
  pool: Pool,
  userId: string,
  credentialVersion: number,
  scopes: readonly string[],
  remember = false,
  rehash?: { previous: string; next: string },
  requestId?: string,
) {
  return transaction(pool, async (client) => {
    const valid = await client.query<{ role: Actor["role"] }>(
      `SELECT role FROM app_user WHERE id=$1 AND status='active' AND credential_version=$2
       AND NOT EXISTS (SELECT 1 FROM app_auth_mfa WHERE user_id=$1) FOR UPDATE`,
      [userId, credentialVersion],
    );
    if (!valid.rowCount) fail(401, "Invalid email or password");
    if (rehash) {
      await client.query(
        "UPDATE app_user_password SET password_hash=$3,updated_at=NOW() WHERE user_id=$1 AND password_hash=$2",
        [userId, rehash.previous, rehash.next],
      );
    }
    const persistent = remember && valid.rows[0].role === "viewer";
    const days = persistent ? 30 : 1;
    const session = await createSession(client, userId, "browser", scopes, null, days);
    if (requestId) await recordAuthEvent(client, userId, "auth.login", requestId);
    return { ...session, maxAge: persistent ? days * 86400 : undefined };
  });
}

export async function bootstrapOwner(
  pool: Pool,
  password: string,
  email = "owner@localhost",
  strongerPasswords = false,
) {
  if ((await pool.query("SELECT 1 FROM app_user LIMIT 1")).rowCount) return;
  if (password.length < 12 || password.length > 128)
    fail(422, "Bootstrap password must have 12–128 characters");
  const hash = await hashPassword(password, strongerPasswords);
  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(728419,2)");
    if ((await client.query("SELECT 1 FROM app_user LIMIT 1")).rowCount) return;
    const id = randomUUID();
    await client.query(
      "INSERT INTO app_user(id,email,role,status) VALUES($1,$2,'owner','active')",
      [id, email.toLowerCase()],
    );
    await client.query(
      "INSERT INTO app_user_password(user_id,password_hash,password_algo) VALUES($1,$2,'scrypt')",
      [id, hash],
    );
  });
}
export async function recordAuthEvent(
  client: PoolClient,
  userId: string,
  action: "auth.login" | "auth.invite.accepted" | "auth.invite.created" | "auth.invite.revoked" | "auth.email_registered" |
    "auth.email_verified" | "auth.password_reset" | "auth.password_changed" | "auth.mfa.login" |
    "auth.mfa.step_up" | "auth.mfa.recovery_used" | "auth.mfa.recovery_rotated" | "auth.mfa.enrolled" | "auth.mfa.recovered",
  requestId: string,
) {
  await client.query(
    `INSERT INTO app_audit_log(id,actor_user_id,action,resource_type,request_id,completed_at)
     VALUES($1,$2,$3,'session',$4,NOW())`,
    [randomUUID(), userId, action, requestId],
  );
}

export async function listBrowserSessions(pool: Pool, actor: Actor) {
  const result = await pool.query<{ id: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date; current: boolean }>(
    `SELECT s.id,s.created_at AS "createdAt",s.last_seen_at AS "lastSeenAt",s.expires_at AS "expiresAt",s.id=$2 AS current
     FROM app_session s JOIN app_user u ON u.id=s.user_id
     WHERE s.user_id=$1 AND s.client_kind='browser' AND s.expires_at>NOW()
       AND u.status='active' AND s.credential_version=u.credential_version AND (${browserIdlePolicy})
     ORDER BY current DESC,s.last_seen_at DESC,s.id LIMIT 100`,
    [actor.userId, actor.sessionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    label: "Browser",
    current: row.current,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

export async function revokeBrowserSessions(pool: Pool, actor: Actor, requestId: string, sessionId?: string) {
  return transaction(pool, async (client) => {
    const result = await client.query(
      `DELETE FROM app_session WHERE user_id=$1 AND client_kind='browser' AND ($2::uuid IS NULL OR id=$2)`,
      [actor.userId, sessionId ?? null],
    );
    if (result.rowCount) {
      await client.query(
        `INSERT INTO app_audit_log(id,actor_user_id,action,resource_type,resource_id,request_id,completed_at)
         VALUES($1,$2,$3,'session',$4,$5,NOW())`,
        [randomUUID(), actor.userId, sessionId ? "auth.session.revoked" : "auth.sessions.revoked", sessionId ?? null, requestId],
      );
    }
  });
}

export async function pruneExpiredBrowserSessions(pool: Pool) {
  await pool.query(`WITH expired AS (
    SELECT id FROM app_session WHERE client_kind='browser' AND expires_at<=NOW()
    ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
  ) DELETE FROM app_session s USING expired e WHERE s.id=e.id`);
}

export async function listUsers(pool: Pool) {
  const result = await pool.query<{
    id: string;
    email: string;
    role: string;
    status: string;
    planTier: string;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT id,email,role,status,plan_tier AS "planTier",created_at AS "createdAt",updated_at AS "updatedAt"
     FROM app_user ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at ASC`,
  );
  return result.rows;
}
export async function updateUserAccess(
  pool: Pool,
  actor: Actor,
  targetId: string,
  patch: {
    role?: "admin" | "viewer";
    status?: "active" | "disabled";
    planTier?: "free" | "pro";
  },
) {
  return transaction(pool, async (client) => {
    const target = (
      await client.query<{
        id: string;
        role: string;
        status: string;
        plan_tier: string;
      }>("SELECT id,role,status,plan_tier FROM app_user WHERE id=$1 FOR UPDATE", [
        targetId,
      ])
    ).rows[0];
    if (!target) fail(404, "User not found");
    if (target.id === actor.userId && patch.status === "disabled")
      fail(422, "Cannot disable your own active account");
    if (target.role === "owner" && (patch.role || patch.status === "disabled"))
      fail(403, "Owner role and active status cannot be modified here");
    if (actor.role !== "owner") {
      if (target.role !== "viewer" || patch.role || patch.planTier)
        fail(403, "Owner access required to change roles or plan tiers");
    }
    const nextRole = patch.role ?? target.role;
    const nextStatus = patch.status ?? target.status;
    const nextTier = patch.planTier ?? target.plan_tier;
    const bumpCred =
      nextRole !== target.role || nextStatus !== target.status ? 1 : 0;
    await client.query(
      `UPDATE app_user SET role=$2,status=$3,plan_tier=$4,credential_version=credential_version+$5,updated_at=NOW() WHERE id=$1`,
      [targetId, nextRole, nextStatus, nextTier, bumpCred],
    );
    await client.query(
      `INSERT INTO app_audit_log(id,actor_user_id,action,resource_type,resource_id,meta_json)
       VALUES($1,$2,'access.user.updated','app_user',$3,$4::jsonb)`,
      [
        randomUUID(),
        actor.userId,
        targetId,
        JSON.stringify({ role: nextRole, status: nextStatus, planTier: nextTier }),
      ],
    );
    return {
      id: targetId,
      role: nextRole,
      status: nextStatus,
      planTier: nextTier,
    };
  });
}
export async function listAccessAudit(pool: Pool) {
  const result = await pool.query(
    `SELECT a.id,a.action,a.resource_type AS "resourceType",a.resource_id AS "resourceId",a.meta_json AS meta,
       a.created_at AS "createdAt",u.email AS "actorEmail"
     FROM app_audit_log a LEFT JOIN app_user u ON u.id=a.actor_user_id
     ORDER BY a.created_at DESC LIMIT 50`,
  );
  return result.rows;
}

export async function writeAuditLog(
  db: Pool | PoolClient,
  input: {
    actorUserId?: string | null;
    actorType?: "session" | "machine" | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    meta?: unknown;
  },
) {
  await db.query(
    `INSERT INTO app_audit_log(id,actor_user_id,actor_type,action,resource_type,resource_id,meta_json)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      randomUUID(),
      input.actorUserId ?? null,
      input.actorType ?? "session",
      input.action,
      input.resourceType ?? null,
      input.resourceId ?? null,
      JSON.stringify(input.meta ?? {}),
    ],
  );
}

export async function getUserQuotaRecord(
  db: Pool | PoolClient,
  userId: string,
  lockForUpdate = false,
) {
  const lockClause = lockForUpdate ? " FOR UPDATE" : "";
  return (
    await db.query<{
      status: string;
      plan_tier: "free" | "pro";
      quota_override: Record<string, unknown> | null;
    }>(`SELECT status, plan_tier, quota_override FROM app_user WHERE id=$1${lockClause}`, [userId])
  ).rows[0];
}

export async function getUserRoleStatus(
  db: Pool | PoolClient,
  userId: string,
  lockForUpdate = false,
) {
  const lockClause = lockForUpdate ? " FOR UPDATE" : "";
  return (
    await db.query<{ id: string; role: string; status: string }>(
      `SELECT id, role, status FROM app_user WHERE id=$1${lockClause}`,
      [userId],
    )
  ).rows[0];
}

export async function updateUserQuotaOverride(
  db: Pool | PoolClient,
  userId: string,
  quotaOverrideJson: string | null,
) {
  await db.query(
    "UPDATE app_user SET quota_override=$2, updated_at=NOW() WHERE id=$1",
    [userId, quotaOverrideJson],
  );
}

export async function listUsersForQuotaSummary(db: Pool | PoolClient) {
  return (
    await db.query<{
      id: string;
      email: string;
      role: string;
      status: string;
      plan_tier: "free" | "pro";
      quota_override: Record<string, unknown> | null;
    }>(
      `SELECT id, email, role, status, plan_tier, quota_override
       FROM app_user
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at ASC`,
    )
  ).rows;
}

export async function getUserEmailsByIds(
  db: Pool | PoolClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = (
    await db.query<{ id: string; email: string }>(
      "SELECT id, email FROM app_user WHERE id = ANY($1::uuid[])",
      [unique],
    )
  ).rows;
  return new Map(rows.map((r) => [r.id, r.email]));
}


export async function listStaffOwnerIds(db: Pool | PoolClient) {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM app_user WHERE role IN ('owner','admin')");
  return rows.map(row => row.id);
}
