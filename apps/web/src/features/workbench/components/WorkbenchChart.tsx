import type { CSSProperties } from 'react';
import type { WorkbenchChartModel, WorkbenchChartSeries } from '../model/chartOptions';

const CHART_WIDTH = 960;
const CHART_HEIGHT = 360;
const PADDING = {
  top: 20,
  right: 56,
  bottom: 54,
  left: 56,
};

type AxisDomain = {
  min: number;
  max: number;
};

function formatCompactValue(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatDateLabel(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getNumericValues(series: WorkbenchChartSeries[]) {
  return series.flatMap((item) => item.values).filter((value): value is number => value != null && Number.isFinite(value));
}

function buildAxisDomain(series: WorkbenchChartSeries[]) {
  const values = getNumericValues(series);
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }

  const hasBar = series.some((item) => item.type === 'bar');
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  if (hasBar) {
    const max = rawMax <= 0 ? 1 : rawMax * 1.1;
    return { min: Math.min(0, rawMin), max };
  }

  if (rawMin === rawMax) {
    const pad = rawMax === 0 ? 1 : Math.abs(rawMax) * 0.1;
    return { min: rawMin - pad, max: rawMax + pad };
  }

  const range = rawMax - rawMin;
  const pad = range * 0.12;
  return { min: rawMin - pad, max: rawMax + pad };
}

function scaleY(value: number, domain: AxisDomain) {
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const ratio = (value - domain.min) / (domain.max - domain.min || 1);
  return CHART_HEIGHT - PADDING.bottom - ratio * plotHeight;
}

function scaleX(index: number, count: number) {
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  if (count <= 1) {
    return PADDING.left + plotWidth / 2;
  }
  return PADDING.left + (plotWidth * index) / (count - 1);
}

function buildLinePath(values: Array<number | null>, domain: AxisDomain, count: number) {
  let path = '';
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value == null || !Number.isFinite(value)) {
      continue;
    }
    const x = scaleX(index, count);
    const y = scaleY(value, domain);
    const previousValue = index > 0 ? values[index - 1] : null;
    path += previousValue == null ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return path;
}

function strokeDasharray(style: WorkbenchChartSeries['strokeStyle']) {
  if (style === 'dashed') return '8 6';
  if (style === 'dotted') return '2 5';
  return undefined;
}

function legendSwatchStyle(series: WorkbenchChartSeries): CSSProperties {
  return {
    width: '18px',
    height: series.type === 'bar' ? '10px' : '2px',
    borderRadius: '999px',
    backgroundColor: series.type === 'bar' ? series.color : 'transparent',
    borderTop: series.type === 'line' ? `${series.strokeWidth}px ${series.strokeStyle === 'solid' ? 'solid' : 'dashed'} ${series.color}` : 'none',
  };
}

function buildTicks(domain: AxisDomain, count = 4) {
  const ticks: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    ticks.push(domain.min + ((domain.max - domain.min) * index) / count);
  }
  return ticks;
}

export function WorkbenchChart({ option }: { option: WorkbenchChartModel }) {
  if (!option.dates.length || !option.series.length) {
    return (
      <div style={{ height: '100%', width: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-tertiary)' }}>
        No chart data.
      </div>
    );
  }

  const primarySeries = option.series.filter((item) => item.axis === 'primary');
  const secondarySeries = option.series.filter((item) => item.axis === 'secondary');
  const primaryDomain = buildAxisDomain(primarySeries);
  const secondaryDomain = buildAxisDomain(secondarySeries);
  const gridTicks = buildTicks(primaryDomain);
  const rightTicks = buildTicks(secondaryDomain);
  const xStep = option.dates.length > 1
    ? (CHART_WIDTH - PADDING.left - PADDING.right) / (option.dates.length - 1)
    : CHART_WIDTH - PADDING.left - PADDING.right;
  const barSeries = option.series.filter((item) => item.type === 'bar');
  const barWidth = barSeries.length > 0 ? Math.max(8, Math.min(28, (xStep * 0.72) / barSeries.length)) : 0;
  const barOffsetBase = ((barSeries.length - 1) * barWidth) / 2;
  const xTickStep = Math.max(1, Math.ceil(option.dates.length / 6));

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {option.series.map((series) => (
          <div key={series.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '12px' }}>
            <span style={legendSwatchStyle(series)} />
            <span>{series.name}</span>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} style={{ width: '100%', height: '100%', overflow: 'visible' }} role="img" aria-label="Workbench chart">
        {gridTicks.map((tick) => {
          const y = scaleY(tick, primaryDomain);
          return (
            <g key={`grid-${tick}`}>
              <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={y} y2={y} stroke="#1a1b1e" strokeWidth="1" />
              <text x={PADDING.left - 10} y={y + 4} fill="#8a8f98" fontSize="11" textAnchor="end">
                {formatCompactValue(tick)}
              </text>
            </g>
          );
        })}

        {secondarySeries.length > 0 && rightTicks.map((tick) => {
          const y = scaleY(tick, secondaryDomain);
          return (
            <text key={`right-${tick}`} x={CHART_WIDTH - PADDING.right + 10} y={y + 4} fill="#8a8f98" fontSize="11">
              {formatCompactValue(tick)}
            </text>
          );
        })}

        {option.series.map((series) => {
          const domain = series.axis === 'secondary' ? secondaryDomain : primaryDomain;
          if (series.type === 'bar') {
            const barIndex = barSeries.findIndex((item) => item.id === series.id);
            const zeroY = scaleY(Math.max(0, domain.min), domain);
            return (
              <g key={series.id}>
                {series.values.map((value, index) => {
                  if (value == null || !Number.isFinite(value)) return null;
                  const x = scaleX(index, option.dates.length) - barOffsetBase + barIndex * barWidth;
                  const y = scaleY(value, domain);
                  const height = Math.max(1, zeroY - y);
                  return (
                    <rect key={`${series.id}-${option.dates[index]}`} x={x - barWidth / 2} y={y} width={barWidth - 2} height={height} rx="2" fill={series.color}>
                      <title>{`${series.name}\n${formatDateLabel(option.dates[index])}: ${value.toLocaleString()}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          }

          const path = buildLinePath(series.values, domain, option.dates.length);
          return (
            <path
              key={series.id}
              d={path}
              fill="none"
              stroke={series.color}
              strokeWidth={series.strokeWidth}
              strokeDasharray={strokeDasharray(series.strokeStyle)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={CHART_HEIGHT - PADDING.bottom} y2={CHART_HEIGHT - PADDING.bottom} stroke="#2b2d31" strokeWidth="1" />

        {option.dates.map((date, index) => {
          if (index % xTickStep !== 0 && index !== option.dates.length - 1) return null;
          const x = scaleX(index, option.dates.length);
          return (
            <g key={date}>
              <line x1={x} x2={x} y1={CHART_HEIGHT - PADDING.bottom} y2={CHART_HEIGHT - PADDING.bottom + 6} stroke="#2b2d31" strokeWidth="1" />
              <text x={x} y={CHART_HEIGHT - 16} fill="#8a8f98" fontSize="11" textAnchor="middle">
                {formatDateLabel(date)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
