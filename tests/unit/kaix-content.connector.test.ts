import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type RequestListener } from "node:http";
import { ContentProviderError } from "../../src/connectors/shared/content-provider.interface";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { resolveKaixConfig } from "../../src/connectors/reddit/kaix.config";
import { classifyJobFailure, providerMaxConcurrentRuns } from "../../src/modules/collection/worker";
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
    tier: "T2",
    ownerEntityId: null,
    sourceGroup: null,
    tags: [],
    locale: null,
    fetchPolicy: {},
    health: {},
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

const post = (id: string, overrides: Partial<typeof root> & { score?: number; numComments?: number } = {}) =>
  ({ ...root, id, fullName: `t3_${id}`, score: 10, numComments: 0, ...overrides });
const bounds = { from: "2026-08-18T12:00:00.000Z", to: now };

test("small search jobs without comments (and account jobs) stay single-run", async () => {
  for (const source of [
    sourceFixture(),
    sourceFixture({ target: { type: "account", account: "alice" } }),
  ]) {
    const f = fixture([receipt("SUCCEEDED"), [{ ...root, author: "alice" }]]);
    const page = await f.connector.collectPage({
      ...bounds, source, limit: 250, checkpoint: null, execution: f.execution(),
    });
    assert.equal(page.nextCheckpoint, null);
    assert.equal(page.items.length, 1);
    assert.equal(f.requests.filter(({ input }) => input).length, 1);
  }
});

test("staged search ranks in-window communities, adds older unique posts, then hydrates only qualified threads", async () => {
  const a = post("alpha", { numComments: 3 });
  const b = post("beta");
  const c = post("gamma", { subreddit: "another", numComments: 9 });
  const old = post("older", { createdUtc: Date.parse("2026-08-25T00:00:00Z") / 1000, numComments: 20 });
  const tooOld = post("out", { createdUtc: Date.parse("2026-08-01T00:00:00Z") / 1000, numComments: 100 });
  const low = post("low", { score: 4, numComments: 100 });
  const reply = { ...comment, linkId: old.fullName, parentId: old.fullName };
  const request = { ...bounds, source: sourceFixture({ target: { type: "search", query: "tiktok", minLikes: 5 } }),
    limit: 251, includeComments: true, maxCommentsPerPost: 2 };
  const page = async (rows: unknown[], checkpoint: JsonValue | null) => {
    const f = fixture([receipt("SUCCEEDED"), rows]);
    const result = await f.connector.collectPage({
      ...request, checkpoint: JSON.parse(JSON.stringify(checkpoint)), execution: f.execution(),
    });
    return { ...result, input: f.requests[0].input! };
  };
  const seed = await page([a, b, a, c, { ...tooOld, subreddit: "outside" }, { ...low, subreddit: "filtered" }], null);
  assert.deepEqual(seed.items.map(({ externalId }) => externalId), [a.fullName, b.fullName, c.fullName]);
  assert.deepEqual([seed.input.sort, seed.input.time, seed.input.includeComments], ["new", "all", false]);
  assert.deepEqual(seed.nextCheckpoint, { phase: "fanout", subreddits: ["fixture", "another"], subIndex: 0,
    seenPostIds: [a.fullName, b.fullName, c.fullName], candidates: [{ id: c.fullName, count: 9 }, { id: a.fullName, count: 3 }] });
  const fanout = await page([a, old, old, tooOld, low], seed.nextCheckpoint);
  assert.deepEqual([fanout.input.mode, fanout.input.keyword, fanout.input.subreddit, fanout.input.sort,
    fanout.input.time, fanout.input.maxItems, fanout.input.includeComments], ["search", "tiktok", "fixture", "top", "year", 248, false]);
  assert.deepEqual(fanout.items.map(({ externalId }) => externalId), [old.fullName]);
  const last = await page([c], fanout.nextCheckpoint);
  assert.equal(last.input.subreddit, "another");
  assert.equal(last.input.maxItems, 247);
  assert.deepEqual(last.items, []);
  assert.deepEqual(last.nextCheckpoint, {
    phase: "hydrate_comments", postIds: [old.fullName, c.fullName, a.fullName], missingComments: false,
  });
  assert.equal(last.continueAfterLimit, true);
  await assert.rejects(() => page([reply, { ...comment, linkId: "t3_elsewhere" }], last.nextCheckpoint), /different post/);
  await assert.rejects(() => page([b], last.nextCheckpoint), /different post/);
  const hydration = await page([old, reply, reply], last.nextCheckpoint);
  assert.deepEqual(hydration.input.postUrls, [old.fullName, c.fullName, a.fullName]);
  assert.deepEqual([hydration.input.mode, hydration.input.commentSort, hydration.input.maxCommentsPerPost,
    hydration.input.includeComments], ["post", "top", 2, true]);
  assert.deepEqual(hydration.items.map(({ externalId }) => externalId), [reply.fullName]);
  assert.equal(hydration.nextCheckpoint, null);
  assert.equal(hydration.coverage, "partial");
  assert.match(hydration.warning ?? "", /no comment records/);
});

