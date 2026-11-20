import { useMemo } from 'react';

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

function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

/**
 * Static Mineral & Ink analytical chart palette sourced directly from CSS tokens.
 */
export function useChartColors() {
  return useMemo(
    () => ({
      ink: readToken('--ink', '#20271f'),
      purple: readToken('--chart-1', '#1f7471'),
      wisteria: readToken('--citron', '#dbf477'),
      teal: readToken('--chart-2', '#3b6fd8'),
      apricot: readToken('--chart-3', '#c96f2d'),
      citron: readToken('--citron', '#dbf477'),
      opal: readToken('--opal', '#d8ebe7'),
      muted: readToken('--faint', '#677166'),
      gridLine: '#eef0e9',
      reddit: readToken('--chart-1', '#1f7471'),
      x: readToken('--ink', '#20271f'),
      bluesky: readToken('--chart-2', '#3b6fd8'),
      web: readToken('--chart-3', '#c96f2d'),
    }),
    [],
  );
}
