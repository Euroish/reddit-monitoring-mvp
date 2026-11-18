import { createHash } from "node:crypto";
import type { ContentReference, SourceTarget } from "../../../packages/contracts/src/source-content";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import { fail } from "../../storage/db";
import { ContentProviderError, type CollectedContent, type ContentProvider } from "../shared/content-provider.interface";
import { KaixContentConnector } from "./kaix-content.connector";
import { resolveKaixConfig } from "./kaix.config";

const text = (value: unknown) => typeof value === "string" ? value : null;
const metric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

interface RedditRow {
  id?: unknown;
  name?: unknown;
  createdAt?: string;
  created_at?: string;
  endpoint?: string;
  permalink?: unknown;
  parent?: { id?: unknown };
  parent_id?: unknown;
  post_id?: unknown;
  depth?: number;
  authorInfo?: { id?: unknown; name?: unknown };
  author?: unknown;
  author_id?: unknown;
  authorName?: unknown;
  subreddit?: { prefixedName?: unknown };
  postInfo?: { id?: unknown; subreddit?: string | { prefixedName?: unknown } };
  content?: { markdown?: unknown; preview?: unknown };
  body?: unknown;
  score?: unknown;
  postTitle?: unknown;
  title?: unknown;
  commentCount?: unknown;
  upvoteRatio?: unknown;
  flair?: { text?: unknown };
  isNsfw?: unknown;
  is_removed?: boolean;
  removedByCategory?: unknown;
  removed_by_category?: unknown;
}