test("community hydration caps and batches highest-comment posts; rejects malformed checkpoints before POST", async () => {
  const posts = Array.from({ length: 55 }, (_, i) => post(`id${i}`, { numComments: i }));
  const f = fixture([receipt("SUCCEEDED"), posts, receipt("SUCCEEDED"), [], receipt("SUCCEEDED"), []]);
  const request = { ...bounds, source: sourceFixture({ target: { type: "community", community: "fixture" } }),
    limit: posts.length, includeComments: true };
  const run = (checkpoint: JsonValue | null) => f.connector.collectPage({
    ...request, checkpoint, execution: { ...f.execution(), state: { phase: "starting" } },
  });
  await assert.rejects(() => run({ phase: "hydrate_comments", postIds: ["t3_valid", "t3_valid"], missingComments: false }),
    /Invalid Kaix continuation/);
  assert.equal(f.requests.length, 0);
  const seed = await run(null);
  assert.equal(seed.items.length, request.limit);
  const first = await run(seed.nextCheckpoint);
  const last = await run(first.nextCheckpoint);
  const paid = f.requests.flatMap(({ input }) => input ? [input] : []);
  const ids = posts.slice(5).reverse().map(p => p.fullName);
  assert.deepEqual(paid.map(input => input.mode), ["subreddit", "post", "post"]);
  assert.deepEqual(paid[1].postUrls, ids.slice(0, 25));
  assert.deepEqual(paid[2].postUrls, ids.slice(25));
  assert.equal(first.continueAfterLimit, true);
  assert.equal(last.nextCheckpoint, null);
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

test("kaix still enforces the exact window and both engagement thresholds on new/all results", async () => {
  const from = "2026-08-27T13:05:27.817Z";
  const to = "2026-11-25T13:05:27.817Z";
  const post = (id: string, date: string, score = 50, numComments = 10) => ({
    ...root,
    id,
    fullName: `t3_${id}`,
    createdUtc: Date.parse(date) / 1000,
    score,
    numComments,
  });
  const f = fixture([receipt("SUCCEEDED"), [
    post("atstart", from),
    post("before", "2026-08-27T13:05:26.817Z", 100, 100),
    post("atend", to, 100, 100),
    post("lowscore", "2026-09-01T00:00:00Z", 49, 100),
    post("fewcomments", "2026-10-01T00:00:00Z", 100, 9),
    post("recent", "2026-11-25T13:05:26.817Z"),
  ]]);
  const page = await f.connector.collectPage({
    source: sourceFixture({ target: { type: "search", query: "tiktok", minLikes: 50, minComments: 10 } }),
    from,
    to,
    limit: 5000,
    checkpoint: null,
    includeComments: false,
    execution: f.execution(),
  });

  assert.equal(f.requests[0].input?.sort, "new");
  assert.equal(f.requests[0].input?.time, "all");
  assert.deepEqual(page.items.map((item) => item.externalId), ["t3_atstart", "t3_recent"]);
  assert.equal(page.coverage, "partial");
  assert.deepEqual(page.nextCheckpoint, {
    phase: "fanout", subreddits: ["fixture"], subIndex: 0,
    seenPostIds: ["t3_atstart", "t3_recent"], candidates: [],
  });
  assert.equal(f.requests.filter((request) => request.input).length, 1);
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

test("legacy single-run discovery can include comments; sparse dataset rereads retain stable evidence", async () => {
  const f = fixture([receipt("SUCCEEDED"), [root, comment]]),
    source = sourceFixture();
  const request = {
    source,
    from: "2026-11-14T00:00:00Z",
    to: now,
    limit: 25,
    checkpoint: null,
    singleRun: true,
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
      limit: 10001,
      execution: f.execution(),
    }),
    /1–10000/,
  );
  await assert.rejects(
    f.connector.collectPage({
      ...request,
      limit: 100,
      includeComments: true,
      maxCommentsPerPost: 501,
      execution: f.execution(),
    }),
    /1–500/,
  );
  assert.equal(f.requests.length, 0);
  assert.throws(
    () => resolveKaixConfig({ APIFY_API_TOKEN: "bad\nsecret" }),
    /header/,
  );
});

test("kaix classifies 402 actor-memory-limit-exceeded as retryable capacity start rejection and preserves INV-003 for 502/other 402", async () => {
  const mkResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const capConnector = new KaixContentConnector(
    { networkEnabled: true, apiToken: "fixture-token" },
    async () =>
      mkResponse(402, {
        error: { type: "actor-memory-limit-exceeded", message: "Exceeds concurrent memory limit of 8192 MB." },
      }),
  );

  let capError: unknown;
  await assert.rejects(
    capConnector.collectPage({
      source: sourceFixture(),
      from: "2026-11-14T00:00:00Z",
      to: now,
      limit: 25,
      checkpoint: null,
      execution: { state: { phase: "starting" }, saveState: async () => undefined },
    }),
    (err) => {
      capError = err;
      return true;
    },
  );
  assert.ok(capError instanceof ContentProviderError);
  assert.equal(capError.retryable, true);
  assert.equal(capError.startOutcome?.confirmedPreStartRejection, true);
  assert.doesNotMatch(capError.message, /8192/);
  assert.equal(capError.httpStatus, 402);
  assert.match(capError.message, /actor-memory-limit-exceeded/);

  const mockSource = { state: "active", primary_provider: "kaix", platform: "reddit", schedule: { enabled: false } };
  const capPlan = classifyJobFailure(
    [capConnector],
    { provider: "kaix", purpose: "collect", pages_committed: 0, page_request_attempts: 1 },
    mockSource,
    capConnector,
    "starting",
    false,
    capError,
  );
  assert.equal(capPlan.retryStart, true);
  assert.equal(capPlan.unknown, false);

  const exhaustedPlan = classifyJobFailure(
    [capConnector],
    { provider: "kaix", purpose: "collect", pages_committed: 0, page_request_attempts: 6 },
    mockSource,
    capConnector,
    "starting",
    false,
    capError,
  );
  assert.equal(exhaustedPlan.retryStart, false);
  assert.equal(exhaustedPlan.unknown, false);

  const billingConnector = new KaixContentConnector(
    { networkEnabled: true, apiToken: "fixture-token" },
    async () => mkResponse(402, { error: { type: "monthly-usage-exceeded", message: "Monthly spend limit reached" } }),
  );
  await assert.rejects(
    billingConnector.collectPage({
      source: sourceFixture(),
      from: "2026-11-14T00:00:00Z",
      to: now,
      limit: 25,
      checkpoint: null,
      execution: { state: { phase: "starting" }, saveState: async () => undefined },
    }),
    (err: unknown) =>
      err instanceof ContentProviderError &&
      err.retryable === false &&
      err.httpStatus === 402 &&
      /monthly-usage-exceeded/.test(err.message) &&
      err.startOutcome?.outcomeUnknown === false &&
      !err.message.includes("Monthly spend limit reached") &&
      !classifyJobFailure([], { page_request_attempts: 1 }, mockSource, billingConnector, "starting", false, err).unknown,
  );

  const gatewayConnector = new KaixContentConnector(
    { networkEnabled: true, apiToken: "fixture-token" },
    async () => new Response("bad gateway", { status: 502 }),
  );
  let gwError: unknown;
  await assert.rejects(
    gatewayConnector.collectPage({
      source: sourceFixture(),
      from: "2026-11-14T00:00:00Z",
      to: now,
      limit: 25,
      checkpoint: null,
      execution: { state: { phase: "starting" }, saveState: async () => undefined },
    }),
    (err) => {
      gwError = err;
      return true;
    },
  );
  const gwPlan = classifyJobFailure(
    [gatewayConnector],
    { provider: "kaix", purpose: "collect", pages_committed: 0, page_request_attempts: 1 },
    mockSource,
    gatewayConnector,
    "starting",
    false,
    gwError,
  );
  assert.equal(gwPlan.retryStart, false);
  assert.equal(gwPlan.unknown, true);
});

test("Apify concurrency uses the same strictly parsed integer limit for both providers", () => {
  const previous = process.env.KAIX_MAX_CONCURRENT_JOBS;
  try {
    for (const [value, expected] of [["", 2], ["2.5", 2], ["3e0", 2], ["NaN", 2], ["0", 1], ["40", 6], ["3", 3]] as const) {
      process.env.KAIX_MAX_CONCURRENT_JOBS = value;
      assert.equal(providerMaxConcurrentRuns("kaix"), expected);
      assert.equal(providerMaxConcurrentRuns("red_crawler"), expected);
      assert.equal(providerMaxConcurrentRuns("feed"), null);
    }
  } finally {
    if (previous === undefined) delete process.env.KAIX_MAX_CONCURRENT_JOBS;
    else process.env.KAIX_MAX_CONCURRENT_JOBS = previous;
  }
});

const capacityBody = JSON.stringify({ error: { type: "actor-memory-limit-exceeded", message: "private upstream details" } });

function bounded402(chunks: Array<string | Error>) {
  let pulls = 0;
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls++];
      if (chunk instanceof Error) controller.error(chunk);
      else if (chunk === undefined) controller.close();
      else controller.enqueue(Buffer.from(chunk));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }), { status: 402 });
  return { response, get pulls() { return pulls; }, get cancelled() { return cancelled; } };
}

