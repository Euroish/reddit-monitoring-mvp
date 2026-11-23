export interface PeriodDelta {
  current: number;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
  status: "up" | "down" | "flat" | "new" | "unknown";
}

export function computePeriodDelta(current: number, previous: number | null): PeriodDelta {
  if (previous === null) {
    return { current, previous: null, delta: null, deltaPct: null, status: "unknown" };
  }
  if (previous === 0) {
    return current > 0
      ? { current, previous: 0, delta: current, deltaPct: null, status: "new" }
      : { current: 0, previous: 0, delta: 0, deltaPct: 0, status: "flat" };
  }
  const delta = Number((current - previous).toFixed(4));
  const deltaPct = Number(((current - previous) / Math.abs(previous)).toFixed(4));
  const status = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { current, previous, delta, deltaPct, status };
}

export function computeEngagementRate(input: {
  score?: number | null;
  likes?: number | null;
  comments?: number | null;
  reposts?: number | null;
  bookmarks?: number | null;
  views?: number | null;
  followers?: number | null;
}): { rate: number | null; basis: "by_views" | "by_followers" | "unavailable" } {
  const numerator =
    Math.max(0, input.score ?? 0) +
    Math.max(0, input.likes ?? 0) +
    2 * Math.max(0, input.comments ?? 0) +
    2 * Math.max(0, input.reposts ?? 0) +
    3 * Math.max(0, input.bookmarks ?? 0);
  if (input.views && input.views > 0) {
    return { rate: Number((numerator / input.views).toFixed(4)), basis: "by_views" };
  }
  if (input.followers && input.followers > 0) {
    return { rate: Number((numerator / input.followers).toFixed(4)), basis: "by_followers" };
  }
  return { rate: null, basis: "unavailable" };
}

export function packXAccountBatches(handles: readonly string[], batchSize = 15): string[][] {
  const clean = [
    ...new Set(
      handles
        .map((h) => h.trim().replace(/^@/, "").toLowerCase())
        .filter((h) => /^[a-z0-9_]{1,15}$/.test(h)),
    ),
  ];
  const size = Math.max(1, Math.min(20, batchSize));
  const batches: string[][] = [];
  for (let i = 0; i < clean.length; i += size) {
    batches.push(clean.slice(i, i + size));
  }
  return batches;
}

export function computeShareOfVoice(
  entries: ReadonlyArray<{ label: string; role: string; mentions: number; engagement: number }>,
) {
  const totalMentions = entries.reduce((sum, e) => sum + e.mentions, 0);
  const totalEngagement = entries.reduce((sum, e) => sum + e.engagement, 0);
  return entries.map((e) => ({
    label: e.label,
    role: e.role,
    mentions: e.mentions,
    engagement: Number(e.engagement.toFixed(2)),
    volumeShare: totalMentions > 0 ? Number((e.mentions / totalMentions).toFixed(4)) : 0,
    weightedShare: totalEngagement > 0 ? Number((e.engagement / totalEngagement).toFixed(4)) : 0,
  }));
}

export function mergeTopDomains(
  lists: ReadonlyArray<ReadonlyArray<{ domain: string; count: number; totalEngagement: number }>>,
  limit = 12,
) {
  const acc = new Map<string, { domain: string; count: number; totalEngagement: number }>();
  for (const items of lists) {
    for (const item of items) {
      const prev = acc.get(item.domain) ?? { domain: item.domain, count: 0, totalEngagement: 0 };
      prev.count += item.count;
      prev.totalEngagement += item.totalEngagement;
      acc.set(item.domain, prev);
    }
  }
  return [...acc.values()]
    .map((d) => ({ ...d, totalEngagement: Number(d.totalEngagement.toFixed(2)) }))
    .sort((a, b) => b.totalEngagement - a.totalEngagement || b.count - a.count)
    .slice(0, limit);
}

const STOPWORDS = new Set(
  "the and for with that this from have what your you are was were they will been more about into than when where how why which can could would should just like using use very also much over only them their there here out get got make made best top new".split(" "),
);

export function extractCooccurringTerms(
  samples: ReadonlyArray<{ title: string | null; excerpt: string | null; hashtags: readonly string[] }>,
  seedTerms: readonly string[],
  limit = 15,
): Array<{ term: string; count: number }> {
  const excluded = new Set(
    seedTerms
      .flatMap((t) => t.toLowerCase().split(/\s+/))
      .map((s) => s.replace(/[^a-z0-9\u4e00-\u9fff_-]/g, ""))
      .filter(Boolean),
  );
  const counts = new Map<string, number>();
  for (const s of samples) {
    const seenInDoc = new Set<string>();
    for (const tag of s.hashtags) {
      const low = tag.toLowerCase();
      if (low.length >= 2 && !excluded.has(low)) seenInDoc.add(`#${low}`);
    }
    const text = `${s.title ?? ""} ${s.excerpt ?? ""}`.toLowerCase();
    for (const m of text.matchAll(/\b[a-z][a-z0-9_-]{2,24}\b/g)) {
      const tok = m[0];
      if (!STOPWORDS.has(tok) && !excluded.has(tok)) seenInDoc.add(tok);
    }
    for (const tok of seenInDoc) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}
