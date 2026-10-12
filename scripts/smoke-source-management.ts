import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { CollectionSource, ContentExportResponse, PublicContent, SourceCapability, SourceCollectionJob, SourceOps, SourceProviderUsage } from '../packages/contracts/src/http.js';

// Requires an already running loopback Vite. All API responses are synthetic; no DB/provider is used.
const base = new URL(process.env.SMOKE_WEB_BASE_URL ?? 'http://127.0.0.1:5173');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Source UI smoke requires loopback');
const now = '2026-10-12T10:00:00.000Z';
const sourceId = '00000000-0000-4000-8000-000000000001';
const sources: CollectionSource[] = [{ id: sourceId, platform: 'reddit', provider: 'demo_reddit', label: 'Synthetic Reddit',
  target: { type: 'community', community: 'technology' }, contentKind: 'post', createdAt: now, updatedAt: now,
  lastSuccessAt: now, latestPublishedAt: now, coverage: 'partial', state: 'active', group: null,
  schedule: { enabled: false, cadenceSeconds: 3600, overlapSeconds: 300, initialLookbackHours: 24, maxCatchupHours: 6, pageSize: 25, maxPages: 5 },
  refresh: { enabled: false, afterHours: 36, minIntervalHours: 12, maxAttempts: 3, batchSize: 25 }, nextDueAt: null, incrementalTo: null }];
const capabilities: SourceCapability[] = [
  { platform: 'reddit', provider: 'demo_reddit', enabled: true, contentKinds: ['post', 'comment'], targetTypes: ['community', 'account', 'post'], keywordSearch: 'scoped', metrics: [], observationModel: 'archive', refreshByIds: true, limitations: ['Synthetic fixture; no external requests.'] },
  { platform: 'x', provider: 'demo_x', enabled: true, contentKinds: ['post'], targetTypes: ['account', 'search'], keywordSearch: 'global', metrics: [{ key: 'x.likes', label: 'Likes', unit: 'count', cumulative: true, signed: false, contentKinds: ['post'], direction: 'higher' }], observationModel: 'snapshot', refreshByIds: true, limitations: ['Synthetic X data only.'] },
  { platform: 'x', provider: 'x_api_v2', enabled: false, contentKinds: ['post'], targetTypes: ['account', 'search'], keywordSearch: 'global', metrics: [], observationModel: 'snapshot', limitations: ['Real provider requires credentials and explicitly enabled network.'] },
];
const usage: SourceProviderUsage = { provider: 'demo_reddit', day: '2026-10-12', month: '2026-10', dailyRequests: 2, monthlyRequests: 2, dailyResources: 50, monthlyResources: 50,
  budget: { provider: 'demo_reddit', enabled: true, dailyRequests: 1000, monthlyRequests: 10000, dailyResources: 100000, monthlyResources: 1000000 } };
function job(id: string, status: SourceCollectionJob['status']): SourceCollectionJob {
  return { id, sourceId, status, from: '2026-10-11T10:00:00Z', to: now, pageSize: 25, maxPages: 5, pagesCommitted: status === 'succeeded' ? 5 : 0,
    recordsProcessed: status === 'succeeded' ? 125 : 0, checkpoint: status === 'succeeded' ? { offset: 125 } : null, coverage: 'partial', exhausted: false,
    attempts: 0, error: status === 'failed' ? 'Synthetic temporary failure' : null, nextRunAt: now, createdAt: now, finishedAt: ['failed', 'succeeded', 'cancelled'].includes(status) ? now : null,
    purpose: 'manual', parentJobId: null, refreshIds: [], recordsInserted: 0, recordsUpdated: 0 };
}
const jobs: SourceCollectionJob[] = [job('00000000-0000-4000-8000-000000000011', 'queued'), job('00000000-0000-4000-8000-000000000012', 'failed'), job('00000000-0000-4000-8000-000000000013', 'succeeded')];
const item: PublicContent = { id: '00000000-0000-4000-8000-000000000021', platform: 'reddit', kind: 'post', externalId: 't3_synthetic',
  title: '[DEMO] Synthetic content', text: '[合成演示] local fixture only', url: null, language: 'zh-CN', author: null, publishedAt: now,
  firstFetchedAt: now, lastFetchedAt: now, availability: 'available', references: [], media: [], platformDetails: { platform: 'reddit', community: 'technology', flair: null, nsfw: false },
  observations: [{ provider: 'demo_reddit', sourceId, sourceObservedAt: now, fetchedAt: now, timeBasis: 'archive_initial', maturity: 'initial', metrics: { 'reddit.score': 0 }, evidenceKey: 'synthetic' }] };
