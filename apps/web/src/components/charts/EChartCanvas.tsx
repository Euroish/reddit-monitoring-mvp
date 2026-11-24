import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import {
  BarChart,
  FunnelChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
} from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  CanvasRenderer,
  BarChart,
  LineChart,
  ScatterChart,
  PieChart,
  GaugeChart,
  RadarChart,
  TreemapChart,
  SankeyChart,
  FunnelChart,
  HeatmapChart,
  GridComponent,
  RadarComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  VisualMapComponent,
  DataZoomComponent,
  TitleComponent,
]);

export interface EChartCanvasProps {
  option: EChartsCoreOption;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  onEvents?: Record<string, (params: unknown) => void>;
  onChartReady?: (chart: ECharts | null) => void;
}

export default function EChartCanvas({
  option,
  height = 240,
  className = '',
  style,
  ariaLabel,
  onEvents,
  onChartReady,
}: EChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const eventsRef = useRef(onEvents);
  const readyRef = useRef(onChartReady);

  useEffect(() => {
    eventsRef.current = onEvents;
  }, [onEvents]);

  useEffect(() => {
    readyRef.current = onChartReady;
  }, [onChartReady]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    instanceRef.current = chart;
    readyRef.current?.(chart);

    const handleResize = () => {
      if (instanceRef.current && !instanceRef.current.isDisposed()) {
        instanceRef.current.resize();
      }
    };

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(handleResize);
    });
    ro.observe(el);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
      readyRef.current?.(null);
      chart.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart || chart.isDisposed()) return;
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    chart.setOption(
      {
        animation: !reduced,
        animationDuration: reduced ? 0 : 280,
        animationEasing: 'cubicOut',
        animationDurationUpdate: reduced ? 0 : 200,
        animationEasingUpdate: 'cubicOut',
        ...option,
      },
      { notMerge: true, lazyUpdate: false },
    );
  }, [option]);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart || chart.isDisposed()) return;
    const map = eventsRef.current;
    if (!map) return;

    const entries = Object.entries(map);
    entries.forEach(([evt, handler]) => {
      chart.on(evt, handler);
    });
    return () => {
      if (!chart.isDisposed()) {
        entries.forEach(([evt, handler]) => {
          chart.off(evt, handler);
        });
      }
    };
  }, [option, onEvents]);

  return (
    <div
      ref={containerRef}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      className={className}
      style={{
        width: '100%',
        height,
        minHeight: typeof height === 'number' ? height : undefined,
        ...style,
      }}
    />
  );
}
