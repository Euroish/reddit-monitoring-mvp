export const WORKBENCH_RANGE_PRESETS = ['7d', '30d', '90d'] as const;

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
