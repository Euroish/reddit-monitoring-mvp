import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { StoryFeed, StoryItem } from "../../apps/web/src/contracts/api.js";
import {
  MAX_STORY_OFFSET_LIMIT,
  buildHomeFeedSections,
  formatDigestWindowBadge,
  formatStoryTimeInfo,
  formatTrendSummary,
  hasMeaningfulSparkline,
  selectHomeFeaturedStory,
  storiesOverlap,
} from "../../apps/web/src/lib/homeFeedPresentation.js";

function makeStory(overrides: Partial<StoryItem> & { id: string; key?: string }): StoryItem {
  const now = "2026-11-22T02:00:00.000Z";
  return {
    storyKey: overrides.key ?? `story-${overrides.id}`,
    representative: {
      id: overrides.id,
      platform: "web",
      title: `Story title ${overrides.id}`,
      url: `https://example.org/${overrides.id}`,
      author: "Author",
      thumbnail: null,
      sourceId: `src-${overrides.id}`,
      sourceLabel: `Source ${overrides.id}`,
      tier: "T1_5",
      publishedAt: now,
      discoveredAt: now,
      ...(overrides.representative ?? {}),
    },
    excerpt: overrides.excerpt !== undefined ? overrides.excerpt : "Readable story excerpt with enough context.",
    related: overrides.related ?? [],
    relatedCount: overrides.relatedCount ?? 0,
    sourceCount: overrides.sourceCount ?? 1,
    heat48h: overrides.heat48h ?? 2.0,
    tierBreakdown: overrides.tierBreakdown ?? { T1: 0, T1_5: 1, T2: 0 },
    sparkline48h: overrides.sparkline48h ?? [0, 0, 0, 0, 0, 0, 0, 0],
    change6h: overrides.change6h !== undefined ? overrides.change6h : null,
    trend: overrides.trend ?? "unknown",
    badges: overrides.badges ?? [],
    updatedAt: overrides.updatedAt ?? now,
  };
}

function makeFeed(items: StoryItem[], nextOffset: number | null = null): StoryFeed {
  return {
    view: "latest",
    from: "2026-11-15T00:00:00.000Z",
    to: "2026-11-22T00:00:00.000Z",
    items,
    totalCount: items.length,
    nextOffset,
    coverage: "stored_sample",
  };
}

