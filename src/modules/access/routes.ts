import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import {
  ActorSchema,
  Login,
  MachineKeyInput,
  Scopes,
  ParamsId,
} from "../../../packages/contracts/src/source-content";
import {
  createSession,
  findActor,
  hashPassword,
  tokenHash,
  verifyPassword,
} from "./sql";
import { fail, transaction } from "../../storage/db";

export async function accessRoutes(
  app: FastifyInstance,
  pool: Pool,
  cookie: (token: string) => string,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    "/v1/auth/session",
    {
      schema: {
        response: {
          200: Type.Object({ user: Type.Union([ActorSchema, Type.Null()]) }),
        },
      },
    },
    async (request) => ({ user: request.actor }),
  );
  api.post(
    "/v1/auth/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { body: Login },
    },
    async (request, reply) => {
      const row = (
        await pool.query(
          `SELECT u.id,u.status,p.password_hash FROM app_user u JOIN app_user_password p ON p.user_id=u.id WHERE u.email=$1`,
          [request.body.email.trim().toLowerCase()],
        )
      ).rows[0];
      const dummy = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;
      if (
        !(await verifyPassword(
          request.body.password,
          row?.password_hash ?? dummy,
        )) ||
        row?.status !== "active"
      )
        fail(401, "Invalid email or password");
      const session = await createSession(
        pool,
        row.id,
        "browser",
        Scopes,
        null,
        7,
      );
      reply.header("Set-Cookie", cookie(session.token));
      request.actor = await findActor(pool, session.token, "browser");
      return { user: request.actor };
    },
  );
  api.post(
    "/v1/auth/register",
    {
      schema: {
        body: Type.Composite([
          Login,
          Type.Object({
            invite: Type.String({ minLength: 1, maxLength: 256 }),
          }),
        ]),
      },
    },
    async (request) => {
      if (request.body.password.length < 12)
        fail(422, "Password must have at least 12 characters");
      const password = await hashPassword(request.body.password);
      return transaction(pool, async (client) => {
        const invite = (
          await client.query(
            "SELECT * FROM app_invite WHERE code_hash=$1 AND status='active' AND used_count<max_uses AND (expires_at IS NULL OR expires_at>NOW()) FOR UPDATE",
            [tokenHash(request.body.invite)],
          )
        ).rows[0];
        if (!invite) fail(403, "Invalid invitation");
        const id = randomUUID();
        await client.query(
          "INSERT INTO app_user(id,email,role,status) VALUES($1,$2,$3,'active')",
          [id, request.body.email.trim().toLowerCase(), invite.role_on_accept],
        );
        await client.query(
          "INSERT INTO app_user_password(user_id,password_hash,password_algo) VALUES($1,$2,'scrypt')",
          [id, password],
        );
        await client.query(
          "UPDATE app_invite SET used_count=used_count+1 WHERE id=$1",
          [invite.id],
        );
        return { registered: true };
      });
    },
  );
  api.post("/v1/auth/logout", async (request, reply) => {
    await pool.query("DELETE FROM app_session WHERE id=$1", [
      request.actor!.sessionId,
    ]);
    reply.header("Set-Cookie", `${cookie("")}; Max-Age=0`);
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
}
