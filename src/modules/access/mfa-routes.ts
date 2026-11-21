import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import { MfaLoginFinish, MfaStepUp } from "../../../packages/contracts/src/source-content";
import { fail } from "../../storage/db";
import { finishMfaLogin, rotateRecoveryCodes, stepUpMfa } from "./mfa-sql";
import { findActor } from "./sql";

export const mfaLoginPath = "/v1/auth/mfa/complete";

export function isPrivilegedWrite(method: string, route: string) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return false;
  return route.startsWith("/v1/admin/") || route.startsWith("/v1/access/") ||
    route.startsWith("/v1/sources/credentials") || route.startsWith("/v1/quotas");
}

export async function mfaRoutes(app: FastifyInstance, pool: Pool, key: Buffer, cookie: (token: string) => string) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  const limits = { bodyLimit: 1024, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } };
  api.post(mfaLoginPath, { ...limits, schema: { body: MfaLoginFinish } }, async (request, reply) => {
    const session = await finishMfaLogin(pool, key, request.body.challenge, request.body.code, request.id);
    if (!session) fail(401, "Invalid or expired administrator verification");
    const user = await findActor(pool, session.token, "browser");
    if (!user) fail(401, "Invalid or expired administrator verification");
    reply.header("Set-Cookie", cookie(session.token));
    return { user };
  });
  api.post("/v1/auth/mfa/step-up", { ...limits, schema: { body: MfaStepUp } }, async ({ actor, body, id }) => {
    if (!await stepUpMfa(pool, key, actor!, body.code, id)) fail(403, "Invalid or reused authenticator code");
    return { verified: true };
  });
  api.post("/v1/auth/mfa/recovery-codes", limits, async ({ actor, id }) => ({
    codes: await rotateRecoveryCodes(pool, actor!, id),
  }));
}
