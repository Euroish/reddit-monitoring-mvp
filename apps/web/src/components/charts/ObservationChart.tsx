import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import type { ContentObservation } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { EChartBox } from './EChartBox';
import { useChartColors } from './chartUtils';

export function ObservationChart({ observations }: { observations: ContentObservation[] }) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [selectedMetric, setSelectedMetric] = useState<string>('ALL');

  const seriesPalette = useMemo(
    () => [colors.purple, colors.teal, colors.apricot, colors.ink, '#527bc5'],
    [colors],
  );

  const { series, uniqueMetrics } = useMemo(() => {
    const groups = new Map<
      string,
      {
        label: string;
        metricKey: string;
        points: Array<{ ts: number; rawTime: string; val: number | null; timeBasis: string; maturity: string }>;
      }
    >();

    for (const obs of observations) {
      const timeStr = obs.sourceObservedAt ?? obs.fetchedAt;
      const ts = Date.parse(timeStr);
      for (const [metricKey, val] of Object.entries(obs.metrics)) {
        const key = `${obs.sourceId}::${obs.provider}::${metricKey}`;
        if (!groups.has(key)) {
          groups.set(key, {
            label: `${obs.provider} · ${metricKey}`,
            metricKey,
            points: [],
          });
        }
        groups.get(key)!.points.push({
          ts,
          rawTime: timeStr,
          val,
          timeBasis: obs.sourceObservedAt ? obs.timeBasis : `${obs.timeBasis} (fallback fetchedAt)`,
          maturity: obs.maturity,
        });
      }
    }

    const list = [...groups.values()].map((g) => ({
      ...g,
      points: g.points.sort((a, b) => a.ts - b.ts),
    }));
    const metrics = [...new Set(list.map((s) => s.metricKey))];
    return { series: list, uniqueMetrics: metrics };
  }, [observations]);

  if (series.length === 0) {
    return (
      <div style={{ padding: 14, background: '#fbfcf7', border: '1px solid var(--line)', borderRadius: 6, fontSize: 11.5, color: 'var(--muted)' }}>
        {t('No numeric metric snapshots recorded on observations for this item.', '该内容观测记录暂无数值指标快照。')}
      </div>
    );
  }

  const metricGroups = selectedMetric === 'ALL' ? uniqueMetrics : uniqueMetrics.filter((m) => m === selectedMetric);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="pill-select">
          <button
            type="button"
            className={selectedMetric === 'ALL' ? 'on' : ''}
            onClick={() => setSelectedMetric('ALL')}
          >
            {t('Split Axes (All)', '分轴多指标 (全部)')}
          </button>
          {uniqueMetrics.map((m) => (
            <button
              key={m}
              type="button"
              className={selectedMetric === m ? 'on' : ''}
              onClick={() => setSelectedMetric(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 10, color: 'var(--faint)' }}>
          {t('Split Y-axes per metric · null breaks stay disjoint', '按指标独立分轴 · null 断档保持断开不连接')}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {metricGroups.map((metricKey) => {
          const groupSeries = series.filter((s) => s.metricKey === metricKey);
          const option: EChartsOption = {
            tooltip: {
              trigger: 'axis',
              backgroundColor: '#1b221a',
              borderWidth: 0,
              textStyle: { color: '#fff', fontSize: 10.5 },
              formatter: (params: unknown) => {
                const list = (Array.isArray(params) ? params : [params]) as Array<{
                  seriesName?: string;
                  data?: { value?: [number, number | null]; rawTime?: string; timeBasis?: string; maturity?: string };
                  color?: string;
                }>;
                if (!list.length) return '';
                const head = list[0]?.data?.rawTime || '';
                const rows = list
                  .map(
                    (it) =>
                      `<div style="margin-top:3px"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${it.color};margin-right:5px"></span>${it.seriesName}: <b>${it.data?.value?.[1] ?? 'null'}</b> <span style="opacity:.7">(${it.data?.maturity || 'snapshot'})</span></div>`,
                  )
                  .join('');
                return `<div style="font-family:JetBrains Mono,monospace;font-size:10px;opacity:.75">${head}</div>${rows}`;
              },
            },
            legend: {
              top: 0,
              right: 4,
              itemWidth: 8,
              itemHeight: 8,
              textStyle: { color: '#5b655a', fontSize: 10 },
            },
            grid: { left: 44, right: 14, top: 26, bottom: 24 },
            xAxis: {
              type: 'time',
              axisLine: { lineStyle: { color: '#dfe3d9' } },
              axisLabel: {
                color: '#8b9388',
                fontSize: 9.5,
                formatter: (v: number) => new Date(v).toISOString().slice(5, 10),
              },
            },
            yAxis: {
              type: 'value',
              splitNumber: 3,
              splitLine: { lineStyle: { color: '#eef0e9', type: 'dashed' } },
              axisLabel: { color: '#8b9388', fontSize: 9.5 },
            },
            series: groupSeries.map((s, sIdx) => ({
              name: s.label.split(' · ')[0],
              type: 'line',
              connectNulls: false,
              symbolSize: 6,
              smooth: 0.15,
              lineStyle: { width: 2, color: seriesPalette[sIdx % seriesPalette.length] },
              itemStyle: { color: seriesPalette[sIdx % seriesPalette.length] },
              areaStyle:
                groupSeries.length === 1
                  ? { opacity: 0.12, color: seriesPalette[sIdx % seriesPalette.length] }
                  : undefined,
              data: s.points.map((pt) => ({
                value: [pt.ts, pt.val],
                rawTime: pt.rawTime,
                timeBasis: pt.timeBasis,
                maturity: pt.maturity,
              })),
            })),
          };

          return (
            <div
              key={metricKey}
              style={{
                background: '#fbfcf7',
                border: '1px solid var(--line)',
                borderRadius: 6,
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 650, color: 'var(--ink)', marginBottom: 4 }}>{metricKey}</div>
              <EChartBox option={option} height={metricGroups.length > 1 ? 130 : 175} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
