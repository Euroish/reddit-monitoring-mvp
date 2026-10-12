import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { buildTargetWorkbenchReadModel } from '../src/application/services/target-workbench-read-model.service.js';
import type { CreateSavedWorkbenchViewRequest, MarketTrendResponse, MarketWorkbenchResponse, SavedWorkbenchViewResponseItem, TargetComparisonWorkbenchResponse, TargetWorkbenchResponse } from '../packages/contracts/src/http.js';

// UI-only smoke: all API responses are synthetic and every external URL is blocked.
// Start the project's Vite dev server first. This script never contacts a provider or database.
const base = new URL(process.env.SMOKE_WEB_BASE_URL ?? 'http://127.0.0.1:5173');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('UI smoke requires a loopback Vite URL');
const now = '2026-10-12T10:00:00.000Z';
const emptyMarket: MarketTrendResponse = { ok: true, requestId: 'synthetic-ui-smoke', generatedAtIso: now,
  fromIso: '2026-10-10T00:00:00Z', toIso: now, targetCount: 0,
  coverage: { scope: 'monitored_targets', label: 'Synthetic empty monitored scope', description: 'Offline UI fixture.', monitoredTargetCount: 0 },
  rankings: { byHeat: [], bySurge: [], byDispersion: [] } };
const emptyMarketWorkbench: MarketWorkbenchResponse = { ok: true, requestId: 'synthetic-ui-smoke', generatedAtIso: now,
  fromIso: emptyMarket.fromIso, toIso: now, coverage: emptyMarket.coverage,
  summary: { rankedTargetCount: 0, breakoutCount: 0, anomalyCount: 0 }, leaders: emptyMarket.rankings,
  targets: [], breakouts: [], anomalies: [] };

function targetFixture(): TargetWorkbenchResponse {
  const response = buildTargetWorkbenchReadModel({ requestId: 'synthetic-ui-smoke', generatedAtIso: now,
    target: { id: 'technology', source: 'reddit', targetType: 'subreddit', canonicalName: 'r/technology',
      status: 'active', config: {}, createdAt: now, updatedAt: now },
    fromIso: '2026-10-10T00:00:00.000Z', toIso: '2026-10-13T00:00:00.000Z', timeframe: '1d', rangePreset: '7d',
    dailyFacts: [], trendPoints: [], keywordDailyRows: [], postGrowthFacts: [], contents: [], anomalyEvents: [], providerHealthWindows: [] });
  response.series = [
    { id: 'heat_price', label: 'Heat Price', family: 'trend', unit: 'score', points: [
      { at: '2026-10-10', value: 10, quality: 'observed', coverageStatus: 'partial', valueSemantics: 'observed_total' },
      { at: '2026-10-12', value: 30, quality: 'observed', coverageStatus: 'partial', valueSemantics: 'observed_total' },
    ] },
    { id: 'ema_7', label: 'EMA 7', family: 'trend', unit: 'score', points: [
      { at: '2026-10-11', value: 20, quality: 'observed', coverageStatus: 'partial', valueSemantics: 'observed_total' },
    ] },
  ];
  response.overlays = [{ id: 'keyword:AI', label: 'AI', kind: 'keyword_heat', queryScope: 'subreddit',
    points: [{ at: '2026-10-11', value: 2 }] }];
  return response;
}

