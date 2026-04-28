export const ORDINARY_POST_BODY_MAX_CHARS = 800;
export const RETAINED_POST_BODY_MAX_CHARS = 4_000;
export const SEARCH_BODY_SNIPPET_MAX_CHARS = 320;
const QUALIFIED_SCORE_THRESHOLD = 12;
const QUALIFIED_COMMENT_THRESHOLD = 4;
const HIGH_IMPACT_SCORE_THRESHOLD = 80;
const HIGH_IMPACT_COMMENT_THRESHOLD = 30;

export function retainStoredPostBodyText(args: {
  bodyText?: string;
  score?: number;
  numComments?: number;
}): string | undefined {
  const normalized = normalizeOptionalText(args.bodyText);
  if (!normalized) {
    return undefined;
  }

  const maxChars = shouldRetainExtendedPostBody(args)
    ? RETAINED_POST_BODY_MAX_CHARS
    : ORDINARY_POST_BODY_MAX_CHARS;
  return truncateText(normalized, maxChars);
}

export function retainSearchBodySnippet(bodyText?: string): string | undefined {
  const normalized = normalizeOptionalText(bodyText);
  if (!normalized) {
    return undefined;
  }
  return truncateText(normalized, SEARCH_BODY_SNIPPET_MAX_CHARS);
}

export function buildSearchText(args: {
  title: string;
  bodyText?: string;
}): string {
  return `${args.title} ${retainSearchBodySnippet(args.bodyText) ?? ""}`.trim().toLowerCase();
}

function shouldRetainExtendedPostBody(args: {
  bodyText?: string;
  score?: number;
  numComments?: number;
}): boolean {
  const score = Math.max(0, args.score ?? 0);
  const comments = Math.max(0, args.numComments ?? 0);
  const qualified = score >= QUALIFIED_SCORE_THRESHOLD && comments >= QUALIFIED_COMMENT_THRESHOLD;
  const highImpact = score >= HIGH_IMPACT_SCORE_THRESHOLD || comments >= HIGH_IMPACT_COMMENT_THRESHOLD;
  return qualified || highImpact;
}

function normalizeOptionalText(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}
