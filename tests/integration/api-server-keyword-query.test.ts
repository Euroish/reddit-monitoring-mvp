import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  createApiTestRepositories,
  getJson,
  postJson,
  startServer,
  stopServer,
} from "./api-server.helpers";

test("api server can create and fetch keyword query session", async () => {
  const fixedNow = "2026-04-12T12:00:00.000Z";
  const repos = createApiTestRepositories();

  await repos.postSearchDocumentRepository.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:t3_keyword_a"),
      targetId: stableUuidFromString("reddit:target:r/datascience"),
      canonicalSubreddit: "r/datascience",
      title: "LLM agent benchmark for production workflows",
      bodySnippet: "A detailed benchmark for multi-agent orchestration and RAG evaluations.",
      permalink: "/r/datascience/comments/keyword_a",
      createdAtSource: "2026-04-11T10:00:00.000Z",
    },
    {
      contentId: stableUuidFromString("reddit:content:t3_keyword_b"),
      targetId: stableUuidFromString("reddit:target:r/machinelearning"),
      canonicalSubreddit: "r/machinelearning",
      title: "Prompt engineering patterns for LLM applications",
      bodySnippet: "Practical pattern collection with evaluation setup.",
      permalink: "/r/machinelearning/comments/keyword_b",
      createdAtSource: "2026-04-11T11:00:00.000Z",
    },
  ]);

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const created = await postJson<{
      ok: boolean;
      result: {
        queryId: string;
        status: string;
        supportCount: number;
        coverageLevel: string;
        sourceType: {
          primary: string;
        };
        dataQuality: {
          level: string;
        };
        samplePosts: Array<{ canonicalSubreddit: string; sourceType: string }>;
        pulsePoints5m: Array<{ sourceType: string }>;
      };
    }>(`${baseUrl}/v1/keyword-queries`, {
      query: "LLM agent",
      limit: 5,
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.ok, true);
    assert.equal(created.body.result.status, "initial_ready");
    assert.equal(created.body.result.supportCount >= 1, true);
    assert.equal(["low", "medium", "high"].includes(created.body.result.coverageLevel), true);
    assert.equal(["index", "live", "backfill"].includes(created.body.result.sourceType.primary), true);
    assert.equal(["low", "medium", "high"].includes(created.body.result.dataQuality.level), true);
    assert.equal(created.body.result.samplePosts.length >= 1, true);
    assert.equal(created.body.result.samplePosts[0]?.sourceType, "index");
    assert.equal(created.body.result.pulsePoints5m.length >= 1, true);

    const fetched = await getJson<{
      ok: boolean;
      result: {
        queryId: string;
        queryText: string;
        dataQuality: {
          level: string;
        };
        samplePosts: Array<{ canonicalSubreddit: string; sourceType: string }>;
        pulsePoints5m: Array<{ sourceType: string }>;
      };
    }>(`${baseUrl}/v1/keyword-queries/${created.body.result.queryId}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.ok, true);
    assert.equal(fetched.body.result.queryId, created.body.result.queryId);
    assert.equal(fetched.body.result.queryText, "LLM agent");
    assert.equal(["low", "medium", "high"].includes(fetched.body.result.dataQuality.level), true);
    assert.equal(fetched.body.result.samplePosts.length >= 1, true);
    assert.equal(fetched.body.result.pulsePoints5m.length >= 1, true);
  } finally {
    await stopServer(server);
  }
});
