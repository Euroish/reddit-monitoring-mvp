import React, { Suspense, lazy } from 'react';
import type { ECharts, EChartsCoreOption } from 'echarts/core';

export type EChartOption = EChartsCoreOption;
export type EChartInstance = ECharts;

const LazyEChartCanvas = lazy(() => import('./EChartCanvas'));

export interface EChartBoxProps {
  option: EChartOption;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  onEvents?: Record<string, (params: unknown) => void>;
  onChartReady?: (chart: ECharts | null) => void;
}

/**
 * Lazy ECharts container: zero ECharts runtime code is loaded until mounted.
 */
export function EChartBox(props: EChartBoxProps) {
  const { height = 240, className = '', style, ariaLabel } = props;
  return (
    <Suspense
      fallback={
        <div
          role={ariaLabel ? 'img' : undefined}
          aria-label={ariaLabel}
          className={className}
          style={{
            width: '100%',
            height,
            minHeight: typeof height === 'number' ? height : undefined,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--faint)',
            fontSize: 11.5,
            background: '#fbfcf7',
            borderRadius: 5,
            ...style,
          }}
        >
          Loading chart…
        </div>
      }
    >
      <LazyEChartCanvas {...props} />
    </Suspense>
  );
}
