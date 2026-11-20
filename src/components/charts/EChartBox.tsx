import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import type { ECharts, EChartsOption } from 'echarts';
import { useTheme } from '../ThemeStudio';

interface EChartBoxProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  onEvents?: Record<string, (params: unknown) => void>;
}

/**
 * Reusable ECharts wrapper with ResizeObserver auto-sizing, clean disposal,
 * reduced-motion respect, and DeepSeek motion curve preservation.
 */
export function EChartBox({ option, height = 240, className = '', style, onEvents }: EChartBoxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const eventsRef = useRef(onEvents);
  eventsRef.current = onEvents;

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

/**
 * Generates an offscreen canvas diagonal hatch texture for ECharts markArea
 * (used to visualize uncollected UTC gap intervals without zero-filling).
 */
export function createHatchPattern(bgHex = '#f6f7f1', stripeHex = '#dce0d2'): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 8, 8);
  ctx.strokeStyle = stripeHex;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0, 8);
  ctx.lineTo(8, 0);
  ctx.moveTo(-2, 2);
  ctx.lineTo(2, -2);
  ctx.moveTo(6, 10);
  ctx.lineTo(10, 6);
  ctx.stroke();
  return canvas;
}

/**
 * Live ECharts palette reactive to ThemeProvider and Workbench skin sync setting.
 */
export function useChartColors() {
  const { palette, syncWorkbench } = useTheme();
  return useMemo(() => {
    if (!syncWorkbench) {
      return {
        ink: '#1b221a',
        purple: '#7659bd',
        wisteria: '#b7a5ed',
        teal: '#258c89',
        apricot: '#e08f52',
        citron: '#dbf477',
        opal: '#a8d3cc',
        muted: '#8b9388',
        gridLine: '#eef0e9',
        reddit: '#7659bd',
        x: '#1b221a',
        bluesky: '#258c89',
        web: '#f5ae78',
      };
    }
    return {
      ink: palette.ink,
      purple: palette.chart1 || palette.accentDeep,
      wisteria: palette.accent,
      teal: palette.chart2 || palette.accent2,
      apricot: '#e08f52',
      citron: '#dbf477',
      opal: palette.cardTint,
      muted: '#8b9388',
      gridLine: '#eef0e9',
      reddit: palette.chart1 || palette.accentDeep,
      x: palette.ink,
      bluesky: palette.chart2 || palette.accent2,
      web: palette.accent.toLowerCase() === (palette.chart1 || palette.accentDeep).toLowerCase() ? '#e08f52' : '#f5ae78',
    };
  }, [palette, syncWorkbench]);
}
