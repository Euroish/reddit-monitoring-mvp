import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSavedWorkbenchRoute, parseWorkbenchSeries } from '../../apps/web/src/features/workbench/model/urlState.js';
import type { SavedWorkbenchViewResponseItem } from '../../packages/contracts/src/http.js';

function saved(overrides: Partial<SavedWorkbenchViewResponseItem> = {}): SavedWorkbenchViewResponseItem {
  return { id: 'saved-1', name: 'Saved target', viewKind: 'target', primaryTarget: 'r/technology',
    compareTargets: ['r/science'], keywords: ['机器学习', 'AI'], seriesIds: ['ema_7', 'observed_new_posts'],
    routePath: '/target/technology', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', ...overrides };
}

test('saved target restores structured legacy fields and keeps explicit range and hidden overlays', () => {
  const route = buildSavedWorkbenchRoute(saved({ routePath: '/target/technology?range=7d&hiddenOverlays=keyword%3AAI' }));
  assert.ok(route);
  const url = new URL(route, 'http://local.invalid');
  assert.equal(url.pathname, '/target/technology');
  assert.equal(url.searchParams.get('range'), '7d');
  assert.equal(url.searchParams.get('compare'), 'science');
  assert.equal(url.searchParams.get('keywords'), '机器学习,AI');
  assert.equal(url.searchParams.get('series'), 'ema_7,observed_new_posts');
  assert.equal(url.searchParams.get('hiddenOverlays'), 'keyword:AI');
  assert.equal(url.searchParams.get('timeframe'), '1d');
});

test('known old API routes translate into UI routes and explicit URL selection wins', () => {
  const route = buildSavedWorkbenchRoute(saved({ viewKind: 'comparison',
    routePath: '/v1/workbench/compare?range=90d&series=heat_price' }));
  assert.ok(route);
  const url = new URL(route, 'http://local.invalid');
  assert.equal(url.pathname, '/compare');
  assert.equal(url.searchParams.get('targets'), 'technology,science');
  assert.equal(url.searchParams.get('series'), 'heat_price');
  assert.equal(url.searchParams.get('range'), '90d');
  assert.match(buildSavedWorkbenchRoute(saved({ routePath: '/v1/workbench/target/technology' }))!, /^\/target\/technology\?/);
});

test('saved routes reject arbitrary URLs and series parsing allows only known metric identifiers', () => {
  for (const routePath of ['https://example.com/target/technology', '//example.com', '/ops', '/target/../ops', '/v1/users']) {
    assert.equal(buildSavedWorkbenchRoute(saved({ routePath })), null);
  }
  assert.deepEqual(parseWorkbenchSeries('ema_7,unknown,heat_price,ema_7'), ['ema_7', 'heat_price']);
  assert.equal(buildSavedWorkbenchRoute(saved({ routePath: '/content?query=AI' })), '/content?query=AI');
});
