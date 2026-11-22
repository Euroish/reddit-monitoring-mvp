import { Type } from "@sinclair/typebox";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  AccountEmailFinish, AccountEmailStart, AccountPasswordChange, AccountToken,
} from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";
import type { AccountEmailProvider, AccountEmailPurpose } from "./email-provider";
import { finishAccountEmail, replaceAccountPassword, reserveAccountEmail } from "./email-sql";
import { hashPassword, verifyLoginPassword } from "./password";
import { checkNewPassword } from "./password-policy";

export const accountPublicPosts = new Set([
  "/v1/auth/email/register/start", "/v1/auth/email/register/finish",
  "/v1/auth/email/reset/start", "/v1/auth/email/reset/finish", "/v1/auth/email/verify/finish",
]);

const challengeRate = {
  bodyLimit: 8192,
  config: { rateLimit: { max: 8, timeWindow: "15 minutes" } },
};

export async function emailRoutes(
  app: FastifyInstance, pool: Pool, provider: AccountEmailProvider,
  options: { publicRegistration: boolean; strongerPasswords?: boolean },
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const deliveries = new Set<Promise<void>>();
  app.addHook("onClose", async () => { await Promise.allSettled(deliveries); });
  async function send(purpose: AccountEmailPurpose, email: string, fields: { inviteCode?: string; userId?: string }) {
    if (deliveries.size >= 2) return { accepted: true };
    const reserved = await reserveAccountEmail(pool, purpose, email, { ...fields, publicRegistration: options.publicRegistration });
    if (reserved && deliveries.size < 2) {
      const warn = () => { app.log.warn({ event: "auth.transactional_email_unavailable", purpose }); };
      const delivery = provider.send(email, purpose, reserved.token, reserved.requestKey)
        .then((ok) => { if (!ok) warn(); }, warn)
        .finally(() => { deliveries.delete(delivery); });
      deliveries.add(delivery);
    }
    return { accepted: true };
  }

  for (const purpose of ["register", "reset"] as const) {
    api.post(`/v1/auth/email/${purpose}/start`, { ...challengeRate, schema: { body: AccountEmailStart } }, async ({ body }) => {
      if (!await provider.verify(body.proof, purpose)) fail(422, "Verification did not pass");
      return send(purpose, body.email.toLowerCase(), { inviteCode: purpose === "register" ? body.invite : undefined });
    });
    api.post(`/v1/auth/email/${purpose}/finish`, { ...challengeRate, schema: { body: AccountEmailFinish } }, async ({ body, id }) => {
      await finishAccountEmail(pool, purpose, body.token, id, { ...options, password: body.password });
      return { completed: true };
    });
  }
  api.post("/v1/auth/email/verify/start", {
    ...challengeRate,
    schema: { body: Type.Object({ proof: AccountEmailStart.properties.proof }, { additionalProperties: false }) },
  }, async ({ actor, body }) => {
    if (!await provider.verify(body.proof, "verify")) fail(422, "Verification did not pass");
    return send("verify", actor!.email, { userId: actor!.userId });
  });
  api.post("/v1/auth/email/verify/finish", {
    ...challengeRate,
    schema: { body: Type.Object({ token: AccountToken }, { additionalProperties: false }) },
  }, async ({ body, id }) => {
    await finishAccountEmail(pool, "verify", body.token, id);
    return { completed: true };
  });
  api.post("/v1/auth/password/change", { ...challengeRate, schema: { body: AccountPasswordChange } }, async ({ actor, body, id }) => {
    if (actor!.role !== "viewer") fail(403, "Privileged accounts require the administrator recovery process");
    checkNewPassword(body.password, actor!.email);
    const user = (await pool.query<{ credential_version: number; password_hash: string }>(
      `SELECT u.credential_version, p.password_hash FROM app_user u JOIN app_user_password p ON p.user_id=u.id
       JOIN app_session s ON s.user_id=u.id AND s.credential_version=u.credential_version
       WHERE u.id=$1 AND s.id=$2 AND u.role='viewer' AND u.status='active'`, [actor!.userId, actor!.sessionId],
    )).rows[0];
    if (!user || !await verifyLoginPassword(body.currentPassword, user.password_hash, Boolean(options.strongerPasswords)))
      fail(401, "Invalid current password");
    const hash = await hashPassword(body.password, options.strongerPasswords);
    await transaction(pool, async (client) => {
      const locked = await client.query(
        `SELECT id FROM app_user WHERE id=$1 AND credential_version=$2 AND role='viewer' AND status='active'
         AND EXISTS (SELECT 1 FROM app_session WHERE id=$3 AND user_id=$1 AND expires_at>NOW()) FOR UPDATE`,
        [actor!.userId, user.credential_version, actor!.sessionId],
      );
      if (!locked.rowCount) fail(401, "Session expired");
      await replaceAccountPassword(client, actor!.userId, hash, "auth.password_changed", id);
    });
    return { completed: true };
  });
}
