import type {
  SavedWorkbenchViewResponseItem,
  WorkbenchComparableSeriesId,
} from '../../../../../../packages/contracts/src/http.js';

export const WORKBENCH_RANGE_PRESETS = ['7d', '30d', '90d'] as const;

export const WORKBENCH_SERIES_IDS: WorkbenchComparableSeriesId[] = [
  'heat_price', 'ema_7', 'ema_30', 'activity_index', 'qualified_activity_index',
  'activity_confidence', 'observed_new_posts', 'observed_qualified_posts',
  'total_new_posts', 'qualified_post_count',
];

export function parseWorkbenchSeries(value: string | null): WorkbenchComparableSeriesId[] {
  return parseCsvList(value).filter((id): id is WorkbenchComparableSeriesId =>
    WORKBENCH_SERIES_IDS.some((allowed) => allowed === id),
  );
}

export type WorkbenchRangePreset = (typeof WORKBENCH_RANGE_PRESETS)[number];

export function normalizeWorkbenchRange(value: string | null): WorkbenchRangePreset {
  return value === '7d' || value === '30d' || value === '90d' ? value : '30d';
}

export function buildWorkbenchPath(args: {
  targetId: string | undefined;
  keywords: string | null;
  range: WorkbenchRangePreset;
  timeframe: '1d';
}) {
  const params = new URLSearchParams({
    driverLimit: '8',
    anomalyLimit: '8',
    range: args.range,
    timeframe: args.timeframe,
  });
  if (args.keywords?.trim()) {
    params.set('keywords', args.keywords.trim());
  }
  return `/v1/workbench/target/${args.targetId}?${params.toString()}`;
}

export function buildComparisonPath(args: {
  targetId: string | undefined;
  compare: string | null;
  range: WorkbenchRangePreset;
  timeframe: '1d';
}) {
  const comparisonTargets = [
    args.targetId,
    ...(args.compare ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  ].filter(Boolean);
  const params = new URLSearchParams({
    targets: comparisonTargets.join(','),
    series: 'heat_price,total_new_posts',
    range: args.range,
    timeframe: args.timeframe,
  });
  return `/v1/workbench/compare?${params.toString()}`;
}

export function parseCompareTargets(value: string | null) {
  return Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim().replace(/^r\//i, ''))
        .filter(Boolean),
    ),
  );
}

export function parseCsvList(value: string | null) {
  return Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function buildSavedWorkbenchRoute(view: SavedWorkbenchViewResponseItem): string | null {
  // Older saves sometimes persisted an API path. Translate only known workbench paths.
  const [rawPath, rawSearch = ''] = view.routePath.split('?', 2);
  const path = rawPath.replace(/^\/v1\/workbench\/target\//, '/target/')
    .replace(/^\/v1\/workbench\/compare$/, '/compare');
  if (path === '/content') return `${path}${rawSearch ? `?${rawSearch}` : ''}`;
  if (path !== '/compare' && !/^\/target\/[A-Za-z0-9_-]{1,100}$/.test(path)) return null;

  const params = new URLSearchParams(rawSearch);
  if (path === '/compare' && !params.has('targets')) {
    params.set('targets', [view.primaryTarget, ...view.compareTargets]
      .map((target) => target.replace(/^r\//i, '')).join(','));
  }
  if (path.startsWith('/target/')) {
    if (!params.has('compare') && view.compareTargets.length > 0) {
      params.set('compare', view.compareTargets.map((target) => target.replace(/^r\//i, '')).join(','));
    }
    if (!params.has('keywords') && view.keywords.length > 0) {
      params.set('keywords', view.keywords.join(','));
    }
  }
  if (!params.has('series') && view.seriesIds.length > 0) {
    params.set('series', view.seriesIds.join(','));
  }
  params.set('range', normalizeWorkbenchRange(params.get('range')));
  params.set('timeframe', '1d');
  return `${path}?${params.toString()}`;
}
