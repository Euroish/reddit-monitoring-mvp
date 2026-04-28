import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchText,
  ORDINARY_POST_BODY_MAX_CHARS,
  RETAINED_POST_BODY_MAX_CHARS,
  retainSearchBodySnippet,
  retainStoredPostBodyText,
  SEARCH_BODY_SNIPPET_MAX_CHARS,
} from "../../src/shared/text/content-text-retention";

test("retainStoredPostBodyText truncates ordinary post bodies", () => {
  const bodyText = "a".repeat(ORDINARY_POST_BODY_MAX_CHARS + 50);

  const retained = retainStoredPostBodyText({
    bodyText,
    score: 3,
    numComments: 1,
  });

  assert.equal(retained?.length, ORDINARY_POST_BODY_MAX_CHARS);
});

test("retainStoredPostBodyText keeps longer bodies for qualified or high-impact posts", () => {
  const qualifiedBody = "b".repeat(RETAINED_POST_BODY_MAX_CHARS + 100);

  const retained = retainStoredPostBodyText({
    bodyText: qualifiedBody,
    score: 24,
    numComments: 8,
  });

  assert.equal(retained?.length, RETAINED_POST_BODY_MAX_CHARS);
});

test("retainSearchBodySnippet and buildSearchText bound indexed body text", () => {
  const bodyText = "c".repeat(SEARCH_BODY_SNIPPET_MAX_CHARS + 120);

  const snippet = retainSearchBodySnippet(bodyText);
  const searchText = buildSearchText({
    title: "Searchable title",
    bodyText,
  });

  assert.equal(snippet?.length, SEARCH_BODY_SNIPPET_MAX_CHARS);
  assert.equal(
    searchText,
    `searchable title ${"c".repeat(SEARCH_BODY_SNIPPET_MAX_CHARS)}`,
  );
});

