import { createHash } from "node:crypto";
import type {
  ContentReference } from "../../../packages/contracts/src/source-content";
import { PublicContentKind } from "../../../packages/contracts/src/common";
import { SourceCapability, SourceTarget } from "../../../packages/contracts/src/collection";
import { stableUuidFromString } from "../../shared/ids/stable-id";
import type { KaixConfig } from "./kaix.config";
import {
  ContentProviderError,
  type CollectedContent,
  type CollectContentPageRequest,
  type ContentProvider,
} from "../shared/content-provider.interface";

const WARNING =
  "Bounded kaix sample; no continuation cursor. New sorting may fall back to relevance. Local date filtering does not establish complete coverage; native upstream query semantics are retained. Comment-only targets are accounts or individual posts.";
type Row = Record<string, unknown>;
const object = (v: unknown): Row | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const number = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
function httpUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}

/** One bounded Actor run per collection operation. Never automatically resubmit an ambiguous paid POST. */
export class KaixContentConnector implements ContentProvider {
  readonly capability: SourceCapability;
  constructor(
    private readonly config: KaixConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now = () => new Date().toISOString(),
  ) {
    this.capability = {
      platform: "reddit",
      provider: "kaix",
      get enabled() {
        return config.networkEnabled && Boolean(config.getApiToken?.() ?? config.apiToken);
      },
      contentKinds: ["post", "comment"],
      targetTypes: ["community", "account", "post", "search"],
      keywordSearch: "global",
      observationModel: "snapshot",
      metrics: [
        {
          key: "reddit.score",
          label: "Score",
          unit: "count",
          cumulative: false,
          signed: true,
          contentKinds: ["post", "comment"],
          direction: "higher",
        },
        {
          key: "reddit.num_comments",
          label: "Comments",
          unit: "count",
          cumulative: true,
          signed: false,
          contentKinds: ["post"],
          direction: "higher",
        },
        {
          key: "reddit.upvote_ratio",
          label: "Upvote ratio",
          unit: "ratio",
          cumulative: false,
          signed: false,
          contentKinds: ["post"],
          direction: "higher",
        },
      ],
      requestResourceUpperBound: 101,
      automaticRequestReplay: false,
      limitations: [
        WARNING,
        "Apify Actor build 0.2.25.",
        "Source metric observation time is unknown. No automatic maturity refresh.",
        ...(!config.networkEnabled || !(config.getApiToken?.() ?? config.apiToken)
          ? ["Requires live networking and private APIFY_API_TOKEN."]
          : []),
      ],
    };
  }

