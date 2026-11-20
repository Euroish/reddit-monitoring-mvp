import assert from "node:assert/strict";
import test from "node:test";
import {
  compileContentFilter,
  decodeCursor,
  escapeLike,
  MAX_INDEXED_BODY_CHARS,
  normalizePublicSearchText,
  publicSearchDocument,
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
      sourceId: "requested", anyTerms: ["valid", "Ａ"],
    }),
    /two consecutive/,
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

test("publicSearchDocument caps body length and compileContentFilter compiles group, tier, language and hasMedia", () => {
  const longBody = "算".repeat(MAX_INDEXED_BODY_CHARS + 500);
  const doc = publicSearchDocument("标题", longBody, "2026-11-19T00:00:00Z");
  assert.equal(Array.from(doc.normalizedText).length, MAX_INDEXED_BODY_CHARS);
  const compiled = compileContentFilter(
    { allowedSourceIds: null },
    { sourceGroup: "ai-firsthand", tier: "T1", language: "zh", hasMedia: true },
  );
  assert.match(compiled.discovery, /cs\.source_group=/);
  assert.match(compiled.discovery, /cs\.tier=/);
  assert.match(compiled.text, /c\.language=/);
  assert.match(compiled.text, /jsonb_array_length\(c\.content_media\)>0/);
});
