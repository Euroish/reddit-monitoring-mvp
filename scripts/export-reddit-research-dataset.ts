import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createRedditConnectorFromEnv,
  type Phase1RunMode,
} from "../src/runtime/reddit-phase1-runtime";
import type {
  RedditCommentData,
  RedditListingChild,
  RedditListingPayload,
  RedditPostData,
  RedditPostListing,
  RedditTopTimeRange,
} from "../src/connectors/reddit/reddit.types";

interface ResearchPostRow {
  externalId: string;
  id: string;
  subreddit: string;
  listing: RedditPostListing;
  timeRange?: RedditTopTimeRange;
  title: string;
  selftext: string;
  author: string;
  createdUtc: number;
  createdAt: string;
  score?: number;
  numComments?: number;
  upvoteRatio?: number;
  url: string;
  permalink: string;
  over18?: boolean;
  spoiler?: boolean;
  stickied?: boolean;
  fetchedAt: string;
}

interface ResearchCommentRow {
  externalId: string;
  id: string;
  postExternalId: string;
  postId: string;
  subreddit: string;
  author: string;
  body: string;
  parentId: string;
  linkId: string;
  depth: number;
  createdUtc?: number;
  createdAt: string;
  score?: number;
  permalink: string;
  fetchedAt: string;
}

const DEFAULT_SUBREDDITS = [
  "Aliexpress",
  "TemuThings",
  "SHEIN_",
  "frugalmalefashion",
  "BuyItForLife",
];

const LISTINGS: RedditPostListing[] = ["new", "hot", "best", "rising", "top"];
const TOP_TIME_RANGES: RedditTopTimeRange[] = ["day", "week", "month", "year", "all"];

function parseList(value: string | undefined, fallback: string[]): string[] {
  const parsed = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function parseListings(value: string | undefined): RedditPostListing[] {
  const listings = parseList(value, ["new", "hot", "top"]).filter(
    (item): item is RedditPostListing => LISTINGS.includes(item as RedditPostListing),
  );
  return listings.length > 0 ? listings : ["new", "hot", "top"];
}

function parseTopTimeRanges(value: string | undefined): RedditTopTimeRange[] {
  const ranges = parseList(value, ["month", "year"]).filter(
    (item): item is RedditTopTimeRange => TOP_TIME_RANGES.includes(item as RedditTopTimeRange),
  );
  return ranges.length > 0 ? ranges : ["month", "year"];
}

function parseKeywords(value: string | undefined): string[] {
  return parseList(value, []).map((item) => item.toLowerCase());
}

function matchesKeywords(row: ResearchPostRow, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }
  const haystack = `${row.title}\n${row.selftext}\n${row.url}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function toAbsolutePermalink(permalink: string): string {
  if (permalink.startsWith("http://") || permalink.startsWith("https://")) {
    return permalink;
  }
  return `https://www.reddit.com${permalink}`;
}

function toResearchRow(args: {
  child: RedditListingChild<RedditPostData>;
  listing: RedditPostListing;
  timeRange?: RedditTopTimeRange;
  fetchedAt: string;
}): ResearchPostRow {
  const post = args.child.data as RedditPostData & {
    over_18?: boolean;
    spoiler?: boolean;
    stickied?: boolean;
  };
  const createdUtc = post.created_utc;
  return {
    externalId: post.name || `t3_${post.id}`,
    id: post.id,
    subreddit: post.subreddit,
    listing: args.listing,
    timeRange: args.timeRange,
    title: post.title ?? "",
    selftext: post.selftext ?? "",
    author: post.author ?? "",
    createdUtc,
    createdAt: Number.isFinite(createdUtc) ? new Date(createdUtc * 1000).toISOString() : "",
    score: post.score,
    numComments: post.num_comments,
    upvoteRatio: post.upvote_ratio,
    url: post.url ?? "",
    permalink: toAbsolutePermalink(post.permalink ?? ""),
    over18: post.over_18,
    spoiler: post.spoiler,
    stickied: post.stickied,
    fetchedAt: args.fetchedAt,
  };
}

