import assert from "node:assert/strict";
import test from "node:test";
import type { CollectionSource } from "../../packages/contracts/src/source-content";
import { ContentProviderError } from "../../src/connectors/shared/content-provider.interface";
import { TwitterApiIoContentConnector } from "../../src/connectors/x/twitterapi-io-content.connector";
import { resolveTwitterApiIoConfig } from "../../src/connectors/x/twitterapi-io.config";

const NOW = "2026-10-12T10:00:00.000Z", FROM = "2026-10-11T00:00:00.000Z", TO = "2026-10-12T00:00:00.000Z";
const source: CollectionSource = { id: "22222222-3333-4444-5555-666666666666", platform: "x", provider: "twitterapi_io", label: "Offline X fixture", target: { type: "account", account: "sample" }, contentKind: "post", createdAt: NOW, lastSuccessAt: null, latestPublishedAt: null, coverage: "unknown", state: "active", group: null, updatedAt: NOW, schedule: { enabled: false, cadenceSeconds: 3600, overlapSeconds: 1800, initialLookbackHours: 24, maxCatchupHours: 48, pageSize: 20, maxPages: 5 }, refresh: { enabled: false, afterHours: 36, minIntervalHours: 24, maxAttempts: 2, batchSize: 20 }, nextDueAt: null, incrementalTo: null };
const request = (overrides = {}) => ({ source, from: FROM, to: TO, limit: 2, checkpoint: null, ...overrides });
function tweet(overrides: Record<string, unknown> = {}) { return { id: "18446744073709551615", text: "中文 AI fixture", createdAt: "Sun Oct 11 10:00:00 +0000 2026", author: { id: "18446744073709551614", userName: "sample", name: "示例作者" }, lang: "zh", likeCount: 0, retweetCount: 2, replyCount: 0, ...overrides }; }
function page(tweets: unknown[], hasNext = false, cursor = "") { return { tweets, has_next_page: hasNext, next_cursor: cursor, status: "success" }; }
function connector(responder: (url: URL, init?: RequestInit) => Response | Promise<Response>) { return new TwitterApiIoContentConnector({ apiKey: "fake-offline-key", networkEnabled: true, now: () => NOW, fetcher: (async (url, init) => responder(new URL(String(url)), init)) as typeof fetch }); }

test("X transport defaults disabled, requires explicit key/network and advertises fixed upstream resource bound", async () => {
  const disabled = new TwitterApiIoContentConnector({ fetcher: async () => { throw new Error("must never make a request"); } });
  assert.equal(disabled.capability.enabled, false);
  assert.equal(disabled.capability.requestResourceUpperBound, 20);
  await assert.rejects(disabled.collectPage(request()), /disabled/);
  assert.equal(new TwitterApiIoContentConnector({ apiKey: "fake" }).capability.enabled, false);
  assert.equal(new TwitterApiIoContentConnector({ networkEnabled: true }).capability.enabled, false);
  assert.deepEqual(resolveTwitterApiIoConfig({}), { apiKey: undefined, networkEnabled: false, timeoutMs: 20000 });
  assert.deepEqual(resolveTwitterApiIoConfig({ TWITTERAPI_IO_API_KEY: " fake ", SOURCE_NETWORK_ENABLED: "true", TWITTERAPI_IO_TIMEOUT_MS: "5000" }), { apiKey: "fake", networkEnabled: true, timeoutMs: 5000 });
  assert.equal(resolveTwitterApiIoConfig({ SOURCE_NETWORK_ENABLED: "1" }).networkEnabled, false);
  assert.throws(() => resolveTwitterApiIoConfig({ TWITTERAPI_IO_TIMEOUT_MS: "0" }), /TIMEOUT/);
  assert.throws(() => resolveTwitterApiIoConfig({ TWITTERAPI_IO_API_KEY: "header\ninjection" }), /header/);
});

