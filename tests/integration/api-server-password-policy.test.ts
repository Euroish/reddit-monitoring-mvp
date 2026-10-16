import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories, postJson, startServer, stopServer } from "./api-server.helpers";
import type { ApiErrorResponse, AuthLoginResponse, CreateInviteResponse, RegisterAppUserResponse, UpdateAppUserStatusResponse } from "../../packages/contracts/src/http";

test("HTTP registration enforces new password boundaries before consuming an invitation and preserves accepted credentials", async () => {
  const server = createApiServer({ repositories: createApiTestRepositories(), createConnector: () => new RedditMockConnector(),
    auth: { bearerToken: "synthetic-policy-machine" }, logger: () => {} });
  const base = await startServer(server), machine = { authorization: "Bearer synthetic-policy-machine" };
  try {
    const invite = await postJson<CreateInviteResponse>(`${base}/auth/invites`, { roleOnAccept: "viewer", maxUses: 2 }, machine);
    assert.equal(invite.status, 201);
    for (const password of ["x".repeat(11), "x".repeat(129)]) {
      const rejected = await postJson<ApiErrorResponse>(`${base}/auth/register`, { email: "rejected@example.test", password, inviteCode: invite.body.code });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.errorCode, "invalid_register_request");
      assert.equal(JSON.stringify(rejected.body).includes(password), false);
    }
    for (const [index, password] of [" twelvechar ", ` ${"x".repeat(126)} `].entries()) {
      const email = `boundary-${index}@example.test`;
      const registered = await postJson<RegisterAppUserResponse>(`${base}/auth/register`, { email, password, inviteCode: invite.body.code });
      assert.equal(registered.status, 201);
      const activated = await postJson<UpdateAppUserStatusResponse>(`${base}/auth/users/${registered.body.user.id}/activate`, {}, machine);
      assert.equal(activated.status, 200);
      assert.equal((await postJson<AuthLoginResponse>(`${base}/auth/login`, { email, password })).status, 200);
      assert.equal((await postJson<ApiErrorResponse>(`${base}/auth/login`, { email, password: password.trim() })).status, 401);
    }
  } finally { await stopServer(server); }
});