function flattenComments(args: {
  comments: RedditListingPayload<RedditCommentData>;
  post: ResearchPostRow;
  fetchedAt: string;
  maxDepth: number;
}): ResearchCommentRow[] {
  const rows: ResearchCommentRow[] = [];
  const walk = (children: Array<RedditListingChild<RedditCommentData>>, depth: number): void => {
    if (depth > args.maxDepth) {
      return;
    }
    for (const child of children) {
      if (child.kind !== "t1") {
        continue;
      }
      const comment = child.data;
      if (!comment.id || !comment.name) {
        continue;
      }
      const createdUtc = comment.created_utc;
      rows.push({
        externalId: comment.name,
        id: comment.id,
        postExternalId: args.post.externalId,
        postId: args.post.id,
        subreddit: comment.subreddit ?? args.post.subreddit,
        author: comment.author ?? "",
        body: comment.body ?? "",
        parentId: comment.parent_id ?? "",
        linkId: comment.link_id ?? args.post.externalId,
        depth,
        createdUtc,
        createdAt:
          typeof createdUtc === "number" && Number.isFinite(createdUtc)
            ? new Date(createdUtc * 1000).toISOString()
            : "",
        score: comment.score,
        permalink: toAbsolutePermalink(comment.permalink ?? args.post.permalink),
        fetchedAt: args.fetchedAt,
      });
      if (comment.replies && typeof comment.replies === "object") {
        walk(comment.replies.data.children, depth + 1);
      }
    }
  };
  walk(args.comments.data.children, 0);
  return rows;
}

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  const text = String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: ResearchPostRow[]): string {
  const columns: Array<keyof ResearchPostRow> = [
    "externalId",
    "id",
    "subreddit",
    "listing",
    "timeRange",
    "title",
    "selftext",
    "author",
    "createdUtc",
    "createdAt",
    "score",
    "numComments",
    "upvoteRatio",
    "url",
    "permalink",
    "over18",
    "spoiler",
    "stickied",
    "fetchedAt",
  ];
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
}

