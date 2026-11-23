import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import type { AccountEmailPurpose } from "./email-provider";
import { hashPassword } from "./password";
import { checkNewPassword } from "./password-policy";
import { recordAuthEvent, tokenHash } from "./sql";

type Challenge = {
  email: string;
  user_id: string | null;
  credential_version: number | null;
  invite_id: string | null;
};

async function eligibleInvite(client: PoolClient, email: string, codeHash?: string, id?: string) {
  return (await client.query<{ id: string; role_on_accept: "viewer" | "admin" }>(
    `SELECT id,role_on_accept FROM app_invite
     WHERE ($1::text IS NULL OR code_hash=$1) AND ($2::uuid IS NULL OR id=$2)
       AND status='active' AND used_count<max_uses AND (expires_at IS NULL OR expires_at>NOW())
       AND role_on_accept IN ('viewer','admin') AND (recipient_email IS NULL OR recipient_email=$3)
     FOR UPDATE`,
    [codeHash ?? null, id ?? null, email],
  )).rows[0];
}

export async function reserveAccountEmail(
  pool: Pool, purpose: AccountEmailPurpose, email: string,
  options: { inviteCode?: string; publicRegistration?: boolean; userId?: string } = {},
) {
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(728419,3)");
    const budget = (await client.query<{ daily: number; recipient: number; cooldown: boolean }>(
      `SELECT count(*)::int AS daily,
         count(*) FILTER (WHERE email=$1)::int AS recipient,
         coalesce(bool_or(email=$1 AND created_at>NOW()-interval '2 minutes'), false) AS cooldown
       FROM app_auth_challenge WHERE created_at>NOW()-interval '24 hours'`, [email],
    )).rows[0];
    if (budget.daily >= 100 || budget.recipient >= 3 || budget.cooldown) return null;
    const user = (await client.query<{
      id: string; role: string; status: string; credential_version: number; email_verified_at: Date | null;
    }>("SELECT id,role,status,credential_version,email_verified_at FROM app_user WHERE email=$1", [email])).rows[0];
    let inviteId: string | null = null;
    if (purpose === "register") {
      if (user) return null;
      if (options.inviteCode) {
        const invite = await eligibleInvite(client, email, tokenHash(options.inviteCode));
        if (!invite) return null;
        inviteId = invite.id;
      } else if (!options.publicRegistration) return null;
    } else {
      if (!user || user.status !== "active") return null;
      if (purpose === "reset" && (user.role !== "viewer" || !user.email_verified_at)) return null;
      if (purpose === "verify" && (user.id !== options.userId || user.email_verified_at)) return null;
    }
    await client.query(
      `INSERT INTO app_auth_challenge(token_hash,purpose,email,user_id,credential_version,invite_id,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()+interval '15 minutes')`,
      [hash, purpose, email, user?.id ?? null, user?.credential_version ?? null, inviteId],
    );
    return { token, requestKey: "account-email-" + hash };
  });
}

export async function finishAccountEmail(
  pool: Pool, purpose: AccountEmailPurpose, token: string, requestId: string,
  options: { password?: string; strongerPasswords?: boolean; publicRegistration?: boolean } = {},
) {
  const hash = tokenHash(token);
  const filter = "token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at>NOW()";
  const candidate = (await pool.query<Pick<Challenge, "email">>(
    `SELECT email FROM app_auth_challenge WHERE ${filter}`, [hash, purpose],
  )).rows[0];
  if (!candidate) fail(422, "Invalid or expired account link");
  let passwordHash: string | undefined;
  if (options.password !== undefined) {
    checkNewPassword(options.password, candidate.email);
    passwordHash = await hashPassword(options.password, options.strongerPasswords);
  }
  return transaction(pool, async (client) => {
    const challenge = (await client.query<Challenge>(
      `UPDATE app_auth_challenge SET consumed_at=NOW() WHERE ${filter} RETURNING email,user_id,credential_version,invite_id`,
      [hash, purpose],
    )).rows[0];
    if (!challenge) fail(422, "Invalid or expired account link");
    if (purpose === "register") {
      const invite = challenge.invite_id ? await eligibleInvite(client, challenge.email, undefined, challenge.invite_id) : undefined;
      if (challenge.invite_id ? !invite : !options.publicRegistration) fail(422, "Invalid or expired account link");
      const userId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO app_user(id,email,role,status,email_verified_at)
         VALUES($1,$2,$3,'active',NOW()) ON CONFLICT (email) DO NOTHING`,
        [userId, challenge.email, invite?.role_on_accept ?? "viewer"],
      );
      if (inserted.rowCount !== 1) fail(422, "Invalid or expired account link");
      await client.query(
        "INSERT INTO app_user_password(user_id,password_hash,password_algo) VALUES($1,$2,'scrypt')", [userId, passwordHash],
      );
      if (invite) await client.query("UPDATE app_invite SET used_count=used_count+1 WHERE id=$1", [invite.id]);
      await recordAuthEvent(client, userId, "auth.email_registered", requestId);
      return;
    }
    const account = (await client.query<{ id: string; role: string; email_verified_at: Date | null }>(
      `SELECT id,role,email_verified_at FROM app_user
       WHERE id=$1 AND email=$2 AND credential_version=$3 AND status='active' FOR UPDATE`,
      [challenge.user_id, challenge.email, challenge.credential_version],
    )).rows[0];
    if (!account) fail(422, "Invalid or expired account link");
    if (purpose === "verify") {
      await client.query("UPDATE app_user SET email_verified_at=coalesce(email_verified_at,NOW()) WHERE id=$1", [account.id]);
      await recordAuthEvent(client, account.id, "auth.email_verified", requestId);
    } else {
      if (account.role !== "viewer" || !account.email_verified_at) fail(422, "Invalid or expired account link");
      await replaceAccountPassword(client, account.id, passwordHash!, "auth.password_reset", requestId);
    }
  });
}

export async function replaceAccountPassword(
  client: PoolClient, userId: string, hash: string,
  action: "auth.password_reset" | "auth.password_changed", requestId: string,
) {
  await client.query("UPDATE app_user_password SET password_hash=$2,updated_at=NOW() WHERE user_id=$1", [userId, hash]);
  await client.query("UPDATE app_user SET credential_version=credential_version+1, updated_at=NOW() WHERE id=$1", [userId]);
  await client.query("DELETE FROM app_session WHERE user_id=$1", [userId]);
  await recordAuthEvent(client, userId, action, requestId);
}

export async function pruneAccountEmail(pool: Pool) {
  await pool.query(
    `DELETE FROM app_auth_challenge WHERE token_hash IN (
       SELECT token_hash FROM app_auth_challenge WHERE created_at<NOW()-interval '25 hours' ORDER BY created_at LIMIT 500
     )`,
  );
}
