import type { Pool, PoolClient } from "pg";
import type { ContentCardLayout, ContentIntentTag } from "../../../packages/contracts/src/content";
import type { CollectedContent } from "../../connectors/shared/content-provider.interface";

export interface EnrichedContentFields {
  authorHandle: string | null;
  communityName: string | null;
  externalDomain: string | null;
  hashtags: string[];
  hasMedia: boolean;
  primaryMediaUrl: string | null;
  cardLayout: ContentCardLayout;
  cleanExcerpt: string | null;
  intentTag: ContentIntentTag | null;
  intentConfidence: number | null;
  enrichmentVersion: number;
  enrichmentSource: string;
  metricScore: number | null;
  metricComments: number | null;
  metricViews: number | null;
  metricLikes: number | null;
  metricReposts: number | null;
  metricBookmarks: number | null;
  upvoteRatio: number | null;
  engagementScore: number;
  discussionRatio: number;
}

export interface AuthorProfileRecord {
  handle: string;
  externalId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  verified: boolean;
  followersCount: number | null;
  followingCount: number | null;
  statusesCount: number | null;
  accountCreatedAt: string | null;
  lastSeenAt: string;
}

export interface ContentEnricher {
  readonly version: number;
  readonly source: string;
  enrich(item: CollectedContent): EnrichedContentFields;
}

const numMetric = (metrics: Record<string, number | null>, key: string): number | null => {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
};

