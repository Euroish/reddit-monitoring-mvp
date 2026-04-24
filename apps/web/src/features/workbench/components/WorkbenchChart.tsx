import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, LegendComponent, LineChart, SVGRenderer, TooltipComponent]);

export function WorkbenchChart({ option }: { option: WorkbenchEChartsOption }) {
  const chartElementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartElementRef.current) return;

    const chart = echarts.init(chartElementRef.current, undefined, { renderer: 'svg' });
    chart.setOption(option, true);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartElementRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div ref={chartElementRef} style={{ height: '100%', width: '100%' }} />;
}
import type { WorkbenchEChartsOption } from '../model/chartOptions';