function commentsToCsv(rows: ResearchCommentRow[]): string {
  const columns: Array<keyof ResearchCommentRow> = [
    "externalId",
    "id",
    "postExternalId",
    "postId",
    "subreddit",
    "author",
    "body",
    "parentId",
    "linkId",
    "depth",
    "createdUtc",
    "createdAt",
    "score",
    "permalink",
    "fetchedAt",
  ];
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const subreddits = parseList(process.env.RESEARCH_SUBREDDITS, DEFAULT_SUBREDDITS);
  const listings = parseListings(process.env.RESEARCH_LISTINGS);
  const topTimeRanges = parseTopTimeRanges(process.env.RESEARCH_TOP_TIME_RANGES);
  const limit = Math.min(parsePositiveInt(process.env.RESEARCH_LIMIT, 100), 100);
  const pages = parsePositiveInt(process.env.RESEARCH_PAGES, 2);
  const delayMs = parsePositiveInt(process.env.RESEARCH_DELAY_MS, 1200);
  const keywords = parseKeywords(process.env.RESEARCH_KEYWORDS);
  const outputDir = process.env.RESEARCH_OUTPUT_DIR ?? "output/reddit-research";
  const mode = (process.env.RESEARCH_REDDIT_MODE as Phase1RunMode | undefined) ?? "live";
  const fetchComments = parseBoolean(process.env.RESEARCH_FETCH_COMMENTS, false);
  const commentLimit = Math.min(parsePositiveInt(process.env.RESEARCH_COMMENT_LIMIT, 50), 500);
  const commentDepth = parsePositiveInt(process.env.RESEARCH_COMMENT_DEPTH, 2);
  const commentDelayMs = parsePositiveInt(process.env.RESEARCH_COMMENT_DELAY_MS, delayMs);
  const connector = createRedditConnectorFromEnv({
    env: process.env,
    mode,
    crawlMode: "backfill",
  });

  const rowsByExternalId = new Map<string, ResearchPostRow>();
  const commentsByExternalId = new Map<string, ResearchCommentRow>();
  const errors: Array<Record<string, unknown>> = [];
  const commentErrors: Array<Record<string, unknown>> = [];

  for (const subreddit of subreddits) {
    for (const listing of listings) {
      const ranges: Array<RedditTopTimeRange | undefined> =
        listing === "top" ? topTimeRanges : [undefined];
      for (const timeRange of ranges) {
        let after: string | undefined;
        for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
          try {
            const page = await connector.collectSubredditPosts(
              { subreddit, listing, timeRange, limit, after },
              {
                requestId: `research-export:${subreddit}:${listing}:${timeRange ?? "none"}:${pageIndex}`,
                now: new Date().toISOString(),
              },
            );
            const fetchedAt = page.raw.fetchedAt;
            for (const child of page.raw.payload.data.children) {
              const row = toResearchRow({ child, listing, timeRange, fetchedAt });
              if (matchesKeywords(row, keywords)) {
                rowsByExternalId.set(row.externalId, row);
              }
            }
            after = page.nextCursor;
            if (!after) {
              break;
            }
          } catch (error) {
            errors.push({
              subreddit,
              listing,
              timeRange,
              pageIndex,
              message: error instanceof Error ? error.message : String(error),
            });
            break;
          }
          await sleep(delayMs);
        }
      }
    }
  }

  const rows = Array.from(rowsByExternalId.values()).sort(
    (left, right) => right.createdUtc - left.createdUtc,
  );

  if (fetchComments && !connector.collectPostComments) {
    throw new Error("The configured Reddit connector does not support comment collection");
  }

  if (fetchComments) {
    for (const post of rows) {
      try {
        const page = await connector.collectPostComments!(
          {
            subreddit: post.subreddit,
            postId: post.id,
            limit: commentLimit,
            depth: commentDepth,
          },
          {
            requestId: `research-comments:${post.subreddit}:${post.id}`,
            now: new Date().toISOString(),
          },
        );
        const commentListing = page.raw.payload[1];
        for (const comment of flattenComments({
          comments: commentListing,
          post,
          fetchedAt: page.raw.fetchedAt,
          maxDepth: commentDepth,
        })) {
          commentsByExternalId.set(comment.externalId, comment);
        }
      } catch (error) {
        commentErrors.push({
          subreddit: post.subreddit,
          postId: post.id,
          postExternalId: post.externalId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await sleep(commentDelayMs);
    }
  }

  const comments = Array.from(commentsByExternalId.values()).sort((left, right) => {
    const leftTime = left.createdUtc ?? 0;
    const rightTime = right.createdUtc ?? 0;
    return rightTime - leftTime;
  });

  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const baseName = `reddit-research-posts-${timestamp}`;
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const csvPath = path.join(outputDir, `${baseName}.csv`);
  const commentsJsonPath = path.join(outputDir, `reddit-research-comments-${timestamp}.json`);
  const commentsCsvPath = path.join(outputDir, `reddit-research-comments-${timestamp}.csv`);
  const metaPath = path.join(outputDir, `${baseName}.metadata.json`);

  await writeFile(jsonPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await writeFile(csvPath, `${toCsv(rows)}\n`, "utf8");
  if (fetchComments) {
    await writeFile(commentsJsonPath, `${JSON.stringify(comments, null, 2)}\n`, "utf8");
    await writeFile(commentsCsvPath, `${commentsToCsv(comments)}\n`, "utf8");
  }
  await writeFile(
    metaPath,
    `${JSON.stringify(
      {
        rowCount: rows.length,
        commentRowCount: comments.length,
        errorCount: errors.length,
        commentErrorCount: commentErrors.length,
        errors,
        commentErrors,
        subreddits,
        listings,
        topTimeRanges,
        limit,
        pages,
        delayMs,
        keywords,
        mode,
        fetchComments,
        commentLimit,
        commentDepth,
        commentDelayMs,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0 && commentErrors.length === 0,
        rowCount: rows.length,
        commentRowCount: comments.length,
        errorCount: errors.length,
        commentErrorCount: commentErrors.length,
        jsonPath,
        csvPath,
        commentsJsonPath: fetchComments ? commentsJsonPath : undefined,
        commentsCsvPath: fetchComments ? commentsCsvPath : undefined,
        metaPath,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
