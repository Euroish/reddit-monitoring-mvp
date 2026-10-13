import type { ContentQuery, SavedContentQuery } from '../../../../../packages/contracts/src/source-content.js';

const textKeys = ['platform', 'provider', 'sourceId', 'kind', 'query', 'from', 'to', 'author', 'language', 'sourceGroup', 'sort', 'metricKey'] as const;
const numberKeys = ['minMetric', 'maxMetric'] as const;
export type ContentFilterDraft = Record<(typeof textKeys)[number] | (typeof numberKeys)[number], string>;

/** Only query fields belong in a reusable search; page cursors and limits never do. */
export function canonicalContentQuery(input: ContentQuery): SavedContentQuery {
  const output: Record<string, string | number> = {};
  for (const key of textKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) output[key] = value.trim();
  }
  for (const key of numberKeys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
  }
  return output as SavedContentQuery;
}

export function contentQueryFromParams(params: URLSearchParams): SavedContentQuery {
  const output: Record<string, string | number> = {};
  for (const key of textKeys) { const value = params.get(key); if (value?.trim()) output[key] = value.trim(); }
  for (const key of numberKeys) {
    const value = params.get(key);
    if (value !== null && value.trim() && Number.isFinite(Number(value))) output[key] = Number(value);
  }
  return output as SavedContentQuery;
}

export function contentQueryParams(query: ContentQuery): string {
  const params = new URLSearchParams();
  const canonical = canonicalContentQuery(query);
  for (const key of [...textKeys, ...numberKeys]) {
    if (canonical[key] !== undefined) params.set(key, String(canonical[key]));
  }
  return params.toString();
}

export function contentQueryPath(query: ContentQuery): string {
  const params = contentQueryParams(query);
  return `/content${params ? `?${params}` : ''}`;
}

export function publicationLocalInput(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

export function contentFilterDraft(query: ContentQuery): ContentFilterDraft {
  const draft = Object.fromEntries([...textKeys, ...numberKeys].map(key => [key, query[key] === undefined ? '' : String(query[key])])) as ContentFilterDraft;
  draft.from = publicationLocalInput(query.from); draft.to = publicationLocalInput(query.to);
  draft.sort = query.sort ?? 'published_desc';
  return draft;
}

export function contentQueryFromDraft(draft: ContentFilterDraft): SavedContentQuery {
  const query = contentQueryFromParams(new URLSearchParams(draft));
  if (draft.from) query.from = new Date(draft.from).toISOString();
  if (draft.to) query.to = new Date(draft.to).toISOString();
  if (!draft.metricKey) { delete query.minMetric; delete query.maxMetric; }
  return canonicalContentQuery(query);
}

/** External links/media must be explicit HTTP(S), never script URLs or credentials. */
export function safeContentUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 4096 || [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