function normalize(row: RedditRow, sourceId: string, fetchedAt: string, runId: string): CollectedContent {
  const id = text(row.name) ?? text(row.id);
  const time = Date.parse(row.createdAt ?? row.created_at ?? "");
  if (!id || !/^t[13]_[a-z0-9]{2,32}$/.test(id) || !Number.isFinite(time))
    throw new ContentProviderError("Invalid red_crawler dataset record", false);
  const kind = id.startsWith("t1_") ? "comment" : "post";
  const permalink = text(row.permalink);
  const root = text(row.postInfo?.id ?? row.post_id);
  const handle = text(row.authorInfo?.name ?? row.author ?? row.authorName)?.replace(/^u\//, "");
  const community = text(row.subreddit?.prefixedName ?? (typeof row.postInfo?.subreddit === "object" ? row.postInfo.subreddit.prefixedName : row.postInfo?.subreddit) ?? permalink?.match(/^\/r\/([^/]+)/i)?.[1])?.replace(/^r\//i, "").toLowerCase();
  if (!community) throw new ContentProviderError("red_crawler record has no subreddit", false);
  const references: ContentReference[] = [];
  const parent = text(row.parent?.id ?? row.parent_id) ?? (row.endpoint === "post_comments" && row.depth === 0 ? root : null);
  for (const [relation, target] of [["thread_root", root], ["reply_to", parent]] as const) {
    if (target && /^t[13]_[a-z0-9]{2,32}$/.test(target)) {
      references.push({ relation, kind: target.startsWith("t1_") ? "comment" : "post", externalId: target });
    }
  }
  const body = text(row.content?.markdown ?? row.body ?? row.content?.preview);
  const deleted = body === "[deleted]";
  const removed = body === "[removed]" || Boolean(row.removedByCategory ?? row.removed_by_category ?? row.is_removed);
  const metrics = {
    "reddit.score": metric(row.score),
    "reddit.num_comments": metric(row.commentCount),
    "reddit.upvote_ratio": metric(row.upvoteRatio),
  };
  const content = {
    id: stableUuidFromString(`reddit:content:${id}`), platform: "reddit", kind, externalId: id,
    title: text(row.postTitle ?? row.title), text: deleted || removed ? null : body,
    url: permalink?.startsWith("/r/") ? `https://www.reddit.com${permalink}` :
      kind === "post" ? `https://www.reddit.com/comments/${id.slice(3)}` : null,
    publishedAt: new Date(time).toISOString(), language: null,
    author: handle && handle !== "[deleted]" ? {
      handle, externalId: text(row.authorInfo?.id ?? row.author_id), displayName: null,
      url: `https://www.reddit.com/user/${encodeURIComponent(handle)}/`,
    } : null,
    availability: deleted ? "deleted" : removed ? "removed" : "available",
    media: [], references,
    platformDetails: { platform: "reddit", community, flair: text(row.flair?.text), nsfw: typeof row.isNsfw === "boolean" ? row.isNsfw : null },
  } satisfies Omit<CollectedContent, "fetchedAt" | "observation">;
  return {
    ...content, fetchedAt, observation: {
      provider: "red_crawler", sourceId, sourceObservedAt: null, fetchedAt,
      timeBasis: "provider_snapshot", maturity: "unknown", metrics,
      evidenceKey: createHash("sha256").update(JSON.stringify([runId, content, metrics])).digest("hex"),
    },
  };
}

export function redCrawler(env = process.env, fetchPage = fetch): ContentProvider {
  const config = resolveKaixConfig(env);
  const kaix = new KaixContentConnector(config);
  const capability = {
    ...kaix.capability, provider: "red_crawler",
    targetTypes: ["search", "community", "post"] as SourceTarget["type"][],
    refreshByIds: false, limitations: ["One bounded search, community feed or post comment run per task"],
  };
  const normalizeTarget: ContentProvider["normalizeTarget"] = (target, kind) => {
    if (target.type === "search" && ["post", "comment"].includes(kind) && target.query.trim())
      return { type: "search", query: target.query.trim() };
    if (target.type === "community" || target.type === "post") {
      try { return kaix.normalizeTarget(target, kind); } catch { fail(422, "Invalid Reddit fallback target"); }
    }
    return fail(422, "red_crawler supports search, community feeds and post comments");
  };
  return {
    capability, normalizeTarget,
    async collectPage(request) {
      const target = normalizeTarget(request.source.target, request.source.contentKind);
      const execution = request.execution;
      if (!capability.enabled || !execution || request.includeComments && target.type !== "post")
        throw new ContentProviderError("red_crawler requires an enabled bounded search or a post comment task", false);
      const post = target.type === "post";
      const limit = post ? Math.min(50, request.limit) : Math.min(100, request.limit);
      const search = target.type === "search" || (target.type === "community" && !!target.query);
      const actor = search ? "reddit-search-v2" : "reddit-scrape-v2";
      const input = search && "query" in target ? {
        endpoint: "search", search_query: target.query,
        search_subreddit: target.type === "community" ? target.community : undefined,
        search_type: request.source.contentKind === "comment" ? "comments" : "posts",
        search_sort: "new", search_limit: limit,
      } : post ? {
        endpoint: "post_comments", post_comments_post: target.postId,
        post_comments_sort: request.commentSort ?? "new", post_comments_mode: "custom", post_comments_limit: limit,
      } : target.type === "community" ? {
        endpoint: "community_feed", community_feed_name: target.community,
        community_feed_sort: "new", community_feed_limit: limit,
      } : fail(422, "Unsupported Reddit fallback target");
      async function read(path: string, body?: object) {
        const timer = AbortSignal.timeout(20000);
        const response = await fetchPage(`https://api.apify.com/v2/${path}`, {
          method: body ? "POST" : "GET",
          body: body ? JSON.stringify(body) : undefined,
          headers: { Authorization: `Bearer ${config.apiToken}`, "Content-Type": "application/json" },
          signal: request.signal ? AbortSignal.any([timer, request.signal]) : timer,
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new ContentProviderError(`Apify returned HTTP ${response.status}`, false, 30, response.status);
        }
        return response.json();
      }
      const saved = execution.state;
      const oldId = saved && typeof saved === "object" && !Array.isArray(saved) ? saved.runId : null;
      const run = (await (typeof oldId === "string"
        ? read(`actor-runs/${encodeURIComponent(oldId)}`)
        : read(`acts/red_crawler~${actor}/runs?waitForFinish=0&restartOnError=false`, input))).data;
      const runId = text(run?.id), datasetId = text(run?.defaultDatasetId);
      if (!runId || !datasetId || !/^[A-Za-z0-9]+$/.test(runId) || !/^[A-Za-z0-9]+$/.test(datasetId))
        throw new ContentProviderError("Invalid red_crawler run receipt", false);
      const base = { nextCheckpoint: null, coverage: "partial" as const, warning: null };
      await execution.saveState({ phase: "running", runId, datasetId });
      if (["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(run.status))
        return { ...base, items: [], exhausted: false, pending: true };
      if (run.status !== "SUCCEEDED") throw new ContentProviderError("red_crawler run did not succeed", false);
      await execution.saveState({ phase: "reading", runId, datasetId });
      const rows = await read(`datasets/${datasetId}/items?clean=true&limit=${limit + 1}`);
      if (!Array.isArray(rows)) throw new ContentProviderError("Invalid red_crawler dataset", false);
      const fetchedAt = new Date().toISOString();
      const items = rows.slice(0, limit).map((row) => normalize(row, request.source.id, fetchedAt, runId))
        .filter((item) => post || (item.publishedAt! >= request.from && item.publishedAt! < request.to));
      return { ...base, items, exhausted: rows.length < limit };
    },
  };
}
