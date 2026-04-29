import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import type {
  BulkUpdateSubredditTargetsResponse,
  CollectionRunNowResponse,
  CreateSubredditTargetResponse,
  GetCollectionSettingsResponse,
  ListSubredditTargetsResponse,
  MaintenancePreviewResponse,
  MaintenancePruneResponse,
  UpdateCollectionSettingsResponse,
  UpdateSubredditTargetResponse,
} from "../../packages/contracts/src/http";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import {
  createApiTestRepositories,
  getJson,
  postJson,
  startServer,
  stopServer,
} from "./api-server.helpers";

async function seedOwner(repos: ReturnType<typeof createApiTestRepositories>) {
  const nowIso = "2026-04-29T10:00:00.000Z";
  const passwordHashingService = new PasswordHashingService();
  const userId = randomUUID();
  await repos.appUserRepository.create(
    {
      id: userId,
      email: "owner@example.com",
      displayName: "owner",
      role: "owner",
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      userId,
      passwordHash: await passwordHashingService.hashPassword("password-123"),
      passwordAlgo: passwordHashingService.passwordAlgo,
      updatedAt: nowIso,
    },
  );
}

async function login(baseUrl: string) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@example.com",
      password: "password-123",
    }),
  });
  return response.headers.get("set-cookie") ?? "";
}

function createFakeSqlDb() {
  return {
    async query<T>(text: string) {
      const makeResult = (rows: T[]) => ({
        command: "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows,
      });
      if (text.includes("COUNT(*)::int")) {
        return makeResult([{ count: 12 } as T]);
      }
      if (text.includes("DELETE FROM raw_reddit_event")) {
        return makeResult([{ id: 1 }, { id: 2 }] as T[]);
      }
      if (text.includes("DELETE FROM metrics_snapshot")) {
        return makeResult([{ target_id: "t1" }, { target_id: "t2" }] as T[]);
      }
      if (text.includes("DELETE FROM post_engagement_window")) {
        return makeResult([{ id: 1 }] as T[]);
      }
      return makeResult([]);
    },
  };
}

test("admin ops routes manage targets, collection settings, and maintenance actions", async () => {
  const repos = createApiTestRepositories();
  await seedOwner(repos);

  const server = createApiServer({
    repositories: repos,
    sqlDb: createFakeSqlDb(),
    createConnector: () => new RedditMockConnector(),
    auth: {
      bearerToken: "test-token",
    },
  });

  const baseUrl = await startServer(server);
  try {
    const cookie = await login(baseUrl);

    const createTarget = await postJson<CreateSubredditTargetResponse>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "datascience" },
      { cookie },
    );
    assert.equal(createTarget.status, 200);

    const listTargets = await getJson<ListSubredditTargetsResponse>(
      `${baseUrl}/v1/targets/subreddit`,
      { cookie },
    );
    assert.equal(listTargets.status, 200);
    assert.equal(listTargets.body.targets.length, 1);
    assert.equal(listTargets.body.targets[0]?.canonicalName, "r/datascience");

    const updateTargetResponse = await fetch(`${baseUrl}/v1/targets/subreddit/datascience`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        status: "paused",
        favorite: true,
        cadenceHours: 12,
        notes: "priority",
      }),
    });
    const updateTarget = await updateTargetResponse.json() as UpdateSubredditTargetResponse;
    assert.equal(updateTargetResponse.status, 200);
    assert.equal(updateTarget.target.status, "paused");
    assert.equal(updateTarget.target.favorite, true);
    assert.equal(updateTarget.target.cadenceHours, 12);

    const bulkUpdate = await postJson<BulkUpdateSubredditTargetsResponse>(
      `${baseUrl}/v1/targets/subreddit/bulk-update`,
      {
        canonicalNames: ["r/datascience"],
        patch: { status: "active", category: "ai" },
      },
      { cookie },
    );
    assert.equal(bulkUpdate.status, 200);
    assert.equal(bulkUpdate.body.targets[0]?.status, "active");
    assert.equal(bulkUpdate.body.targets[0]?.category, "ai");

    const getSettings = await getJson<GetCollectionSettingsResponse>(
      `${baseUrl}/v1/ops/collection/settings`,
      { cookie },
    );
    assert.equal(getSettings.status, 200);

    const patchSettingsResponse = await fetch(`${baseUrl}/v1/ops/collection/settings`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        defaultCadenceHours: 10,
        providerPreference: "http",
      }),
    });
    const patchSettings = await patchSettingsResponse.json() as UpdateCollectionSettingsResponse;
    assert.equal(patchSettingsResponse.status, 200);
    assert.equal(patchSettings.settings.defaultCadenceHours, 10);
    assert.equal(patchSettings.settings.providerPreference, "http");

    const runNow = await postJson<CollectionRunNowResponse>(
      `${baseUrl}/v1/ops/collection/run-now`,
      {
        subreddit: "datascience",
        crawlMode: "live",
        async: true,
      },
      { cookie },
    );
    assert.equal(runNow.status, 200);
    assert.deepEqual(runNow.body.requestedCanonicalNames, ["r/datascience"]);

    const preview = await getJson<MaintenancePreviewResponse>(
      `${baseUrl}/v1/ops/maintenance/preview`,
      { cookie },
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.items.length, 3);

    const dryRun = await postJson<MaintenancePruneResponse>(
      `${baseUrl}/v1/ops/maintenance/prune/raw-events`,
      {
        retentionDays: 7,
        dryRun: true,
      },
      { cookie },
    );
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.estimatedRows, 12);
  } finally {
    await stopServer(server);
  }
});
