import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
  type MouseEventParams,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import type { WorkbenchChartModel, WorkbenchChartSeries } from '../model/chartOptions';

type ChartPoint = {
  time: Time;
  value?: number;
};

type HoverRow = {
  id: string;
  name: string;
  color: string;
  value: number | null;
};

function formatCompactValue(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  }).format(value);
}

function formatDateLabel(value: Time | string | undefined) {
  if (!value) return '';
  if (typeof value === 'string') {
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  if (typeof value === 'number') {
    return new Date(value * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

function toLineStyle(style: WorkbenchChartSeries['strokeStyle']) {
  if (style === 'dashed') return LineStyle.Dashed;
  if (style === 'dotted') return LineStyle.Dotted;
  return LineStyle.Solid;
}

function toLineWidth(width: number): LineWidth {
  if (width >= 4) return 4;
  if (width >= 3) return 3;
  if (width >= 2) return 2;
  return 1;
}

function toChartTime(value: string, offsetHours = 0): Time {
  if (offsetHours === 0) return value as Time;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return value as Time;
  return Math.floor((timestamp + offsetHours * 60 * 60 * 1000) / 1000) as Time;
}

function pointData(series: WorkbenchChartSeries, dates: string[]): ChartPoint[] {
  return dates.map((date, index) => {
    const time = toChartTime(date, series.barOffsetHours);
    const value = series.values[index];
    return value != null && Number.isFinite(value) ? { time, value } : { time };
  });
}

function legendSwatchStyle(series: WorkbenchChartSeries) {
  return {
    '--series-color': series.color,
  } as CSSProperties;
}

export function WorkbenchChart({ option }: { option: WorkbenchChartModel }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<SeriesType>>>(new Map());
  const optionRef = useRef(option);
  const [hover, setHover] = useState<{ model: WorkbenchChartModel; time: Time; rows: HoverRow[] } | null>(null);
  const hasData = option.dates.length > 0 && option.series.some((series) =>
    series.values.some((value) => value != null && Number.isFinite(value)),
  );

  const latestRows = useMemo<HoverRow[]>(() => {
    return option.series.map((series) => {
      const lastValue = [...series.values].reverse().find((value) => value != null && Number.isFinite(value));
      return {
        id: series.id,
        name: series.name,
        color: series.color,
        value: lastValue ?? null,
      };
    });
  }, [option.series]);

  useEffect(() => {
    optionRef.current = option;
  }, [option]);

  useEffect(() => {
    const container = containerRef.current;
    if (!hasData || !container || chartRef.current) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8a8f98',
        fontFamily: 'var(--font-mono)',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.045)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.06)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(226, 232, 240, 0.42)',
          style: LineStyle.Dotted,
          width: 1,
          labelBackgroundColor: '#111315',
        },
        horzLine: {
          color: 'rgba(226, 232, 240, 0.22)',
          style: LineStyle.Dotted,
          width: 1,
          labelBackgroundColor: '#111315',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.12, bottom: 0.16 },
      },
      leftPriceScale: {
        visible: true,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.62, bottom: 0.04 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 16,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      localization: {
        priceFormatter: formatCompactValue,
        timeFormatter: formatDateLabel,
      },
    });

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (!param.time) {
        setHover(null);
        return;
      }

      const rows = optionRef.current.series.map((series) => {
        const api = seriesRef.current.get(series.id);
        const datum = api ? param.seriesData.get(api) : undefined;
        const value = datum && 'value' in datum && typeof datum.value === 'number' ? datum.value : null;
        return {
          id: series.id,
          name: series.name,
          color: series.color,
          value,
        };
      });

      setHover({ model: optionRef.current, time: param.time, rows });
    });

    chartRef.current = chart;
    const mountedSeries = seriesRef.current;
    return () => {
      chart.remove();
      chartRef.current = null;
      mountedSeries.clear();
    };
  }, [hasData]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const api of seriesRef.current.values()) {
      chart.removeSeries(api);
    }
    seriesRef.current.clear();

    option.series.forEach((series) => {
      const priceScaleId = series.axis === 'secondary' ? 'left' : 'right';
      const commonOptions = {
        priceScaleId,
        priceLineVisible: false,
        lastValueVisible: true,
        title: series.name,
      };

      const api = series.type === 'bar'
        ? chart.addSeries(HistogramSeries, {
            ...commonOptions,
            color: series.color,
            base: 0,
            priceLineVisible: false,
            lastValueVisible: true,
          })
        : chart.addSeries(LineSeries, {
            ...commonOptions,
            color: series.color,
            lineWidth: toLineWidth(series.strokeWidth),
            lineStyle: toLineStyle(series.strokeStyle),
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
          });

      api.setData(pointData(series, option.dates));
      seriesRef.current.set(series.id, api as ISeriesApi<SeriesType>);
    });

    chart.timeScale().fitContent();
  }, [hasData, option]);

  if (!hasData) {
    return (
      <div className="workbench-chart-empty">
        No chart data.
      </div>
    );
  }

  const currentHover = hover?.model === option ? hover : null;
  const visibleRows = currentHover?.rows ?? latestRows;

  return (
    <div className="workbench-chart">
      <div className="workbench-chart-meta">
        <div>
          <div className="workbench-chart-kicker">Interactive trend surface</div>
          <div className="workbench-chart-date">{currentHover ? formatDateLabel(currentHover.time) : 'Latest captured point'}</div>
        </div>
        <div className="workbench-chart-legend">
          {option.series.map((series) => (
            <span key={series.id} className={`workbench-chart-legend-item ${series.type}`} style={legendSwatchStyle(series)}>
              {series.name}
            </span>
          ))}
        </div>
      </div>
      <div className="workbench-chart-canvas" ref={containerRef} />
      <div className="workbench-chart-readout">
        {visibleRows.map((row) => (
          <div key={row.id} className="workbench-chart-readout-row">
            <span className="workbench-chart-readout-dot" style={{ backgroundColor: row.color }} />
            <span>{row.name}</span>
            <strong>{formatCompactValue(row.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