test("X preserves large string identities, nullable fields, true zero metrics, references and receipt/observation separation", async () => {
  const value = tweet({ inReplyToId: "18446744073709551610", conversationId: "18446744073709551609", isReply: true, quoted_tweet: { id: "18446744073709551608" }, retweeted_tweet: { id: "18446744073709551607" }, possiblySensitive: false, entities: { urls: [{ expanded_url: "https://example.test/article" }] }, extended_entities: { media: [{ type: "photo", media_url_https: "https://example.test/image.png", ext_alt_text: "图片" }, { type: "video", media_url_https: "https://example.test/preview.png", video_info: { duration_millis: 12500, variants: [{ content_type: "video/mp4", bitrate: 128, url: "https://example.test/low.mp4" }, { content_type: "video/mp4", bitrate: 256, url: "https://example.test/high.mp4" }, { content_type: "application/x-mpegURL", url: "https://example.test/stream.m3u8" }] } }] } });
  const adapter = connector(() => Response.json(page([value]), { headers: { "x-request-id": "fixture-request", "x-ratelimit-remaining": "42" } }));
  const result = await adapter.collectPage(request()), item = result.items[0]!;
  assert.equal(item.externalId, "18446744073709551615");
  assert.equal(item.author?.externalId, "18446744073709551614");
  assert.equal(item.title, null);
  assert.equal(item.publishedAt, "2026-10-11T10:00:00.000Z");
  assert.equal(item.observation.sourceObservedAt, null);
  assert.equal(item.observation.fetchedAt, NOW);
  assert.equal(item.observation.timeBasis, "provider_snapshot");
  assert.equal(item.observation.maturity, "unknown");
  assert.equal(item.observation.metrics["x.likes"], 0);
  assert.equal(item.observation.metrics["x.views"], null);
  assert.equal(item.observation.metrics["x.bookmarks"], null);
  assert.deepEqual(item.references.map((ref) => ref.relation), ["reply_to", "thread_root", "quote", "repost"]);
  assert.equal(item.media.length, 3);
  assert.equal(item.media.find((media) => media.type === "video")?.url, "https://example.test/high.mp4");
  assert.equal(item.media.find((media) => media.type === "video")?.durationSeconds, 12.5);
  assert.equal(item.platformDetails.extensions?.["twitterapi_io.rate_limit_remaining"], 42);
  assert.equal(item.id, (await adapter.collectPage(request())).items[0]?.id);
  assert.equal(result.coverage, "unknown");
});

test("X account timeline is bounded locally, follows provider cursor and never slices a charged page to requested sample size", async () => {
  const calls: URL[] = [];
  const adapter = connector((url, init) => {
    calls.push(url);
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "fake-offline-key");
    assert.equal(init?.redirect, "error");
    return calls.length === 1 ? Response.json(page([tweet(), tweet({ id: "18446744073709551613" })], true, "opaque-first")) : Response.json(page([tweet({ id: "18446744073709551612", createdAt: "2026-10-10T10:00:00Z" })], true, "opaque-second"));
  });
  const first = await adapter.collectPage(request({ limit: 1 }));
  assert.equal(first.items.length, 2, "provider resource reservation covers the whole returned page");
  assert.equal(calls[0]?.pathname, "/twitter/user/last_tweets");
  assert.equal(calls[0]?.searchParams.get("includeReplies"), "true");
  assert.equal(calls[0]?.searchParams.get("userName"), "sample");
  assert.equal(calls[0]?.searchParams.has("limit"), false);
  const second = await adapter.collectPage(request({ checkpoint: first.nextCheckpoint }));
  assert.equal(calls[1]?.searchParams.get("cursor"), "opaque-first");
  assert.equal(second.items.length, 0);
  assert.equal(second.exhausted, true);
  await assert.rejects(adapter.collectPage(request({ to: "2026-10-12T00:01:00Z", checkpoint: first.nextCheckpoint })), /changed collection scope/);
});

test("X keyword searches use Latest and owned Unix window operators, include from/to filtering and validate target scope", async () => {
  let requested: URL | undefined;
  const adapter = connector((url) => { requested = url; return Response.json(page([tweet(), tweet({ id: "18446744073709551612", createdAt: TO })])); });
  assert.deepEqual(adapter.normalizeTarget({ type: "account", account: "@Sample", query: "AI" }, "post"), { type: "account", account: "sample", query: "AI" });
  await adapter.collectPage(request({ source: { ...source, target: { type: "search", query: '"智能体" OR AI' } } }));
  assert.equal(requested?.pathname, "/twitter/tweet/advanced_search");
  assert.equal(requested?.searchParams.get("queryType"), "Latest");
  assert.match(requested?.searchParams.get("query") ?? "", /since_time:\d+ until_time:\d+/);
  const accountSearch = await adapter.collectPage(request({ source: { ...source, target: { type: "account", account: "sample", query: "AI" } } }));
  assert.equal(accountSearch.items.length, 1, "to is exclusive even if provider search returns it");
  assert.match(requested?.searchParams.get("query") ?? "", /from:sample \(AI\)/);
  for (const target of [{ type: "feed", url: "https://example.test" }, { type: "search", query: "AI since_time:10" }, { type: "account", account: "sample", query: "AI OR from:other" }, { type: "account", account: "bad/handle" }]) assert.throws(() => adapter.normalizeTarget(target as never, "post"));
  assert.throws(() => adapter.normalizeTarget({ type: "account", account: "sample" }, "comment"), /posts only/);
  assert.throws(() => adapter.normalizeTarget({ type: "account", account: "sample", query: 1 } as never, "post"), (error: unknown) => error instanceof ContentProviderError && /string/.test(error.message));
  assert.throws(() => adapter.normalizeTarget({ type: "search", query: {} } as never, "post"), (error: unknown) => error instanceof ContentProviderError && /string/.test(error.message));
});

