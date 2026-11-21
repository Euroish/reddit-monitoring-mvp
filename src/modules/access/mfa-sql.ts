import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Scopes, type Actor } from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";
import { openTotpSeed, sealTotpSeed, totpStep } from "./mfa-crypto";
import { createSession, recordAuthEvent, tokenHash } from "./sql";

export async function hasMfa(pool: Pool, userId: string) {
  return (await pool.query("SELECT 1 FROM app_auth_mfa WHERE user_id=$1", [userId])).rowCount === 1;
}

export async function startMfaLogin(pool: Pool, userId: string, version: number) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO app_auth_mfa_login(token_hash,user_id,credential_version,expires_at) VALUES ($1,$2,$3,NOW()+interval '5 minutes')`,
    [tokenHash(token), userId, version],
  );
  return token;
}

async function acceptFactor(client: PoolClient, userId: string, code: string, key: Buffer, recoveryAllowed: boolean) {
  const factor = (await client.query<{
    encrypted_secret: string; last_step: string; recovery_hashes: string[]; blocked: boolean;
  }>(
    `SELECT encrypted_secret,last_step,recovery_hashes,
       coalesce(failed_attempts>=10 AND failure_until>NOW(), false) AS blocked
     FROM app_auth_mfa WHERE user_id=$1 FOR UPDATE`, [userId],
  )).rows[0];
  if (!factor || factor.blocked) return null;
  const codeHash = tokenHash(code.toLowerCase());
  const recovery = recoveryAllowed && /^[A-Fa-f0-9]{24}$/.test(code) && factor.recovery_hashes.includes(codeHash);
  const step = recovery ? null : totpStep(openTotpSeed(factor.encrypted_secret, key, userId), code, Number(factor.last_step));
  if (recovery || step !== null) {
    await client.query(
      `UPDATE app_auth_mfa SET last_step=coalesce($2,last_step), recovery_hashes=array_remove(recovery_hashes,$3),
       failed_attempts=0, failure_until=NULL WHERE user_id=$1`, [userId, step, recovery ? codeHash : null],
    );
    return recovery ? "recovery" : "totp";
  }
  await client.query(
    `UPDATE app_auth_mfa SET failed_attempts=CASE WHEN failure_until>NOW() THEN failed_attempts+1 ELSE 1 END,
       failure_until=CASE WHEN failure_until>NOW() THEN failure_until ELSE NOW()+interval '15 minutes' END WHERE user_id=$1`, [userId],
  );
  return null;
}

export async function finishMfaLogin(pool: Pool, key: Buffer, token: string, code: string, requestId: string) {
  return transaction(pool, async (client) => {
    const hash = tokenHash(token);
    const locked = (await client.query<{ id: string }>(
      `SELECT u.id FROM app_user u JOIN app_auth_mfa_login c ON c.user_id=u.id
       WHERE c.token_hash=$1 AND c.credential_version=u.credential_version AND u.status='active' FOR UPDATE OF u`, [hash],
    )).rows[0];
    if (!locked) return null;
    const updated = await client.query(
      "UPDATE app_auth_mfa_login SET attempts=attempts+1 WHERE token_hash=$1 AND expires_at>NOW() AND attempts<5", [hash],
    );
    if (!updated.rowCount) return null;
    const factor = await acceptFactor(client, locked.id, code, key, true);
    if (!factor) return null;
    await client.query("DELETE FROM app_auth_mfa_login WHERE token_hash=$1", [hash]);
    const session = await createSession(client, locked.id, "browser", Scopes, null, 1);
    await client.query(
      "UPDATE app_session SET mfa_verified_at=NOW(),mfa_step_up_at=CASE WHEN $2 THEN NOW() END WHERE id=$1",
      [session.id, factor === "totp"],
    );
    await recordAuthEvent(client, locked.id, factor === "totp" ? "auth.mfa.login" : "auth.mfa.recovery_used", requestId);
    return session;
  });
}

export async function requireRecentMfa(pool: Pool, actor: Actor, required: boolean) {
  const result = await pool.query(
    `SELECT 1 FROM app_session s WHERE s.id=$1 AND s.user_id=$2
       AND (s.mfa_step_up_at>NOW()-interval '5 minutes'
            OR (NOT $3::boolean AND NOT EXISTS (SELECT 1 FROM app_auth_mfa WHERE user_id=$2)))`,
    [actor.sessionId, actor.userId, required],
  );
  if (!result.rowCount) fail(403, "Recent administrator MFA verification required");
}

async function lockMfaActor(client: PoolClient, actor: Actor) {
  return (await client.query(
    `SELECT u.id FROM app_user u JOIN app_session s ON s.user_id=u.id
     WHERE u.id=$1 AND s.id=$2 AND u.status='active' AND s.credential_version=u.credential_version
       AND s.mfa_verified_at IS NOT NULL AND s.client_kind='browser' AND s.expires_at>NOW() FOR UPDATE OF u,s`,
    [actor.userId, actor.sessionId],
  )).rowCount === 1;
}

export async function stepUpMfa(pool: Pool, key: Buffer, actor: Actor, code: string, requestId: string) {
  return transaction(pool, async (client) => {
    if (!await lockMfaActor(client, actor) || !await acceptFactor(client, actor.userId, code, key, false)) return false;
    await client.query("UPDATE app_session SET mfa_step_up_at=NOW() WHERE id=$1", [actor.sessionId]);
    await recordAuthEvent(client, actor.userId, "auth.mfa.step_up", requestId);
    return true;
  });
}

export async function rotateRecoveryCodes(pool: Pool, actor: Actor, requestId: string) {
  const codes = Array.from({ length: 8 }, () => randomBytes(12).toString("hex"));
  await transaction(pool, async (client) => {
    if (!await lockMfaActor(client, actor)) fail(403, "MFA browser session required");
    const changed = await client.query(
      `UPDATE app_auth_mfa SET recovery_hashes=$2 WHERE user_id=$1
        AND EXISTS (SELECT 1 FROM app_session WHERE id=$3 AND mfa_step_up_at>NOW()-interval '5 minutes')`,
      [actor.userId, codes.map(tokenHash), actor.sessionId],
    );
    if (!changed.rowCount) fail(403, "Recent authenticator verification required");
    await recordAuthEvent(client, actor.userId, "auth.mfa.recovery_rotated", requestId);
  });
  return codes;
}

export async function provisionMfa(pool: Pool, userId: string, seed: Buffer, key: Buffer, step: number, recover: boolean) {
  return transaction(pool, async (client) => {
    const user = await client.query(
      "SELECT id FROM app_user WHERE id=$1 AND status='active' AND role IN ('admin','owner') FOR UPDATE", [userId],
    );
    if (!user.rowCount) fail(422, "Active administrator account required");
    const saved = await client.query(
      `INSERT INTO app_auth_mfa(user_id,encrypted_secret,last_step) VALUES ($1,$2,$3)
       ON CONFLICT (user_id) DO UPDATE SET encrypted_secret=$2,last_step=$3,recovery_hashes='{}',failed_attempts=0,failure_until=NULL
       WHERE $4`, [userId, sealTotpSeed(seed, key, userId), step, recover],
    );
    if (!saved.rowCount) fail(409, "Account already enrolled");
    await client.query("DELETE FROM app_auth_mfa_login WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM app_session WHERE user_id=$1 AND client_kind='browser'", [userId]);
    await recordAuthEvent(client, userId, recover ? "auth.mfa.recovered" : "auth.mfa.enrolled", "offline-mfa");
  });
}

export async function pruneMfaChallenges(pool: Pool) {
  await pool.query(
    `DELETE FROM app_auth_mfa_login WHERE token_hash IN (
      SELECT token_hash FROM app_auth_mfa_login WHERE expires_at<=NOW() ORDER BY expires_at LIMIT 500
    )`,
  );
}
