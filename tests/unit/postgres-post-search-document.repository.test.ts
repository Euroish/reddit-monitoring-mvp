import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPostSearchDocumentRepository } from "../../src/storage/repositories/postgres/postgres-post-search-document.repository";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import { SEARCH_BODY_SNIPPET_MAX_CHARS } from "../../src/shared/text/content-text-retention";

test("PostgresPostSearchDocumentRepository truncates body snippet and search text on upsert", async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const db = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows: [] };
    },
  };

  const repo = new PostgresPostSearchDocumentRepository(db as never);
  const longBody = "x".repeat(SEARCH_BODY_SNIPPET_MAX_CHARS + 40);

  await repo.upsertMany([
    {
      contentId: stableUuidFromString("reddit:content:t3_test"),
      targetId: stableUuidFromString("reddit:target:r/test"),
      canonicalSubreddit: "r/test",
      title: "Long body title",
      bodySnippet: longBody,
      permalink: "/r/test/comments/t3_test/post",
      createdAtSource: "2026-04-28T09:00:00.000Z",
    },
  ]);

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.text, /INSERT INTO post_search_document/);
  assert.equal((calls[0]!.params?.[4] as string).length, SEARCH_BODY_SNIPPET_MAX_CHARS);
  assert.equal(
    calls[0]!.params?.[7],
    `long body title ${"x".repeat(SEARCH_BODY_SNIPPET_MAX_CHARS)}`,
  );
});

test("PostgresPostSearchDocumentRepository seedFromContent bounds snippet length in SQL", async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const db = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows: [], rowCount: 0 };
    },
  };

  const repo = new PostgresPostSearchDocumentRepository(db as never);
  await repo.seedFromContent(2000);

  assert.equal(calls.length, 1);
  assert.match(
    calls[0]!.text,
    new RegExp(`LEFT\\(c\\.body_text, ${SEARCH_BODY_SNIPPET_MAX_CHARS}\\)`),
  );
});

