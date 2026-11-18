import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';

interface EChartBoxProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onEvents?: Record<string, (params: unknown) => void>;
}

/**
 * Reusable ECharts wrapper with ResizeObserver auto-sizing, clean disposal,
 * and reduced-motion respect.
 */
export function EChartBox({ option, height = 240, className = '', style, onEvents }: EChartBoxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const eventsRef = useRef(onEvents);

  useEffect(() => {
    eventsRef.current = onEvents;
  }, [onEvents]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    instanceRef.current = chart;

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
      chart.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart || chart.isDisposed()) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    chart.setOption(
      {
        animation: !reduced,
        animationDuration: reduced ? 0 : 560,
        animationEasing: 'cubicOut',
        animationDurationUpdate: reduced ? 0 : 320,
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
      className={className}
      style={{ width: '100%', height, minHeight: typeof height === 'number' ? height : undefined, ...style }}
    />
  );
}
