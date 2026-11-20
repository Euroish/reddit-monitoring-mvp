import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";

const derive = promisify(scrypt);
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16),
    key = (await derive(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) return false;
  const [, salt, expected] = hash.split(":"),
    key = (await derive(password, Buffer.from(salt, "hex"), 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}
export async function findActor(
  pool: Pool,
  token: string,
  clientKind: "browser" | "machine",
): Promise<Actor | null> {
  const row = (
    await pool.query(
      `SELECT s.id,s.client_kind,s.scopes,s.allowed_source_ids,u.id AS user_id,u.email,u.role,u.plan_tier
       FROM app_session s JOIN app_user u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.client_kind=$2 AND s.expires_at>NOW()
         AND u.status='active' AND s.credential_version=u.credential_version`,
      [tokenHash(token), clientKind],
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
export async function bootstrapOwner(
  pool: Pool,
  password: string,
  email = "owner@localhost",
) {
  if (password.length < 12 || password.length > 128)
    fail(422, "Bootstrap password must have 12–128 characters");
  const hash = await hashPassword(password);
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
