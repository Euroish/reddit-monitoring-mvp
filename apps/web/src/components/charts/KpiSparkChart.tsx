import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { useI18n } from '../../i18n/translations';
import { EChartBox } from './EChartBox';

export function KpiSparkChart({
  values,
  color,
  height = 30,
}: {
  values: Array<number | null>;
  color: string;
  height?: number;
}) {
  const { t } = useI18n();
  const clean = useMemo(() => values.map(value => Number.isFinite(value) ? value : null), [values]);

  const option: EChartsOption = useMemo(
    () => ({
      animationDuration: 480,
      animationEasing: 'cubicOut',
      grid: { left: 2, right: 4, top: 4, bottom: 2 },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: '#1b221a',
        borderWidth: 0,
        padding: [3, 7],
        textStyle: { color: '#fff', fontSize: 10 },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const first = list[0] as { value?: number } | undefined;
          return first?.value !== undefined ? String(first.value) : '';
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        show: false,
        data: clean.map((_, i) => i),
      },
      yAxis: {
        type: 'value',
        show: false,
        min: (v) => Math.max(0, v.min * 0.8),
      },
      series: [
        {
          type: 'line',
          data: clean.map((val, idx) =>
            idx === clean.length - 1
              ? { value: val, symbol: 'circle', symbolSize: 5, itemStyle: { color } }
              : val,
          ),
          showSymbol: true,
          symbolSize: 0,
          smooth: 0.2,
          lineStyle: { width: 1.7, color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${color}28` },
                { offset: 1, color: `${color}02` },
              ],
            },
          },
        },
      ],
    }),
    [clean, color],
  );

  if (clean.filter(value => value !== null).length < 2) {
    return <span className="kpi-sub">{t("No trend data yet", "暂无趋势数据")}</span>;
  }
  return <EChartBox option={option} height={height} style={{ width: 84 }} />;
}
