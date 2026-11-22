import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import { ParamsId, strictMerge } from "../../../packages/contracts/src/common";
import {
  ActorSchema,
  Login,
  AccountEmailAddress,
  AccountInviteSummary,
  BrowserLogin,
  BrowserSession,
  MachineKeyInput,
  PlanTier,
  Scopes,
  type Actor,
} from "../../../packages/contracts/src/access";
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
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import type { AccountEmailProvider } from "./email-provider";
import { hasMfa, startMfaLogin } from "./mfa-sql";

export async function accessRoutes(
  app: FastifyInstance,
  pool: Pool,
  cookie: (token: string, maxAge?: number) => string,
  options: {
    publicRead?: boolean;
    publicRegistration?: boolean;
    strongerPasswords?: boolean;
    accountEmail?: { provider: AccountEmailProvider; publicRegistration: boolean };
    mfa?: { key: Buffer; required: boolean };
    limitLogin: (email: string) => number;
    validateSourceIds: (pool: Pool, ids: string[]) => Promise<boolean>;
  },
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    "/v1/auth/session",
    {
      config: { auth: { access: "public", browserOnly: true } },
      schema: {
        response: {
          200: Type.Object({
            user: Type.Union([ActorSchema, Type.Null()]),
            publicRead: Type.Boolean(),
            publicRegistration: Type.Boolean(),
            turnstileSiteKey: Type.Optional(Type.String()),
            mfaActive: Type.Optional(Type.Boolean()),
          }),
        },
      },
    },
    async (request) => ({
      user: request.actor,
      publicRead: Boolean(options.publicRead),
      publicRegistration: options.accountEmail?.publicRegistration ?? Boolean(options.publicRegistration),
      turnstileSiteKey: options.accountEmail?.provider.siteKey,
      mfaActive: options.mfa && request.actor ? await hasMfa(pool, request.actor.userId) : undefined,
    }),
  );
  api.post(
    "/v1/auth/login",
    {
      bodyLimit: 8 * 1024,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" }, auth: { access: "public", browserOnly: true, credentialSubmission: true } },
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
          `SELECT u.id,u.status,u.role,u.credential_version,p.password_hash,
             EXISTS (SELECT 1 FROM app_auth_mfa f WHERE f.user_id=u.id) AS enrolled
           FROM app_user u JOIN app_user_password p ON p.user_id=u.id WHERE u.email=$1`,
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
      if (row.enrolled) {
        if (!options.mfa) fail(503, "Authenticator temporarily unavailable");
        const challenge = await startMfaLogin(pool, row.id, row.credential_version);
        return reply.code(202).send({ mfaRequired: true, challenge });
      }
      if (options.mfa?.required && row.role !== "viewer") fail(403, "Administrator MFA enrollment required");
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
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" }, auth: { access: "public", browserOnly: true, credentialSubmission: true } },
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
      if (options.accountEmail) fail(403, "Use the email verification registration flow");
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
              `SELECT * FROM app_invite WHERE code_hash=$1 AND recipient_email IS NULL AND status='active'
               AND used_count<max_uses AND (expires_at IS NULL OR expires_at>NOW()) FOR UPDATE`,
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
  api.post("/v1/auth/logout", { bodyLimit: 8192, config: { auth: { access: "public", browserOnly: true } } }, async (request, reply) => {
    const actor = request.actor;
    if (actor) await revokeBrowserSessions(pool, actor, request.id, actor.sessionId);
    reply.header("Set-Cookie", cookie("", 0));
    return { loggedOut: true };
  });
  api.get("/v1/auth/sessions", {
    config: { auth: { access: "authenticated", browserOnly: true } },
    schema: { response: { 200: Type.Object({ sessions: Type.Array(BrowserSession) }) } },
  }, async (request) => ({ sessions: await listBrowserSessions(pool, request.actor!) }));
  api.delete("/v1/auth/sessions/:id", { config: { auth: { access: "viewer_write", browserOnly: true } }, schema: { params: ParamsId } }, async (request, reply) => {
    const actor = request.actor!;
    await revokeBrowserSessions(pool, actor, request.id, request.params.id);
    if (actor.sessionId === request.params.id) reply.header("Set-Cookie", cookie("", 0));
    return { revoked: true };
  });
  api.post("/v1/auth/logout-all", { bodyLimit: 8192, config: { auth: { access: "viewer_write", browserOnly: true } } }, async (request, reply) => {
    await revokeBrowserSessions(pool, request.actor!, request.id);
    reply.header("Set-Cookie", cookie("", 0));
    return { loggedOut: true };
  });
  api.get("/v1/access/keys", { config: { auth: { access: "authenticated" } } }, async (request) => {
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
      config: { auth: { access: "admin_mfa" } },
      schema: {
        body: Type.Object(
          { role: Type.Union([Type.Literal("viewer"), Type.Literal("admin")]), email: Type.Optional(AccountEmailAddress) },
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
      const email = request.body.email?.toLowerCase();
      if (options.accountEmail && !email) fail(422, "Recipient email is required");
      if (email && !options.accountEmail) fail(403, "Email-bound invitations are disabled");
      const code = randomUUID() + randomUUID();
      await transaction(pool, async (client) => {
        await client.query(
          `INSERT INTO app_invite(id,code_hash,status,role_on_accept,max_uses,expires_at,recipient_email)
           VALUES($1,$2,'active',$3,1,NOW()+interval '7 days',$4)`,
          [randomUUID(), tokenHash(code), request.body.role, email ?? null],
        );
        await recordAuthEvent(client, actor.userId, "auth.invite.created", request.id);
      });
      return { code };
    },
  );
  api.get("/v1/access/invites", {
    config: { auth: { access: "admin" } },
    schema: { response: { 200: Type.Object({ invites: Type.Array(AccountInviteSummary) }) } },
  }, async ({ actor }) => {
    if (actor!.role === "viewer") fail(403, "Administrator access required");
    const invites = await pool.query(
      `SELECT id, role_on_accept AS role, recipient_email IS NOT NULL AS "emailBound", expires_at AS "expiresAt",
         CASE WHEN status='disabled' THEN 'disabled' WHEN used_count>=max_uses THEN 'used'
              WHEN expires_at<=NOW() THEN 'expired' ELSE 'active' END AS status
       FROM app_invite WHERE role_on_accept IN ('viewer','admin') AND ($1 OR role_on_accept='viewer')
       ORDER BY created_at DESC,id LIMIT 50`, [actor!.role === "owner"],
    );
    return { invites: invites.rows };
  });
  api.delete("/v1/access/invites/:id", { config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId } }, async ({ actor, id, params }) => {
    if (actor!.role === "viewer") fail(403, "Administrator access required");
    await transaction(pool, async (client) => {
      const result = await client.query(
        `UPDATE app_invite SET status='disabled' WHERE id=$1 AND status='active'
         AND role_on_accept IN ('viewer','admin') AND ($2 OR role_on_accept='viewer')`, [params.id, actor!.role === "owner"],
      );
      if (result.rowCount) await recordAuthEvent(client, actor!.userId, "auth.invite.revoked", id);
    });
    return { revoked: true };
  });
  api.post(
    "/v1/access/keys",
    { config: { auth: { access: "admin_mfa" } }, schema: { body: MachineKeyInput } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser" || actor.role === "viewer")
        fail(403, "Administrator browser session required");
      const { allowedSourceIds, scopes, expiresInDays, label } = request.body;
      if (scopes.includes("ingest") && !allowedSourceIds.length) fail(422, "Ingest keys require allowed sources");
      if (!(await options.validateSourceIds(pool, allowedSourceIds)))
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
    { config: { auth: { access: "admin_mfa" } }, schema: { params: ParamsId } },
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
  api.get("/v1/access/users", { config: { auth: { access: "admin" } } }, async (request) => {
    const actor = request.actor!;
    if (actor.clientKind !== "browser" || actor.role === "viewer")
      fail(403, "Administrator browser session required");
    return { users: await listUsers(pool) };
  });
  api.patch(
    "/v1/access/users/:id",
    {
      config: { auth: { access: "admin_mfa" } },
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
  api.get("/v1/access/audit", { config: { auth: { access: "admin" } } }, async (request) => {
    const actor = request.actor!;
    if (actor.clientKind !== "browser" || actor.role === "viewer")
      fail(403, "Administrator browser session required");
    return { events: await listAccessAudit(pool) };
  });
}
