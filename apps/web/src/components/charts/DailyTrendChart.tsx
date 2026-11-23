import { useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { DayPlatformFacet, OverviewFacet, Platform } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { EChartBox, type EChartOption } from './EChartBox';
import { createHatchPattern, useChartColors } from './chartUtils';

interface DailyTrendChartProps {
  facets: OverviewFacet[];
  dayPlatformFacets?: DayPlatformFacet[];
  rangeDays: 7 | 30 | 90;
  bucket?: 'day' | '6h';
  threadAware: boolean;
  includePushInTrends: boolean;
  onSelectDayPlatform?: (dayIso: string, platform?: Platform) => void;
}

type TrendChartType = 'bar' | 'area';
type MetricMode = 'discussions' | 'matched';
type Granularity = 'day' | 'week' | 'month';

const PLATFORMS: Platform[] = ['reddit', 'x', 'bluesky', 'web'];

function isKnownPlatform(val: string): val is Platform {
  return val === 'reddit' || val === 'x' || val === 'bluesky' || val === 'web';
}

export function DailyTrendChart({
  facets,
  dayPlatformFacets,
  rangeDays,
  bucket = 'day',
  threadAware,
  includePushInTrends,
  onSelectDayPlatform,
}: DailyTrendChartProps) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [chartType, setChartType] = useState<TrendChartType>('bar');
  const [metricMode, setMetricMode] = useState<MetricMode>('discussions');
  const [grouping, setGrouping] = useState<Granularity>('day');
  const granularity = bucket === '6h' ? 'day' : grouping;

  const {
    dayLabels,
    dayIsos,
    hasPlatformSplit,
    seriesByPlatform,
    totalSeries,
    gapRanges,
    unknownRow,
    peakInfo,
    gapCount,
  } = useMemo(() => {
    const dayRows = facets.filter((f) => f.day_group === 0);
    const unknown = dayRows.find((f) => f.day === null) || null;
    const dated = dayRows
      .filter((f): f is OverviewFacet & { day: string } => f.day !== null)
      .sort((a, b) => a.day.localeCompare(b.day));

    const validPlatFacets = (dayPlatformFacets ?? []).filter(
      (f) => Boolean(f.day) && isKnownPlatform(f.platform),
    );
    const usePlatformSplit = validPlatFacets.length > 0;

    const isHourly = bucket === '6h';
    const keyOf = (value: string) => value.slice(0, isHourly ? 13 : 10);
    const parseKey = (key: string) => Date.parse(key + (isHourly ? ':00:00Z' : 'T00:00:00Z'));
    const bucketMs = (isHourly ? 6 : 24) * 3_600_000;

    const byDayPlatform = new Map<string, Record<Platform, number>>();
    for (const row of validPlatFacets) {
      const dayKey = keyOf(row.day);
      if (!byDayPlatform.has(dayKey)) {
        byDayPlatform.set(dayKey, { reddit: 0, x: 0, bluesky: 0, web: 0 });
      }
      const val = metricMode === 'matched' ? row.matchedContentCount : row.count;
      byDayPlatform.get(dayKey)![row.platform as Platform] += val;
    }

    const byDayTotal = new Map(dated.map((d) => [keyOf(d.day), d]));
    const allDays = [...new Set([...byDayTotal.keys(), ...byDayPlatform.keys()])].sort();

    if (allDays.length === 0) {
      return {
        dayLabels: [] as string[],
        dayIsos: [] as string[],
        hasPlatformSplit: usePlatformSplit,
        seriesByPlatform: { reddit: [], x: [], bluesky: [], web: [] } as Record<Platform, Array<number | null>>,
        totalSeries: [] as Array<number | null>,
        gapRanges: [] as Array<[number, number]>,
        unknownRow: unknown,
        peakInfo: null as { label: string; total: number } | null,
        gapCount: 0,
      };
    }

    const startTs = parseKey(allDays[0]);
    const endTs = parseKey(allDays[allDays.length - 1]);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
      return {
        dayLabels: [] as string[],
        dayIsos: [] as string[],
        hasPlatformSplit: usePlatformSplit,
        seriesByPlatform: { reddit: [], x: [], bluesky: [], web: [] } as Record<Platform, Array<number | null>>,
        totalSeries: [] as Array<number | null>,
        gapRanges: [] as Array<[number, number]>,
        unknownRow: unknown,
        peakInfo: null as { label: string; total: number } | null,
        gapCount: 0,
      };
    }

    const minWindowStart = endTs - rangeDays * 86_400_000 + bucketMs;
    const effectiveStart = Math.max(startTs, minWindowStart);

    const rawBuckets: Array<{
      label: string;
      iso: string;
      isGap: boolean;
      total: number | null;
      platforms: Record<Platform, number | null>;
    }> = [];

    for (let ts = effectiveStart; ts <= endTs; ts += bucketMs) {
      const iso = keyOf(new Date(ts).toISOString());
      const date = `${iso.slice(5, 7).replace(/^0/, '')}/${iso.slice(8, 10)}`;
      const label = isHourly ? `${date} ${iso.slice(11, 13)}:00` : date;

      if (usePlatformSplit) {
        const platRow = byDayPlatform.get(iso);
        if (!platRow) {
          rawBuckets.push({
            label,
            iso,
            isGap: true,
            total: null,
            platforms: { reddit: null, x: null, bluesky: null, web: null },
          });
        } else {
          const sum = platRow.reddit + platRow.x + platRow.bluesky + platRow.web;
          rawBuckets.push({
            label,
            iso,
            isGap: false,
            total: sum,
            platforms: { ...platRow },
          });
        }
      } else {
        const row = byDayTotal.get(iso);
        if (!row) {
          rawBuckets.push({
            label,
            iso,
            isGap: true,
            total: null,
            platforms: { reddit: null, x: null, bluesky: null, web: null },
          });
        } else {
          const baseTotal = metricMode === 'matched' ? row.matchedContentCount : row.count;
          rawBuckets.push({
            label,
            iso,
            isGap: false,
            total: baseTotal,
            platforms: { reddit: null, x: null, bluesky: null, web: null },
          });
        }
      }
    }

    let aggregated = rawBuckets;
    if (granularity !== 'day') {
      const groups = new Map<string, (typeof rawBuckets)[number]>();
      for (const [idx, current] of rawBuckets.entries()) {
        const label = granularity === 'week' ? `W${Math.floor(idx / 7) + 1}` : current.iso.slice(0, 7);
        const group = groups.get(label);
        if (!group) {
          groups.set(label, { ...current, label, platforms: { ...current.platforms } });
        } else if (!current.isGap) {
          group.isGap = false;
          group.total = (group.total ?? 0) + (current.total ?? 0);
          if (usePlatformSplit) {
            for (const platform of PLATFORMS) {
              group.platforms[platform] = (group.platforms[platform] ?? 0) + (current.platforms[platform] ?? 0);
            }
          }
        }
      }
      aggregated = [...groups.values()];
    }

    const labels = aggregated.map((b) => b.label);
    const isos = aggregated.map((b) => b.iso);
    const byPlat: Record<Platform, Array<number | null>> = { reddit: [], x: [], bluesky: [], web: [] };
    const totals: Array<number | null> = [];
    const gaps: Array<[number, number]> = [];
    let best: { label: string; total: number } | null = null;
    let gapsCount = 0;

    aggregated.forEach((b, i) => {
      if (b.isGap) gapsCount += 1;
      totals.push(b.total);
      PLATFORMS.forEach((p) => {
        byPlat[p].push(b.platforms[p]);
      });
      if (!b.isGap && b.total !== null) {
        if (!best || b.total > best.total) best = { label: b.label, total: b.total };
      }
      if (b.isGap) {
        const prev = gaps[gaps.length - 1];
        if (prev && prev[1] === i - 1) prev[1] = i;
        else gaps.push([i, i]);
      }
    });

    return {
      dayLabels: labels,
      dayIsos: isos,
      hasPlatformSplit: usePlatformSplit,
      seriesByPlatform: byPlat,
      totalSeries: totals,
      gapRanges: gaps,
      unknownRow: unknown,
      peakInfo: best,
      gapCount: gapsCount,
    };
  }, [facets, dayPlatformFacets, rangeDays, metricMode, granularity, bucket]);

  const hatchImg = useMemo(() => createHatchPattern('#f6f7f1', '#d8ddd0'), []);

  const option: EChartOption = useMemo(() => {
    const platMeta: Array<{ key: Platform; name: string; color: string }> = [
      { key: 'web', name: 'Web', color: colors.web },
      { key: 'bluesky', name: 'Bluesky', color: colors.bluesky },
      { key: 'x', name: 'X', color: colors.x },
      { key: 'reddit', name: 'Reddit', color: colors.reddit },
    ];

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
            formatter: t('No samples', '暂无样本'),
            color: '#9c7838',
            fontSize: 9.5,
          },
        },
        { xAxis: endIdx },
      ] as [{ xAxis: number; itemStyle: Record<string, unknown>; label: Record<string, unknown> }, { xAxis: number }],
    );

    const buildSeries = () => {
      if (!hasPlatformSplit) {
        const markAreaCfg = markAreaData.length > 0 ? { silent: true, data: markAreaData } : undefined;
        const name = t('Total', '总计');
        if (chartType === 'area') {
          return [
            {
              name,
              type: 'line' as const,
              smooth: 0.25,
              connectNulls: false,
              showSymbol: false,
              itemStyle: { color: colors.purple },
              lineStyle: { width: 1.8, color: colors.purple },
              areaStyle: { opacity: 0.2, color: colors.purple },
              data: totalSeries,
              markArea: markAreaCfg,
            },
          ];
        }
        return [
          {
            name,
            type: 'bar' as const,
            barMaxWidth: 22,
            itemStyle: { color: colors.purple, borderRadius: [2, 2, 0, 0] },
            data: totalSeries,
            markArea: markAreaCfg,
          },
        ];
      }

      return platMeta.map((p, sIdx) => {
        const markAreaCfg =
          sIdx === 0 && markAreaData.length > 0
            ? { silent: true, data: markAreaData }
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
            areaStyle: { opacity: 0.2, color: p.color },
            data: seriesByPlatform[p.key],
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
          markArea: markAreaCfg,
        };
      });
    };

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
            .filter((r) => Number(r.value || 0) > 0)
            .map(
              (r) =>
                `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:11px"><span style="display:inline-flex;align-items:center;gap:5px"><i style="width:7px;height:7px;border-radius:2px;background:${r.color};display:inline-block"></i>${r.seriesName}</span><b>${Number(r.value).toLocaleString()}</b></div>`,
            )
            .join('');
          return `<div style="font-size:10px;color:#677166;margin-bottom:2px">${label} · UTC</div><div style="font-size:14px;font-weight:700;margin-bottom:5px">${sum.toLocaleString()}</div>${rows}`;
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
        axisLabel: { color: '#677166', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: colors.gridLine } },
        axisLabel: { color: '#677166', fontSize: 10 },
      },
      series: buildSeries(),
    };
  }, [chartType, colors, dayLabels, gapRanges, hasPlatformSplit, hatchImg, seriesByPlatform, t, totalSeries]);

  return (
    <>
      <div className="ds-card-hd">
        <div>
          <div className="ds-card-title">
            <span>{t('Discussion Volume Trend', '已存样本内容量趋势')}</span>
            <span className="tag tag--line" style={{ height: 19, fontSize: 9.5 }}>
              thread_aware: {String(threadAware)}
            </span>
          </div>
          <div className="ds-card-sub">
            {bucket === '6h' ? t('Six-hour UTC buckets', 'UTC 六小时分桶') : t('Daily UTC buckets', 'UTC 日分桶')}
            {' · '}{t('Gaps indicate missing samples', '空档表示缺少样本')}
            {' · '}{includePushInTrends ? t('Includes push ingest', '含推流样本') : t('Pull samples only', '仅拉取样本')}
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
          </div>

          <div className="seg">
            <button type="button" className={metricMode === 'discussions' ? 'on' : ''} onClick={() => setMetricMode('discussions')}>
              {t('Volume', '讨论量')}
            </button>
            <button type="button" className={metricMode === 'matched' ? 'on' : ''} onClick={() => setMetricMode('matched')}>
              {t('Matched', '命中数')}
            </button>
          </div>

          {bucket === 'day' && <div className="seg">
            <button type="button" className={granularity === 'day' ? 'on' : ''} onClick={() => setGrouping('day')}>
              {t('D', '日')}
            </button>
            <button type="button" className={granularity === 'week' ? 'on' : ''} onClick={() => setGrouping('week')}>
              {t('W', '周')}
            </button>
            <button type="button" className={granularity === 'month' ? 'on' : ''} onClick={() => setGrouping('month')}>
              {t('M', '月')}
            </button>
          </div>}
        </div>
      </div>

      <div className="ds-card-bd">
        {dayLabels.length === 0 ? (
          <div style={{ padding: '44px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted)', background: '#f8faf5', borderRadius: 6 }}>
            {t('No dated UTC facets available in stored_sample.', '当前已存样本中暂无带发布日期的 UTC 分桶。')}
          </div>
        ) : (
          <EChartBox
            option={option}
            height={246}
            ariaLabel={bucket === '6h'
              ? t('Content volume by six-hour UTC bucket and platform', '按 UTC 六小时分桶与平台的内容量')
              : t('Content volume by day and platform', '按日与平台的内容量')}
            onEvents={
              onSelectDayPlatform && granularity === 'day'
                ? {
                    click: (params: unknown) => {
                      const p = params as { dataIndex?: number; seriesName?: string };
                      if (typeof p.dataIndex !== 'number') return;
                      const iso = dayIsos[p.dataIndex];
                      if (!iso) return;
                      const plat = p.seriesName?.toLowerCase();
                      const validPlat =
                        plat === 'reddit' || plat === 'x' || plat === 'bluesky' || plat === 'web'
                          ? (plat as Platform)
                          : undefined;
                      onSelectDayPlatform(iso, validPlat);
                    },
                  }
                : undefined
            }
          />
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
              ▨ {t(`${gapCount} buckets with no dated samples`, `${gapCount} 个分桶暂无带发布日期的样本`)}
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