test("unconfirmed paid 402s are unknown, including interrupted and oversized streams", async () => {
  const oversized = bounded402([capacityBody.padEnd(4096 * 2), "must not read"]);
  const atLimit = bounded402([capacityBody.padEnd(4096), "must not read"]);
  const broken = bounded402([capacityBody, Error("private stream failure")]);
  for (const response of [
    oversized.response, atLimit.response, broken.response,
    new Response("actor-memory-limit-exceeded", { status: 402 }),
    Response.json({ error: { message: "actor-memory-limit-exceeded" } }, { status: 402 }),
    Response.json({ error: { type: "actor-memory-limit-exceeded " } }, { status: 402 }),
    Response.json({ error: { type: "private unsupported code" } }, { status: 402 }),
  ]) {
    const f = fixture([response]);
    await assert.rejects(f.connector.collectPage({
      ...bounds, source: sourceFixture(), limit: 25, checkpoint: null, execution: f.execution(),
    }), (error: unknown) => {
      assert.ok(error instanceof ContentProviderError);
      assert.equal(error.httpStatus, 402);
      assert.equal(error.startOutcome?.outcomeUnknown, true);
      assert.doesNotMatch(error.message, /private|actor-memory-limit-exceeded/);
      const plan = classifyJobFailure([], { page_request_attempts: 1 }, {}, f.connector, "starting", false, error);
      assert.equal(plan.retryStart, false);
      assert.equal(plan.unknown, true);
      return true;
    });
    assert.equal(f.requests.length, 1);
  }
  for (const stream of [oversized, atLimit]) {
    assert.equal(stream.pulls, 1);
    assert.equal(stream.cancelled, true);
  }
  assert.equal(broken.pulls, 2);
  const f = fixture([]);
  const unconfirmed = new ContentProviderError("Generic transient 402", true, 25, 402);
  const plan = classifyJobFailure([], { page_request_attempts: 1 }, {}, f.connector, "starting", false, unconfirmed);
  assert.equal(plan.retryStart, false);
  assert.equal(plan.unknown, true);
});

