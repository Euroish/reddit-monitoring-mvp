import { useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { fetchApi } from '../api/client';
import { Card, Badge } from '../components/ui';
import type { SubredditDailyTrendResponse } from '../../../../packages/contracts/src/http';

echarts.use([GridComponent, LegendComponent, LineChart, SVGRenderer, TooltipComponent]);

function HeatTrendChart({ option }: { option: EChartsOption }) {
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

export function TargetDetail() {
  const { targetId } = useParams<{ targetId: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['target-daily', targetId],
    queryFn: () => fetchApi<SubredditDailyTrendResponse>(`/v1/trends/subreddit/${targetId}/daily`),
    enabled: !!targetId,
  });

  const chartOptions = useMemo<EChartsOption>(() => {
    if (!data || !data.daily || data.daily.length === 0) return {};

    const dates = data.daily.map((d) => d.day);
    const heatPrice = data.daily.map((d) => d.heatPrice);
    const ema7 = data.daily.map((d) => d.ema7);
    const ema30 = data.daily.map((d) => d.ema30);

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(23, 24, 25, 0.9)',
        borderColor: '#2b2d31',
        textStyle: { color: '#eeeeee' },
      },
      legend: {
        data: ['Heat Price', 'EMA 7', 'EMA 30'],
        textStyle: { color: '#888888' },
        bottom: 0,
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '10%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: '#2b2d31' } },
        axisLabel: { color: '#888888' },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1a1b1e' } },
        axisLabel: { color: '#888888' },
      },
      series: [
        {
          name: 'Heat Price',
          type: 'line',
          data: heatPrice,
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#5e6ad2' },
          lineStyle: { width: 3 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(94, 106, 210, 0.3)' },
                { offset: 1, color: 'rgba(94, 106, 210, 0)' },
              ],
            },
          },
        },
        {
          name: 'EMA 7',
          type: 'line',
          data: ema7,
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#a07cc6' },
          lineStyle: { width: 2, type: 'dashed' },
        },
        {
          name: 'EMA 30',
          type: 'line',
          data: ema30,
          smooth: true,
          showSymbol: false,
          itemStyle: { color: '#555555' },
          lineStyle: { width: 2, type: 'dotted' },
        },
      ],
    };
  }, [data]);

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <Link to="/dashboard" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>
              &larr; Back
            </Link>
            <h1 style={{ margin: 0 }} className="break-text">r/{targetId}</h1>
            {data && <Badge variant="neutral">{data.daily[data.daily.length - 1]?.subredditTier || 'unknown'}</Badge>}
          </div>
          <p className="page-subtitle">30-day Trend Analysis</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading trend data...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading data. The target might not exist or hasn't been crawled yet.</div>}

      {data && data.daily.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Card>
              <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Latest Heat</div>
              <div className="kpi-value">
                {Math.round(data.daily[data.daily.length - 1].heatPrice)}
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Daily Posts</div>
              <div className="kpi-value">
                {data.daily[data.daily.length - 1].totalNewPosts}
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Subscribers</div>
              <div className="kpi-value">
                {(data.daily[data.daily.length - 1].subscriberCount / 1000).toFixed(1)}k
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Active Users</div>
              <div className="kpi-value">
                {data.daily[data.daily.length - 1].activeUserCount}
              </div>
            </Card>
          </div>

          <Card style={{ padding: '24px' }}>
            <h3 style={{ marginBottom: '24px' }}>Heat Trend</h3>
            <div className="chart-shell">
              <HeatTrendChart option={chartOptions} />
            </div>
          </Card>
        </div>
      )}

      {data && data.daily.length === 0 && (
        <Card>
          <div className="card-empty">
            No daily trend data available for this target yet.
          </div>
        </Card>
      )}
    </div>
  );
}