describe("homeFeedPresentation", () => {
  it("returns null featured story on empty input and selects deterministically for 1+ items", () => {
    assert.equal(selectHomeFeaturedStory([], [], Date.parse("2026-11-22T03:00:00Z")), null);

    const single = makeStory({ id: "only-1", representative: { ...makeStory({ id: "only-1" }).representative, tier: "T1" } });
    const picked = selectHomeFeaturedStory([single], [], Date.parse("2026-11-22T03:00:00Z"));
    assert.ok(picked);
    assert.equal(picked.story.storyKey, single.storyKey);
    assert.equal(picked.reasonKey, "recent_firsthand");
    assert.equal(picked.hotRank, null);
    assert.equal(picked.template, "editorial");
  });

  it("prefers recent multi-source hot story and preserves real 1-based hot rank", () => {
    const nowMs = Date.parse("2026-11-22T03:00:00Z");
    const olderT2 = makeStory({
      id: "old-1",
      representative: {
        ...makeStory({ id: "old-1" }).representative,
        tier: "T2",
        publishedAt: "2026-11-17T00:00:00.000Z",
      },
      sourceCount: 1,
    });
    const hotLeader = makeStory({
      id: "hot-1",
      representative: {
        ...makeStory({ id: "hot-1" }).representative,
        tier: "T1",
        publishedAt: "2026-11-22T01:00:00.000Z",
      },
      sourceCount: 3,
      heat48h: 9.4,
      sparkline48h: [0, 0, 1, 2, 2, 3, 4, 6],
    });
    const picked = selectHomeFeaturedStory([olderT2, hotLeader], [hotLeader], nowMs);
    assert.ok(picked);
    assert.equal(picked.story.storyKey, hotLeader.storyKey);
    assert.equal(picked.hotRank, 1);
    assert.equal(picked.reasonKey, "multi_source_momentum");
    assert.equal(picked.template, "data");
  });

  it("does not merge distinct stories with similar titles, but detects overlap by representative ID or canonical URL", () => {
    const a = makeStory({
      id: "doc-a",
      key: "k-a",
      representative: { ...makeStory({ id: "doc-a" }).representative, title: "Model v2 release", url: "https://example.org/post-1/" },
    });
    const bSameUrl = makeStory({
      id: "doc-b",
      key: "k-b",
      representative: { ...makeStory({ id: "doc-b" }).representative, title: "Different headline", url: "https://example.org/post-1#top" },
    });
    const cSimilarTitle = makeStory({
      id: "doc-c",
      key: "k-c",
      representative: { ...makeStory({ id: "doc-c" }).representative, title: "Model v2 release", url: "https://example.org/post-2" },
    });
    assert.equal(storiesOverlap(a, bSameUrl), true);
    assert.equal(storiesOverlap(a, cSimilarTitle), false);
  });

  it("deduplicates across pages, preserves sparse channels, and uses raw server nextOffset", () => {
    const items = Array.from({ length: 12 }, (_, idx) => makeStory({ id: `s-${idx + 1}` }));
    const featured = items[0];
    const hotItems = [items[0], items[1]];

    const page1 = makeFeed(items.slice(0, 8), 8);
    const page2 = makeFeed([items[7], ...items.slice(8)], 16); // overlaps items[7]

    const sections = buildHomeFeedSections({
      pages: [page1, page2],
      featured,
      hotItems,
      selectedGroup: "",
    });

    assert.equal(sections.allVisible.length, 10); // 12 unique - 2 excluded (featured + hot[1])
    assert.equal(sections.leadCards.length, 3);
    assert.equal(sections.upperRows.length, 3);
    assert.equal(sections.lowerRows.length, 4);
    assert.equal(sections.hasMore, true);
    assert.equal(sections.nextOffset, 16); // raw server nextOffset, not deduped length

    // Sparse channel with 1 item matching featured must NOT become empty
    const sparse = buildHomeFeedSections({
      pages: [makeFeed([featured], null)],
      featured,
      hotItems,
      selectedGroup: "ai-firsthand",
    });
    assert.equal(sparse.allVisible.length, 1);
    assert.equal(sparse.leadCards.length, 1);
    assert.equal(sparse.hasMore, false);

    // Offset beyond contract limit stops cleanly
    const capped = buildHomeFeedSections({
      pages: [makeFeed(items, MAX_STORY_OFFSET_LIMIT + 1)],
      featured: null,
      hotItems: [],
      selectedGroup: "",
    });
    assert.equal(capped.hasMore, false);
    assert.equal(capped.reachedOffsetLimit, true);
  });

  it("formats publishedAt fallback, Asia/Shanghai digest window, and honest trends", () => {
    const withPub = makeStory({ id: "t1" }).representative;
    assert.equal(formatStoryTimeInfo(withPub).isFallback, false);

    const noPub = { ...withPub, publishedAt: null, discoveredAt: "2026-11-21T10:00:00.000Z" };
    const fallback = formatStoryTimeInfo(noPub);
    assert.equal(fallback.isFallback, true);
    assert.equal(fallback.iso, "2026-11-21T10:00:00.000Z");

    // 2026-11-22T00:00:00Z is 2026-11-22 08:00 Asia/Shanghai
    const badgeZh = formatDigestWindowBadge({ from: "2026-11-21T00:00:00.000Z", to: "2026-11-22T00:00:00.000Z" }, "zh");
    assert.deepEqual(badgeZh, {
      monthLabel: "11月",
      dayLabel: "22日",
      dateIso: "2026-11-22",
      windowLabel: "11月22日 08:00 CST 前 24 小时",
    });

    assert.equal(formatDigestWindowBadge(null, "en"), null);
    assert.equal(hasMeaningfulSparkline([0, 0, 0, 0, 0, 0, 0, 0]), false);
    assert.equal(hasMeaningfulSparkline([0, 0, 1.2, 0, 0, 0, 0, 0]), true);

    assert.equal(formatTrendSummary({ trend: "unknown", change6h: null }, "zh").tone, "neutral");
    assert.equal(formatTrendSummary({ trend: "down", change6h: -0.25 }, "en").label, "-25%");
    assert.equal(formatTrendSummary({ trend: "new", change6h: null }, "zh").label, "新上榜");
  });
});
