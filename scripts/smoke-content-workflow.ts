import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { AuthUserView, CollectionSource, PublicContent, SourceCapability } from '../packages/contracts/src/http.js';
import type { ContentAnnotationView, ContentSavedQueryView, SavedContentQuery } from '../packages/contracts/src/source-content.js';
import { contentQueryParams } from '../apps/web/src/features/content/queryState.js';

// Complete synthetic browser workflow. All API and media requests are intercepted; real providers are forbidden.
const base = new URL(process.env.SMOKE_WEB_BASE_URL ?? 'http://127.0.0.1:5173');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Content smoke requires loopback');
const now = '2026-10-13T01:00:00.000Z';
const users: AuthUserView[] = ['a', 'b'].map(letter => ({ id: `viewer-${letter}`, email: `${letter}@example.test`, displayName: `Synthetic viewer ${letter}`, role: 'viewer', status: 'active' }));
const sourceId = '34f16a77-cd9c-4f5e-a15b-9ba5f2dc21d7';
const source: CollectionSource = { revision: 1, id: sourceId, platform: 'x', provider: 'demo_x', label: 'Synthetic research source', target: { type: 'account', account: 'writer' }, contentKind: 'post', createdAt: now, updatedAt: now, state: 'active', group: 'Research A', lastSuccessAt: now, latestPublishedAt: now, coverage: 'partial', nextDueAt: null, incrementalTo: null,
  schedule: { enabled: false, cadenceSeconds: 3600, overlapSeconds: 300, initialLookbackHours: 24, maxCatchupHours: 6, maxPages: 2, pageSize: 25 }, refresh: { enabled: false, afterHours: 36, minIntervalHours: 12, maxAttempts: 2, batchSize: 10 } };
const capability: SourceCapability = { platform: 'x', provider: 'demo_x', enabled: true, contentKinds: ['post', 'comment'], targetTypes: ['account', 'search'], keywordSearch: 'global', observationModel: 'snapshot', limitations: ['Synthetic fixture; no source coverage claim.'], metrics: [{ key: 'x.likes', label: 'Likes', unit: 'count', signed: false, cumulative: true, contentKinds: ['post'], direction: 'higher' }] };
const mainId = '0daa62d1-a0d2-4383-b291-138fedab615e', olderId = 'e215494d-acab-474c-aa62-62909496d0bd', nullId = 'fcad5ddf-a2b2-4cba-9f36-938b98af3bb7', childId = '12b4fadb-6f64-4288-b7f9-36c073da9b18';
const mainItem: PublicContent = { id: mainId, externalId: '12345678901234567890', platform: 'x', kind: 'post', title: 'X research 研究 fixture', text: 'Bilingual 研究 content, with punctuation and source evidence.', url: 'https://example.test/original', language: 'zh', author: { externalId: '99999999999999999999', handle: 'writer', displayName: 'Synthetic Writer', url: null }, publishedAt: '2026-10-13T00:00:00.000Z', firstFetchedAt: now, lastFetchedAt: now, availability: 'available', references: [{ kind: 'post', externalId: '88888888888888888888', relation: 'quote' }],
  media: [{ type: 'image', url: `${base.origin}/mock-content-image.svg`, previewUrl: null, altText: 'Synthetic local image', durationSeconds: null }, { type: 'image', url: `${base.origin}/mock-expired-image.png`, previewUrl: null, altText: null, durationSeconds: null }, { type: 'image', url: 'javascript:alert(1)', previewUrl: null, altText: null, durationSeconds: null }],
  platformDetails: { platform: 'x', conversationId: '12345678901234567890', isQuote: true, isReply: null, isRepost: false, sensitive: null, extensions: { 'demo.note': 'Allowlisted fixture metadata only' } }, observations: [{ provider: 'demo_x', sourceId, fetchedAt: now, sourceObservedAt: null, timeBasis: 'provider_snapshot', maturity: 'unknown', metrics: { 'x.likes': 0, 'x.views': null }, evidenceKey: 'synthetic-main-evidence' }] };