const floatMetric = (metrics: Record<string, number | null>, key: string): number | null => {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

export function normalizeCleanText(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^[#>*\-\s]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length <= 220) return cleaned;
  const slice = cleaned.slice(0, 220);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("。"), slice.lastIndexOf(" "));
  return (lastStop > 120 ? slice.slice(0, lastStop) : slice).trim();
}

function hostFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || ["reddit.com", "old.reddit.com", "x.com", "twitter.com", "t.co"].includes(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function extractDomain(item: CollectedContent): string | null {
  const details = item.platformDetails;
  if (details.platform === "reddit" && details.domain) return details.domain.toLowerCase();
  if (details.platform === "x" && details.externalDomain) return details.externalDomain.toLowerCase();
  if (details.platform === "web" && details.publisher) return details.publisher.toLowerCase().replace(/^www\./, "");
  const linked = item.media.find((m) => m.type === "link")?.url ?? null;
  return hostFromUrl(linked) ?? hostFromUrl(item.url);
}

function extractHashtags(item: CollectedContent): string[] {
  const tags = new Set<string>();
  if (item.platformDetails.platform === "x" && item.platformDetails.hashtags) {
    for (const t of item.platformDetails.hashtags) tags.add(t.toLowerCase());
  }
  const source = `${item.title ?? ""} ${item.text ?? ""}`;
  for (const match of source.matchAll(/(?:^|\s)#([a-zA-Z0-9_]{2,32})/g)) {
    tags.add(match[1].toLowerCase());
    if (tags.size >= 25) break;
  }
  return [...tags];
}

export function classifyIntent(title: string | null, text: string | null, platform: string): {
  tag: ContentIntentTag | null;
  confidence: number | null;
} {
  const sample = `${title ?? ""}\n${(text ?? "").slice(0, 600)}`.toLowerCase();
  if (!sample.trim()) return { tag: null, confidence: null };
  if (/\b(?:vs\.?|versus|alternative to|alternatives|better than|compared to|switch from|migrating from)\b|对比|替代/.test(sample)) {
    return { tag: "comparison", confidence: 0.78 };
  }
  if (/\b(?:frustrating|broken|issue|bug|slow|expensive|pricing|sucks|disappointed|why does|hate|nightmare|cant even|can't)\b|吐槽|踩坑|难用|太贵|崩溃/.test(sample)) {
    return { tag: "pain", confidence: 0.74 };
  }
  if (/\b(?:show hn|launching|released|introducing|open-sourced|announcing|v\d+\.\d+|changelog|we built)\b|开源了|发布|上线/.test(sample)) {
    return { tag: "launch", confidence: 0.8 };
  }
  if (/\?$|^(?:how|what|why|which|anyone|recommend|looking for|is there)\b|\b(?:how do you|best way to|worth it)\b|求助|请问|推荐|怎么选/.test(sample.trim())) {
    return { tag: "question", confidence: 0.72 };
  }
  return platform === "web" ? { tag: "news", confidence: 0.6 } : { tag: "discussion", confidence: 0.65 };
}

function pickCardLayout(
  item: CollectedContent,
  hasVisualMedia: boolean,
  comments: number | null,
  externalDomain: string | null,
): ContentCardLayout {
  if (hasVisualMedia) return "hero_media";
  if (item.platform === "x" || item.references.some((r) => r.relation === "quote")) return "quote_social";
  if (item.kind === "post" && (item.platform === "reddit" || (comments ?? 0) >= 8)) return "discussion_thread";
  if (externalDomain) return "link_preview";
  return "compact_signal";
}

export const heuristicV1Enricher: ContentEnricher = {
  version: 1,
  source: "heuristic_v1",
  enrich(item: CollectedContent): EnrichedContentFields {
    const m = item.observation.metrics;
    const metricScore = numMetric(m, "reddit.score");
    const metricComments = numMetric(m, "reddit.num_comments") ?? numMetric(m, "x.replies");
    const metricViews = numMetric(m, "x.views");
    const metricLikes = numMetric(m, "x.likes");
    const metricReposts = numMetric(m, "x.reposts") ?? numMetric(m, "bsky.reposts");
    const metricBookmarks = numMetric(m, "x.bookmarks");
    const upvoteRatio = floatMetric(m, "reddit.upvote_ratio");

    const primarySignal = Math.max(0, metricScore ?? metricLikes ?? 0);
    const commentSignal = Math.max(0, metricComments ?? 0);
    const repostSignal = Math.max(0, metricReposts ?? 0);
    const engagementScore = Number(
      (Math.log1p(primarySignal) + 1.6 * Math.log1p(commentSignal) + 0.8 * Math.log1p(repostSignal)).toFixed(4),
    );
    const discussionRatio = primarySignal > 0
      ? Number((commentSignal / Math.max(1, primarySignal)).toFixed(4))
      : 0;

    const visual = item.media.find((entry) => entry.type === "image" || entry.type === "video");
    const primaryMediaUrl = visual ? (visual.previewUrl ?? visual.url) : null;
    const externalDomain = extractDomain(item);
    const authorHandle = item.author?.handle ? item.author.handle.replace(/^[@u/]+/i, "").toLowerCase() : null;
    const communityName = item.platformDetails.platform === "reddit"
      ? item.platformDetails.community.replace(/^r\//i, "").toLowerCase()
      : null;
    const cleanExcerpt = item.availability === "available" ? normalizeCleanText(item.text) : null;
    const intent = item.availability === "available"
      ? classifyIntent(item.title, item.text, item.platform)
      : { tag: null, confidence: null };

    return {
      authorHandle,
      communityName,
      externalDomain,
      hashtags: extractHashtags(item),
      hasMedia: item.media.length > 0,
      primaryMediaUrl,
      cardLayout: pickCardLayout(item, Boolean(visual), metricComments, externalDomain),
      cleanExcerpt,
      intentTag: intent.tag,
      intentConfidence: intent.confidence,
      enrichmentVersion: this.version,
      enrichmentSource: this.source,
      metricScore,
      metricComments,
      metricViews,
      metricLikes,
      metricReposts,
      metricBookmarks,
      upvoteRatio,
      engagementScore,
      discussionRatio,
    };
  },
};

export function toAuthorProfileRecord(item: CollectedContent): AuthorProfileRecord | null {
  const author = item.author;
  if (!author?.handle) return null;
  const handle = author.handle.replace(/^[@u/]+/i, "").trim().toLowerCase();
  if (!handle) return null;
  return {
    handle,
    externalId: author.externalId ?? null,
    displayName: author.displayName ?? null,
    avatarUrl: author.avatarUrl ?? null,
    bio: author.bio ?? null,
    location: author.location ?? null,
    verified: Boolean(author.verified),
    followersCount: author.followersCount ?? null,
    followingCount: author.followingCount ?? null,
    statusesCount: author.statusesCount ?? null,
    accountCreatedAt: author.accountCreatedAt ?? null,
    lastSeenAt: item.fetchedAt,
  };
}

export interface ContentEnrichmentUpgrade {
  contentId: string;
  cleanExcerpt: string | null;
  intentTag: ContentIntentTag | null;
  intentConfidence: number | null;
  enrichmentVersion: number;
  enrichmentSource: string;
}

/**
 * Pluggable upgrade hook for future LLM / classifier background workers.
 * Preserves newer versions and keeps content write ownership strictly inside `content`.
 */
export async function upgradeContentEnrichment(
  db: Pool | PoolClient,
  upgrades: readonly ContentEnrichmentUpgrade[],
): Promise<number> {
  if (!upgrades.length) return 0;
  const result = await db.query(
    `UPDATE content c SET
       clean_excerpt = COALESCE(u.clean_excerpt, c.clean_excerpt),
       intent_tag = COALESCE(u.intent_tag, c.intent_tag),
       intent_confidence = COALESCE(u.intent_confidence, c.intent_confidence),
       enrichment_version = u.enrichment_version,
       enrichment_source = u.enrichment_source
     FROM (
       SELECT
         (v->>'contentId')::uuid AS content_id,
         v->>'cleanExcerpt' AS clean_excerpt,
         v->>'intentTag' AS intent_tag,
         (v->>'intentConfidence')::real AS intent_confidence,
         (v->>'enrichmentVersion')::smallint AS enrichment_version,
         v->>'enrichmentSource' AS enrichment_source
       FROM UNNEST($1::jsonb[]) AS input(v)
     ) u
     WHERE c.id = u.content_id
       AND u.enrichment_version >= c.enrichment_version`,
    [upgrades.map((u) => JSON.stringify(u))],
  );
  return result.rowCount ?? 0;
}
