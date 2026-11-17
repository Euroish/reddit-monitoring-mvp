import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prepareContentBatch } from "../../src/modules/content/sql";
import { batchItem, BATCH_NOW } from "../helpers/content-batch-fixtures";

test("batch picks the same version in every arrival order and retains independent observations", () => {
  const sourceId = randomUUID(),
    base = batchItem(sourceId);
  const old = {
    ...base,
    title: "Old",
    observation: { ...base.observation, evidenceKey: "a" },
  };
  const winner = {
    ...base,
    title: "Winner",
    observation: { ...base.observation, evidenceKey: "z" },
  };
  const unknown = {
    ...base,
    title: "Unknown clock",
    fetchedAt: "2026-11-17T00:00:00Z",
    observation: {
      ...base.observation,
      sourceObservedAt: null,
      evidenceKey: "zz",
    },
  };
  for (const items of [
    [old, unknown, winner],
    [winner, old, unknown],
    [unknown, winner, old],
  ]) {
    const batch = prepareContentBatch(items);
    assert.equal(batch.nodes.length, 1);
    assert.equal(batch.nodes[0].item.title, "Winner");
    assert.equal(batch.observations.length, 3);
    assert.equal(batch.nodes[0].lastFetchedAt, unknown.fetchedAt);
  }
});

test("same evidence ignores reread clock and JSON key order but rejects changed content or metrics", () => {
  const item = batchItem(randomUUID()),
    later = {
      ...item,
      fetchedAt: "2026-11-17T00:00:00Z",
      observation: { ...item.observation, fetchedAt: "2026-11-17T00:00:00Z" },
    };
  assert.equal(prepareContentBatch([item, later]).observations.length, 1);
  assert.throws(
    () => prepareContentBatch([item, { ...later, text: "Changed" }]),
    /Conflicting observation/,
  );
  assert.throws(
    () =>
      prepareContentBatch([
        item,
        {
          ...later,
          observation: { ...later.observation, metrics: { "reddit.score": 2 } },
        },
      ]),
    /Conflicting observation/,
  );
});

test("batch rejects cycles, cross-root parents and malformed Reddit prefixes, and accepts missing ancestors", () => {
  const sourceId = randomUUID();
  const first = batchItem(sourceId, {
    kind: "comment",
    externalId: "t1_19riqx8r047lt",
    references: [
      { kind: "comment", externalId: "t1_19riqx8r047lu", relation: "reply_to" },
    ],
  });
  const second = batchItem(sourceId, {
    kind: "comment",
    externalId: "t1_19riqx8r047lu",
    references: [
      { kind: "comment", externalId: first.externalId, relation: "reply_to" },
    ],
  });
  assert.equal(
    prepareContentBatch([first]).nodes[0].item.references[0].externalId,
    second.externalId,
  );
  assert.throws(() => prepareContentBatch([first, second]), /Cyclic/);
  assert.throws(
    () =>
      prepareContentBatch([
        {
          ...first,
          references: [
            { kind: "post", externalId: "t3_root1", relation: "thread_root" },
            { kind: "post", externalId: "t3_root2", relation: "reply_to" },
          ],
        },
      ]),
    /Cross-root/,
  );
  assert.throws(
    () => prepareContentBatch([{ ...first, externalId: "t3_wrong" }]),
    /prefix/,
  );
  assert.throws(
    () =>
      prepareContentBatch([
        {
          ...first,
          observation: { ...first.observation, sourceObservedAt: "invalid" },
        },
      ]),
    /timestamp/,
  );
  assert.throws(
    () => prepareContentBatch(Array.from({ length: 2001 }, () => first)),
    /2000/,
  );
  assert.equal(BATCH_NOW, first.fetchedAt);
});

test("premerge preserves known fields before a sparse update and respects an intervening deletion in every order", () => {
  const old = batchItem(randomUUID());
  const removed = {
    ...old,
    availability: "deleted" as const,
    observation: {
      ...old.observation,
      evidenceKey: "b",
      sourceObservedAt: "2026-11-17T00:00:00Z",
    },
  };
  const sparse = {
    ...old,
    title: null,
    text: null,
    observation: {
      ...old.observation,
      evidenceKey: "c",
      sourceObservedAt: "2026-11-18T00:00:00Z",
    },
  };
  assert.equal(prepareContentBatch([sparse, old]).nodes[0].item.text, old.text);
  for (const items of [
    [sparse, old, removed],
    [removed, sparse, old],
    [old, removed, sparse],
  ]) {
    assert.equal(prepareContentBatch(items).nodes[0].item.text, null);
  }
});

test("same version merges sparse fields from independent sources without losing the later fetched clock", () => {
  const base = batchItem(randomUUID());
  const a = { ...base, title: null };
  const b = { ...base, text: null, fetchedAt: "2026-11-17T00:00:00Z",
    observation: { ...base.observation, sourceId: randomUUID(), fetchedAt: "2026-11-17T00:00:00Z" } };
  for (const items of [[a, b], [b, a]]) {
    const node = prepareContentBatch(items).nodes[0];
    assert.equal(node.item.title, base.title);
    assert.equal(node.item.text, base.text);
    assert.equal(node.item.fetchedAt, b.fetchedAt);
  }
});
