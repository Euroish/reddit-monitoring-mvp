import { useId, useMemo } from 'react';

export function KpiSparkChart({
  values,
  color,
  height = 30,
  width = 84,
}: {
  values: Array<number | null>;
  color: string;
  height?: number;
  width?: number;
}) {
  const gradId = useId();
  const clean = useMemo(
    () => values.filter((v): v is number => v !== null && Number.isFinite(v)),
    [values],
  );

  if (clean.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line
          x1={4}
          y1={height - 6}
          x2={width - 4}
          y2={height - 6}
          stroke="#d3d8cc"
          strokeWidth={1.2}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = Math.max(1, max - min);
  const padX = 3;
  const padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const coords = clean.map((val, idx) => {
    const x = padX + (innerW * idx) / (clean.length - 1);
    const y = padY + innerH - ((val - min) / span) * innerH;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });

  const linePath = coords.map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0]} ${height - 1} L${coords[0][0]} ${height - 1} Z`;
  const last = coords[coords.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}