function filteredItem(url: URL): PublicContent {
  if (url.searchParams.get('platform') !== 'x') return item;
  return { ...item, platform: 'x', externalId: '1900000000000000001', title: '[DEMO] Synthetic X content',
    platformDetails: { platform: 'x', conversationId: '1900000000000000001', isReply: false, isRepost: false, isQuote: false, sensitive: false },
    observations: [{ ...item.observations[0]!, provider: 'demo_x', sourceId: sources[1]!.id, timeBasis: 'provider_snapshot', maturity: 'unknown', metrics: { 'x.likes': 0 } }] };
}
const mutations: string[] = [];
const contentQueries: URLSearchParams[] = [];
let role: 'owner' | 'viewer' = 'owner';
let revision = 0;
let rejectCsvOnce = true;

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  const errors: string[] = [], external: string[] = [];
  try {
    await context.addInitScript(() => localStorage.setItem('reddit-monitoring.language', 'en'));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) { external.push(url.origin); await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      const path = url.pathname.slice(4), method = route.request().method();
      const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (path === '/auth/me') return respond({ ok: true, requestId: 'synthetic-ui', user: { id: `synthetic-${role}`, email: `${role}@example.test`, role, status: 'active', createdAt: now, updatedAt: now } });
      if (method !== 'GET') mutations.push(`${method} ${path}`);
      if (path === '/v1/sources' && method === 'GET') return respond({ ok: true, requestId: 'synthetic-ui', sources, capabilities, providers: [usage] });
      if (path === '/v1/sources' && method === 'POST') {
        const payload = route.request().postDataJSON();
        assert.equal(payload.provider, 'demo_x');
        assert.deepEqual(payload.target, { type: 'search', query: 'AI agents' });
        const created: CollectionSource = { ...sources[0]!, id: '00000000-0000-4000-8000-000000000002', platform: payload.platform, provider: payload.provider,
          label: payload.label, target: payload.target, contentKind: payload.contentKind, schedule: { ...sources[0]!.schedule, enabled: false }, refresh: { ...sources[0]!.refresh, enabled: false } };
        sources.push(created); return respond({ ok: true, source: created }, 201);
      }
      if (path === `/v1/sources/${sourceId}` && method === 'PATCH') {
        const payload = route.request().postDataJSON();
        Object.assign(sources[0]!, payload, { updatedAt: new Date(Date.parse(now) + ++revision * 1000).toISOString() });
        return respond({ ok: true, source: sources[0] });
      }
      const stateMatch = /^\/v1\/sources\/([^/]+)\/(pause|resume|archive)$/.exec(path);
      if (stateMatch) {
        const source = sources.find(value => value.id === stateMatch[1])!;
        source.state = stateMatch[2] === 'pause' ? 'paused' : stateMatch[2] === 'archive' ? 'archived' : 'active';
        source.updatedAt = new Date(Date.parse(now) + ++revision * 1000).toISOString();
        return respond({ ok: true, source });
      }
      if (path === '/v1/source-jobs') return respond({ ok: true, jobs: jobs.filter(value => (!url.searchParams.get('sourceId') || value.sourceId === url.searchParams.get('sourceId')) && (!url.searchParams.get('status') || value.status === url.searchParams.get('status'))) });
      const taskMatch = /^\/v1\/source-jobs\/([^/]+)(?:\/(cancel|retry|continue))?$/.exec(path);
      if (taskMatch) {
        const value = jobs.find(value => value.id === taskMatch[1])!;
        if (taskMatch[2] === 'cancel') value.status = 'cancelled';
        else if (taskMatch[2] === 'retry') { value.status = 'queued'; value.error = null; }
        else if (taskMatch[2] === 'continue') { const next = { ...value, id: '00000000-0000-4000-8000-000000000014', status: 'queued' as const, parentJobId: value.id, pagesCommitted: 0 }; jobs.push(next); return respond({ ok: true, job: next }, 202); }
        return respond({ ok: true, job: value });
      }
      if (path === '/v1/source-ops') {
        const ops: SourceOps = { checkedAt: now, workers: [{ id: 'synthetic-worker', startedAt: now, lastHeartbeatAt: now, state: 'active', lastJobId: null, stale: false }],
          queue: [{ status: 'queued', count: jobs.filter(value => value.status === 'queued').length }], oldestQueuedAt: now, sources: [], providers: [usage] };
        return respond({ ok: true, ops });
      }
      if (path === '/v1/source-provider-budgets/demo_reddit' && method === 'PUT') { usage.budget = { provider: usage.provider, ...route.request().postDataJSON() }; return respond({ ok: true, budget: usage.budget }); }
      if (path === '/v1/content') { contentQueries.push(url.searchParams); return respond({ ok: true, items: [filteredItem(url)], nextCursor: null, coverage: 'stored_sample', queryScope: 'collected_content' }); }
      if (path === '/v1/content/workbench') return respond({ ok: true, requestId: 'synthetic-ui', generatedAt: now,
        stats: { total: 1, byKind: [{ kind: 'post', count: 1 }], daily: [{ day: '2026-10-12', count: 1 }], scope: 'collected_content', unknownPublishedAtCount: 0 },
        byPlatform: [{ platform: filteredItem(url).platform, count: 1 }], byProvider: [{ provider: filteredItem(url).observations[0]!.provider, count: 1 }], sources, capabilities,
        scope: 'collected_content', providerCountsMayOverlap: true, metricComparison: 'platform_units_only' });
      if (path === '/v1/content/export') {
        assert.equal(url.searchParams.get('platform'), 'x'); assert.equal(url.searchParams.get('provider'), 'demo_x');
        const second = url.searchParams.has('cursor');
        const data: ContentExportResponse = { ok: true, requestId: 'synthetic-ui', exportedAt: now, scope: 'collected_content', coverage: 'stored_sample',
          filters: { platform: 'x', provider: 'demo_x' }, totalMatching: 2, exportedCount: 1, maxItems: Number(url.searchParams.get('maxItems')),
          truncated: !second, nextCursor: second ? null : 'synthetic_export_part_2', items: [filteredItem(url)] };
        if (url.searchParams.get('format') === 'csv') {
          if (rejectCsvOnce) { rejectCsvOnce = false; return respond({ error: '' }, 503); }
          const { items: _items, ...metadata } = data;
          return route.fulfill({ contentType: 'text/csv;charset=utf-8', headers: { 'X-Export-Count': '1', 'X-Export-Truncated': String(data.truncated), 'X-Export-Next-Cursor': data.nextCursor ?? '' },
            body: `\uFEFFexport_metadata,"${JSON.stringify(metadata).replaceAll('"', '""')}"\r\nid,title\r\n${item.id},合成演示\r\n` });
        }
        return respond(data);
      }
      throw new Error(`Unstubbed synthetic endpoint: ${method} ${path}`);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base.origin}/content`);
    await page.getByRole('heading', { name: 'Collected content', exact: true }).waitFor();
    await page.getByText('[DEMO] Synthetic content', { exact: true }).waitFor();
    await page.getByText(/View and manage sources/).click();
    const sourceRow = page.locator('.content-source-list li').first();
    await sourceRow.getByText('Source settings', { exact: true }).click();
    const settings = sourceRow.getByRole('form', { name: 'Settings for Synthetic Reddit' });
    await settings.getByLabel('Source label', { exact: true }).fill('Renamed synthetic Reddit');
    await settings.getByLabel('Source group', { exact: true }).fill('Research');
    await settings.getByLabel('Enable periodic collection', { exact: true }).check();
    await settings.getByLabel('Collection interval (seconds)', { exact: true }).fill('7200');
    await settings.getByLabel('Enable metric refresh by content ID', { exact: true }).check();
    await settings.getByRole('button', { name: 'Save source settings', exact: true }).click();
    await sourceRow.getByText('Settings saved', { exact: true }).waitFor();
    assert.equal(sources[0]!.group, 'Research'); assert.equal(sources[0]!.schedule.cadenceSeconds, 7200); assert.equal(sources[0]!.refresh.enabled, true);
    await sourceRow.getByRole('button', { name: 'Pause source', exact: true }).click();
    await sourceRow.getByRole('button', { name: 'Resume source', exact: true }).waitFor();
    assert.equal(await sourceRow.getByRole('button', { name: 'Collect', exact: true }).isDisabled(), true);
    await sourceRow.getByRole('button', { name: 'Resume source', exact: true }).click();
    await sourceRow.getByRole('button', { name: 'Pause source', exact: true }).waitFor();
    await page.getByText('Add a source', { exact: true }).click();
    await page.getByLabel('Platform / provider', { exact: true }).selectOption('x:x_api_v2');
    assert.equal(await page.getByRole('button', { name: 'Save source', exact: true }).isDisabled(), true);
    await page.getByLabel('Platform / provider', { exact: true }).selectOption('x:demo_x');
    await page.getByLabel('Target type', { exact: true }).selectOption('search');
    await page.getByLabel('Source label (optional)', { exact: true }).fill('Synthetic X search');
    await page.getByLabel('Search expression', { exact: true }).fill('AI agents');
    await page.getByRole('button', { name: 'Save source', exact: true }).click();
    await page.locator('.content-source-list').getByText(/Synthetic X search/).waitFor();
    const xSourceRow = page.locator('.content-source-list li').nth(1);
    await xSourceRow.getByText('Source settings', { exact: true }).click();
    assert.equal(await xSourceRow.getByLabel('Enable metric refresh by content ID', { exact: true }).isDisabled(), true);
    await xSourceRow.getByText(/Automatic mature metric refresh currently applies only to archive providers/).waitFor();
    assert.equal(sources[1]!.refresh.enabled, false);
    await page.getByText('Collection task history', { exact: true }).click();
    await page.getByRole('button', { name: 'Cancel task', exact: true }).first().click();
    await page.locator('li strong').filter({ hasText: /Cancelled/ }).waitFor();
    await page.getByRole('button', { name: 'Retry task', exact: true }).click();
    const continuedResponse = page.waitForResponse(response => response.url().endsWith('/continue'));
    await page.getByRole('button', { name: 'Continue task', exact: true }).click(); await continuedResponse;
    assert.equal(jobs[0]!.status, 'cancelled'); assert.equal(jobs[1]!.status, 'queued'); assert.equal(jobs.at(-1)!.parentJobId, jobs[2]!.id);
    await page.getByText('Worker status and provider budgets', { exact: true }).click();
    await page.getByText(/synthetic-worker/).waitFor();
    const budget = page.getByRole('form', { name: 'Budget for demo_reddit' });
    await budget.getByLabel('Daily request limit', { exact: true }).fill('1200');
    await budget.getByRole('button', { name: 'Save provider budget', exact: true }).click();
    await page.getByText('Budget saved', { exact: true }).waitFor(); assert.equal(usage.budget.dailyRequests, 1200);
    await page.getByLabel('Platform', { exact: true }).selectOption('x');
    await page.getByLabel('Provider', { exact: true }).selectOption('demo_x');
    const filteredResponse = page.waitForResponse(response => response.url().includes('/api/v1/content?') && response.url().includes('platform=x'));
    await page.getByRole('button', { name: 'Search', exact: true }).click(); await filteredResponse;
    await page.getByText('[DEMO] Synthetic X content', { exact: true }).waitFor();
    assert.equal(contentQueries.at(-1)!.get('provider'), 'demo_x');
    await page.getByText('Unified source overview', { exact: true }).click();
    await page.getByText(/Provider counts may share content identities/).waitFor();
    await page.getByText('Export matching saved content', { exact: true }).click();
    await page.getByLabel('Export limit per file (1–2000)', { exact: true }).fill('1');
    const jsonDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const firstDownload = await jsonDownload;
    const firstData = JSON.parse(await readFile((await firstDownload.path())!, 'utf8')) as ContentExportResponse;
    assert.equal(firstData.truncated, true); assert.equal(firstData.totalMatching, 2); assert.equal(firstData.maxItems, 1);
    await page.getByRole('button', { name: 'Download next part', exact: true }).waitFor();
    const nextDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download next part', exact: true }).click();
    const nextData = JSON.parse(await readFile((await (await nextDownload).path())!, 'utf8')) as ContentExportResponse;
    assert.equal(nextData.truncated, false);
    await page.getByText(/Reached the end of this saved sample/).waitFor();
    await page.getByTitle('简体中文', { exact: true }).click();
    await page.getByRole('button', { name: '下载 CSV', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '导出失败（HTTP 503），请重试。' }).waitFor();
    await page.getByTitle('English', { exact: true }).click();
    const csvDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
    const csv = await readFile((await (await csvDownload).path())!, 'utf8');
    assert.match(csv, /export_metadata/); assert.match(csv, /合成演示/);
    await page.getByRole('button', { name: 'Download next part', exact: true }).waitFor();
    await sourceRow.getByRole('button', { name: 'Archive source', exact: true }).click();
    await sourceRow.getByRole('button', { name: 'Resume source', exact: true }).waitFor(); assert.equal(sources[0]!.state, 'archived');
    await sourceRow.getByRole('button', { name: 'Resume source', exact: true }).click();
    await sourceRow.getByRole('button', { name: 'Pause source', exact: true }).waitFor();
    await mkdir('output/playwright', { recursive: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'output/playwright/source-management-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'output/playwright/source-management-mobile.png', fullPage: true });
    role = 'viewer'; await page.reload();
    await page.getByText(/View sources/).click();
    assert.equal(await page.getByRole('button', { name: 'Pause source', exact: true }).count(), 0);
    assert.equal(await page.getByText('Add a source', { exact: true }).count(), 0);
    await page.getByText('Collection task history', { exact: true }).click();
    await page.getByRole('button', { name: 'Inspect task', exact: true }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cancel task', exact: true }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'output/playwright/source-management-viewer-mobile.png', fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const result = { ok: true, mode: 'synthetic_api_offline_ui', externalRequests: 0, errors, checked: ['source label/group/schedule/refresh edits', 'snapshot automatic mature refresh disabled', 'pause/resume/archive', 'dynamic X/demo creation', 'disabled real provider', 'task cancel/retry/continue', 'heartbeat and provider budget edit', 'platform/provider query filters', 'unified stored overview', 'bounded JSON/CSV download and cursor continuation', 'Chinese fallback for empty export errors', 'viewer controls', '390px no overflow'], mutations };
    await writeFile('output/playwright/source-management-evidence.json', JSON.stringify(result, null, 2), 'utf8'); console.log(JSON.stringify(result));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
