import { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, ExternalLink, FileText, Hash, MessageSquare, RefreshCw, Sparkles, Users } from 'lucide-react';
import type { Platform } from '@/contracts/api';
import type { L1OverviewResponse } from '@/contracts/research';
import { useI18n } from '@/i18n/translations';
import { safeHttpUrl } from '@/lib/sourceLabels';
import { useChartColors } from '../charts/chartUtils';
import type { EChartOption } from '../charts/EChartBox';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Empty } from '../ui/empty';
import { Select } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { AdaptiveLayerLayout } from './AdaptivePanelLayout';
import { AnalysisChartCard } from './AnalysisChartCard';
import { L1_PANEL_RULES, resolvePanelGroup, usePanelPreferences, type EvaluatedPanel } from './panelRegistry';

const L1_PANEL_IDS = L1_PANEL_RULES.map((r) => r.id);

const PLATFORM_NAMES: Record<Platform, string> = {
  reddit: 'Reddit',
  x: 'X',
  bluesky: 'Bluesky',
  web: 'Web',
};

export function L1OverviewTab({
  projectId,
  data,
  isLoading,
  error,
  onRetry,
  keywordLabels,
  exportDisabled,
  onOpenContentDetail,
  onTraceToSearch,
}: {
  projectId?: string;
  data?: L1OverviewResponse;
  isLoading: boolean;
  error?: string | null;
  onRetry: () => void;
  keywordLabels: string[];
  exportDisabled?: boolean;
  onOpenContentDetail: (contentId: string) => void;
  onTraceToSearch: (extraQs: Record<string, string | string[] | undefined>, label?: string) => void;
}) {
  const { t } = useI18n();
  const colors = useChartColors();
  const resolvedProjectId = projectId ?? data?.projectId ?? '';
  const { overrides, setOverride, clearOverride, resetLayer } = usePanelPreferences(resolvedProjectId, L1_PANEL_IDS);

  // Local chart controls (scoped strictly to individual cards!)
  const [trendGranularity, setTrendGranularity] = useState<'bucket' | 'week' | 'month'>('bucket');
  const [trendSeriesMode, setTrendSeriesMode] = useState<'total' | 'byPlatform'>('byPlatform');
  const [trendKindFilter, setTrendKindFilter] = useState<'all' | 'posts' | 'comments'>('all');

  const [kwMetric, setKwMetric] = useState<'count' | 'share'>('count');
  const [platStyle, setPlatStyle] = useState<'donut' | 'bar'>('donut');
  const [sourceDimension, setSourceDimension] = useState<'community' | 'source'>('community');
  const [sourceTopN, setSourceTopN] = useState<5 | 10 | 20>(10);

  const projectName = data?.projectName ?? t('Research Project', '研究项目');

  // L1-02 Trend series rollup
  const trendDisplayPoints = useMemo(() => {
    const trendData = data?.analyses.trend.data;
    const raw = trendData?.points ?? [];
    if (raw.length === 0) return [];
    const pickCount = (pt: (typeof raw)[number]) =>
      trendKindFilter === 'posts' ? pt.postsCount : trendKindFilter === 'comments' ? pt.commentsCount : pt.totalCount;

    if (trendGranularity === 'bucket' || trendData?.bucket === '6h') {
      return raw.map((pt) => ({
        key: pt.bucket.slice(0, trendData?.bucket === '6h' ? 16 : 10),
        total: pickCount(pt),
        byPlatform: Object.fromEntries(pt.byPlatform.map((bp) => [bp.platform, bp.count])) as Partial<Record<Platform, number>>,
      }));
    }

    const grouped = new Map<
      string,
      { key: string; total: number; byPlatform: Partial<Record<Platform, number>> }
    >();
    raw.forEach((pt, idx) => {
      const k = trendGranularity === 'week' ? `W${Math.floor(idx / 7) + 1}` : pt.bucket.slice(0, 7);
      let g = grouped.get(k);
      if (!g) {
        g = { key: k, total: 0, byPlatform: {} };
        grouped.set(k, g);
      }
      g.total += pickCount(pt);
      for (const bp of pt.byPlatform) {
        g.byPlatform[bp.platform] = (g.byPlatform[bp.platform] ?? 0) + bp.count;
      }
    });
    return [...grouped.values()];
  }, [data?.analyses.trend, trendGranularity, trendKindFilter]);

  const trendOption: EChartOption | null = useMemo(() => {
    const platformColor = (p: Platform) =>
      p === 'reddit' ? colors.reddit : p === 'x' ? colors.x : p === 'bluesky' ? colors.bluesky : colors.web;
    if (!trendDisplayPoints.length) return null;
    const activePlatforms = (['reddit', 'x', 'bluesky', 'web'] as Platform[]).filter((p) =>
      trendDisplayPoints.some((pt) => (pt.byPlatform[p] ?? 0) > 0),
    );
    const useSplit = trendSeriesMode === 'byPlatform' && trendKindFilter === 'all' && activePlatforms.length > 1;
    const series = useSplit
      ? activePlatforms.map((p) => ({
          name: PLATFORM_NAMES[p],
          type: 'line' as const,
          smooth: 0.25,
          showSymbol: trendDisplayPoints.length <= 31,
          itemStyle: { color: platformColor(p) },
          lineStyle: { width: 2, color: platformColor(p) },
          data: trendDisplayPoints.map((pt) => pt.byPlatform[p] ?? 0),
        }))
      : [
          {
            name:
              trendKindFilter === 'posts'
                ? t('Posts', '帖文')
                : trendKindFilter === 'comments'
                  ? t('Comments', '评论')
                  : t('Total Content', '内容总量'),
            type: 'line' as const,
            smooth: 0.25,
            showSymbol: trendDisplayPoints.length <= 31,
            itemStyle: { color: colors.purple },
            lineStyle: { width: 2.2, color: colors.purple },
            areaStyle: { opacity: 0.14, color: colors.purple },
            data: trendDisplayPoints.map((pt) => pt.total),
          },
        ];

    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, left: 0, textStyle: { fontSize: 11 } },
      grid: { left: 42, right: 16, top: 18, bottom: 36 },
      xAxis: {
        type: 'category',
        data: trendDisplayPoints.map((p) => p.key),
        axisLabel: { fontSize: 10.5, color: colors.muted },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: colors.gridLine } },
        axisLabel: { fontSize: 10.5, color: colors.muted },
      },
      series,
    };
  }, [trendDisplayPoints, trendSeriesMode, trendKindFilter, colors, t]);

  const trendRows = useMemo(
    () =>
      trendDisplayPoints.map((pt) => ({
        bucket: pt.key,
        total: pt.total,
        reddit: pt.byPlatform.reddit ?? 0,
        x: pt.byPlatform.x ?? 0,
        bluesky: pt.byPlatform.bluesky ?? 0,
        web: pt.byPlatform.web ?? 0,
      })),
    [trendDisplayPoints],
  );

  // L1-03 Keywords Distribution
  const kwRows = useMemo(() => {
    const raw = data?.analyses.keywords.data.rows ?? [];
    return [...raw].sort((a, b) => b.contentCount - a.contentCount);
  }, [data?.analyses.keywords.data.rows]);

  const kwOption: EChartOption | null = useMemo(() => {
    if (!kwRows.length) return null;
    const rev = [...kwRows].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 110, right: 44, top: 10, bottom: 16 },
      xAxis: { type: 'value', minInterval: kwMetric === 'count' ? 1 : undefined, axisLabel: { fontSize: 10.5 } },
      yAxis: {
        type: 'category',
        data: rev.map((r) => r.label),
        axisLabel: { fontSize: 11, color: colors.ink, width: 96, overflow: 'truncate' },
      },
      series: [
        {
          name: kwMetric === 'share' ? t('Share %', '占比%') : t('Items', '去重内容数'),
          type: 'bar',
          barMaxWidth: 20,
          itemStyle: { color: colors.purple, borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right',
            fontSize: 10.5,
            formatter: (params: unknown) => {
              const v = (params as { value?: number }).value ?? 0;
              return kwMetric === 'share' ? `${v}%` : String(v);
            },
          },
          data: rev.map((r) => (kwMetric === 'share' ? r.sharePct : r.contentCount)),
        },
      ],
    };
  }, [kwRows, kwMetric, colors.ink, colors.purple, t]);

  // L1-04 Platform Distribution
  const platRows = useMemo(() => data?.analyses.platforms.data.rows ?? [], [data?.analyses.platforms.data.rows]);
  const platOption: EChartOption | null = useMemo(() => {
    const platformColor = (p: Platform) =>
      p === 'reddit' ? colors.reddit : p === 'x' ? colors.x : p === 'bluesky' ? colors.bluesky : colors.web;
    if (!platRows.length) return null;
    if (platStyle === 'donut') {
      return {
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [
          {
            type: 'pie',
            radius: ['42%', '72%'],
            center: ['50%', '45%'],
            itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
            label: { fontSize: 11, formatter: '{b} {d}%' },
            data: platRows.map((r) => ({
              name: PLATFORM_NAMES[r.platform],
              value: r.contentCount,
              itemStyle: { color: platformColor(r.platform) },
            })),
          },
        ],
      };
    }
    const rev = [...platRows].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 72, right: 44, top: 10, bottom: 16 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: rev.map((r) => PLATFORM_NAMES[r.platform]) },
      series: [
        {
          type: 'bar',
          barMaxWidth: 20,
          label: { show: true, position: 'right', fontSize: 10.5 },
          data: rev.map((r) => ({
            value: r.contentCount,
            itemStyle: { color: platformColor(r.platform), borderRadius: [0, 4, 4, 0] },
          })),
        },
      ],
    };
  }, [platRows, platStyle, colors.bluesky, colors.reddit, colors.web, colors.x]);

  // L1-05 Sources / Community Distribution
  const sourceItems = useMemo(() => {
    const srcBlock = data?.analyses.sources.data;
    if (!srcBlock) return [];
    const list =
      sourceDimension === 'community' && srcBlock.communities.length > 0
        ? srcBlock.communities
        : srcBlock.collectionSources;
    return list.slice(0, sourceTopN);
  }, [data?.analyses.sources.data, sourceDimension, sourceTopN]);

  const sourceOption: EChartOption | null = useMemo(() => {
    if (!sourceItems.length) return null;
    const rev = [...sourceItems].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 130, right: 48, top: 10, bottom: 16 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: {
        type: 'category',
        data: rev.map((r) => r.label),
        axisLabel: { fontSize: 11, width: 115, overflow: 'truncate', color: colors.ink },
      },
      series: [
        {
          name: t('Items', '内容数'),
          type: 'bar',
          barMaxWidth: 18,
          itemStyle: { color: colors.teal, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10.5 },
          data: rev.map((r) => r.contentCount),
        },
      ],
    };
  }, [sourceItems, colors.ink, colors.teal, t]);

  // L1-06 Content Types
  const kindRows = useMemo(() => data?.analyses.kinds.data.byPlatform ?? [], [data?.analyses.kinds.data.byPlatform]);
  const kindOption: EChartOption | null = useMemo(() => {
    if (!kindRows.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 68, right: 20, top: 12, bottom: 34 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: kindRows.map((k) => PLATFORM_NAMES[k.platform]) },
      series: [
        {
          name: t('Posts', '帖文'),
          type: 'bar',
          stack: 'kind',
          barMaxWidth: 22,
          itemStyle: { color: colors.ink },
          data: kindRows.map((k) => k.postsCount),
        },
        {
          name: t('Comments', '评论'),
          type: 'bar',
          stack: 'kind',
          barMaxWidth: 22,
          itemStyle: { color: colors.purple },
          data: kindRows.map((k) => k.commentsCount),
        },
        {
          name: t('Articles', '文章'),
          type: 'bar',
          stack: 'kind',
          barMaxWidth: 22,
          itemStyle: { color: colors.teal },
          data: kindRows.map((k) => k.articlesCount),
        },
      ],
    };
  }, [kindRows, colors, t]);

  // L1-07 Engagement
  const engPlatforms = useMemo(
    () => data?.analyses.engagement.data.platforms ?? [],
    [data?.analyses.engagement.data.platforms],
  );
  const engOption: EChartOption | null = useMemo(() => {
    if (!engPlatforms.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 2, textStyle: { fontSize: 11 } },
      grid: { left: 48, right: 16, top: 16, bottom: 52 },
      xAxis: { type: 'category', data: engPlatforms.map((p) => PLATFORM_NAMES[p.platform]) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: t('Platform Primary Likes/Score', '主互动指标(赞/Score)'),
          type: 'bar',
          barMaxWidth: 24,
          itemStyle: { color: colors.purple, borderRadius: [4, 4, 0, 0] },
          data: engPlatforms.map((p) => p.totalPrimaryMetric),
        },
        {
          name: t('Reported Comments', '平台记录评论'),
          type: 'bar',
          barMaxWidth: 24,
          itemStyle: { color: colors.teal, borderRadius: [4, 4, 0, 0] },
          data: engPlatforms.map((p) => p.reportedRepliesSum),
        },
        {
          name: t('Collected Comments', '已采集评论'),
          type: 'bar',
          barMaxWidth: 24,
          itemStyle: { color: '#d4821c', borderRadius: [4, 4, 0, 0] },
          data: engPlatforms.map((p) => p.collectedCommentsCount),
        },
      ],
    };
  }, [engPlatforms, colors, t]);

  const scale = data?.analyses.scale.data;
  const topItems = data?.analyses.topContent.data.items ?? [];

  const resolvedGroup = useMemo(() => {
    if (!data) return null;
    return resolvePanelGroup(L1_PANEL_RULES, data, overrides, t);
  }, [data, overrides, t]);

  const renderFullL1Panel = (panel: EvaluatedPanel, headerExtras: React.ReactNode) => {
    switch (panel.id) {
      case 'l1.trend':
        return (
          <AnalysisChartCard
            title={t('Discussion Trend', '讨论趋势')}
            subtitle={t('Changes in collected content volume across UTC time buckets', '研究范围内内容数量随时间变化趋势（空缺时段不补零）')}
            block={data?.analyses.trend}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={trendOption}
            height={265}
            headerExtras={headerExtras}
            exportDisabled={exportDisabled}
            columns={[
              { key: 'bucket', label: t('UTC Bucket', 'UTC 时间分桶') },
              { key: 'total', label: t('Total', '总计') },
              { key: 'reddit', label: 'Reddit' },
              { key: 'x', label: 'X' },
              { key: 'bluesky', label: 'Bluesky' },
              { key: 'web', label: 'Web' },
            ]}
            rows={trendRows}
            onTraceEvidence={() => onTraceToSearch({}, t('Inspect samples in Content Search', '在内容检索中查看样本'))}
            onChartEvents={{
              click: (params: unknown) => {
                const p = params as { name?: string };
                if (!p.name || trendGranularity !== 'bucket') return;
                const isoPrefix = p.name.slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(isoPrefix)) return;
                const fromIso = `${isoPrefix}T00:00:00.000Z`;
                const toIso = new Date(Date.parse(fromIso) + 86_400_000).toISOString();
                onTraceToSearch({ from: fromIso, to: toIso }, `${isoPrefix}`);
              },
            }}
            controls={
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup
                  value={[trendSeriesMode]}
                  onValueChange={(v) => {
                    const pick = v[v.length - 1];
                    if (pick === 'total' || pick === 'byPlatform') setTrendSeriesMode(pick);
                  }}
                >
                  <ToggleGroupItem value="byPlatform">{t('By Platform', '分平台')}</ToggleGroupItem>
                  <ToggleGroupItem value="total">{t('Total', '总计')}</ToggleGroupItem>
                </ToggleGroup>

                <ToggleGroup
                  value={[trendKindFilter]}
                  onValueChange={(v) => {
                    const pick = v[v.length - 1];
                    if (pick === 'all' || pick === 'posts' || pick === 'comments') setTrendKindFilter(pick);
                  }}
                >
                  <ToggleGroupItem value="all">{t('All', '全部')}</ToggleGroupItem>
                  <ToggleGroupItem value="posts">{t('Posts', '主帖')}</ToggleGroupItem>
                  <ToggleGroupItem value="comments">{t('Comments', '评论')}</ToggleGroupItem>
                </ToggleGroup>

                {data?.analyses.trend.data.bucket === 'day' && (
                  <ToggleGroup
                    value={[trendGranularity]}
                    onValueChange={(v) => {
                      const pick = v[v.length - 1];
                      if (pick === 'bucket' || pick === 'week' || pick === 'month') setTrendGranularity(pick);
                    }}
                  >
                    <ToggleGroupItem value="bucket">{t('Day', '按天')}</ToggleGroupItem>
                    <ToggleGroupItem value="week">{t('Week', '按周')}</ToggleGroupItem>
                    <ToggleGroupItem value="month">{t('Month', '按月')}</ToggleGroupItem>
                  </ToggleGroup>
                )}
              </div>
            }
          />
        );

      case 'l1.keywords':
        return (
          <AnalysisChartCard
            title={t('Collection Keyword Distribution', '采集关键词分布')}
            subtitle={t('Deduplicated content count per collection target (multi-keyword overlap preserved)', '各采集关键词关联的内容量（允许跨词多重归属，项目总量已去重）')}
            block={data?.analyses.keywords}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={kwOption}
            height={250}
            headerExtras={headerExtras}
            exportDisabled={exportDisabled}
            columns={[
              { key: 'label', label: t('Keyword / Target', '采集关键词/目标') },
              { key: 'contentCount', label: t('Content Count', '内容数') },
              { key: 'postsCount', label: t('Posts', '帖文') },
              { key: 'commentsCount', label: t('Comments', '评论') },
              { key: 'sharePct', label: t('Share %', '占总量%') },
              { key: 'overlapCount', label: t('Overlap', '跨词重叠') },
            ]}
            rows={kwRows.map((r) => ({ ...r }))}
            controls={
              <ToggleGroup
                value={[kwMetric]}
                onValueChange={(v) => {
                  const pick = v[v.length - 1];
                  if (pick === 'count' || pick === 'share') setKwMetric(pick);
                }}
              >
                <ToggleGroupItem value="count">{t('Count', '数量')}</ToggleGroupItem>
                <ToggleGroupItem value="share">{t('Share %', '占比 %')}</ToggleGroupItem>
              </ToggleGroup>
            }
          />
        );

      case 'l1.platforms':
        return (
          <AnalysisChartCard
            title={t('Platform Distribution', '平台分布')}
            subtitle={t('Share of deduplicated content across platforms', '各平台在当前研究范围内的内容数量与占比')}
            block={data?.analyses.platforms}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={platOption}
            height={250}
            headerExtras={headerExtras}
            exportDisabled={exportDisabled}
            columns={[
              { key: 'platform', label: t('Platform', '平台') },
              { key: 'contentCount', label: t('Count', '内容数') },
              { key: 'postsCount', label: t('Posts', '帖文') },
              { key: 'commentsCount', label: t('Comments', '评论') },
              { key: 'sharePct', label: t('Share %', '占比%') },
            ]}
            rows={platRows.map((r) => ({ ...r, platform: PLATFORM_NAMES[r.platform] }))}
            onChartEvents={{
              click: (params: unknown) => {
                const raw = (params as { name?: string }).name?.toLowerCase();
                if (raw === 'reddit' || raw === 'x' || raw === 'bluesky' || raw === 'web') {
                  onTraceToSearch({ platform: raw }, PLATFORM_NAMES[raw]);
                }
              },
            }}
            controls={
              <ToggleGroup
                value={[platStyle]}
                onValueChange={(v) => {
                  const pick = v[v.length - 1];
                  if (pick === 'donut' || pick === 'bar') setPlatStyle(pick);
                }}
              >
                <ToggleGroupItem value="donut">{t('Donut', '环形图')}</ToggleGroupItem>
                <ToggleGroupItem value="bar">{t('Bar', '条形图')}</ToggleGroupItem>
              </ToggleGroup>
            }
          />
        );

      case 'l1.sources':
        return (
          <AnalysisChartCard
            title={t('Community & Source Ranking', '来源与社区分布')}
            subtitle={t('Top communities and collection sources by item count', '讨论集中度最高的社区或采集来源排名')}
            block={data?.analyses.sources}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={sourceOption}
            height={260}
            headerExtras={headerExtras}
            exportDisabled={exportDisabled}
            columns={[
              { key: 'label', label: t('Community / Source', '社区/来源') },
              { key: 'platform', label: t('Platform', '平台') },
              { key: 'contentCount', label: t('Count', '内容数') },
              { key: 'sharePct', label: t('Share %', '占比%') },
              { key: 'avgEngagementScore', label: t('Avg Engagement', '平均热度') },
            ]}
            rows={sourceItems.map((r) => ({ ...r }))}
            onChartEvents={{
              click: (params: unknown) => {
                const name = (params as { name?: string }).name;
                const hit = sourceItems.find((s) => s.label === name);
                if (!hit) return;
                if (hit.kind === 'community') onTraceToSearch({ community: hit.key }, hit.label);
                else onTraceToSearch({ sourceIds: [hit.key] }, hit.label);
              },
            }}
            controls={
              <div className="flex items-center gap-2">
                <ToggleGroup
                  value={[sourceDimension]}
                  onValueChange={(v) => {
                    const pick = v[v.length - 1];
                    if (pick === 'community' || pick === 'source') setSourceDimension(pick);
                  }}
                >
                  <ToggleGroupItem value="community">{t('Community', '社区')}</ToggleGroupItem>
                  <ToggleGroupItem value="source">{t('Source', '采集源')}</ToggleGroupItem>
                </ToggleGroup>
                <Select
                  aria-label={t('Top N', '显示前 N 项')}
                  value={String(sourceTopN)}
                  onChange={(e) => setSourceTopN(Number(e.target.value) as 5 | 10 | 20)}
                >
                  <option value="5">Top 5</option>
                  <option value="10">Top 10</option>
                  <option value="20">Top 20</option>
                </Select>
              </div>
            }
          />
        );

      case 'l1.kinds':
        return (
          <AnalysisChartCard
            title={t('Content Morphology', '内容类型分布')}
            subtitle={t('Breakdown of posts, collected comments, and articles per platform', '各平台下帖文、已采集评论与文章的堆叠分布')}
            block={data?.analyses.kinds}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={kindOption}
            height={260}
            headerExtras={headerExtras}
            exportDisabled={exportDisabled}
            columns={[
              { key: 'platform', label: t('Platform', '平台') },
              { key: 'postsCount', label: t('Posts', '帖文') },
              { key: 'commentsCount', label: t('Comments', '评论') },
              { key: 'articlesCount', label: t('Articles', '文章') },
              { key: 'totalCount', label: t('Total', '合计') },
            ]}
            rows={kindRows.map((r) => ({ ...r, platform: PLATFORM_NAMES[r.platform] }))}
          />
        );

      case 'l1.engagement':
        return (
          <AnalysisChartCard
            title={t('Engagement Breakdown by Platform', '各平台互动情况')}
            subtitle={t('Platform-native metrics kept separate with collected vs reported reply counts', '按平台口径分别统计点赞/Score、平台记录评论与实际入库评论')}
            block={data?.analyses.engagement}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={engOption}
            height={250}
            headerExtras={headerExtras}
            exportDisabled={exportDisabled}
            columns={[
              { key: 'platform', label: t('Platform', '平台') },
              { key: 'postCount', label: t('Posts', '主帖数') },
              { key: 'primaryMetricLabel', label: t('Metric', '主指标') },
              { key: 'totalPrimaryMetric', label: t('Total Metric', '累计主互动') },
              { key: 'avgPrimaryMetric', label: t('Avg / Post', '篇均主互动') },
              { key: 'reportedRepliesSum', label: t('Reported Replies', '平台记录评论') },
              { key: 'collectedCommentsCount', label: t('Collected Comments', '已采评论') },
            ]}
            rows={engPlatforms.map((p) => ({ ...p, platform: PLATFORM_NAMES[p.platform] }))}
          />
        );

      case 'l1.topContent':
      default:
        return (
          <AnalysisChartCard
            title={t('Top Discussions & Representative Content', '热门讨论与代表内容')}
            subtitle={t('Highest-engagement items in the selected scope; click any title to inspect text and thread tree', '当前研究范围内综合互动最高的内容，点击标题可阅读正文与评论上下文')}
            block={data?.analyses.topContent}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={null}
            headerExtras={headerExtras}
            exportDisabled={exportDisabled}
            chartOnly
            columns={[
              { key: 'platform', label: t('Platform', '平台') },
              { key: 'kind', label: t('Type', '类型') },
              { key: 'title', label: t('Title / Excerpt', '标题/摘要') },
              { key: 'communityName', label: t('Community', '社区') },
              { key: 'authorHandle', label: t('Author', '作者') },
              { key: 'metricPrimary', label: t('Score / Likes', '赞/Score') },
              { key: 'metricComments', label: t('Replies', '评论数') },
              { key: 'publishedAt', label: t('Published (UTC)', '发布时间') },
            ]}
            rows={topItems.map((it) => ({
              platform: PLATFORM_NAMES[it.platform],
              kind: it.kind,
              title: it.title || it.cleanExcerpt || it.externalId,
              communityName: it.communityName ? `r/${it.communityName}` : '—',
              authorHandle: it.authorHandle ? `@${it.authorHandle}` : '—',
              metricPrimary: it.metricScore ?? it.metricLikes ?? 0,
              metricComments: it.metricComments ?? 0,
              publishedAt: it.publishedAt ? it.publishedAt.slice(0, 16).replace('T', ' ') : '—',
            }))}
            onTraceEvidence={() => onTraceToSearch({}, t('View all matching content', '去内容检索查看全部'))}
            customBody={
              topItems.length === 0 ? (
                <Empty
                  title={t('No representative items', '暂无代表内容')}
                  description={t('No items match the current research scope.', '当前研究范围内暂无代表性讨论。')}
                />
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border">
                  {topItems.map((item) => {
                    const extUrl = safeHttpUrl(item.url);
                    const primaryMetric = item.metricScore ?? item.metricLikes;
                    return (
                      <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-3 hover:bg-muted/25">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">
                              {PLATFORM_NAMES[item.platform]} · {item.kind}
                            </Badge>
                            {item.communityName && (
                              <Badge variant="secondary" className="text-[10px]">
                                r/{item.communityName}
                              </Badge>
                            )}
                            {item.targetLabels.map((lbl) => (
                              <Badge key={lbl} variant="secondary" className="gap-1 text-[10px]">
                                <Hash size={9} />
                                {lbl}
                              </Badge>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenContentDetail(item.id)}
                            className="block cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-foreground hover:text-primary hover:underline"
                          >
                            {item.title || item.cleanExcerpt || item.externalId}
                          </button>
                          {item.cleanExcerpt && item.title && (
                            <p className="line-clamp-2 text-xs text-muted-foreground">{item.cleanExcerpt}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                            <span>{item.authorHandle ? `@${item.authorHandle}` : t('Unknown author', '未知作者')}</span>
                            <span>·</span>
                            <span>
                              {item.publishedAt
                                ? `${item.publishedAt.slice(0, 16).replace('T', ' ')} UTC`
                                : t('Publish time unknown', '发布时间未知')}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                          <div className="text-right">
                            <div className="font-semibold text-foreground">{primaryMetric ?? '—'}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {item.platform === 'reddit' ? 'Score' : 'Likes'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-foreground">{item.metricComments ?? '—'}</div>
                            <div className="text-[10px] text-muted-foreground">{t('Replies', '评论')}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="xs" onClick={() => onOpenContentDetail(item.id)}>
                              {t('Read', '查阅')}
                              <ArrowRight size={11} />
                            </Button>
                            {extUrl && (
                              <a
                                href={extUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={t('Open original URL', '打开原始链接')}
                                className="inline-flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                              >
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            }
          />
        );
    }
  };

  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert variant="destructive" className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          <RefreshCw size={12} />
          <span>{t('Retry', '重试')}</span>
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* L1-01 Scale KPI Strip */}
      <div className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="gap-1 py-3.5 shadow-xs">
            <CardContent className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={13} />
                  {t('Deduplicated Content', '去重内容总量')}
                </span>
                <Badge variant="outline" className="text-[10px]">L1-01</Badge>
              </div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {(scale?.deduplicatedContentCount ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t('Thread roots', '折叠讨论根数')}: {(scale?.threadAnchorCount ?? 0).toLocaleString()}
                {(scale?.multiTargetOverlapCount ?? 0) > 0 &&
                  ` · ${t('Overlap', '跨词重叠')} ${scale?.multiTargetOverlapCount}`}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-1 py-3.5 shadow-xs">
            <CardContent className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={13} />
                  {t('Posts & Articles', '主帖与文章数')}
                </span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {((scale?.postsCount ?? 0) + (scale?.articlesCount ?? 0)).toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t('Posts', '帖文')} {(scale?.postsCount ?? 0).toLocaleString()} · {t('Articles', '文章')}{' '}
                {(scale?.articlesCount ?? 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-1 py-3.5 shadow-xs">
            <CardContent className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MessageSquare size={13} />
                  {t('Collected Comments', '已采集评论数')}
                </span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {(scale?.commentsCount ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t('Platform reported replies', '平台记录评论总量')}:{' '}
                {(scale?.reportedPlatformCommentsSum ?? 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-1 py-3.5 shadow-xs">
            <CardContent className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Users size={13} />
                  {t('Sources & Communities', '覆盖来源与社区')}
                </span>
              </div>
              <div className="text-2xl font-bold tabular-nums text-foreground">
                {(scale?.sourcesCount ?? 0).toLocaleString()} / {(scale?.communitiesCount ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t('Distinct authors', '参与作者数')}: {(scale?.authorsCount ?? 0).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        </div>

        {data?.analyses.scale.summaryText && (
          <div className="rounded-lg border border-border/70 bg-card px-3.5 py-2 text-xs text-muted-foreground">
            <strong className="mr-1.5 text-foreground">{t('Scope Summary', '规模解读')}:</strong>
            {data.analyses.scale.summaryText}
          </div>
        )}
      </div>

      {resolvedGroup && (
        <AdaptiveLayerLayout
          group={resolvedGroup}
          onSetOverride={setOverride}
          onClearOverride={clearOverride}
          onResetAll={resetLayer}
          renderFullPanel={renderFullL1Panel}
        />
      )}
    </div>
  );
}
