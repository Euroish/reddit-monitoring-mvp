import type { ContentMedia, PlatformDetails } from "../../../packages/contracts/src/content";

type Row = Record<string, unknown>;
type RedditDetails = Extract<PlatformDetails, { platform: "reddit" }>;

const obj = (v: unknown): Row | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const nonNegInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

export function safeHttpUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 8) return null;
  try {
    const u = new URL(v.replace(/&amp;/g, "&"));
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

export function extractDomain(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "reddit.com" || host === "old.reddit.com" || host.endsWith(".reddit.com")) return null;
    return host;
  } catch {
    return null;
  }
}

function pushMedia(seen: Map<string, ContentMedia>, item: ContentMedia) {
  if (!seen.has(item.url) && seen.size < 40) seen.set(item.url, item);
}

function collectPreviewMedia(seen: Map<string, ContentMedia>, row: Row) {
  const preview = obj(row.preview);
  const images = Array.isArray(preview?.images) ? preview.images : [];
  for (const img of images) {
    const src = obj(obj(img)?.source);
    const url = safeHttpUrl(src?.url);
    if (url) pushMedia(seen, { type: "image", url, previewUrl: url, altText: null, durationSeconds: null });
  }
  const gallery = Array.isArray(row.galleryImages) ? row.galleryImages : Array.isArray(row.images) ? row.images : [];
  for (const entry of gallery) {
    const url = safeHttpUrl(typeof entry === "string" ? entry : obj(entry)?.url ?? obj(entry)?.src);
    if (url) pushMedia(seen, { type: "image", url, previewUrl: url, altText: null, durationSeconds: null });
  }
  const meta = obj(row.mediaMetadata);
  if (meta) {
    for (const val of Object.values(meta)) {
      const m = obj(val);
      const url = safeHttpUrl(obj(m?.s)?.u ?? obj(m?.s)?.gif);
      if (url) pushMedia(seen, { type: "image", url, previewUrl: url, altText: null, durationSeconds: null });
    }
  }
}

function collectVideoAndThumb(seen: Map<string, ContentMedia>, row: Row, linkedUrl: string | null) {
  const video = obj(row.redditVideo) ?? obj(obj(row.media)?.reddit_video) ?? obj(obj(row.secure_media)?.reddit_video);
  const thumb = safeHttpUrl(row.thumbnail) ?? safeHttpUrl(row.thumbnailUrl);
  const videoUrl = safeHttpUrl(video?.fallback_url ?? video?.hls_url ?? row.videoUrl);
  if (videoUrl) {
    const dur = typeof video?.duration === "number" && video.duration >= 0 ? video.duration : null;
    pushMedia(seen, { type: "video", url: videoUrl, previewUrl: thumb, altText: null, durationSeconds: dur });
  }
  const imageUrl = safeHttpUrl(row.imageUrl);
  if (imageUrl) pushMedia(seen, { type: "image", url: imageUrl, previewUrl: thumb ?? imageUrl, altText: null, durationSeconds: null });
  if (linkedUrl && /\.(?:png|jpe?g|webp|gif)(?:\?.*)?$/i.test(linkedUrl)) {
    pushMedia(seen, { type: "image", url: linkedUrl, previewUrl: thumb ?? linkedUrl, altText: null, durationSeconds: null });
  } else if (thumb && seen.size === 0) {
    pushMedia(seen, { type: "image", url: thumb, previewUrl: thumb, altText: null, durationSeconds: null });
  }
}

export function extractRedditMedia(row: Row, postUrl: string | null, linkedUrl: string | null): ContentMedia[] {
  const seen = new Map<string, ContentMedia>();
  collectPreviewMedia(seen, row);
  collectVideoAndThumb(seen, row, linkedUrl);
  if (linkedUrl && linkedUrl !== postUrl) {
    pushMedia(seen, { type: "link", url: linkedUrl, previewUrl: safeHttpUrl(row.thumbnail), altText: null, durationSeconds: null });
  }
  return [...seen.values()];
}

function optionalRedditExtras(row: Row, linkedUrl: string | null): Partial<RedditDetails> {
  const rawDomain = str(row.domain)?.toLowerCase().replace(/^www\./, "") ?? extractDomain(linkedUrl);
  const domain = rawDomain && !rawDomain.startsWith("self.") && rawDomain !== "reddit.com" ? rawDomain : null;
  const authorFlair = str(row.authorFlairText ?? obj(row.authorFlair)?.text);
  const awards = nonNegInt(row.totalAwardsReceived ?? row.total_awards_received ?? (Array.isArray(row.all_awardings) ? row.all_awardings.length : null));
  const crossposts = nonNegInt(row.numCrossposts ?? row.num_crossposts);
  const subs = nonNegInt(row.subredditSubscribers ?? obj(row.subreddit)?.subscribers);
  const selfFlag = typeof row.isSelf === "boolean" ? row.isSelf : typeof row.is_self === "boolean" ? row.is_self : null;
  return {
    ...(domain ? { domain } : {}),
    ...(selfFlag !== null ? { isSelf: selfFlag } : {}),
    ...(typeof row.stickied === "boolean" ? { stickied: row.stickied } : {}),
    ...(awards !== null ? { awards } : {}),
    ...(crossposts !== null ? { crossposts } : {}),
    ...(authorFlair ? { authorFlair } : {}),
    ...(subs !== null ? { subredditSubscribers: subs } : {}),
  };
}

export function buildRedditDetails(row: Row, community: string, linkedUrl: string | null): RedditDetails {
  const nsfw = typeof row.over18 === "boolean" ? row.over18 : typeof row.isNsfw === "boolean" ? row.isNsfw : null;
  return {
    platform: "reddit",
    community,
    flair: str(obj(row.flair)?.text ?? row.linkFlairText),
    nsfw,
    ...optionalRedditExtras(row, linkedUrl),
  };
}
