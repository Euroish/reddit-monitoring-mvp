import type { ContentQuery, SavedContentQuery } from '../../../../../packages/contracts/src/source-content.js';

const textKeys = ['platform', 'provider', 'sourceId', 'kind', 'query', 'from', 'to', 'author', 'language', 'sourceGroup', 'sort', 'metricKey', 'searchMode', 'searchScope'] as const;
const numberKeys = ['minMetric', 'maxMetric'] as const;
export type ContentFilterDraft = Record<(typeof textKeys)[number] | (typeof numberKeys)[number] | 'exclusions', string>;

/** Only query fields belong in a reusable search; page cursors and limits never do. */
export function canonicalContentQuery(input: ContentQuery): SavedContentQuery {
  const output: Record<string, string | number | string[]> = {};
  for (const key of textKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) output[key] = value.trim();
  }
  for (const key of numberKeys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
  }
  if (input.exclusions?.length) output.exclusions = [...new Set(input.exclusions.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
  return output as SavedContentQuery;
}

export function contentQueryFromParams(params: URLSearchParams): SavedContentQuery {
  const output: Record<string, string | number | string[]> = {};
  for (const key of textKeys) { const value = params.get(key); if (value?.trim()) output[key] = value.trim(); }
  for (const key of numberKeys) {
    const value = params.get(key);
    if (value !== null && value.trim() && Number.isFinite(Number(value))) output[key] = Number(value);
  }
  const exclusions = params.getAll('exclusions').filter(value => value.trim());
  if (exclusions.length) output.exclusions = [...new Set(exclusions.map(value => value.trim()))];
  return output as SavedContentQuery;
}

export function contentQueryParams(query: ContentQuery): string {
  const params = new URLSearchParams();
  const canonical = canonicalContentQuery(query);
  for (const key of [...textKeys, ...numberKeys]) {
    if (canonical[key] !== undefined) params.set(key, String(canonical[key]));
  }
  for (const value of canonical.exclusions ?? []) params.append('exclusions', value);
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
  draft.exclusions = (query.exclusions ?? []).join('\n');
  return draft;
}

export function contentQueryFromDraft(draft: ContentFilterDraft): SavedContentQuery {
  const { exclusions, ...fields } = draft;
  const query = contentQueryFromParams(new URLSearchParams(fields));
  const phrases = contentExclusionsFromDraft(exclusions);
  if (phrases.length) query.exclusions = phrases;
  if (draft.from) query.from = new Date(draft.from).toISOString();
  if (draft.to) query.to = new Date(draft.to).toISOString();
  if (!draft.metricKey) { delete query.minMetric; delete query.maxMetric; }
  return canonicalContentQuery(query);
}

export function contentExclusionsFromDraft(value: string): string[] {
  const phrases = value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  if (phrases.length > 10 || phrases.some(phrase => phrase.length > 200 || [...phrase].some(character => { const code = character.charCodeAt(0); return code <= 8 || code >= 14 && code <= 31 || code === 127; }))) throw new Error('Exclusions need at most 10 lines of 1–200 characters.');
  return [...new Set(phrases)];
}

/** External links/media must be explicit HTTP(S), never script URLs or credentials. */
export function safeContentUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 4096 || [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