const olderItem: PublicContent = { ...mainItem, id: olderId, externalId: '12345678901234567889', title: 'Older research 研究 fixture', publishedAt: '2026-10-12T23:59:59.200Z', references: [], media: [], observations: [{ ...mainItem.observations[0]!, metrics: { 'x.likes': 5 } }] };
const nullItem: PublicContent = { ...mainItem, id: nullId, externalId: '12345678901234567888', title: 'Null metric research 研究 fixture', publishedAt: null, media: [], references: [], observations: [{ ...mainItem.observations[0]!, metrics: { 'x.likes': null } }] };
const child: PublicContent = { ...mainItem, id: childId, externalId: '12345678901234567887', kind: 'comment', title: null, author: null, language: null, url: null, text: null, publishedAt: null, media: [], references: [{ relation: 'reply_to', kind: 'post', externalId: mainItem.externalId }], observations: [] };
const content = [mainItem, olderItem, nullItem, child];
const initialQuery: SavedContentQuery = { platform: 'x', provider: 'demo_x', sourceId, kind: 'post', query: '研究', author: 'writer', language: 'zh', sourceGroup: 'Research A', sort: 'published_asc', metricKey: 'x.likes', minMetric: 0, maxMetric: 10, from: '2026-10-12T23:59:59.123Z', to: '2026-10-13T00:00:00.456Z' };

