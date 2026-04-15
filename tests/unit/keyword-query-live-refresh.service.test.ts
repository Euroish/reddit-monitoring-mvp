import test from "node:test";
import assert from "node:assert/strict";
import { runKeywordPulseQuery } from "../../src/application/services/keyword-pulse-query.service";
import { runKeywordQueryLiveRefreshCycle } from "../../src/application/services/keyword-query-live-refresh.service";
import {
  InMemoryKeywordQuerySessionRepository,
  InMemoryPostSearchDocumentRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";

test("live refresh advances keyword query to live_refreshing and writes 5m summary", async () => {
  const postSearchDocumentRepository = new InMemoryPostSearchDocumentRepository();
  const keywordQuerySessionRepository = new InMemoryKeywordQuerySessionRepository();

  await postSearchDocumentRepository.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:live_refresh_seed"),
      targetId: stableUuidFromString("reddit:target:r/datascience"),
      canonicalSubreddit: "r/datascience",
      title: "LLM agent reliability benchmark",
      bodySnippet: "Initial indexed baseline document for keyword query bootstrap.",
      permalink: "/r/datascience/comments/live_refresh_seed",
      createdAtSource: "2026-04-12T11:50:00.000Z",
    },
  ]);

  const created = await runKeywordPulseQuery({
    input: {
      queryText: "LLM agent",
      canonicalSubreddit: "r/datascience",
      limit: 10,
      nowIso: "2026-04-12T12:00:00.000Z",
    },
    postSearchDocumentRepository,
    keywordQuerySessionRepository,
    idGenerator: () => "00000000-0000-0000-0000-000000000777",
  });

  await postSearchDocumentRepository.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:live_refresh_new"),
      targetId: stableUuidFromString("reddit:target:r/datascience"),
      canonicalSubreddit: "r/datascience",
      title: "LLM agent deployment pain points in production",
      bodySnippet:
        "Fresh live document that should be captured by 5m incremental refresh and summary.",
      permalink: "/r/datascience/comments/live_refresh_new",
      createdAtSource: "2026-04-12T12:03:00.000Z",
    },
  ]);

  const refresh = await runKeywordQueryLiveRefreshCycle({
    nowIso: "2026-04-12T12:04:30.000Z",
    keywordQuerySessionRepository,
    postSearchDocumentRepository,
    bucketMinutes: 5,
    liveWindowMinutes: 20,
  });

  assert.equal(refresh.processed, 1);
  assert.equal(refresh.transitionedToLiveRefreshing, 1);

  const record = await keywordQuerySessionRepository.findById(created.session.id, 10);
  assert.ok(record);
  assert.equal(record.session.status, "live_refreshing");
  assert.equal(record.session.sourceTypeSummary.live, 1);
  assert.equal(record.session.supportCount >= 2, true);
  assert.equal(record.samples.some((sample) => sample.sourceType === "live"), true);
  assert.equal(record.pulsePoints5m.some((point) => point.sourceType === "live"), true);
});

test("live refresh completes query after configured live window", async () => {
  const postSearchDocumentRepository = new InMemoryPostSearchDocumentRepository();
  const keywordQuerySessionRepository = new InMemoryKeywordQuerySessionRepository();

  await postSearchDocumentRepository.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:completion_seed"),
      targetId: stableUuidFromString("reddit:target:r/machinelearning"),
      canonicalSubreddit: "r/machinelearning",
      title: "Transformer scaling law discussion",
      bodySnippet: "Sufficiently long body for quality and query qualification checks.",
      permalink: "/r/machinelearning/comments/completion_seed",
      createdAtSource: "2026-04-12T11:40:00.000Z",
    },
  ]);

  const created = await runKeywordPulseQuery({
    input: {
      queryText: "transformer scaling",
      canonicalSubreddit: "r/machinelearning",
      limit: 10,
      nowIso: "2026-04-12T12:00:00.000Z",
    },
    postSearchDocumentRepository,
    keywordQuerySessionRepository,
    idGenerator: () => "00000000-0000-0000-0000-000000000888",
  });

  const refresh = await runKeywordQueryLiveRefreshCycle({
    nowIso: "2026-04-12T12:25:00.000Z",
    keywordQuerySessionRepository,
    postSearchDocumentRepository,
    bucketMinutes: 5,
    liveWindowMinutes: 20,
  });

  assert.equal(refresh.processed, 1);
  assert.equal(refresh.transitionedToCompleted, 1);

  const record = await keywordQuerySessionRepository.findById(created.session.id, 10);
  assert.ok(record);
  assert.equal(record.session.status, "completed");
});
