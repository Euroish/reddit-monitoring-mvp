import test from "node:test";
import assert from "node:assert/strict";
import { runKeywordPulseQuery } from "../../src/application/services/keyword-pulse-query.service";
import {
  InMemoryKeywordQuerySessionRepository,
  InMemoryPostSearchDocumentRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";

test("runKeywordPulseQuery returns initial_ready session with sampled posts", async () => {
  const postSearchDocumentRepository = new InMemoryPostSearchDocumentRepository();
  await postSearchDocumentRepository.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:pulse_1"),
      targetId: stableUuidFromString("reddit:target:r/datascience"),
      canonicalSubreddit: "r/datascience",
      title: "LLM Agent orchestration benchmark and eval setup",
      bodySnippet:
        "Long body to satisfy quality heuristic and describe practical production patterns for agents.",
      permalink: "/r/datascience/comments/pulse_1",
      createdAtSource: "2026-04-11T10:00:00.000Z",
    },
    {
      contentId: stableUuidFromString("reddit:content:pulse_2"),
      targetId: stableUuidFromString("reddit:target:r/machinelearning"),
      canonicalSubreddit: "r/machinelearning",
      title: "Classic ML baseline comparison",
      bodySnippet: "No strong LLM keyword mention here.",
      permalink: "/r/machinelearning/comments/pulse_2",
      createdAtSource: "2026-04-11T11:00:00.000Z",
    },
  ]);
  const keywordQuerySessionRepository = new InMemoryKeywordQuerySessionRepository();

  const result = await runKeywordPulseQuery({
    input: {
      queryText: "LLM agent",
      limit: 10,
      nowIso: "2026-04-12T12:00:00.000Z",
    },
    postSearchDocumentRepository,
    keywordQuerySessionRepository,
    idGenerator: () => "00000000-0000-0000-0000-000000000123",
  });

  assert.equal(result.session.id, "00000000-0000-0000-0000-000000000123");
  assert.equal(result.session.status, "initial_ready");
  assert.equal(result.session.supportCount, 2);
  assert.equal(result.cacheStatus, "miss");
  assert.equal(result.samples.length, 2);
  assert.equal(result.samples[0]?.canonicalSubreddit, "r/datascience");
  assert.equal(result.samples[0]?.sourceType, "index");
  assert.equal(result.pulsePoints5m.length, 1);
  assert.equal(result.pulsePoints5m[0]?.sourceType, "index");

  const stored = await keywordQuerySessionRepository.findById(result.session.id, 10);
  assert.equal(stored?.session.id, result.session.id);
  assert.equal(stored?.samples.length, 2);
  assert.equal(stored?.pulsePoints5m.length, 1);
});

test("runKeywordPulseQuery reuses recent cached session for identical query scope", async () => {
  const postSearchDocumentRepository = new InMemoryPostSearchDocumentRepository();
  await postSearchDocumentRepository.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:cache_1"),
      targetId: stableUuidFromString("reddit:target:r/datascience"),
      canonicalSubreddit: "r/datascience",
      title: "LLM agent reliability checklist",
      bodySnippet: "Enough context for a stable cached keyword query response.",
      permalink: "/r/datascience/comments/cache_1",
      createdAtSource: "2026-04-11T10:00:00.000Z",
    },
  ]);
  const keywordQuerySessionRepository = new InMemoryKeywordQuerySessionRepository();

  const first = await runKeywordPulseQuery({
    input: {
      queryText: "LLM agent",
      canonicalSubreddit: "r/datascience",
      limit: 10,
      nowIso: "2026-04-12T12:00:00.000Z",
    },
    postSearchDocumentRepository,
    keywordQuerySessionRepository,
    idGenerator: () => "00000000-0000-0000-0000-000000000124",
  });

  const second = await runKeywordPulseQuery({
    input: {
      queryText: "LLM agent",
      canonicalSubreddit: "r/datascience",
      limit: 10,
      nowIso: "2026-04-12T12:05:00.000Z",
    },
    postSearchDocumentRepository,
    keywordQuerySessionRepository,
    idGenerator: () => "00000000-0000-0000-0000-000000000125",
  });

  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "hit");
  assert.equal(second.session.id, first.session.id);
});

test("runKeywordPulseQuery keeps support count independent from returned sample limit", async () => {
  const postSearchDocumentRepository = new InMemoryPostSearchDocumentRepository();
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  await postSearchDocumentRepository.upsertMany(
    Array.from({ length: 25 }, (_, index) => ({
      contentId: stableUuidFromString(`reddit:content:bulk_${index}`),
      targetId,
      canonicalSubreddit: "r/datascience",
      title: `LLM agent case study ${index}`,
      bodySnippet: "Enough body text to keep the document qualified for sampling and scoring.",
      permalink: `/r/datascience/comments/bulk_${index}`,
      createdAtSource: `2026-04-12T12:${String(index).padStart(2, "0")}:00.000Z`,
    })),
  );
  const keywordQuerySessionRepository = new InMemoryKeywordQuerySessionRepository();

  const result = await runKeywordPulseQuery({
    input: {
      queryText: "LLM agent",
      canonicalSubreddit: "r/datascience",
      limit: 3,
      nowIso: "2026-04-12T13:00:00.000Z",
    },
    postSearchDocumentRepository,
    keywordQuerySessionRepository,
    idGenerator: () => "00000000-0000-0000-0000-000000000126",
  });

  assert.equal(result.session.supportCount, 25);
  assert.equal(result.session.coverageLevel, "high");
  assert.equal(result.samples.length, 3);
});

test("runKeywordPulseQuery filters polluted substring-only matches", async () => {
  const postSearchDocumentRepository = new InMemoryPostSearchDocumentRepository();
  const targetId = stableUuidFromString("reddit:target:r/artificial");
  await postSearchDocumentRepository.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:ai_exact"),
      targetId,
      canonicalSubreddit: "r/artificial",
      title: "AI model evaluation checklist",
      bodySnippet: "Practical notes on AI system reviews and benchmark hygiene.",
      permalink: "/r/artificial/comments/ai_exact",
      createdAtSource: "2026-04-12T12:00:00.000Z",
    },
    {
      contentId: stableUuidFromString("reddit:content:ai_polluted"),
      targetId,
      canonicalSubreddit: "r/artificial",
      title: "Airflow scheduler tuning notes",
      bodySnippet: "This mentions orchestration but should not count as the target query.",
      permalink: "/r/artificial/comments/ai_polluted",
      createdAtSource: "2026-04-12T12:05:00.000Z",
    },
  ]);
  const keywordQuerySessionRepository = new InMemoryKeywordQuerySessionRepository();

  const result = await runKeywordPulseQuery({
    input: {
      queryText: "ai",
      canonicalSubreddit: "r/artificial",
      limit: 10,
      nowIso: "2026-04-12T13:00:00.000Z",
    },
    postSearchDocumentRepository,
    keywordQuerySessionRepository,
    idGenerator: () => "00000000-0000-0000-0000-000000000127",
  });

  assert.equal(result.session.supportCount, 1);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0]?.title, "AI model evaluation checklist");
  assert.equal(result.session.explainPayload.pollutionFilteredCount, 1);
});
