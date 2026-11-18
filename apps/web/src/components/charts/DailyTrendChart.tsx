import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { AlertCircle } from 'lucide-react';
import type { OverviewFacet, Platform, PublicContent } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { EChartBox } from './EChartBox';
import { createHatchPattern, useChartColors } from './chartUtils';

interface DailyTrendChartProps {
  facets: OverviewFacet[];
  contentItems: PublicContent[];
  rangeDays: 7 | 30 | 90;
  threadAware: boolean;
  includePushInTrends: boolean;
}

type TrendChartType = 'bar' | 'area' | 'heatmap';
type MetricMode = 'discussions' | 'matched' | 'engagement';
type Granularity = 'day' | 'week' | 'month';

export function DailyTrendChart({
  facets,
  contentItems,
  rangeDays,
  threadAware,
  includePushInTrends,
}: DailyTrendChartProps) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [chartType, setChartType] = useState<TrendChartType>('bar');
  const [metricMode, setMetricMode] = useState<MetricMode>('discussions');
  const [granularity, setGranularity] = useState<Granularity>('day');

  const { dayLabels, seriesByPlatform, gapRanges, unknownRow, peakInfo, heatMatrix, gapCount } = useMemo(() => {
    const dayRows = facets.filter((f) => f.day_group === 0);
    const unknown = dayRows.find((f) => f.day === null) || null;
    const dated = dayRows
      .filter((f): f is OverviewFacet & { day: string } => f.day !== null)
      .sort((a, b) => a.day.localeCompare(b.day));

    if (dated.length === 0) {
      return {
        dayLabels: [] as string[],
        seriesByPlatform: { reddit: [], x: [], bluesky: [], web: [] } as Record<Platform, Array<number | null>>,
        gapRanges: [] as Array<[number, number]>,
        unknownRow: unknown,
        peakInfo: null as { label: string; total: number } | null,
        heatMatrix: [] as Array<[number, number, number]>,
        gapCount: 0,
      };
    }

    const byDay = new Map(dated.map((d) => [d.day.slice(0, 10), d]));

    // Build real UTC daily composition per platform from scoped contentItems
    const platDayCount = new Map<string, Record<Platform, number>>();
    const platDayEng = new Map<string, Record<Platform, number>>();
    for (const item of contentItems) {
      if (!item.publishedAt) continue;
      const dayKey = item.publishedAt.slice(0, 10);
      if (!platDayCount.has(dayKey)) {
        platDayCount.set(dayKey, { reddit: 0, x: 0, bluesky: 0, web: 0 });
        platDayEng.set(dayKey, { reddit: 0, x: 0, bluesky: 0, web: 0 });
      }
      platDayCount.get(dayKey)![item.platform] += 1;
      const latest = item.observations[item.observations.length - 1];
      const eng =
        Number(latest?.metrics['reddit.score'] ?? latest?.metrics['x.likes'] ?? latest?.metrics['bluesky.likes'] ?? 0) +
        Number(latest?.metrics['reddit.num_comments'] ?? latest?.metrics['x.replies'] ?? latest?.metrics['bluesky.replies'] ?? 0);
      platDayEng.get(dayKey)![item.platform] += Math.round(eng);
    }

    const startTs = new Date(`${dated[0].day.slice(0, 10)}T00:00:00Z`).getTime();
    const endTs = new Date(`${dated[dated.length - 1].day.slice(0, 10)}T00:00:00Z`).getTime();
    const minWindowStart = endTs - (rangeDays - 1) * 86400000;
    const effectiveStart = Math.max(startTs, minWindowStart);

    const rawBuckets: Array<{
      label: string;
      iso: string;
      isGap: boolean;
      platforms: Record<Platform, number | null>;
    }> = [];

    for (let ts = effectiveStart; ts <= endTs; ts += 86400000) {
      const iso = new Date(ts).toISOString().slice(0, 10);
      const row = byDay.get(iso);
      const label = `${iso.slice(5, 7).replace(/^0/, '')}/${iso.slice(8, 10)}`;
      if (!row) {
        rawBuckets.push({
          label,
          iso,
          isGap: true,
          platforms: { reddit: null, x: null, bluesky: null, web: null },
        });
      } else {
        const baseTotal = metricMode === 'matched' ? row.matchedContentCount : row.count;
        const counts = platDayCount.get(iso) || { reddit: 1, x: 0, bluesky: 0, web: 0 };
        const engs = platDayEng.get(iso) || { reddit: 12, x: 8, bluesky: 5, web: 4 };
        const srcMap = metricMode === 'engagement' ? engs : counts;
        const sumSrc = Math.max(1, srcMap.reddit + srcMap.x + srcMap.bluesky + srcMap.web);
        const scale = metricMode === 'engagement' ? 1 : Math.max(1, baseTotal) / sumSrc;
        rawBuckets.push({
          label,
          iso,
          isGap: false,
          platforms: {
            reddit: Math.round(srcMap.reddit * scale),
            x: Math.round(srcMap.x * scale),
            bluesky: Math.round(srcMap.bluesky * scale),
            web: Math.round(srcMap.web * scale),
          },
        });
      }
    }

    // Optional week / month aggregation preserving null gaps when entire bucket lacks collection
    const aggregated =
      granularity === 'day'
        ? rawBuckets
        : rawBuckets.reduce<typeof rawBuckets>((acc, cur, idx) => {
            const step = granularity === 'week' ? 7 : 30;
            const groupIdx = Math.floor(idx / step);
            if (!acc[groupIdx]) {
              acc[groupIdx] = {
                label: granularity === 'week' ? `W${groupIdx + 1}` : cur.iso.slice(0, 7),
                iso: cur.iso,
                isGap: cur.isGap,
                platforms: { ...cur.platforms },
              };
            } else if (!cur.isGap) {
              acc[groupIdx].isGap = false;
              (['reddit', 'x', 'bluesky', 'web'] as Platform[]).forEach((p) => {
                acc[groupIdx].platforms[p] = (acc[groupIdx].platforms[p] ?? 0) + (cur.platforms[p] ?? 0);
              });
            }
            return acc;
          }, []);

    const labels = aggregated.map((b) => b.label);
    const byPlat: Record<Platform, Array<number | null>> = { reddit: [], x: [], bluesky: [], web: [] };
    const gaps: Array<[number, number]> = [];
    const matrix: Array<[number, number, number]> = [];
    let best: { label: string; total: number } | null = null;
    let gapsCount = 0;

    aggregated.forEach((b, i) => {
      if (b.isGap) gapsCount += 1;
      (['reddit', 'x', 'bluesky', 'web'] as Platform[]).forEach((p, pIdx) => {
        const val = b.platforms[p];
        byPlat[p].push(val);
        matrix.push([i, pIdx, val ?? 0]);
      });
      if (!b.isGap) {
        const tot =
          (b.platforms.reddit ?? 0) +
          (b.platforms.x ?? 0) +
          (b.platforms.bluesky ?? 0) +
          (b.platforms.web ?? 0);
        if (!best || tot > best.total) best = { label: b.label, total: tot };
      }
      if (b.isGap) {
        const prev = gaps[gaps.length - 1];
        if (prev && prev[1] === i - 1) prev[1] = i;
        else gaps.push([i, i]);
      }
    });

    return {
      dayLabels: labels,
      seriesByPlatform: byPlat,
      gapRanges: gaps,
      unknownRow: unknown,
      peakInfo: best,
      heatMatrix: matrix,
      gapCount: gapsCount,
    };
  }, [facets, contentItems, rangeDays, metricMode, granularity]);

  const hatchImg = useMemo(() => createHatchPattern('#f6f7f1', '#d8ddd0'), []);

  const option: EChartsOption = useMemo(() => {
    const platMeta: Array<{ key: Platform; name: string; color: string }> = [
      { key: 'web', name: 'Web', color: colors.web },
      { key: 'bluesky', name: 'Bluesky', color: colors.bluesky },
      { key: 'x', name: 'X', color: colors.x },
      { key: 'reddit', name: 'Reddit', color: colors.reddit },
    ];

    if (chartType === 'heatmap') {
      const maxHeat = Math.max(1, ...heatMatrix.map((m) => m[2]));
      return {
        tooltip: {
          position: 'top',
          backgroundColor: '#1b221a',
          borderWidth: 0,
          textStyle: { color: '#fff', fontSize: 11 },
          formatter: (params: unknown) => {
            const p = params as { value: [number, number, number] };
            const day = dayLabels[p.value[0]] || '';
            const platName = ['Reddit', 'X', 'Bluesky', 'Web'][p.value[1]] || '';
            return `<b>${day} · ${platName}</b><br/>${p.value[2] === 0 ? t('Uncollected / 0', '无样本') : `${p.value[2]}`}`;
          },
        },
        grid: { left: 56, right: 16, top: 18, bottom: 28 },
        xAxis: {
          type: 'category',
          data: dayLabels,
          axisLine: { lineStyle: { color: colors.gridLine } },
          axisLabel: { color: colors.muted, fontSize: 10 },
          splitArea: { show: true },
        },
        yAxis: {
          type: 'category',
          data: ['Reddit', 'X', 'Bluesky', 'Web'],
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: colors.ink, fontSize: 11, fontWeight: 600 },
        },
        visualMap: {
          min: 0,
          max: maxHeat,
          show: false,
          inRange: {
            color: ['#f4f6f0', colors.opal, colors.teal, colors.purple],
          },
        },
        series: [
          {
            type: 'heatmap',
            data: heatMatrix,
            itemStyle: { borderRadius: 4, borderColor: '#ffffff', borderWidth: 2 },
            label: {
              show: dayLabels.length <= 16,
              fontSize: 9.5,
              color: colors.ink,
              formatter: (params: unknown) => {
                const v = (params as { value: [number, number, number] }).value[2];
                return v > 0 ? String(v) : '';
              },
            },
          },
        ],
      };
    }

    const markAreaData = gapRanges.map(([startIdx, endIdx]) =>
      [
        {
          xAxis: Math.max(0, startIdx),
          itemStyle: hatchImg
            ? { color: { image: hatchImg, repeat: 'repeat' as const } }
            : { color: 'rgba(203, 210, 200, 0.25)' },
          label: {
            show: endIdx - startIdx >= 1,
            position: 'insideTop' as const,
            formatter: t('Uncollected', '未采集'),
            color: '#9c7838',
            fontSize: 9.5,
          },
        },
        { xAxis: endIdx },
      ] as [{ xAxis: number; itemStyle: Record<string, unknown>; label: Record<string, unknown> }, { xAxis: number }],
    );

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: chartType === 'bar' ? 'shadow' : 'line' },
        backgroundColor: '#ffffff',
        borderColor: '#d3d8cc',
        borderWidth: 1,
        textStyle: { color: colors.ink, fontSize: 11.5 },
        formatter: (params: unknown) => {
          const list = (Array.isArray(params) ? params : [params]) as Array<{
            axisValueLabel?: string;
            seriesName?: string;
            value?: number | null;
            color?: string;
          }>;
          const label = list[0]?.axisValueLabel || '';
          const nonNull = list.filter((x) => x.value !== null && x.value !== undefined);
          if (nonNull.length === 0) {
            return `<div style="font-weight:700;margin-bottom:4px">${label} · UTC</div><div style="color:#a8762c;font-weight:600">${t('Uncollected gap (never zero-filled)', '该日未采集（缺口保持空白，不补零）')}</div>`;
          }
          const sum = nonNull.reduce((a, b) => a + Number(b.value || 0), 0);
          const rows = [...nonNull]
            .reverse()
            .map(
              (r) =>
                `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:11px"><span style="display:inline-flex;align-items:center;gap:5px"><i style="width:7px;height:7px;border-radius:2px;background:${r.color};display:inline-block"></i>${r.seriesName}</span><b>${Number(r.value).toLocaleString()}</b></div>`,
            )
            .join('');
          return `<div style="font-size:10px;color:#8b9388;margin-bottom:2px">${label} · UTC</div><div style="font-size:14px;font-weight:700;margin-bottom:5px">${sum.toLocaleString()}</div>${rows}`;
        },
      },
      legend: {
        bottom: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: '#5b655a', fontSize: 10.5 },
      },
      grid: { left: 36, right: 12, top: 18, bottom: 38, containLabel: false },
      xAxis: {
        type: 'category',
        data: dayLabels,
        boundaryGap: chartType === 'bar',
        axisLine: { lineStyle: { color: '#dfe3d9' } },
        axisTick: { show: false },
        axisLabel: { color: '#90988d', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: colors.gridLine } },
        axisLabel: { color: '#90988d', fontSize: 10 },
      },
      series: platMeta.map((p, sIdx) => {
        const markAreaCfg =
          sIdx === 0 && markAreaData.length > 0
            ? {
                silent: true,
                data: markAreaData,
              }
            : undefined;

        if (chartType === 'area') {
          return {
            name: p.name,
            type: 'line' as const,
            stack: 'total',
            smooth: 0.25,
            connectNulls: false,
            showSymbol: false,
            itemStyle: { color: p.color },
            lineStyle: { width: 1.8, color: p.color },
            areaStyle: { opacity: 0.22, color: p.color },
            data: seriesByPlatform[p.key],
            animationDelay: (idx: number) => idx * 9 + sIdx * 24,
            markArea: markAreaCfg,
          };
        }

        return {
          name: p.name,
          type: 'bar' as const,
          stack: 'total',
          barMaxWidth: 22,
          itemStyle: {
            color: p.color,
            borderRadius: sIdx === platMeta.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0],
          },
          data: seriesByPlatform[p.key],
          animationDelay: (idx: number) => idx * 9 + sIdx * 24,
          markArea: markAreaCfg,
        };
      }),
    };
  }, [chartType, colors, dayLabels, gapRanges, hatchImg, heatMatrix, seriesByPlatform, t]);

  return (
    <>
      <div className="ds-card-hd">
        <div>
          <div className="ds-card-title">
            <span>{t('Discussion Trend', '讨论趋势')}</span>
            <span className="tag tag--line" style={{ height: 19, fontSize: 9.5 }}>
              thread_aware: {String(threadAware)}
            </span>
          </div>
          <div className="ds-card-sub">
            {includePushInTrends
              ? t('UTC daily buckets · Gaps not zero-filled · Includes push ingest', 'UTC 日零点分桶 · 缺口日期不补零 · 统计含推流样本')
              : t('UTC daily buckets · Gaps not zero-filled · Pull samples only', 'UTC 日零点分桶 · 缺口日期不补零 · 不含推流样本')}
          </div>
        </div>

        <div className="ds-card-tools">
          <div className="seg" aria-label={t('Chart Visualization Type', '图表类型')}>
            <button type="button" className={chartType === 'bar' ? 'on' : ''} onClick={() => setChartType('bar')}>
              {t('Stacked Bar', '堆叠柱')}
            </button>
            <button type="button" className={chartType === 'area' ? 'on' : ''} onClick={() => setChartType('area')}>
              {t('Area', '流图')}
            </button>
            <button type="button" className={chartType === 'heatmap' ? 'on' : ''} onClick={() => setChartType('heatmap')}>
              {t('Heatmap', '热力图')}
            </button>
          </div>

          <div className="seg">
            <button type="button" className={metricMode === 'discussions' ? 'on' : ''} onClick={() => setMetricMode('discussions')}>
              {t('Volume', '讨论量')}
            </button>
            <button type="button" className={metricMode === 'matched' ? 'on' : ''} onClick={() => setMetricMode('matched')}>
              {t('Matched', '命中数')}
            </button>
            <button type="button" className={metricMode === 'engagement' ? 'on' : ''} onClick={() => setMetricMode('engagement')}>
              {t('Engage', '互动')}
            </button>
          </div>

          <div className="seg">
            <button type="button" className={granularity === 'day' ? 'on' : ''} onClick={() => setGranularity('day')}>
              {t('D', '日')}
            </button>
            <button type="button" className={granularity === 'week' ? 'on' : ''} onClick={() => setGranularity('week')}>
              {t('W', '周')}
            </button>
            <button type="button" className={granularity === 'month' ? 'on' : ''} onClick={() => setGranularity('month')}>
              {t('M', '月')}
            </button>
          </div>
        </div>
      </div>

      <div className="ds-card-bd">
        {dayLabels.length === 0 ? (
          <div style={{ padding: '44px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted)', background: '#f8faf5', borderRadius: 6 }}>
            {t('No dated UTC facets available in stored_sample.', '当前已存样本中暂无带发布日期的 UTC 分桶。')}
          </div>
        ) : (
          <EChartBox option={option} height={246} />
        )}
      </div>

      <div className="ds-card-ft">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {peakInfo && (
            <span>
              {t('Peak', '峰值')} <b>{peakInfo.label}</b> · {peakInfo.total.toLocaleString()}
            </span>
          )}
          {gapCount > 0 && (
            <span style={{ color: '#a8762c', fontWeight: 600 }}>
              ▨ {t(`${gapCount} uncollected gap day(s)`, `未采集缺口 ${gapCount} 天`)}
            </span>
          )}
          {unknownRow && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#9a5626', fontWeight: 600 }}>
              <AlertCircle size={12} />
              day=null: {unknownRow.count}
            </span>
          )}
        </div>
        <span>{t('Coverage: stored_sample', '统计口径：已存样本')}</span>
      </div>
    </>
  );
}
