import { useMemo } from 'react';
import { useTheme } from '../themeContext';

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
