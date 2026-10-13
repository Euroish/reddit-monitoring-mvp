import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalContentQuery, contentFilterDraft, contentQueryFromDraft, contentQueryFromParams, contentQueryParams, contentQueryPath, safeContentUrl } from '../../apps/web/src/features/content/queryState.js';
import { loginReturnPath, safeInternalReturnPath } from '../../apps/web/src/auth/internalReturnPath.js';

test('content queries round-trip all 5A filters, Unicode and a reported metric zero without paging state', () => {
  const query = { platform: 'x' as const, provider: 'demo_x', sourceId: 'source-id', kind: 'post' as const, query: '研究 🚀 & punctuation,', author: '12345678901234567890', language: 'zh', sourceGroup: '研究 A', sort: 'published_asc' as const, metricKey: 'x.likes', minMetric: 0, maxMetric: 25, from: '2026-10-12T23:59:59.123Z', to: '2026-10-13T00:00:00.456Z', limit: 1, cursor: 'private-cursor' };
  const canonical = canonicalContentQuery(query);
  const serialized = contentQueryParams(query);
  assert.equal(serialized.includes('cursor'), false); assert.equal(serialized.includes('limit'), false);
  assert.deepEqual(contentQueryFromParams(new URLSearchParams(serialized)), canonical);
  assert.deepEqual(contentQueryFromDraft(contentFilterDraft(canonical)), canonical);
  assert.equal(canonical.minMetric, 0); assert.equal(canonical.author, '12345678901234567890');
  assert.equal(contentQueryPath(canonical), `/content?${serialized}`);
});

test('empty filters remain empty, numeric unknowns are never coerced into zero', () => {
  assert.deepEqual(contentQueryFromParams(new URLSearchParams('minMetric=&maxMetric=NaN&cursor=next&limit=1')), {});
  assert.deepEqual(canonicalContentQuery({ query: ' ', minMetric: Number.NaN, maxMetric: Number.POSITIVE_INFINITY }), {});
  const draft = contentFilterDraft({ minMetric: 0, maxMetric: 9 });
  assert.deepEqual(contentQueryFromDraft(draft), { sort: 'published_desc' });
});

test('login preserves a known internal path with exact query across location state and refresh', () => {
  const path = '/content?query=%E7%A0%94%E7%A9%B6&sourceGroup=A%2BB&sort=published_asc';
  assert.equal(safeInternalReturnPath(path), path);
  assert.equal(loginReturnPath({ from: { pathname: '/content', search: path.slice(8) } }, new URLSearchParams()), path);
  assert.equal(loginReturnPath(null, new URLSearchParams({ returnTo: path })), path);
  assert.equal(safeInternalReturnPath('/content/123?back=%2Fsaved'), '/content/123?back=%2Fsaved');
  assert.equal(safeInternalReturnPath('/markets/board?range=7d'), '/markets/board?range=7d');
});

test('external and disguised login return paths are rejected', () => {
  for (const path of ['https://evil.test', '//evil.test/content', '/\\evil.test', '/%2f%2fevil.test', '/%5cevil.test', '/%0a/content', '/login?returnTo=//evil.test', '/unknown', '/content/../../login', '/content\u0000', '/content?x=\n']) assert.equal(safeInternalReturnPath(path), '/content', path);
  assert.equal(loginReturnPath({}, new URLSearchParams({ returnTo: '//evil.test' })), '/content');
});

test('stored original and media URLs accept HTTP(S) only, never credentials or active schemes', () => {
  assert.equal(safeContentUrl('https://example.test/content?x=1#view'), 'https://example.test/content?x=1#view');
  assert.equal(safeContentUrl('http://127.0.0.1:41975/mock-image.png'), 'http://127.0.0.1:41975/mock-image.png');
  for (const url of [null, '', 'javascript:alert(1)', 'data:image/png;base64,AA==', '//host.test', 'https://user:password@host.test', 'https://host.test/\nscript', 'https:\\host.test', 'https://host.test/' + 'x'.repeat(4100)]) assert.equal(safeContentUrl(url), null);
});