function comparisonFixture(url: URL): TargetComparisonWorkbenchResponse {
  const empty = url.searchParams.get('range') !== '30d';
  const seriesIds = (url.searchParams.get('series') ?? 'heat_price,total_new_posts').split(',');
  return { ok: true, requestId: 'synthetic-ui-smoke', generatedAtIso: now,
    range: { fromIso: '2026-10-10T00:00:00Z', toIso: '2026-10-13T00:00:00Z', grain: 'day', dayCount: 3, timeframe: '1d' },
    series: [{ id: 'heat_price', label: 'Heat', unit: 'score' }, { id: 'total_new_posts', label: 'Captured posts', unit: 'count' },
      { id: 'ema_7', label: 'EMA 7', unit: 'score' }],
    targets: ['technology', 'science'].map((name) => ({ targetId: name, canonicalName: `r/${name}`, displayName: name, targetType: 'subreddit' })),
    comparisons: empty ? [] : ['technology', 'science'].flatMap((name, index) =>
      (['heat_price', 'total_new_posts', 'ema_7'] as const).filter((id) => seriesIds.includes(id)).map((seriesId) => ({
        targetId: name, canonicalName: `r/${name}`, seriesId, baselineValue: 1,
        latestValue: index + 2, latestNormalizedValue: (index + 2) * 100,
        points: index === 0 ? [{ at: '2026-10-10', value: 1, normalizedValue: 100 }, { at: '2026-10-12', value: 2, normalizedValue: 200 }]
          : [{ at: '2026-10-11', value: 1, normalizedValue: 100 }, { at: '2026-10-12', value: 3, normalizedValue: 300 }],
      }))),
    summary: ['technology', 'science'].map((name) => ({ targetId: name, canonicalName: `r/${name}`,
      latestHeatPrice: empty ? null : 3, latestTotalNewPosts: empty ? null : 2, latestQualifiedPostCount: null })),
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const errors: string[] = [];
  const blockedExternal: string[] = [];
  const saved: SavedWorkbenchViewResponseItem[] = [];
  let rejectNextSave = true;
  try {
    await context.addInitScript(() => { if (!localStorage.getItem('reddit-monitoring.language')) localStorage.setItem('reddit-monitoring.language', 'en'); });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) { blockedExternal.push(url.origin); await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      const respond = (json: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
      if (url.pathname === '/api/auth/me') return respond({ ok: true, requestId: 'synthetic-ui-smoke',
        user: { id: 'synthetic-owner', email: 'synthetic@example.test', displayName: 'UI smoke', role: 'owner', status: 'active', createdAt: now, updatedAt: now } });
      if (url.pathname === '/api/v1/trends/market') return respond(emptyMarket);
      if (url.pathname === '/api/v1/workbench/market') return respond(emptyMarketWorkbench);
      if (url.pathname === '/api/v1/workbench/compare') return respond(comparisonFixture(url));
      if (url.pathname.startsWith('/api/v1/workbench/target/')) return respond(targetFixture());
      if (url.pathname.includes('/anomalies/incidents')) return respond({ ok: true, incidents: [] });
      if (url.pathname === '/api/v1/workbench/saved-views') {
        if (route.request().method() === 'POST') {
          if (rejectNextSave) { rejectNextSave = false; return respond({ errorCode: 'CONFLICT', error: 'Synthetic save conflict; retry is safe.' }, 409); }
          const input = route.request().postDataJSON() as CreateSavedWorkbenchViewRequest;
          const view = { ...input, id: `synthetic-view-${saved.length}`, compareTargets: input.compareTargets ?? [],
            keywords: input.keywords ?? [], seriesIds: input.seriesIds ?? [], createdAt: now, updatedAt: now };
          saved.push(view);
          return respond({ ok: true, requestId: 'synthetic-ui-smoke', view });
        }
        return respond({ ok: true, requestId: 'synthetic-ui-smoke', views: saved });
      }
      throw new Error(`Unstubbed API request ${url.pathname}`);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base.origin}/compare?targets=technology,science&range=7d`);
    await page.getByText('No chart data.', { exact: true }).waitFor();
    assert.equal(await page.locator('.workbench-chart-canvas canvas').count(), 0);
    await page.getByLabel('Range', { exact: true }).selectOption('30d');
    await page.locator('.workbench-chart-canvas canvas').first().waitFor();
    await page.getByLabel('Range', { exact: true }).selectOption('90d');
    await page.getByText('No chart data.', { exact: true }).waitFor();
    assert.equal(await page.locator('.workbench-chart-canvas canvas').count(), 0);
    await page.getByLabel('Range', { exact: true }).selectOption('30d');
    await page.locator('.workbench-chart-canvas canvas').first().waitFor();
    await page.getByRole('checkbox', { name: 'EMA 7', exact: true }).check();
    await page.getByLabel('Save current comparison', { exact: true }).fill('Synthetic comparison');
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Synthetic save conflict' }).waitFor();
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await page.getByRole('main').getByText('Saved', { exact: true }).waitFor();
    assert.equal(saved.length, 1);
    const compareUrl = new URL(saved[0]!.routePath, base);
    assert.equal(compareUrl.pathname, '/compare');
    assert.equal(compareUrl.searchParams.get('range'), '30d');
    assert.match(compareUrl.searchParams.get('series')!, /ema_7/);
    await page.goto(`${base.origin}/saved`);
    await page.getByRole('link', { name: 'Open saved view', exact: true }).click();
    await page.locator('.workbench-chart-canvas canvas').first().waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'EMA 7', exact: true }).isChecked(), true);
    assert.equal(await page.getByLabel('Range', { exact: true }).inputValue(), '30d');
    await page.goto(`${base.origin}/target/technology?range=7d&keywords=AI&series=ema_7&hiddenOverlays=keyword%3AAI`);
    await page.getByRole('heading', { name: 'Workbench Chart', exact: true }).waitFor();
    await page.locator('.workbench-chart-canvas canvas').first().waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'EMA 7', exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Heat Price', exact: true }).isChecked(), false);
    assert.equal(await page.locator('.workbench-chart-legend-item').filter({ hasText: 'AI' }).count(), 0);
    await page.getByRole('button', { name: 'Save view', exact: true }).click();
    await page.getByText('Saved.', { exact: true }).waitFor();
    const targetSave = saved.at(-1)!;
    const targetUrl = new URL(targetSave.routePath, base);
    assert.equal(targetUrl.searchParams.get('series'), 'ema_7');
    assert.equal(targetUrl.searchParams.get('hiddenOverlays'), 'keyword:AI');
    await page.goto(`${base.origin}/saved`);
    await page.getByRole('link', { name: 'Open saved view', exact: true }).last().click();
    await page.locator('.workbench-chart-canvas canvas').first().waitFor();
    assert.equal(new URL(page.url()).searchParams.get('series'), 'ema_7');
    assert.equal(await page.locator('.workbench-chart-legend-item').filter({ hasText: 'AI' }).count(), 0);
    await mkdir('output/playwright', { recursive: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'output/playwright/phase1-target-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base.origin}${saved[0]!.routePath}`);
    await page.locator('.workbench-chart-canvas canvas').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    const chartBounds = await page.locator('.workbench-chart').boundingBox();
    const saveBounds = await page.getByLabel('Save current comparison', { exact: true }).boundingBox();
    assert.ok(chartBounds && saveBounds && chartBounds.y + chartBounds.height <= saveBounds.y,
      'Wrapped chart legend and readout must not overlap the save controls');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: 'output/playwright/phase1-compare-mobile.png', fullPage: true });
    await page.goto(`${base.origin}/markets/board`);
    await page.getByText(/Candidates are limited to the first 50 targets/).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Add or manage sources to query collected content', exact: true }).getAttribute('href'), '/content');
    await page.goto(`${base.origin}/queries`);
    await page.getByText(/This indexed query matches any positive term/).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open collected content and stored counts', exact: true }).getAttribute('href'), '/content');
    await page.getByTitle('简体中文', { exact: true }).click();
    await page.getByText(/任一正向词项（OR）/).waitFor();
    await page.getByRole('link', { name: '查询来源内容与已存统计', exact: true }).waitFor();
    await page.goto(`${base.origin}/markets`);
    await page.getByRole('link', { name: '添加或管理来源，查询已采集内容', exact: true }).waitFor();
    await page.getByText(/尚未纳入来源采集的 Arctic Shift/).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(blockedExternal, []);
    const result = { ok: true, mode: 'synthetic_api_offline_ui', checked: ['empty-data-empty-data chart lifecycle',
      'date-keyed series rendering', 'visible save failure and successful retry', 'comparison saved route restoration',
      'target series and hidden overlay restoration', '390px no horizontal overflow or overlapping controls',
      'board candidate limit and source empty link', 'bilingual indexed-search semantics and source link',
      'Chinese dashboard legacy-scope notice and source empty link'], externalRequests: 0, errors };
    await writeFile('output/playwright/phase1-functional-evidence.json', JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
