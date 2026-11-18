import assert from "node:assert/strict";
import test from "node:test";
import {
  compileContentFilter,
  decodeCursor,
  escapeLike,
  normalizePublicSearchText,
} from "../../src/modules/content/search";
import { csvCell } from "../../src/modules/content/routes";

test("filter compiler intersects source scopes within one EXISTS and escapes LIKE metacharacters", () => {
  const compiled = compileContentFilter(
    { allowedSourceIds: ["allowed"] },
    { sourceId: "requested", query: "100%_\\" },
    ["project"],
  );
  assert.equal((compiled.text.match(/EXISTS/g) ?? []).length, 1);
  assert.deepEqual(compiled.values.slice(0, 3), [
    ["allowed"],
    ["project"],
    "requested",
  ]);
  assert.equal(escapeLike("100%_\\"), "100\\%\\_\\\\");
  assert.equal(normalizePublicSearchText("  ＡI\u00a0🧭  工具 "), "ai 🧭 工具");
  assert.throws(
    () => compileContentFilter({ allowedSourceIds: ["allowed"] }, {}, ["project"], {
      sourceId: "requested", anyTerms: ["valid", "ＡI"],
    }),
    /three consecutive/,
  );
  assert.throws(
    () =>
      compileContentFilter(
        { allowedSourceIds: null },
        { query: "a\u001fb", sourceId: "source" },
      ),
    /controls/,
  );
  assert.throws(() => decodeCursor("invalid", "scope"), /Invalid cursor/);
});

test("CSV treats formula prefixes and quotes as data", () => {
  assert.equal(csvCell('  =SUM(A1)"'), '"\'  =SUM(A1)"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell("ordinary text"), '"ordinary text"');
});
