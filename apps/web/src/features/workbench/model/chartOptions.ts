import type {
  TargetComparisonWorkbenchResponse,
  TargetWorkbenchResponse,
} from '../../../../../../packages/contracts/src/http.js';

export type WorkbenchEChartsOption = Record<string, unknown>;

export const SERIES_COLORS: Record<string, string> = {
  heat_price: '#5e6ad2',
  ema_7: '#a07cc6',
  ema_30: '#6f7785',
  total_new_posts: '#10b981',
  qualified_post_count: '#f59f00',
};

export function createInitialSeriesSelection(data: TargetWorkbenchResponse | undefined) {
  const defaults = data?.indicators
    .filter((indicator) => indicator.defaultVisible)
    .map((indicator) => indicator.id);
  return new Set(defaults && defaults.length > 0 ? defaults : ['heat_price', 'ema_7', 'ema_30']);
}

export function buildTargetWorkbenchChartOptions(args: {
  data: TargetWorkbenchResponse | undefined;
  activeSeries: Set<string>;
  hiddenOverlayIds: Set<string>;
}): WorkbenchEChartsOption {
  if (!args.data || args.data.series.length === 0) return {};

  const dates = args.data.series[0]?.points.map((point) => point.at) ?? [];
  const indicatorsById = new Map(args.data.indicators.map((indicator) => [indicator.id, indicator]));
  const visibleSeries = args.data.series.filter((series) => args.activeSeries.has(series.id));
  const chartSeries = visibleSeries.map((series) => {
    const indicator = indicatorsById.get(series.id);
    return {
      name: series.label,
      type: indicator?.chartType ?? 'line',
      data: series.points.map((point) => point.value),
      smooth: indicator?.chartType !== 'bar',
      showSymbol: false,
      yAxisIndex: indicator?.axis === 'secondary' ? 1 : 0,
      itemStyle: { color: SERIES_COLORS[series.id] ?? '#8a8f98' },
      lineStyle: {
        width: series.id === 'heat_price' ? 3 : 2,
        type: series.id.startsWith('ema_') ? 'dashed' as const : 'solid' as const,
      },
    };
  });
  const overlaySeries = args.data.overlays
    .filter((overlay) => !args.hiddenOverlayIds.has(overlay.id))
    .slice(0, 3)
    .map((overlay) => ({
      name: overlay.label,
      type: 'line' as const,
      data: overlay.points.map((point) => point.value),
      smooth: true,
      showSymbol: false,
      yAxisIndex: 1,
      itemStyle: { color: '#e879f9' },
      lineStyle: { width: 1.5, type: 'dotted' as const },
    }));

  return buildBaseLineOption({
    dates,
    series: [...chartSeries, ...overlaySeries],
    yAxis: [
      {
        type: 'value',
        splitLine: { lineStyle: { color: '#1a1b1e' } },
        axisLabel: { color: '#888888' },
      },
      {
        type: 'value',
        splitLine: { show: false },
        axisLabel: { color: '#8a8f98' },
      },
    ],
  });
}

export function buildComparisonChartOptions(
  comparisonData: TargetComparisonWorkbenchResponse | undefined,
): WorkbenchEChartsOption {
  if (!comparisonData || comparisonData.comparisons.length === 0) return {};
  const dates = comparisonData.comparisons[0]?.points.map((point) => point.at) ?? [];
  const palette = ['#5e6ad2', '#10b981', '#f59f00', '#e879f9', '#38bdf8', '#f43f5e'];
  const chartSeries = comparisonData.comparisons.map((comparison, index) => {
    const seriesLabel =
      comparisonData.series.find((series) => series.id === comparison.seriesId)?.label ??
      comparison.seriesId;
    return {
      name: `${comparison.canonicalName} ${seriesLabel}`,
      type: 'line' as const,
      data: comparison.points.map((point) => point.normalizedValue),
      smooth: true,
      showSymbol: false,
      itemStyle: { color: palette[index % palette.length] },
      lineStyle: {
        width: comparison.seriesId === 'heat_price' ? 2.5 : 1.5,
        type: comparison.seriesId === 'heat_price' ? 'solid' as const : 'dashed' as const,
      },
    };
  });
  return buildBaseLineOption({
    dates,
    series: chartSeries,
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#1a1b1e' } },
      axisLabel: { color: '#888888', formatter: '{value}' },
    },
    bottom: '15%',
  });
}

function buildBaseLineOption(args: {
  dates: string[];
  series: Array<Record<string, unknown>>;
  yAxis: Record<string, unknown> | Array<Record<string, unknown>>;
  bottom?: string;
}): WorkbenchEChartsOption {
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(23, 24, 25, 0.94)',
      borderColor: '#2b2d31',
      textStyle: { color: '#eeeeee' },
    },
    legend: {
      data: Array.isArray(args.series)
        ? args.series.map((series) => ('name' in series ? series.name : undefined)).filter(Boolean)
        : [],
      textStyle: { color: '#888888' },
      bottom: 0,
    },
    grid: {
      left: '3%',
      right: '5%',
      bottom: args.bottom ?? '12%',
      top: '4%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: args.dates,
      axisLine: { lineStyle: { color: '#2b2d31' } },
      axisLabel: { color: '#888888' },
    },
    yAxis: args.yAxis,
    series: args.series,
  };
}