function matches(params: URLSearchParams): PublicContent[] {
  const rows = content.filter(item => {
    if (params.get('platform') && params.get('platform') !== item.platform || params.get('kind') && params.get('kind') !== item.kind) return false;
    if (params.get('provider') && params.get('provider') !== 'demo_x' || params.get('sourceId') && params.get('sourceId') !== sourceId || params.get('sourceGroup') && params.get('sourceGroup') !== source.group) return false;
    if (params.get('author') && ![item.author?.handle, item.author?.externalId].some(value => value?.toLowerCase() === params.get('author')!.toLowerCase())) return false;
    if (params.get('language') && item.language?.toLowerCase() !== params.get('language')!.toLowerCase()) return false;
    if (params.get('query') && !`${item.title ?? ''} ${item.text ?? ''}`.toLowerCase().includes(params.get('query')!.toLowerCase())) return false;
    if (params.get('from') && (!item.publishedAt || item.publishedAt < params.get('from')!) || params.get('to') && (!item.publishedAt || item.publishedAt >= params.get('to')!)) return false;
    const key = params.get('metricKey'), value = key ? item.observations[0]?.metrics[key] : undefined;
    if (params.has('minMetric') && (value == null || value < Number(params.get('minMetric'))) || params.has('maxMetric') && (value == null || value > Number(params.get('maxMetric')))) return false;
    return true;
  });
  return rows.sort((a, b) => { if (!a.publishedAt || !b.publishedAt) return a.publishedAt ? -1 : b.publishedAt ? 1 : a.id.localeCompare(b.id); const value = a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id); return params.get('sort') === 'published_asc' ? value : -value; });
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'Asia/Shanghai' });
  let actor: AuthUserView | null = null, mediaRequests = 0, exportRequests = 0;
  const pageErrors: string[] = [], externalRequests: string[] = [], requests: { path: string; method: string; actor: string | null }[] = [];
  const queries = new Map<string, ContentSavedQueryView[]>(), annotations = new Map<string, Map<string, ContentAnnotationView>>();
  const ownerQueries = (id: string) => { if (!queries.has(id)) queries.set(id, []); return queries.get(id)!; };
  const ownerAnnotations = (id: string) => { if (!annotations.has(id)) annotations.set(id, new Map()); return annotations.get(id)!; };
  const checks: string[] = [];
  try {
    await context.addInitScript(() => localStorage.setItem('reddit-monitoring.language', 'en'));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) { externalRequests.push(url.href); await route.abort(); return; }
      if (url.pathname === '/mock-content-image.svg') { mediaRequests++; return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#39386c"/><text x="20" y="80" fill="white">Synthetic local media</text></svg>' }); }
      if (url.pathname === '/mock-expired-image.png') { mediaRequests++; return route.fulfill({ status: 404, body: 'Synthetic expired image' }); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname.slice(4), method = route.request().method();
      requests.push({ path, method, actor: actor?.id ?? null });
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      const reject = (message: string, status = 400) => json({ errorCode: status === 409 ? 'personal_conflict' : status === 401 ? 'unauthorized' : 'synthetic_error', error: message }, status);
      if (path === '/auth/me') return actor ? json({ ok: true, requestId: 'fixture', user: actor }) : reject('Sign in required', 401);
      if (path === '/auth/login') { const body = route.request().postDataJSON() as { email: string }; actor = users.find(user => user.email === body.email) ?? null; return actor ? json({ ok: true, requestId: 'fixture', user: actor }) : reject('Invalid synthetic account', 401); }
      if (path === '/auth/logout') { actor = null; return json({ ok: true, requestId: 'fixture' }); }
      if (!actor) return reject('Sign in required', 401);
      if (path === '/v1/sources') return json({ ok: true, requestId: 'fixture', sources: [source], capabilities: [capability] });
      if (path === '/v1/source-jobs') return json({ ok: true, requestId: 'fixture', jobs: [] });
      if (path === '/v1/source-ops') return json({ ok: true, requestId: 'fixture', ops: { checkedAt: now, workers: [], queue: [], sources: [], providers: [], oldestQueuedAt: null } });
      if (path === '/v1/workbench/saved-views') return json({ ok: true, requestId: 'fixture', views: [] });
      if (path === '/v1/content/workbench') { const rows = matches(url.searchParams); return json({ ok: true, requestId: 'fixture', generatedAt: now, stats: { total: rows.length, byKind: [{ kind: 'post', count: rows.length }], daily: [], unknownPublishedAtCount: rows.filter(row => !row.publishedAt).length, scope: 'collected_content' }, byPlatform: [{ platform: 'x', count: rows.length }], byProvider: [{ provider: 'demo_x', count: rows.length }], sources: [], capabilities: [capability], limitations: [] }); }
      if (path === '/v1/content') { const rows = matches(url.searchParams), index = url.searchParams.get('cursor') === 'fixture-next' ? 1 : 0; return json({ ok: true, requestId: 'fixture', items: rows.slice(index, index + 1), nextCursor: index === 0 && rows.length > 1 ? 'fixture-next' : null, coverage: 'stored_sample', queryScope: 'collected_content' }); }
      if (path === '/v1/content/export') { exportRequests++; const rows = matches(url.searchParams); return json({ ok: true, requestId: 'fixture', items: rows, exportedCount: rows.length, totalMatching: rows.length, truncated: false, nextCursor: null, scope: 'collected_content', generatedAt: now, query: Object.fromEntries(url.searchParams), sources: [source] }); }
      if (path === '/v1/content-saved-queries') {
        const mine = ownerQueries(actor.id);
        if (method === 'GET') return json({ ok: true, requestId: 'fixture', queries: mine, nextCursor: null });
        const body = route.request().postDataJSON() as { name: string; query: SavedContentQuery; expectedRevision: number };
        assert.equal(body.expectedRevision, 0); assert.equal('cursor' in body.query, false); assert.equal('limit' in body.query, false); assert.equal(body.query.minMetric, 0);
        const saved: ContentSavedQueryView = { id: 'afac2c84-ef65-4684-aacb-955fab27c94b', name: body.name, query: body.query, revision: 1, createdAt: now, updatedAt: now }; mine.push(saved);
        return json({ ok: true, requestId: 'fixture', savedQuery: saved });
      }
      const savedMatch = path.match(/^\/v1\/content-saved-queries\/([^/]+)$/);
      if (savedMatch) { const mine = ownerQueries(actor.id), found = mine.find(value => value.id === savedMatch[1]); if (!found) return reject('Not found', 404); const body = route.request().postDataJSON() as { expectedRevision: number; name: string; query: SavedContentQuery }; if (body.expectedRevision !== found.revision) return reject('Saved query changed; reload before saving', 409); if (method === 'DELETE') { mine.splice(mine.indexOf(found), 1); return json({ ok: true, requestId: 'fixture', deleted: true }); } Object.assign(found, { name: body.name, query: body.query, revision: found.revision + 1 }); return json({ ok: true, requestId: 'fixture', savedQuery: found }); }
      const annotationMatch = path.match(/^\/v1\/content\/([^/]+)\/annotation$/);
      if (annotationMatch) { const id = annotationMatch[1]!, mine = ownerAnnotations(actor.id), found = mine.get(id); if (method === 'GET') return json({ ok: true, requestId: 'fixture', annotation: found ?? null }); const body = route.request().postDataJSON() as { expectedRevision: number; note: string; favorite: boolean }; if (body.expectedRevision !== (found?.revision ?? 0)) return reject('Annotation changed; reload before saving', 409); if (method === 'DELETE') { mine.delete(id); return json({ ok: true, requestId: 'fixture', deleted: true }); } const annotation: ContentAnnotationView = { contentId: id, note: body.note, favorite: body.favorite, revision: body.expectedRevision + 1, createdAt: now, updatedAt: now }; mine.set(id, annotation); return json({ ok: true, requestId: 'fixture', annotation }); }
      if (path === '/v1/content-annotations') return json({ ok: true, requestId: 'fixture', items: [...ownerAnnotations(actor.id).values()].filter(note => url.searchParams.get('favorite') !== 'true' || note.favorite).map(annotation => ({ annotation, content: content.find(item => item.id === annotation.contentId) })), nextCursor: null });
      const detailMatch = path.match(/^\/v1\/content\/([^/]+)$/);
      if (detailMatch) { const item = content.find(item => item.id === detailMatch[1]); return item ? json({ ok: true, requestId: 'fixture', content: item, sources: [source], references: item.references.map(reference => ({ reference, content: null })), children: item.id === mainId ? [child] : [], relatedLimit: 20, relatedTruncated: item.id === mainId, scope: 'stored_content' }) : reject('Not found', 404); }
      return reject(`Unhandled synthetic endpoint: ${path}`, 404);
    });
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
    const signIn = async (who: string) => { await page.getByLabel('Email', { exact: true }).fill(`${who}@example.test`); await page.getByLabel('Password', { exact: true }).fill('Synthetic-password-123'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: 'Logout', exact: true }).waitFor(); };
    const visit = async (path: string) => page.locator(`.app-sidebar a[href="${path}"]`).click();
    const queryPath = `/content?${contentQueryParams(initialQuery)}`;
    await page.goto(`${base.origin}${queryPath}`); await page.waitForURL('**/login?returnTo=*');
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), queryPath);
    await page.reload(); await signIn('a'); await page.waitForURL(`${base.origin}${queryPath}`);
    await page.getByRole('heading', { name: olderItem.title!, exact: true }).waitFor();
    assert.equal(await page.getByLabel('Author', { exact: true }).inputValue(), 'writer');
    assert.equal(await page.getByLabel('Metric minimum', { exact: true }).inputValue(), '0');
    assert.equal(await page.getByText(nullItem.title!, { exact: true }).count(), 0);
    checks.push('Login refresh restores every filter, Unicode query, UTC day boundary and metric zero; unknown metric/date excluded');
    await page.getByLabel('Publication order', { exact: true }).selectOption('published_desc');
    await page.getByLabel('Keyword', { exact: true }).press('Enter'); await page.getByRole('heading', { name: mainItem.title!, exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('sort'), 'published_desc');
    assert.equal(new URL(page.url()).searchParams.get('from'), initialQuery.from);
    await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByRole('heading', { name: olderItem.title!, exact: true }).waitFor();
    await page.locator('summary').filter({ hasText: 'Save applied query for my account' }).click();
    await page.getByLabel('Query name', { exact: true }).fill('A private research query'); await page.getByRole('button', { name: 'Save query', exact: true }).click();
    await page.getByText('Query saved.', { exact: false }).waitFor();
    await visit('/saved'); await page.getByRole('link', { name: 'A private research query', exact: true }).waitFor();
    const saved = ownerQueries(users[0]!.id)[0]!; saved.name = 'Other tab name'; saved.revision++;
    await page.getByLabel('Rename saved query', { exact: true }).fill('My draft rename'); await page.getByRole('button', { name: 'Rename query', exact: true }).click();
    await page.getByText('Your name draft is preserved', { exact: false }).waitFor(); assert.equal(await page.getByLabel('Rename saved query', { exact: true }).inputValue(), 'My draft rename');
    await page.getByRole('button', { name: 'Reload saved query', exact: true }).click(); await page.waitForFunction(() => (document.querySelector('[id^="saved-name-"]') as HTMLInputElement)?.value === 'Other tab name');
    await page.getByLabel('Rename saved query', { exact: true }).fill('Reopened research'); await page.getByRole('button', { name: 'Rename query', exact: true }).click(); await page.getByRole('link', { name: 'Reopened research', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Reopened research', exact: true }).click(); await page.getByRole('heading', { name: mainItem.title!, exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('author'), 'writer'); assert.equal(new URL(page.url()).searchParams.get('sourceGroup'), 'Research A');
    await mkdir('output/playwright', { recursive: true }); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForFunction(() => scrollY === 0); await page.screenshot({ path: 'output/playwright/phase5a-content-desktop.png', fullPage: true });
    checks.push('Source-aware filters, keyboard apply, asc/desc paging, canonical query save/reopen and rename CAS preserving drafts');
    await page.getByRole('heading', { name: mainItem.title!, exact: true }).getByRole('link').click(); await page.getByRole('heading', { name: 'Stored references and replies', exact: true }).waitFor();
    assert.equal(mediaRequests, 0); await page.getByText('Referenced content not stored', { exact: false }).waitFor(); await page.getByText('88888888888888888888', { exact: false }).waitFor();
    assert.equal(await page.getByText('12345678901234567890', { exact: false }).count() > 0, true);
    await page.getByText('x.views: Unknown', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Load media preview', exact: true }).first().click(); await page.getByAltText('Synthetic local image', { exact: true }).waitFor(); await page.waitForFunction(() => (document.querySelector('img[alt="Synthetic local image"]') as HTMLImageElement)?.naturalWidth > 0); assert.equal(mediaRequests, 1);
    await page.getByRole('button', { name: 'Load media preview', exact: true }).first().click(); await page.getByText('Media could not be loaded.', { exact: false }).waitFor(); assert.equal(mediaRequests, 2);
    await page.getByText('Media address is missing or unsafe.', { exact: true }).waitFor();
    checks.push('Detail preserves string IDs, units/null/time semantics, bounded stored-only quote/replies and opt-in media success/expired/unsafe states');
    await page.getByLabel('Favorite this content', { exact: true }).check(); await page.getByLabel('Personal note', { exact: true }).fill('A initial private note'); await page.getByRole('button', { name: 'Save personal note', exact: true }).click(); await page.getByText('Personal annotation updated.', { exact: true }).waitFor();
    const current = ownerAnnotations(users[0]!.id).get(mainId)!; current.note = 'Other tab annotation'; current.revision++;
    await page.getByLabel('Personal note', { exact: true }).fill('Preserved conflict draft'); await page.getByRole('button', { name: 'Save personal note', exact: true }).click();
    await page.getByText('Your draft is preserved.', { exact: false }).waitFor(); assert.equal(await page.getByLabel('Personal note', { exact: true }).inputValue(), 'Preserved conflict draft'); assert.equal(await page.getByRole('button', { name: 'Save personal note', exact: true }).isDisabled(), true);
    await Promise.all([page.waitForEvent('dialog').then(dialog => dialog.dismiss()), page.getByRole('link', { name: 'Back to content query', exact: true }).click()]); assert.equal(new URL(page.url()).pathname, `/content/${mainId}`);
    await page.getByRole('button', { name: 'Reload personal note', exact: true }).click(); await page.waitForFunction(() => (document.querySelector('#personal-content-note') as HTMLTextAreaElement)?.value === 'Other tab annotation');
    await page.getByLabel('Personal note', { exact: true }).fill('Final A private note'); await page.getByRole('button', { name: 'Save personal note', exact: true }).click(); await page.getByText('Personal annotation updated.', { exact: true }).waitFor();
    await visit('/saved'); await page.getByText('Final A private note', { exact: true }).waitFor();
    await page.getByRole('link', { name: mainItem.title!, exact: true }).click(); await page.getByLabel('Personal note', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Personal note', { exact: true }).inputValue(), 'Final A private note');
    checks.push('Viewer favorite/note create/revision update/reopen; stale write keeps draft; SPA exit confirmation respects cancel');
    await page.getByRole('link', { name: 'Back to saved items', exact: true }).click(); await page.getByRole('link', { name: 'Reopened research', exact: true }).click(); await page.getByRole('heading', { name: mainItem.title!, exact: true }).waitFor();
    await page.locator('summary').filter({ hasText: 'Export matching saved content' }).click();
    const download = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JSON', exact: true }).click()]); assert.ok(download[0].suggestedFilename().endsWith('.json')); assert.equal(exportRequests, 1);
    assert.deepEqual(ownerQueries(users[0]!.id)[0]!.query, { ...initialQuery, sort: 'published_desc' });
    await page.getByRole('button', { name: 'Logout', exact: true }).click(); await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor(); await signIn('b'); await page.getByRole('heading', { name: 'Collected content', exact: true }).waitFor();
    await visit('/saved'); await page.getByText('No personal content queries yet.', { exact: false }).waitFor(); await page.getByText('No matching favorites or notes for this account.', { exact: true }).waitFor(); assert.equal(await page.getByText('Final A private note', { exact: true }).count(), 0);
    await page.goto(`${base.origin}/content/${mainId}`); await page.getByLabel('Personal note', { exact: true }).waitFor(); assert.equal(await page.getByLabel('Personal note', { exact: true }).inputValue(), ''); assert.equal(await page.getByLabel('Favorite this content', { exact: true }).isChecked(), false);
    checks.push('Filtered export uses applied query; account A/B cannot reuse each other’s private query/note cache');
    await page.getByRole('button', { name: 'Logout', exact: true }).click(); await signIn('a'); await visit('/saved'); await page.getByRole('link', { name: 'Reopened research', exact: true }).waitFor();
    await Promise.all([page.waitForEvent('dialog').then(dialog => dialog.accept()), page.getByRole('button', { name: 'Delete query', exact: true }).click()]); await page.getByText('No personal content queries yet.', { exact: false }).waitFor();
    await page.getByRole('link', { name: mainItem.title!, exact: true }).click(); await page.getByLabel('Personal note', { exact: true }).waitFor();
    await Promise.all([page.waitForEvent('dialog').then(dialog => dialog.accept()), page.getByRole('button', { name: 'Delete personal note', exact: true }).click()]); await page.waitForFunction(() => (document.querySelector('#personal-content-note') as HTMLTextAreaElement)?.value === '');
    await page.goto(`${base.origin}/content/${childId}`); await page.getByText('Text was not provided;', { exact: false }).waitFor(); await page.getByText('Original link unavailable.', { exact: true }).waitFor(); await page.getByText('No media was supplied.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Language', exact: true }).click(); await page.getByRole('heading', { name: '已存内容详情', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { const textarea = document.querySelector<HTMLTextAreaElement>('#personal-content-note'); textarea?.focus(); });
    assert.equal(await page.locator('#personal-content-note').evaluate(element => element === document.activeElement), true);
    const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(widths.document <= widths.viewport + 1, JSON.stringify(widths));
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForFunction(() => scrollY === 0); await page.screenshot({ path: 'output/playwright/phase5a-content-mobile.png', fullPage: true });
    checks.push('Query/note revision deletes, missing title/author/text/language/media/original, Chinese 390px, keyboard focus and no overflow');
    assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
    const evidence = { scope: 'synthetic_browser_only', base: base.origin, checks, requests: requests.length, mediaRequests, externalRequests, pageErrors, realProviderRequests: 0 };
    await writeFile('output/playwright/phase5a-content-workflow-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`); console.log(JSON.stringify(evidence, null, 2));
  } catch (error) { await mkdir('output/playwright', { recursive: true }); await context.pages()[0]?.screenshot({ path: 'output/playwright/phase5a-content-debug.png', fullPage: true }).catch(() => {}); throw error;
  } finally { await context.close(); await browser.close(); }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