  normalizeTarget(target: SourceTarget, kind: PublicContentKind): SourceTarget {
    if (
      !target ||
      !["post", "comment"].includes(kind) ||
      !this.capability.targetTypes.includes(target.type)
    )
      throw new ContentProviderError(
        "Unsupported kaix target/content kind",
        false,
      );
    const query = "query" in target ? target.query : undefined;
    if (
      query !== undefined &&
      (typeof query !== "string" ||
        !query.trim() ||
        query.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(query))
    )
      throw new ContentProviderError(
        "Kaix query must contain 1–200 characters without controls",
        false,
      );
    if (target.type === "search") {
      if (!query || kind !== "post")
        throw new ContentProviderError(
          "Kaix global search collects posts only",
          false,
        );
      return { type: "search", query: query.trim() };
    }
    if (target.type === "feed")
      throw new ContentProviderError("Unsupported kaix target", false);
    if (
      (target.type === "community" && kind !== "post") ||
      (target.type === "post" && kind !== "comment")
    )
      throw new ContentProviderError(
        "Kaix community targets collect posts; post targets collect comments",
        false,
      );
    const raw =
      target.type === "community"
        ? target.community
        : target.type === "account"
          ? target.account
          : target.postId;
    if (typeof raw !== "string")
      throw new ContentProviderError("Invalid kaix target identifier", false);
    const name = raw
      .trim()
      .replace(/^[ru]\//i, "")
      .replace(/^t3_/i, "")
      .toLowerCase();
    if (
      !(
        target.type === "post" ? /^[a-z0-9]{2,32}$/ : /^[a-z0-9_-]{2,40}$/
      ).test(name)
    )
      throw new ContentProviderError("Invalid kaix target identifier", false);
    const filter = query ? { query: query.trim() } : {};
    return target.type === "community"
      ? { type: "community", community: name, ...filter }
      : target.type === "account"
        ? { type: "account", account: name, ...filter }
        : { type: "post", postId: name, ...filter };
  }

  async collectPage(request: CollectContentPageRequest) {
    if (!this.capability.enabled)
      throw new ContentProviderError(
        "Kaix collection disabled; configure live networking and APIFY_API_TOKEN",
        false,
      );
    if (
      request.source.platform !== "reddit" ||
      request.source.primaryProvider !== "kaix"
    )
      throw new ContentProviderError("Unsupported kaix source", false);
    if (request.checkpoint !== null)
      throw new ContentProviderError(
        "Kaix does not support continuation checkpoints",
        false,
      );
    if (
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 300
    )
      throw new ContentProviderError("Kaix page size must be 1–300", false);
    const from = Date.parse(request.from),
      to = Date.parse(request.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
      throw new ContentProviderError("Invalid kaix collection window", false);
    const target = this.normalizeTarget(
      request.source.target,
      request.source.contentKind,
    );
    request.signal?.throwIfAborted();
    const thread = target.type === "post";
    const comments = thread || (request.includeComments ?? false);
    const commentLimit = thread
      ? Math.min(request.limit, request.maxCommentsPerPost ?? 50)
      : request.maxCommentsPerPost ?? 15;
    const maxRows = thread
      ? 1 + commentLimit
      : request.limit * (comments ? commentLimit + 1 : 1);
    if (
      maxRows > 2000 ||
      !Number.isInteger(commentLimit) ||
      commentLimit < 1 ||
      commentLimit > 50
    )
      throw new ContentProviderError(
        "Kaix batch exceeds 2000 rows or 50 comments per post",
        false,
      );
    const input: Row = {
      depth: "detailed",
      includeNsfw: true,
      includeComments: comments,
      maxCommentsPerPost: commentLimit,
      ...(thread
        ? { commentSort: request.commentSort ?? "top" }
        : { sort: "new", time: "all", maxItems: request.limit }),
    };
    if (target.type === "search")
      Object.assign(input, { mode: "search", keyword: target.query });
    else if (target.type === "community")
      Object.assign(
        input,
        target.query
          ? {
              mode: "search",
              subreddit: target.community,
              keyword: target.query,
            }
          : { mode: "subreddit", subreddit: target.community },
      );
    else if (target.type === "account")
      Object.assign(input, {
        mode: "user",
        username: target.account,
        userContent:
          request.source.contentKind === "comment" ? "comments" : "submitted",
      });
    else if (target.type === "post")
      Object.assign(input, {
        mode: "post",
        postUrls: [`t3_${target.postId}`],
      });
    const start = new URL(
      "https://api.apify.com/v2/acts/kaix~reddit-scraper/runs",
    );
    start.search = new URLSearchParams({
      build: "0.2.25",
      waitForFinish: "0",
      restartOnError: "false",
    }).toString();
    const saved = object(request.execution?.state);
    let run = saved?.runId
      ? object(
          object(
            await this.json(
              new URL(`https://api.apify.com/v2/actor-runs/${saved.runId}`),
              {},
              request.signal,
            ),
          )?.data,
        )
      : null;
    if (!saved?.runId) {
      if (!request.execution)
        throw new ContentProviderError(
          "Kaix requires durable execution state before starting a paid run",
          false,
        );
      if (saved?.phase !== "starting")
        throw new ContentProviderError(
          "Unresolved paid start; inspect provider console",
          false,
        );
      run = object(
        object(
          await this.json(
            start,
            { method: "POST", body: JSON.stringify(input) },
            request.signal,
            65_000,
          ),
        )?.data,
      );
    }
    const runId = text(run?.id),
      datasetId = text(run?.defaultDatasetId);
    if (
      !runId ||
      !/^[a-zA-Z0-9]{1,64}$/.test(runId) ||
      !datasetId ||
      !/^[a-zA-Z0-9]{1,64}$/.test(datasetId)
    )
      throw new ContentProviderError(
        "Invalid kaix run receipt; inspect provider console",
        false,
      );
    await request.execution!.saveState({ phase: "running", runId, datasetId });
    if (
      ["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(
        String(run?.status),
      )
    )
      return {
        items: [],
        pending: true,
        nextCheckpoint: null,
        exhausted: false,
        coverage: "partial" as const,
        warning: WARNING,
      };
    if (run?.status !== "SUCCEEDED")
      throw new ContentProviderError(
        `Kaix run ${runId} did not succeed; inspect provider console`,
        false,
      );
    await request.execution!.saveState({ phase: "reading", runId, datasetId });
    const data = await this.json(
      new URL(
        `https://api.apify.com/v2/datasets/${datasetId}/items?format=json&limit=${maxRows + 1}`,
      ),
      {},
      request.signal,
    );
    if (!Array.isArray(data) || data.length > maxRows)
      throw new ContentProviderError(
        `Invalid kaix dataset for run ${runId}`,
        false,
      );
    const fetchedAt = this.now(),
      items: CollectedContent[] = [];
    for (const value of data) {
      const row = object(value);
      if (!row || !["post", "comment"].includes(String(row.type)))
        throw new ContentProviderError("Invalid kaix dataset record", false);
      if (
        row.type !== request.source.contentKind &&
        !(target.type === "post" && row.type === "post") &&
        !(comments && row.type === "comment")
      )
        throw new ContentProviderError("Unexpected kaix content kind", false);
      const item = this.normalize(row, request, fetchedAt, runId);
      if (
        target.type === "community" &&
        item.platformDetails.platform === "reddit" &&
        item.platformDetails.community.toLowerCase() !== target.community
      )
        throw new ContentProviderError(
          "Kaix returned a different community",
          false,
        );
      if (
        item.kind === request.source.contentKind &&
        target.type === "account" &&
        item.author?.handle?.toLowerCase() !== target.account
      )
        continue;
      if (
        target.type === "post" &&
        (item.kind === "post"
          ? item.externalId !== `t3_${target.postId}`
          : !item.references.some(
              (ref) =>
                ref.relation === "thread_root" &&
                ref.externalId === `t3_${target.postId}`,
            ))
      )
        throw new ContentProviderError(
          "Kaix returned comments for a different post",
          false,
        );
      if (
        item.kind === request.source.contentKind &&
        target.type !== "post" &&
        (!item.publishedAt ||
          Date.parse(item.publishedAt) < from ||
          Date.parse(item.publishedAt) >= to)
      )
        continue;
      items.push(item);
    }
    const returnedItems = data.filter(row => object(row)?.type === request.source.contentKind).length;
    const reportedComments = items.some(item =>
      item.kind === "post" && (item.observation.metrics["reddit.num_comments"] ?? 0) > 0,
    );
    const missingComments = comments && reportedComments && !items.some(item => item.kind === "comment");
    return {
      items,
      nextCheckpoint: null,
      exhausted: !missingComments && (thread || returnedItems < request.limit),
      coverage: "partial" as const,
      warning: missingComments
        ? "Kaix returned posts with a positive comment count but no comment records. Check the Actor run before retrying."
        : WARNING,
    };
  }

  private async json(
    url: URL,
    init: RequestInit,
    parent?: AbortSignal,
    timeoutMs = 20_000,
  ): Promise<unknown> {
    const signal = parent
      ? AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    try {
      const response = await this.fetcher(url, {
        ...init,
        signal,
        redirect: "error",
        headers: {
          Authorization: `Bearer ${this.config.getApiToken?.() ?? this.config.apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ContentProviderError(
          `Apify HTTP ${response.status}; check console before Retry (paid run may exist)`,
          false,
          30,
          response.status,
        );
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const reader = response.body?.getReader();
      if (reader)
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 16 * 1024 * 1024) {
              await reader.cancel();
              throw new ContentProviderError(
                "Kaix response exceeds 16 MiB",
                false,
              );
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof ContentProviderError) throw error;
      throw new ContentProviderError(
        "Kaix request interrupted or invalid JSON; check Apify console before Retry (paid run may exist)",
        false,
      );
    }
  }

  private normalize(
    row: Row,
    request: CollectContentPageRequest,
    fetchedAt: string,
    runId: string,
  ): CollectedContent {
    const kind = row.type as "post" | "comment",
      prefix = kind === "comment" ? "t1_" : "t3_";
    const id = text(row.id),
      community = text(row.subreddit),
      created = number(row.createdUtc);
    if (
      !id ||
      !/^[a-z0-9]{2,32}$/i.test(id) ||
      !community ||
      created === null ||
      created <= 0 ||
      created >= 253402300800
    )
      throw new ContentProviderError(
        "Kaix record lacks valid identity/publication/community",
        false,
      );
    const externalId = prefix + id.toLowerCase();
    if (row.fullName !== undefined && row.fullName !== externalId)
      throw new ContentProviderError("Kaix record identity mismatch", false);
    const body = text(kind === "post" ? row.selftext : row.body),
      author = text(row.author);
    const metrics: Record<string, number | null> = {
      "reddit.score": number(row.score),
    };
    if (kind === "post") {
      const count = number(row.numComments),
        ratio = number(row.upvoteRatio);
      metrics["reddit.num_comments"] =
        count !== null && Number.isInteger(count) && count >= 0 ? count : null;
      metrics["reddit.upvote_ratio"] =
        ratio !== null && ratio >= 0 && ratio <= 1 ? ratio : null;
    }
    const references: ContentReference[] = [];
    for (const [key, relation] of [
      ["parentId", "reply_to"],
      ["linkId", "thread_root"],
      ["crosspostParentId", "repost"],
    ] as const) {
      const ref = text(row[key]);
      if (ref && /^t[13]_[a-z0-9]{2,32}$/i.test(ref))
        references.push({
          kind: ref.startsWith("t1_") ? "comment" : "post",
          externalId: ref.toLowerCase(),
          relation,
        });
    }
    const url = httpUrl(row.permalink),
      linked = httpUrl(row.url);
    const removed = body === "[removed]" || Boolean(row.removedByCategory),
      deleted = body === "[deleted]";
    const item: CollectedContent = {
      id: stableUuidFromString(`reddit:content:${externalId}`),
      platform: "reddit",
      kind,
      externalId,
      title: kind === "post" ? text(row.title) : null,
      text: removed || deleted ? null : body,
      url,
      language: null,
      publishedAt: new Date(created * 1000).toISOString(),
      fetchedAt,
      availability: deleted
        ? "deleted"
        : removed
          ? "removed"
          : (kind === "post" ? text(row.title) !== null : body !== null)
            ? "available"
            : "unknown",
      author:
        author && author !== "[deleted]"
          ? {
              externalId: text(row.authorFullName),
              handle: author,
              displayName: null,
              url: `https://www.reddit.com/user/${encodeURIComponent(author)}/`,
            }
          : null,
      references,
      media:
        linked && linked !== url
          ? [
              {
                type: "link",
                url: linked,
                previewUrl: null,
                altText: null,
                durationSeconds: null,
              },
            ]
          : [],
      platformDetails: {
        platform: "reddit",
        community,
        flair: text(row.linkFlairText),
        nsfw: typeof row.over18 === "boolean" ? row.over18 : null,
      },
      observation: {
        provider: "kaix",
        sourceId: request.source.id,
        sourceObservedAt: null,
        fetchedAt,
        timeBasis: "provider_snapshot",
        maturity: "unknown",
        metrics,
        evidenceKey: "",
      },
    };
    const {
      fetchedAt: _fetchedAt,
      observation: _observation,
      ...content
    } = item;
    item.observation.evidenceKey = createHash("sha256")
      .update(JSON.stringify({ runId, content, metrics }))
      .digest("hex");
    return item;
  }
}