test("X account endpoint handles provider data.tweets envelope while search and ID schemas remain flat", async () => {
  let calls = 0;
  const adapter = connector(() => { calls++; return calls === 1 ? Response.json({ status: "success", data: page([tweet()], true, "nested-cursor") }) : Response.json({ status: "success", data: { tweets: [tweet()] }, has_next_page: false, next_cursor: "" }); });
  const first = await adapter.collectPage(request());
  assert.equal(first.items.length, 1);
  assert.equal(first.exhausted, false);
  assert.equal((first.nextCheckpoint as { cursor: string }).cursor, "nested-cursor");
  assert.equal((await adapter.collectPage(request({ checkpoint: first.nextCheckpoint }))).exhausted, true);
  const unexpectedSearch = connector(() => Response.json({ data: page([tweet()]) }));
  await assert.rejects(unexpectedSearch.collectPage(request({ source: { ...source, target: { type: "search", query: "AI" } } })), /page shape/);
});

test("X cursor stalls and unknown dates remain explicit partial, invalid unsafe IDs fail the page", async () => {
  const adapter = connector(() => Response.json(page([tweet({ createdAt: undefined, author: undefined, quoteCount: -1 })], true, "")));
  const result = await adapter.collectPage(request());
  assert.equal(result.exhausted, false);
  assert.equal(result.nextCheckpoint, null);
  assert.equal(result.coverage, "partial");
  assert.match(result.warning!, /unknown publication/);
  assert.match(result.warning!, /cursor failed/);
  assert.equal(result.items[0]?.author, null);
  assert.equal(result.items[0]?.observation.metrics["x.quotes"], null);
  const unsafe = connector(() => Response.json(page([tweet({ id: 18446744073709551615 })])));
  await assert.rejects(unsafe.collectPage(request()), /safe string identity/);
  const oversized = connector(() => Response.json(page(Array.from({ length: 21 }, () => tweet()))));
  await assert.rejects(oversized.collectPage(request()), /resource bound/);
});

test("X request errors use one attempt, redact provider payload, respect rate headers and propagate cancellation", async () => {
  let calls = 0;
  const rateLimited = connector(() => { calls++; return new Response("fake-offline-key must not be echoed", { status: 429, headers: { "retry-after": "125" } }); });
  await assert.rejects(rateLimited.collectPage(request()), (error: unknown) => error instanceof ContentProviderError && error.retryable && error.retryAfterSeconds === 125 && !error.message.includes("fake-offline-key"));
  assert.equal(calls, 1);
  const reset = connector(() => new Response("", { status: 429, headers: { "x-ratelimit-reset": String(Date.parse(NOW) / 1000 + 90) } }));
  await assert.rejects(reset.collectPage(request()), (error: unknown) => error instanceof ContentProviderError && error.retryAfterSeconds === 90);
  const forbidden = connector(() => new Response("", { status: 403 }));
  await assert.rejects(forbidden.collectPage(request()), (error: unknown) => error instanceof ContentProviderError && !error.retryable);
  const broken = connector(() => Response.json({ status: "error", message: "fake-offline-key" }));
  await assert.rejects(broken.collectPage(request()), /provider failure/);
  const malformed = connector(() => new Response("not json"));
  await assert.rejects(malformed.collectPage(request()), /malformed JSON/);
  const controller = new AbortController(); controller.abort(new Error("fixture cancellation"));
  await assert.rejects(rateLimited.collectPage(request({ signal: controller.signal })), /fixture cancellation/);
  assert.equal(calls, 1, "aborted request must not spend another network attempt");
});

test("X bounded ID refresh uses one request and does not infer deletion from missing IDs", async () => {
  let calls = 0;
  const adapter = connector((url) => { calls++; assert.equal(url.pathname, "/twitter/tweets"); assert.equal(url.searchParams.get("tweet_ids"), "18446744073709551615,18446744073709551613"); return Response.json({ tweets: [tweet()] }); });
  const result = await adapter.refreshIds({ source, externalIds: ["18446744073709551615", "18446744073709551613"] });
  assert.equal(calls, 1);
  assert.equal(result.exhausted, true);
  assert.equal(result.coverage, "partial");
  assert.match(result.warning!, /does not prove deletion/);
  assert.equal(result.items[0]?.platformDetails.extensions?.["twitterapi_io.endpoint"], "refresh");
  await assert.rejects(adapter.refreshIds({ source, externalIds: [] }), /1–100/);
  const unrelated = connector(() => Response.json({ tweets: [tweet({ id: "999" })] }));
  await assert.rejects(unrelated.refreshIds({ source, externalIds: ["18446744073709551615"] }), /unrelated/);
});
