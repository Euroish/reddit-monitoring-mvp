import test from "node:test";
import assert from "node:assert/strict";
import {
  buildValuesPlaceholders,
  chunkArray,
  maxIso,
  minIso,
  minNullableIso,
} from "../../src/storage/repositories/postgres/postgres-sql.utils";

test("chunkArray splits items with fixed chunk size", () => {
  const chunks = chunkArray([1, 2, 3, 4, 5], 2);
  assert.deepEqual(chunks, [
    [1, 2],
    [3, 4],
    [5],
  ]);
});

test("buildValuesPlaceholders builds ordered placeholders", () => {
  const sql = buildValuesPlaceholders(2, 3);
  assert.equal(sql, "($1, $2, $3), ($4, $5, $6)");
});

test("iso comparison helpers keep deterministic ordering", () => {
  assert.equal(minIso("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"), "2026-01-01T00:00:00.000Z");
  assert.equal(maxIso("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"), "2026-01-02T00:00:00.000Z");
  assert.equal(minNullableIso(undefined, "2026-01-02T00:00:00.000Z"), "2026-01-02T00:00:00.000Z");
});
