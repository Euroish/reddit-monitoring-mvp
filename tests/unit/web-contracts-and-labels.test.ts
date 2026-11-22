import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CAPABILITIES,
  mergeServerCapabilities,
} from "../../apps/web/src/contracts/api.js";
import {
  SOURCE_GROUPS,
  TIER_SHORT,
  decodeHtmlEntities,
  formatExactTime,
  formatRelativeTime,
  safeHttpUrl,
  shiftUtcDate,
  toSafeUtcIso,
  toUtcDatetimeLocal,
} from "../../apps/web/src/lib/sourceLabels.js";

describe("mergeServerCapabilities", () => {
  it("applies dynamic server overrides for limits, comments, fallback, and flags", () => {
    const merged = mergeServerCapabilities([
      {
        platform: "reddit",
        provider: "kaix",
        enabled: false,
        targetTypes: ["community"],
        contentKinds: ["post"],
        maxLimit: 75,
        supportsComments: false,
        maxCommentsPerPost: null,
        refreshByIds: false,
        automaticRequestReplay: true,
        fallbackAllowed: [],
      },
      {
        platform: "web",
        provider: "feed",
        enabled: true,
        maxLimit: 250,
        supportsComments: true,
        maxCommentsPerPost: 15,
        fallbackAllowed: ["scrapebadger"],
      },
    ]);

    const reddit = merged.find((c) => c.platform === "reddit" && c.provider === "kaix");
    assert.ok(reddit);
    assert.equal(reddit.enabled, false);
    assert.deepEqual(reddit.targetTypes, ["community"]);
    assert.deepEqual(reddit.contentKinds, ["post"]);
    assert.equal(reddit.maxLimit, 75);
    assert.equal(reddit.supportsComments, false);
    assert.equal(reddit.maxCommentsPerPost, null);
    assert.equal(reddit.refreshByIds, false);
    assert.equal(reddit.automaticRequestReplay, true);
    assert.deepEqual(reddit.fallbackAllowed, []);

    const feed = merged.find((c) => c.platform === "web" && c.provider === "feed");
    assert.ok(feed);
    assert.equal(feed.maxLimit, 250);
    assert.equal(feed.supportsComments, true);
    assert.equal(feed.maxCommentsPerPost, 15);
    assert.deepEqual(feed.fallbackAllowed, ["scrapebadger"]);
  });

  it("ignores invalid types and falls back to defaults cleanly", () => {
    const merged = mergeServerCapabilities([
      {
        platform: "reddit",
        provider: "kaix",
        enabled: "yes",
        maxLimit: Number.NaN,
        supportsComments: 1,
        maxCommentsPerPost: "ten",
        fallbackAllowed: "red_crawler",
      },
    ]);
    const base = DEFAULT_CAPABILITIES.find((c) => c.platform === "reddit" && c.provider === "kaix")!;
    const actual = merged.find((c) => c.platform === "reddit" && c.provider === "kaix")!;
    assert.equal(actual.enabled, base.enabled);
    assert.equal(actual.maxLimit, base.maxLimit);
    assert.equal(actual.supportsComments, base.supportsComments);
    assert.equal(actual.maxCommentsPerPost, base.maxCommentsPerPost);
    assert.deepEqual(actual.fallbackAllowed, base.fallbackAllowed);
  });
});

describe("sourceLabels utilities", () => {
  it("exposes all 8 source groups and tier labels", () => {
    assert.equal(Object.keys(SOURCE_GROUPS).length, 8);
    assert.equal(TIER_SHORT.T1, "T1");
    assert.equal(TIER_SHORT.T1_5, "T1.5");
    assert.equal(TIER_SHORT.T2, "T2");
  });

  it("validates external http/https URLs strictly", () => {
    assert.equal(safeHttpUrl("https://example.com/a"), "https://example.com/a");
    assert.equal(safeHttpUrl("http://example.com/b"), "http://example.com/b");
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl("data:text/html,hi"), null);
    assert.equal(safeHttpUrl(null), null);
  });

  it("decodes named and numeric HTML entities safely", () => {
    assert.equal(
      decodeHtmlEntities("AT&amp;T &mdash; &ldquo;AI&rdquo; &#39;ok&#39; &#x2192;"),
      "AT&T — “AI” 'ok' →",
    );
    assert.equal(decodeHtmlEntities(null), "");
  });

  it("formats and parses UTC dates safely", () => {
    assert.equal(shiftUtcDate("2026-04-10", -1), "2026-04-09");
    assert.equal(shiftUtcDate("2026-04-10", 2), "2026-04-12");
    assert.equal(toUtcDatetimeLocal("2026-04-10T08:30"), "2026-04-10T08:30");
    assert.equal(toUtcDatetimeLocal("not-a-date"), "");
    assert.equal(toSafeUtcIso("2026-04-10T08:30"), "2026-04-10T08:30:00.000Z");
    assert.equal(toSafeUtcIso("invalid"), null);
    assert.equal(formatExactTime("invalid"), "时间未知");
    assert.equal(formatRelativeTime(null), "时间未知");
  });
});
