import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import {
  strictMerge,
  ActorSchema,
  Login,
  BrowserLogin,
  BrowserSession,
  MachineKeyInput,
  PlanTier,
  Scopes,
  ParamsId,
  type Actor,
} from "../../../packages/contracts/src/source-content";
import {
  createSession,
  createLoginSession,
  findActor,
  hashPassword,
  listAccessAudit,
  listBrowserSessions,
  revokeBrowserSessions,
  recordAuthEvent,
  listUsers,
  tokenHash,
  updateUserAccess,
} from "./sql";
import { dummyPasswordHash, isCurrentPasswordHash, verifyLoginPassword } from "./password";
import { fail, transaction } from "../../storage/db";

export async function accessRoutes(
  app: FastifyInstance,
  pool: Pool,
  cookie: (token: string, maxAge?: number) => string,
  options: {
    publicRead?: boolean;
    publicRegistration?: boolean;
    strongerPasswords?: boolean;
    limitLogin: (email: string) => number;
  },
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    "/v1/auth/session",
    {
      schema: {
        response: {
          200: Type.Object({
            user: Type.Union([ActorSchema, Type.Null()]),
            publicRead: Type.Boolean(),
            publicRegistration: Type.Boolean(),
          }),
        },
      },
    },
    async (request) => ({
      user: request.actor,
      publicRead: Boolean(options.publicRead),
      publicRegistration: Boolean(options.publicRegistration),
    }),
  );
  api.post(
    "/v1/auth/login",
    {
      bodyLimit: 8 * 1024,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { body: BrowserLogin },
    },
    async (request, reply) => {
      const email = request.body.email.trim().toLowerCase();
      const retryAfter = options.limitLogin(email);
      if (retryAfter) {
        reply.header("Retry-After", retryAfter);
        fail(429, "Too many login attempts");
      }
      const row = (
        await pool.query(
          `SELECT u.id,u.status,u.credential_version,p.password_hash FROM app_user u JOIN app_user_password p ON p.user_id=u.id WHERE u.email=$1`,
          [email],
        )
      ).rows[0];
      if (
        !(await verifyLoginPassword(
          request.body.password,
          row?.password_hash ?? dummyPasswordHash(),
          Boolean(options.strongerPasswords),
        )) ||
        row?.status !== "active"
      ) {
        request.log.info({ event: "auth.login.rejected" });
        fail(401, "Invalid email or password");
      }
      const rehash = options.strongerPasswords && !isCurrentPasswordHash(row.password_hash)
        ? { previous: row.password_hash, next: await hashPassword(request.body.password, true) }
        : undefined;
      const session = await createLoginSession(
        pool, row.id, row.credential_version, Scopes, request.body.remember, rehash, request.id,
      );
      request.actor = await findActor(pool, session.token, "browser");
      if (!request.actor) fail(401, "Invalid email or password");
      reply.header("Set-Cookie", cookie(session.token, session.maxAge));
      return { user: request.actor };
    },
  );
  api.post(
    "/v1/auth/register",
    {
      bodyLimit: 8 * 1024,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        body: strictMerge([
          Login,
          Type.Object({
            invite: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
          }),
        ]),
      },
    },
    async (request, reply) => {
      if (request.body.password.length < 12)
        fail(422, "Password must have at least 12 characters");
      const inviteCode = request.body.invite;
      if (!inviteCode && !options.publicRegistration)
        fail(403, "Invitation required");
      const email = request.body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+$/.test(email)) fail(422, "Invalid email address");
      const password = await hashPassword(request.body.password, options.strongerPasswords);
      const outcome = await transaction(pool, async (client) => {
        let role: Actor["role"] = "viewer";
        let inviteId: string | null = null;
        if (inviteCode) {
          const invite = (
            await client.query(
              "SELECT * FROM app_invite WHERE code_hash=$1 AND status='active' AND used_count<max_uses AND (expires_at IS NULL OR expires_at>NOW()) FOR UPDATE",
              [tokenHash(inviteCode)],
            )
          ).rows[0];
          if (!invite) fail(403, "Invalid invitation");
          role = invite.role_on_accept;
          inviteId = invite.id;
        }
        const id = randomUUID();
        try {
          await client.query(
            "INSERT INTO app_user(id,email,role,status) VALUES($1,$2,$3,'active')",
            [id, email, role],
          );
        } catch (error) {
          if ((error as { code?: string }).code === "23505")
            fail(409, "Email already registered");
          throw error;
        }
        await client.query(
          "INSERT INTO app_user_password(user_id,password_hash,password_algo) VALUES($1,$2,'scrypt')",
          [id, password],
        );
        if (inviteId) {
          await client.query(
            "UPDATE app_invite SET used_count=used_count+1 WHERE id=$1",
            [inviteId],
          );
          await recordAuthEvent(client, id, "auth.invite.accepted", request.id);
          return null;
        }
        const session = await createSession(client, id, "browser", Scopes, null, 1);
        const actor: Actor = {
          sessionId: session.id,
          userId: id,
          email,
          role: "viewer",
          planTier: "free",
          clientKind: "browser",
          scopes: [...Scopes],
          allowedSourceIds: null,
        };
        return { token: session.token, actor };
      });
      if (!outcome) return { registered: true };
      reply.header("Set-Cookie", cookie(outcome.token));
      request.actor = outcome.actor;
      return { registered: true, user: outcome.actor };
    },
  );
  api.post("/v1/auth/logout", { bodyLimit: 8192 }, async (request, reply) => {
    const actor = request.actor;
    if (actor) await revokeBrowserSessions(pool, actor, request.id, actor.sessionId);
    reply.header("Set-Cookie", cookie("", 0));
    return { loggedOut: true };
  });
  api.get("/v1/auth/sessions", {
    schema: { response: { 200: Type.Object({ sessions: Type.Array(BrowserSession) }) } },
  }, async (request) => ({ sessions: await listBrowserSessions(pool, request.actor!) }));
  api.delete("/v1/auth/sessions/:id", { schema: { params: ParamsId } }, async (request, reply) => {
    const actor = request.actor!;
    await revokeBrowserSessions(pool, actor, request.id, request.params.id);
    if (actor.sessionId === request.params.id) reply.header("Set-Cookie", cookie("", 0));
    return { revoked: true };
  });
  api.post("/v1/auth/logout-all", { bodyLimit: 8192 }, async (request, reply) => {
    await revokeBrowserSessions(pool, request.actor!, request.id);
    reply.header("Set-Cookie", cookie("", 0));
    return { loggedOut: true };
  });
  api.get("/v1/access/keys", async (request) => {
    if (request.actor!.clientKind !== "browser")
      fail(403, "Browser session required");
    return {
      keys: (
        await pool.query(
          "SELECT id,label,scopes,allowed_source_ids,expires_at FROM app_session WHERE user_id=$1 AND client_kind='machine' ORDER BY created_at DESC",
          [request.actor!.userId],
        )
      ).rows,
    };
  });
  api.post(
    "/v1/access/invites",
    {
      schema: {
        body: Type.Object(
          { role: Type.Union([Type.Literal("viewer"), Type.Literal("admin")]) },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const actor = request.actor!;
      if (
        actor.clientKind !== "browser" ||
        actor.role === "viewer" ||
        (request.body.role === "admin" && actor.role !== "owner")
      )
        fail(403, "Owner required to invite administrators");
      const code = randomUUID() + randomUUID();
      await pool.query(
        "INSERT INTO app_invite(id,code_hash,status,role_on_accept,max_uses,expires_at) VALUES($1,$2,'active',$3,1,NOW()+interval '7 days')",
        [randomUUID(), tokenHash(code), request.body.role],
      );
      return { code };
    },
  );
  api.post(
    "/v1/access/keys",
    { schema: { body: MachineKeyInput } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser" || actor.role === "viewer")
        fail(403, "Administrator browser session required");
      const { allowedSourceIds, scopes, expiresInDays, label } = request.body;
      if (scopes.includes("ingest") && !allowedSourceIds.length) fail(422, "Ingest keys require allowed sources");
      const count = (
        await pool.query(
          "SELECT COUNT(*) FROM collection_source WHERE id=ANY($1::uuid[])",
          [allowedSourceIds],
        )
      ).rows[0].count;
      if (Number(count) !== new Set(allowedSourceIds).size)
        fail(422, "Unknown allowed source");
      return createSession(
        pool,
        actor.userId,
        "machine",
        scopes,
        allowedSourceIds,
        expiresInDays,
        label,
      );
    },
  );
  api.delete(
    "/v1/access/keys/:id",
    { schema: { params: ParamsId } },
    async (request) => {
      if (request.actor!.clientKind !== "browser")
        fail(403, "Browser session required");
      await pool.query(
        "DELETE FROM app_session WHERE id=$1 AND user_id=$2 AND client_kind='machine'",
        [request.params.id, request.actor!.userId],
      );
      return { revoked: true };
    },
  );
  api.get("/v1/access/users", async (request) => {
    const actor = request.actor!;
    if (actor.clientKind !== "browser" || actor.role === "viewer")
      fail(403, "Administrator browser session required");
    return { users: await listUsers(pool) };
  });
  api.patch(
    "/v1/access/users/:id",
    {
      schema: {
        params: ParamsId,
        body: Type.Object(
          {
            role: Type.Optional(Type.Union([Type.Literal("admin"), Type.Literal("viewer")])),
            status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("disabled")])),
            planTier: Type.Optional(PlanTier),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
      },
    },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser" || actor.role === "viewer")
        fail(403, "Administrator browser session required");
      return { user: await updateUserAccess(pool, actor, request.params.id, request.body) };
    },
  );
  api.get("/v1/access/audit", async (request) => {
    const actor = request.actor!;
    if (actor.clientKind !== "browser" || actor.role === "viewer")
      fail(403, "Administrator browser session required");
    return { events: await listAccessAudit(pool) };
  });
}
