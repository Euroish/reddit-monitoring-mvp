import type {
  TargetComparisonWorkbenchResponse,
  TargetWorkbenchResponse,
} from '../../../../../../packages/contracts/src/http.js';

export type WorkbenchChartModel = {
  dates: string[];
  series: WorkbenchChartSeries[];
};

export type WorkbenchChartSeries = {
  id: string;
  name: string;
  type: 'line' | 'bar';
  values: Array<number | null>;
  barOffsetHours?: number;
  axis: 'primary' | 'secondary';
  color: string;
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
};

export const SERIES_COLORS: Record<string, string> = {
  heat_price: '#5e6ad2',
  ema_7: '#a07cc6',
  ema_30: '#6f7785',
  activity_index: '#14b8a6',
  qualified_activity_index: '#f97316',
  activity_confidence: '#64748b',
  observed_new_posts: 'rgba(20, 184, 166, 0.58)',
  observed_qualified_posts: '#eab308',
  total_new_posts: 'rgba(16, 185, 129, 0.58)',
  qualified_post_count: '#f59f00',
};

const VOLUME_BAR_OFFSETS: Record<string, number> = {
  observed_new_posts: -6,
  total_new_posts: -6,
  observed_qualified_posts: 6,
  qualified_post_count: 6,
};

function dateKeys(groups: Array<Array<{ at: string }>>): string[] {
  return Array.from(new Set(groups.flatMap((points) => points.map((point) => point.at))))
    .sort();
}

function alignValues(
  dates: string[],
  points: Array<{ at: string; value: number | null }>,
): Array<number | null> {
  const byDate = new Map(points.map((point) => [point.at, point.value]));
  return dates.map((date) => {
    const value = byDate.get(date);
    return value != null && Number.isFinite(value) ? value : null;
  });
}

export function createInitialSeriesSelection(data: TargetWorkbenchResponse | undefined) {
  const coverage = data?.dataQuality.coverage;
  const useCompleteTotals =
    coverage &&
    coverage.expectedDayCount > 0 &&
    (coverage.completeCoverageDayCount ?? 0) >= coverage.expectedDayCount;
  if (data && !useCompleteTotals) {
    return new Set(['heat_price', 'ema_7', 'ema_30', 'observed_new_posts', 'observed_qualified_posts']);
  }
  const defaults = data?.indicators
    .filter((indicator) => indicator.defaultVisible)
    .map((indicator) => indicator.id);
  return new Set(
    defaults && defaults.length > 0
      ? defaults
      : ['heat_price', 'ema_7', 'ema_30', 'total_new_posts', 'qualified_post_count'],
  );
}

export function buildTargetWorkbenchChartOptions(args: {
  data: Pick<TargetWorkbenchResponse, 'series' | 'indicators' | 'overlays'> | undefined;
  activeSeries: Set<string>;
  hiddenOverlayIds: Set<string>;
}): WorkbenchChartModel {
  if (!args.data) return { dates: [], series: [] };

  const selectedSeries = args.data.series.filter((series) => args.activeSeries.has(series.id));
  const selectedOverlays = args.data.overlays
    .filter((overlay) => !args.hiddenOverlayIds.has(overlay.id))
    .slice(0, 3);
  const dates = dateKeys([...selectedSeries, ...selectedOverlays].map((series) => series.points));
  const indicatorsById = new Map(args.data.indicators.map((indicator) => [indicator.id, indicator]));
  const visibleSeries = selectedSeries.map((series) => {
    const indicator = indicatorsById.get(series.id);
    return {
      id: series.id,
      name: series.label,
      type: indicator?.chartType ?? 'line',
      values: alignValues(dates, series.points),
      barOffsetHours: VOLUME_BAR_OFFSETS[series.id],
      axis: indicator?.axis ?? 'primary',
      color: SERIES_COLORS[series.id] ?? '#8a8f98',
      strokeWidth: series.id === 'heat_price' ? 3 : series.id.includes('qualified') ? 3 : 2,
      strokeStyle: series.id.startsWith('ema_') ? 'dashed' as const : 'solid' as const,
    };
  });
  const overlaySeries = selectedOverlays
    .map((overlay) => ({
      id: overlay.id,
      name: overlay.label,
      type: 'line' as const,
      values: alignValues(dates, overlay.points),
      axis: 'secondary' as const,
      color: '#e879f9',
      strokeWidth: 1.5,
      strokeStyle: 'dotted' as const,
    }));

  return {
    dates,
    series: [...visibleSeries, ...overlaySeries],
  };
}

export function buildComparisonChartOptions(
  comparisonData: Pick<TargetComparisonWorkbenchResponse, 'comparisons' | 'series'> | undefined,
): WorkbenchChartModel {
  if (!comparisonData || comparisonData.comparisons.length === 0) return { dates: [], series: [] };
  const dates = dateKeys(comparisonData.comparisons.map((comparison) => comparison.points));
  const palette = ['#5e6ad2', '#10b981', '#f59f00', '#e879f9', '#38bdf8', '#f43f5e'];
  const chartSeries = comparisonData.comparisons.map((comparison, index) => {
    const seriesLabel =
      comparisonData.series.find((series) => series.id === comparison.seriesId)?.label ??
      comparison.seriesId;
    return {
      id: `${comparison.targetId}:${comparison.seriesId}`,
      name: `${comparison.canonicalName} ${seriesLabel}`,
      type: 'line' as const,
      values: alignValues(dates, comparison.points.map((point) => ({
        at: point.at,
        value: point.normalizedValue,
      }))),
      axis: 'primary' as const,
      color: palette[index % palette.length],
      strokeWidth: comparison.seriesId === 'heat_price' ? 2.5 : 1.5,
      strokeStyle: comparison.seriesId === 'heat_price' ? 'solid' as const : 'dashed' as const,
    };
  });
  return {
    dates,
    series: chartSeries,
  };
}