test("a GET 402 with the capacity code does not replay either the read or paid start", async () => {
  const f = fixture([new Response(capacityBody, { status: 402 })]);
  const execution = { ...f.execution(), state: { phase: "reading", runId: "fixtureRun" } };
  await assert.rejects(f.connector.collectPage({
    ...bounds, source: sourceFixture(), limit: 25, checkpoint: null, execution,
  }), (error: unknown) => {
    assert.ok(error instanceof ContentProviderError);
    assert.equal(error.httpStatus, 402);
    assert.equal(error.startOutcome, undefined);
    const plan = classifyJobFailure([], { page_request_attempts: 1 }, {}, f.connector, "reading", true, error);
    assert.equal(plan.retryRead, false);
    assert.equal(plan.retryStart, false);
    assert.equal(plan.unknown, false);
    return true;
  });
  assert.deepEqual(f.requests.map(({ url, input }) => [url.pathname, input]), [["/v2/actor-runs/fixtureRun", undefined]]);
});

test("Relay exposes only the whitelisted 402 code for allowed actor starts", async (t) => {
  const relayModule = "../../deploy/apify-relay.mjs";
  const { handleApifyRelay } = await import(relayModule);
  const oversized = bounded402([capacityBody.padEnd(4097), "must not read"]);
  const broken = bounded402([capacityBody, Error("private stream failure")]);
  const responses = [
    bounded402([capacityBody.slice(0, 20), capacityBody.slice(20)]).response,
    new Response(capacityBody, { status: 402 }),
    new Response(capacityBody, { status: 502 }),
    Response.json({ error: { type: "monthly-usage-exceeded" } }, { status: 402 }),
    oversized.response, broken.response, new Response(null, { status: 402 }),
  ];
  const handler: RequestListener = (request, response) => handleApifyRelay(request, response, "127.0.0.1", {
    fetcher: async () => responses.shift(),
    readToken: async () => "apify_api_synthetic_fixture_token",
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = async (method: string, path: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method });
    return [response.status, await response.text()];
  };
  const start = "/v2/acts/kaix~reddit-scraper/runs";
  assert.deepEqual(await call("POST", "/v1/acts/kaix~reddit-scraper/runs"), [403, "{}"]);
  assert.deepEqual(await call("POST", "/v2/actor-runs/fake"), [403, "{}"]);
  assert.deepEqual(await call("POST", start), [402, '{"error":{"type":"actor-memory-limit-exceeded"}}']);
  assert.deepEqual(await call("GET", "/v2/actor-runs/fake"), [402, "{}"]);
  assert.deepEqual(await call("POST", start), [502, "{}"]);
  for (let i = 0; i < 4; i++) assert.deepEqual(await call("POST", start), [402, "{}"]);
  assert.deepEqual(responses, []);
  assert.equal(oversized.pulls, 1);
  assert.equal(oversized.cancelled, true);
});
