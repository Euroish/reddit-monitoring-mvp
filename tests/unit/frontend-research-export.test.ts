import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceAuthEpoch, ApiError, fetchApi, fetchApiBlob, getAuthEpoch } from '../../apps/web/src/api/client.js';
import { canonicalContentQuery, contentExclusionsFromDraft, contentFilterDraft, contentQueryFromDraft, contentQueryFromParams, contentQueryParams } from '../../apps/web/src/features/content/queryState.js';
import { downloadResearchBlob, researchCsvMetadata, researchPageParams, validateResearchPage } from '../../apps/web/src/features/content/researchExportState.js';
import type { ResearchExportManifest, ResearchExportPageResponse } from '../../packages/contracts/src/research-export.js';

const manifest: ResearchExportManifest = { formatVersion: 1, contentContractVersion: 'public-content-v1', queryContractVersion: 'content-query-v2', identityVersion: 'platform-kind-external-v1', observationSelection: 'latest_per_source_known_source_time_first', frozenAt: '2026-10-13T00:00:00.000Z', query: {}, total: 0, scope: 'frozen_stored_sample', textScope: 'stored_title_and_text', sources: [], metricDefinitions: [], coverage: { indexed: 0, textPresent: 0, textMissing: 0, scope: 'stored_content' }, limitations: [] };

test('5B query modes, scopes and repeated exclusions round-trip without comma splitting or pagination', () => {
  const query = { query: '研究 🚀 artificial intelligence', searchMode: 'terms' as const, searchScope: 'text' as const, exclusions: ['comma, punctuation', '报价 "引用"', '-literal'], minMetric: 0, metricKey: 'x.likes', cursor: 'private', limit: 100 };
  const params = new URLSearchParams(contentQueryParams(query));
  assert.deepEqual(params.getAll('exclusions'), query.exclusions); assert.equal(params.has('limit'), false); assert.equal(params.has('cursor'), false);
  assert.deepEqual(contentQueryFromParams(params), canonicalContentQuery(query));
  assert.deepEqual(contentQueryFromDraft(contentFilterDraft(query)), { ...canonicalContentQuery(query), sort: 'published_desc' });
  assert.deepEqual(canonicalContentQuery({ exclusions: ['same', 'same'] }).exclusions, ['same']);
});

test('exclusion editor enforces ten bounded literal lines while retaining punctuation and Unicode', () => {
  assert.deepEqual(contentExclusionsFromDraft('  中文 🚀\ncomma, intact\n\n-literal\n'), ['中文 🚀', 'comma, intact', '-literal']);
  assert.equal(contentExclusionsFromDraft(Array.from({ length: 10 }, (_, index) => `word-${index}`).join('\n')).length, 10);
  assert.throws(() => contentExclusionsFromDraft(Array.from({ length: 11 }, (_, index) => `word-${index}`).join('\n')));
  assert.throws(() => contentExclusionsFromDraft('x'.repeat(201)));
  assert.throws(() => contentExclusionsFromDraft('bad\u0000phrase'));
});

test('research page limits are bounded independently of snapshot size and cursors are encoded', () => {
  assert.equal(researchPageParams(100, 'cursor&scope=other'), 'limit=100&cursor=cursor%26scope%3Dother');
  assert.equal(researchPageParams(1), 'limit=1');
  for (const limit of [0, 101, 1.5, Number.NaN]) assert.throws(() => researchPageParams(limit));
});

test('CSV metadata validates the fixed denominator, bounded count and explicit frozen scope; absent values stay unknown', () => {
  const valid = () => new Headers({ 'X-Export-Count': '100', 'X-Export-Total-Matching': '205', 'X-Export-Next-Cursor': 'next-100', 'X-Export-Scope': 'frozen_members' });
  assert.deepEqual(researchCsvMetadata(valid(), 205, 100), { count: 100, nextCursor: 'next-100' });
  assert.deepEqual(researchCsvMetadata(new Headers({ 'X-Export-Count': '0', 'X-Export-Total-Matching': '0', 'X-Export-Scope': 'frozen_members' }), 0, 100), { count: 0, nextCursor: null });
  for (const [key, value] of [['X-Export-Count', ''], ['X-Export-Count', '101'], ['X-Export-Total-Matching', '206'], ['X-Export-Scope', 'stored_sample']]) { const headers = valid(); headers.set(key, value); assert.throws(() => researchCsvMetadata(headers, 205, 100)); }
  assert.throws(() => researchCsvMetadata(new Headers(), 0, 100));
  assert.throws(() => researchCsvMetadata(new Headers({ 'X-Export-Count': '1', 'X-Export-Total-Matching': '0', 'X-Export-Scope': 'frozen_members' }), 0, 100));
});

test('JSON page belongs to the selected frozen export and preserves its denominator including empty samples', () => {
  const page: ResearchExportPageResponse = { ok: true, requestId: 'fixture', exportId: 'export-a', total: 0, manifest, items: [], nextCursor: null, scope: 'frozen_members' };
  validateResearchPage(page, 'export-a', 0, 100);
  assert.throws(() => validateResearchPage(page, 'export-b', 0, 100));
  assert.throws(() => validateResearchPage({ ...page, total: 1 }, 'export-a', 0, 100));
  assert.throws(() => validateResearchPage({ ...page, manifest: { ...manifest, total: 1 } }, 'export-a', 0, 100));
  assert.throws(() => validateResearchPage({ ...page, nextCursor: 'non-advancing-empty' }, 'export-a', 0, 100));
});

test('research limit errors preserve nested API messages and HTTP status', async () => {
  const nativeFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ errorCode: 'research_export_limit', error: { code: 'research_export_limit', message: 'Complete matching set exceeds 20000 rows; narrow the query' } }, { status: 413 });
    await assert.rejects(fetchApi('/v1/research-exports'), error => error instanceof ApiError && error.status === 413 && /exceeds 20000/.test(error.message));
  } finally { globalThis.fetch = nativeFetch; advanceAuthEpoch(); }
});

test('binary body reading cannot complete a download after the authentication epoch changes', async () => {
  const nativeFetch = globalThis.fetch;
  let release: () => void = () => {}, started: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; }), reading = new Promise<void>(resolve => { started = resolve; });
  const response = new Response('old-account-csv', { headers: { 'Content-Type': 'text/csv' } });
  response.blob = async () => { started(); await gate; return new Blob(['old-account-csv']); };
  globalThis.fetch = async () => response;
  try { const download = fetchApiBlob('/v1/research-exports/export-a/export?format=csv'); await reading; advanceAuthEpoch(); release(); await assert.rejects(download, { name: 'AbortError' }); }
  finally { globalThis.fetch = nativeFetch; advanceAuthEpoch(); }
});

test('a late download success callback cannot create an artifact for a replaced identity', () => {
  const epoch = getAuthEpoch(); advanceAuthEpoch();
  // No DOM stub: the stale callback must return before touching document or creating object URLs.
  assert.equal(downloadResearchBlob(new Blob(['private-export-a']), 'private.csv', epoch), false);
});
