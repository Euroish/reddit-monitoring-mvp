import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonChartOptions, buildTargetWorkbenchChartOptions } from '../../apps/web/src/features/workbench/model/chartOptions.js';
import type { TargetWorkbenchResponse } from '../../packages/contracts/src/http.js';

function points(entries: Array<[string, number | null]>): TargetWorkbenchResponse['series'][number]['points'] {
  return entries.map(([at, value]) => ({ at, value, quality: value === null ? 'missing' : 'observed',
    coverageStatus: 'partial', valueSemantics: value === null ? 'missing' : 'observed_total' }));
}

test('target chart aligns visible series and overlays by sorted dates without inventing zeroes', () => {
  const model = buildTargetWorkbenchChartOptions({
    data: {
      indicators: [],
      series: [
        { id: 'heat_price', label: 'Heat', family: 'trend', unit: 'score',
          points: points([['2026-10-12', 30], ['2026-10-10', 0]]) },
        { id: 'observed_new_posts', label: 'Posts', family: 'activity', unit: 'count',
          points: points([['2026-10-11', -1], ['2026-10-12', null]]) },
        { id: 'ema_7', label: 'Hidden', family: 'trend', unit: 'score',
          points: points([['2026-01-01', 999]]) },
      ],
      overlays: [
        { id: 'keyword:visible', label: 'Visible keyword', kind: 'keyword_heat', queryScope: 'subreddit',
          points: [{ at: '2026-10-09', value: 4 }, { at: '2026-10-11', value: 8 }] },
        { id: 'keyword:hidden', label: 'Hidden keyword', kind: 'keyword_heat', queryScope: 'subreddit',
          points: [{ at: '2026-01-01', value: 99 }] },
      ],
    },
    activeSeries: new Set(['heat_price', 'observed_new_posts']),
    hiddenOverlayIds: new Set(['keyword:hidden']),
  });
  assert.deepEqual(model.dates, ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
  assert.deepEqual(model.series.map((series) => series.values), [
    [null, 0, null, 30], [null, null, -1, null], [4, null, 8, null],
  ]);
});

test('comparison chart uses the union of dates for different starts and missing middle days', () => {
  const model = buildComparisonChartOptions({
    series: [{ id: 'heat_price', label: 'Heat', unit: 'score' }],
    comparisons: [
      { targetId: 'a', canonicalName: 'r/a', seriesId: 'heat_price', baselineValue: 1,
        latestValue: 3, latestNormalizedValue: 300,
        points: [{ at: '2026-10-12', value: 3, normalizedValue: 300 },
          { at: '2026-10-10', value: 1, normalizedValue: 100 }] },
      { targetId: 'b', canonicalName: 'r/b', seriesId: 'heat_price', baselineValue: 2,
        latestValue: null, latestNormalizedValue: null,
        points: [{ at: '2026-10-11', value: 2, normalizedValue: 100 },
          { at: '2026-10-13', value: null, normalizedValue: null }] },
    ],
  });
  assert.deepEqual(model.dates, ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
  assert.deepEqual(model.series[0]?.values, [100, null, 300, null]);
  assert.deepEqual(model.series[1]?.values, [null, 100, null, null]);
});

test('chart models keep empty responses empty and treat invalid numbers as missing', () => {
  assert.deepEqual(buildComparisonChartOptions(undefined), { dates: [], series: [] });
  const model = buildTargetWorkbenchChartOptions({
    data: { indicators: [], overlays: [], series: [{ id: 'heat_price', label: 'Heat', family: 'trend',
      unit: 'score', points: points([['2026-10-10', Number.NaN], ['2026-10-11', Number.POSITIVE_INFINITY]]) }] },
    activeSeries: new Set(['heat_price']), hiddenOverlayIds: new Set(),
  });
  assert.deepEqual(model.series[0]?.values, [null, null]);
});
