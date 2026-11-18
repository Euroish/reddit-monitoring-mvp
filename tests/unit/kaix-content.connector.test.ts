import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { resolveKaixConfig } from "../../src/connectors/reddit/kaix.config";
import type {
  CollectionSource,
  JsonValue,
} from "../../packages/contracts/src/source-content";

const now = "2026-11-16T12:00:00.000Z";
export function sourceFixture(
  overrides: Partial<CollectionSource> = {},
): CollectionSource {
  return {
    id: randomUUID(),
    platform: "reddit",
    primaryProvider: "kaix",
    fallbackProvider: null,
    deliveryMode: "pull",
    label: "Fixture",
    target: { type: "search", query: "OpenAI OR Anthropic" },
    contentKind: "post",
    state: "active",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    coverage: "partial",
    ...overrides,
  };
}
const root = {
  type: "post",
  id: "root123",
  fullName: "t3_root123",
  subreddit: "fixture",
  title: "OpenAI research",
  selftext: "A native OR match",
  createdUtc: Date.parse("2026-11-15T00:00:00Z") / 1000,
};
const comment = {
  type: "comment",
  id: "19riqx8r047lt",
  fullName: "t1_19riqx8r047lt",
  parentId: "t3_root123",
  linkId: "t3_root123",
  subreddit: "fixture",
  body: "[deleted]",
  createdUtc: root.createdUtc,
};
function fixture(responses: unknown[]) {
  const requests: { url: URL; input?: Record<string, unknown> }[] = [];
  const connector = new KaixContentConnector(
    { networkEnabled: true, apiToken: "synthetic-token" },
    async (input, init) => {
      requests.push({
        url: new URL(String(input)),
        input: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer synthetic-token",
      );
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : Response.json(response);
    },
    () => now,
  );
  let state: JsonValue = { phase: "starting" };
  const execution = () => ({
    state,
    saveState: async (value: JsonValue) => {
      state = value;
    },
  });
  return { connector, requests, execution };
}
const receipt = (status: string) => ({
  data: { id: "fixtureRun", defaultDatasetId: "fixtureDataset", status },
});

test("paid kaix run persists identifiers, polls without another POST and keeps native OR matches", async () => {
  const f = fixture([receipt("RUNNING"), receipt("SUCCEEDED"), [root]]);
  const request = {
    source: sourceFixture(),
    from: "2026-11-14T00:00:00Z",
    to: now,
    limit: 300,
    checkpoint: null,
  };
  assert.equal(
    (await f.connector.collectPage({ ...request, execution: f.execution() }))
      .pending,
    true,
  );
  assert.deepEqual(f.execution().state, {
    phase: "running",
    runId: "fixtureRun",
    datasetId: "fixtureDataset",
  });
  const page = await f.connector.collectPage({
    ...request,
    execution: f.execution(),
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.coverage, "partial");
  assert.equal(f.requests.filter((item) => item.input).length, 1);
  assert.equal(f.requests[0].input!.keyword, "OpenAI OR Anthropic");
  assert.equal(f.requests[0].url.searchParams.get("build"), "0.2.25");
  for (const field of ["memory", "timeout", "maxTotalChargeUsd"])
    assert.equal(f.requests[0].url.searchParams.has(field), false);
  assert.equal(f.requests[0].input!.maxItems, 300);
});

test("kaix root/comment hydration retains old context, long IDs and deletion markers", async () => {
  const reply = {
    ...comment,
    id: "reply123",
    fullName: "t1_reply123",
    parentId: comment.fullName,
    body: "Nested reply",
  };
  const f = fixture([receipt("SUCCEEDED"), [root, comment, reply]]);
  const page = await f.connector.collectPage({
    source: sourceFixture({
      contentKind: "comment",
      target: { type: "post", postId: "root123" },
    }),
    from: now,
    to: "2026-11-17T00:00:00Z",
    limit: 50,
    maxCommentsPerPost: 2,
    checkpoint: null,
    execution: f.execution(),
  });
  assert.equal(page.items.length, 3);
  assert.deepEqual(f.requests[0].input!.postUrls, [root.fullName]);
  assert.equal(f.requests[0].input!.commentSort, "top");
  assert.equal(f.requests[0].input!.maxCommentsPerPost, 2);
  assert.equal(f.requests[0].input!.maxItems, undefined);
  assert.equal(f.requests[1].url.searchParams.get("limit"), "4");
  assert.equal(page.items[0].kind, "post");
  assert.equal(page.items[1].externalId, "t1_19riqx8r047lt");
  assert.equal(page.items[1].availability, "deleted");
  assert.equal(page.items[1].text, null);
  assert.deepEqual(
    page.items[1].references.map((reference) => reference.relation),
    ["reply_to", "thread_root"],
  );
  assert.deepEqual(page.items[2].references, [
    { kind: "comment", externalId: comment.fullName, relation: "reply_to" },
    { kind: "post", externalId: root.fullName, relation: "thread_root" },
  ]);
});

test("precise discovery can include comments; sparse dataset rereads retain stable evidence", async () => {
  const f = fixture([receipt("SUCCEEDED"), [root, comment]]),
    source = sourceFixture();
  const request = {
    source,
    from: "2026-11-14T00:00:00Z",
    to: now,
    limit: 25,
    checkpoint: null,
    includeComments: true,
    maxCommentsPerPost: 15,
  };
  const page = await f.connector.collectPage({
    ...request,
    execution: f.execution(),
  });
  assert.equal(page.items.length, 2);
  assert.equal(f.requests[0].input!.includeComments, true);
  const reread = fixture([
    receipt("SUCCEEDED"),
    [Object.fromEntries(Object.entries(root).reverse()), comment],
  ]);
  const again = await reread.connector.collectPage({
    ...request,
    execution: reread.execution(),
  });
  assert.equal(
    page.items[0].observation.evidenceKey,
    again.items[0].observation.evidenceKey,
  );
});

test("kaix retains the root without exhausting a comment request that returned no comments", async () => {
  const f = fixture([receipt("SUCCEEDED"), [{ ...root, numComments: 7 }]]);
  const page = await f.connector.collectPage({
    source: sourceFixture({
      target: { type: "post", postId: root.fullName },
      contentKind: "comment",
    }),
    from: "2026-11-14T00:00:00Z",
    to: now,
    limit: 10,
    checkpoint: null,
    execution: f.execution(),
  });
  assert.deepEqual(page.items.map(item => item.externalId), [root.fullName]);
  assert.equal(page.exhausted, false);
  assert.match(page.warning ?? "", /no comment records/);
  assert.equal(f.requests.filter(request => request.input).length, 1);
});

test("ambiguous paid failures never retry and invalid bounds or missing durable state never start a run", async () => {
  for (const response of [
    new Error("interrupted"),
    new Response("private upstream data", { status: 429 }),
    receipt("FAILED"),
  ]) {
    const f = fixture([response]),
      request = {
        source: sourceFixture(),
        from: "2026-11-14T00:00:00Z",
        to: now,
        limit: 25,
        checkpoint: null,
      };
    await assert.rejects(
      f.connector.collectPage({ ...request, execution: f.execution() }),
    );
    assert.equal(f.requests.length, 1);
  }
  const f = fixture([]),
    request = {
      source: sourceFixture(),
      from: "2026-11-14T00:00:00Z",
      to: now,
      limit: 25,
      checkpoint: null,
    };
  await assert.rejects(f.connector.collectPage(request), /durable/);
  await assert.rejects(
    f.connector.collectPage({
      ...request,
      limit: 301,
      execution: f.execution(),
    }),
    /1–300/,
  );
  await assert.rejects(
    f.connector.collectPage({
      ...request,
      limit: 100,
      includeComments: true,
      maxCommentsPerPost: 50,
      execution: f.execution(),
    }),
    /2000/,
  );
  assert.equal(f.requests.length, 0);
  assert.throws(
    () => resolveKaixConfig({ APIFY_API_TOKEN: "bad\nsecret" }),
    /header/,
  );
});
