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
      `SELECT s.id,s.client_kind,s.scopes,s.allowed_source_ids,u.id AS user_id,u.email,u.role FROM app_session s JOIN app_user u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.client_kind=$2 AND s.expires_at>NOW() AND u.status='active' AND s.credential_version=u.credential_version`,
      [tokenHash(token), clientKind],
    )
  ).rows[0];
  return row
    ? {
        sessionId: row.id,
        userId: row.user_id,
        email: row.email,
        role: row.role,
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
