import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type RedditSort = "relevance" | "hot" | "top" | "new" | "comments";
type RedditTimeRange = "hour" | "day" | "week" | "month" | "year" | "all";

interface RedditListingChild<TData = Record<string, unknown>> {
  kind: string;
  data: TData;
}

interface RedditListingPayload<TData = Record<string, unknown>> {
  data: {
    after?: string;
    children: Array<RedditListingChild<TData>>;
  };
}

interface RedditPostData {
  name?: string;
  id?: string;
  subreddit?: string;
  title?: string;
  selftext?: string;
  author?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
  upvote_ratio?: number;
  url?: string;
  permalink?: string;
  over_18?: boolean;
  spoiler?: boolean;
  stickied?: boolean;
}

interface RedditCommentData {
  name?: string;
  id?: string;
  subreddit?: string;
  author?: string;
  body?: string;
  parent_id?: string;
  link_id?: string;
  permalink?: string;
  created_utc?: number;
  score?: number;
  replies?: "" | RedditListingPayload<RedditCommentData>;
}

type RedditPostCommentsPayload = [
  RedditListingPayload<RedditPostData>,
  RedditListingPayload<RedditCommentData>,
];

interface ResearchPostRow {
  externalId: string;
  id: string;
  subreddit: string;
  query: string;
  sort: RedditSort;
  timeRange: RedditTimeRange;
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

const DEFAULT_QUERIES = ["aliexpress", "\"ali express\"", "aliexpress shipping", "aliexpress customs"];
const DEFAULT_SORTS: RedditSort[] = ["relevance", "new", "top", "comments"];
const DEFAULT_TIME_RANGES: RedditTimeRange[] = ["year", "all"];
const SORTS: RedditSort[] = ["relevance", "hot", "top", "new", "comments"];
const TIME_RANGES: RedditTimeRange[] = ["hour", "day", "week", "month", "year", "all"];

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

function parseSorts(value: string | undefined): RedditSort[] {
  const sorts = parseList(value, DEFAULT_SORTS).filter((item): item is RedditSort =>
    SORTS.includes(item as RedditSort),
  );
  return sorts.length > 0 ? sorts : DEFAULT_SORTS;
}

function parseTimeRanges(value: string | undefined): RedditTimeRange[] {
  const ranges = parseList(value, DEFAULT_TIME_RANGES).filter((item): item is RedditTimeRange =>
    TIME_RANGES.includes(item as RedditTimeRange),
  );
  return ranges.length > 0 ? ranges : DEFAULT_TIME_RANGES;
}

function parseKeywords(value: string | undefined): string[] {
  return parseList(value, []).map((item) => item.toLowerCase());
}

function matchesKeywords(row: ResearchPostRow, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }
  const haystack = `${row.title}\n${row.selftext}\n${row.subreddit}`.toLowerCase();
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
  query: string;
  sort: RedditSort;
  timeRange: RedditTimeRange;
  fetchedAt: string;
}): ResearchPostRow | null {
  const post = args.child.data;
  if (!post.id) {
    return null;
  }
  const createdUtc = post.created_utc ?? 0;
  return {
    externalId: post.name || `t3_${post.id}`,
    id: post.id,
    subreddit: post.subreddit ?? "",
    query: args.query,
    sort: args.sort,
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

function toCsv<TRow extends object>(rows: TRow[], columns: Array<keyof TRow>): string {
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

function buildHeaders(requestId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": process.env.REDDIT_USER_AGENT ?? "reddit-monitoring-mvp-local-research/0.1",
    Accept: "application/json",
    "X-Request-Id": requestId,
  };
  if (process.env.REDDIT_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.REDDIT_ACCESS_TOKEN}`;
  }
  return headers;
}

async function fetchJson<TPayload>(url: URL, requestId: string, timeoutMs: number): Promise<{
  payload: TPayload;
  fetchedAt: string;
  status: number;
}> {
  if (process.env.REDDIT_HTTP_TRANSPORT === "powershell") {
    return fetchJsonViaPowerShell<TPayload>(url, requestId, timeoutMs);
  }
  let lastError: unknown;
  const maxRetries = parsePositiveInt(process.env.RESEARCH_SEARCH_MAX_RETRIES, 2);
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: buildHeaders(requestId),
        signal: controller.signal,
      });
      if (response.ok) {
        return {
          payload: (await response.json()) as TPayload,
          fetchedAt: new Date().toISOString(),
          status: response.status,
        };
      }
      const body = await response.text();
      throw new Error(`Reddit request failed: status=${response.status}, body=${body.slice(0, 300)}`);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) {
        throw error;
      }
      await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Reddit request failed unexpectedly");
}

async function fetchJsonViaPowerShell<TPayload>(
  url: URL,
  requestId: string,
  timeoutMs: number,
): Promise<{
  payload: TPayload;
  fetchedAt: string;
  status: number;
}> {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const headersJson = JSON.stringify(buildHeaders(requestId));
  const script = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$uri = @'
${url.toString()}
'@
$headersObject = ConvertFrom-Json @'
${headersJson}
'@
$headers = @{}
$headersObject.PSObject.Properties | ForEach-Object { $headers[$_.Name] = [string]$_.Value }
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers $headers -Method Get -TimeoutSec ${timeoutSeconds}
  $status = [int]$response.StatusCode
  $content = [string]$response.Content
} catch {
  $webResponse = $_.Exception.Response
  if (-not $webResponse) { throw }
  $status = [int]$webResponse.StatusCode
  $stream = $webResponse.GetResponseStream()
  try {
    $reader = New-Object System.IO.StreamReader($stream)
    try {
      $content = $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}
[Console]::Out.WriteLine((@{ status = $status; body = $content } | ConvertTo-Json -Compress -Depth 8))
`;
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-EncodedCommand", encodedCommand],
      {
        timeout: timeoutMs + 5000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error && !stdout.trim()) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as { status: number; body: string });
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Reddit request failed: status=${result.status}, body=${result.body.slice(0, 300)}`);
  }
  return {
    payload: JSON.parse(result.body) as TPayload,
    fetchedAt: new Date().toISOString(),
    status: result.status,
  };
}

function searchUrl(args: {
  query: string;
  sort: RedditSort;
  timeRange: RedditTimeRange;
  limit: number;
  after?: string;
}): URL {
  const baseUrl = process.env.REDDIT_ACCESS_TOKEN
    ? "https://oauth.reddit.com"
    : "https://www.reddit.com";
  const url = new URL("/search.json", baseUrl);
  url.searchParams.set("q", args.query);
  url.searchParams.set("type", "link");
  url.searchParams.set("restrict_sr", "false");
  url.searchParams.set("sort", args.sort);
  url.searchParams.set("t", args.timeRange);
  url.searchParams.set("limit", String(args.limit));
  if (args.after) {
    url.searchParams.set("after", args.after);
  }
  return url;
}

function commentsUrl(post: ResearchPostRow, limit: number, depth: number): URL {
  const baseUrl = process.env.REDDIT_ACCESS_TOKEN
    ? "https://oauth.reddit.com"
    : "https://www.reddit.com";
  const url = new URL(`/r/${encodeURIComponent(post.subreddit)}/comments/${encodeURIComponent(post.id)}.json`, baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("depth", String(depth));
  url.searchParams.set("sort", "top");
  return url;
}

async function main(): Promise<void> {
  const queries = parseList(process.env.RESEARCH_SEARCH_QUERIES, DEFAULT_QUERIES);
  const sorts = parseSorts(process.env.RESEARCH_SEARCH_SORTS);
  const timeRanges = parseTimeRanges(process.env.RESEARCH_SEARCH_TIME_RANGES);
  const limit = Math.min(parsePositiveInt(process.env.RESEARCH_LIMIT, 100), 100);
  const pages = parsePositiveInt(process.env.RESEARCH_PAGES, 2);
  const delayMs = parsePositiveInt(process.env.RESEARCH_DELAY_MS, 1200);
  const timeoutMs = parsePositiveInt(process.env.REDDIT_HTTP_TIMEOUT_MS, 25_000);
  const outputDir = process.env.RESEARCH_OUTPUT_DIR ?? "output/reddit-research-search";
  const inputPostsJson = process.env.RESEARCH_INPUT_POSTS_JSON;
  const fetchComments = parseBoolean(process.env.RESEARCH_FETCH_COMMENTS, false);
  const commentLimit = Math.min(parsePositiveInt(process.env.RESEARCH_COMMENT_LIMIT, 30), 500);
  const commentDepth = parsePositiveInt(process.env.RESEARCH_COMMENT_DEPTH, 1);
  const commentDelayMs = parsePositiveInt(process.env.RESEARCH_COMMENT_DELAY_MS, delayMs);
  const commentPostLimit = parsePositiveInt(process.env.RESEARCH_COMMENT_POST_LIMIT, 100);
  const commentPostOffset = parsePositiveInt(process.env.RESEARCH_COMMENT_POST_OFFSET, 0);
  const commentMinComments = parsePositiveInt(process.env.RESEARCH_COMMENT_MIN_COMMENTS, 1);
  const commentKeywords = parseKeywords(process.env.RESEARCH_COMMENT_KEYWORDS);
  const rowsByExternalId = new Map<string, ResearchPostRow>();
  const commentsByExternalId = new Map<string, ResearchCommentRow>();
  const errors: Array<Record<string, unknown>> = [];
  const commentErrors: Array<Record<string, unknown>> = [];

  if (inputPostsJson) {
    const inputRows = JSON.parse(await readFile(inputPostsJson, "utf8")) as ResearchPostRow[];
    for (const row of inputRows) {
      rowsByExternalId.set(row.externalId, row);
    }
  } else {
    for (const query of queries) {
      for (const sort of sorts) {
        for (const timeRange of timeRanges) {
          let after: string | undefined;
          for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
            try {
              const result = await fetchJson<RedditListingPayload<RedditPostData>>(
                searchUrl({ query, sort, timeRange, limit, after }),
                `research-search:${query}:${sort}:${timeRange}:${pageIndex}`,
                timeoutMs,
              );
              for (const child of result.payload.data.children) {
                const row = toResearchRow({
                  child,
                  query,
                  sort,
                  timeRange,
                  fetchedAt: result.fetchedAt,
                });
                if (row) {
                  rowsByExternalId.set(row.externalId, row);
                }
              }
              after = result.payload.data.after;
              if (!after) {
                break;
              }
            } catch (error) {
              errors.push({
                query,
                sort,
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
  }

  const rows = Array.from(rowsByExternalId.values()).sort(
    (left, right) => right.createdUtc - left.createdUtc,
  );

  if (fetchComments) {
    const commentPosts = rows
      .filter((post) => (post.numComments ?? 0) >= commentMinComments)
      .filter((post) => matchesKeywords(post, commentKeywords))
      .sort((left, right) => (right.numComments ?? 0) - (left.numComments ?? 0))
      .slice(commentPostOffset)
      .slice(0, commentPostLimit);
    for (const post of commentPosts) {
      try {
        const result = await fetchJson<RedditPostCommentsPayload>(
          commentsUrl(post, commentLimit, commentDepth),
          `research-search-comments:${post.subreddit}:${post.id}`,
          timeoutMs,
        );
        for (const comment of flattenComments({
          comments: result.payload[1],
          post,
          fetchedAt: result.fetchedAt,
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
  const baseName = `reddit-search-posts-${timestamp}`;
  const postsJsonPath = path.join(outputDir, `${baseName}.json`);
  const postsCsvPath = path.join(outputDir, `${baseName}.csv`);
  const commentsJsonPath = path.join(outputDir, `reddit-search-comments-${timestamp}.json`);
  const commentsCsvPath = path.join(outputDir, `reddit-search-comments-${timestamp}.csv`);
  const metaPath = path.join(outputDir, `${baseName}.metadata.json`);

  await writeFile(postsJsonPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await writeFile(
    postsCsvPath,
    `${toCsv(rows, [
      "externalId",
      "id",
      "subreddit",
      "query",
      "sort",
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
    ])}\n`,
    "utf8",
  );
  if (fetchComments) {
    await writeFile(commentsJsonPath, `${JSON.stringify(comments, null, 2)}\n`, "utf8");
    await writeFile(
      commentsCsvPath,
      `${toCsv(comments, [
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
      ])}\n`,
      "utf8",
    );
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
        queries,
        sorts,
        timeRanges,
        inputPostsJson,
        limit,
        pages,
        delayMs,
        timeoutMs,
        fetchComments,
        commentLimit,
        commentDepth,
        commentPostLimit,
        commentPostOffset,
        commentMinComments,
        commentKeywords,
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
        postsJsonPath,
        postsCsvPath,
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
