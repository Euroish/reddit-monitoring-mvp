import { useMemo, useState } from 'react';
import { GitCompare } from 'lucide-react';
import type { L2ComparisonResponse, L2TermItem } from '@/contracts/research';
import { useI18n } from '@/i18n/translations';
import { useChartColors } from '../charts/chartUtils';
import type { EChartOption } from '../charts/EChartBox';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Empty } from '../ui/empty';
import { Select } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { AdaptiveLayerLayout } from './AdaptivePanelLayout';
import { AnalysisChartCard } from './AnalysisChartCard';
import { buildL2PanelRules, resolvePanelGroup, usePanelPreferences, type EvaluatedPanel } from './panelRegistry';

const SERIES_PALETTE = ['#2563eb', '#7c3aed', '#0d9488', '#ea580c', '#db2777', '#65a30d', '#0284c7', '#9333ea'];
const ALL_L2_RULES = buildL2PanelRules();
const ALL_L2_PANEL_IDS = ALL_L2_RULES.map((r) => r.id);

export function L2ComparisonTab({
  projectId,
  data,
  isLoading,
  error,
  onRetry,
  compareMode,
  onCompareModeChange,
  sensitivity,
  onSensitivityChange,
  windowSplitAt,
  onWindowSplitAtChange,
  keywordLabels,
  exportDisabled,
  onTraceToSearch,
}: {
  projectId?: string;
  data?: L2ComparisonResponse;
  isLoading: boolean;
  error?: string | null;
  onRetry: () => void;
  compareMode: 'target' | 'batch';
  onCompareModeChange: (m: 'target' | 'batch') => void;
  sensitivity: 'low' | 'medium' | 'high';
  onSensitivityChange: (s: 'low' | 'medium' | 'high') => void;
  windowSplitAt: string;
  onWindowSplitAtChange: (isoDate: string) => void;
  keywordLabels: string[];
  exportDisabled?: boolean;
  onTraceToSearch: (extraQs: Record<string, string | string[] | undefined>, label?: string) => void;
}) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [section, setSection] = useState<'all' | 'text' | 'compare' | 'change'>('all');
  const [objTrendMode, setObjTrendMode] = useState<'count' | 'share'>('count');
  const [matrixMetric, setMatrixMetric] = useState<'count' | 'share'>('count');
  const resolvedProjectId = projectId ?? data?.projectId ?? '';
  const { overrides, setOverride, clearOverride, resetLayer } = usePanelPreferences(resolvedProjectId, ALL_L2_PANEL_IDS);

  const projectName = data?.projectName ?? t('Research Project', '研究项目');
  const a = data?.analyses;

  const mkTermOption = (items: readonly L2TermItem[], color: string, metric: 'docCount' | 'avgScore' = 'docCount'): EChartOption | null => {
    if (!items.length) return null;
    const rev = [...items.slice(0, 14)].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 120, right: 44, top: 8, bottom: 16 },
      xAxis: { type: 'value', axisLabel: { fontSize: 10.5 } },
      yAxis: {
        type: 'category',
        data: rev.map((r) => r.term),
        axisLabel: { width: 108, overflow: 'truncate', fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 16,
          itemStyle: { color, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10 },
          data: rev.map((r) => (metric === 'avgScore' ? Number((r.avgScore ?? 0).toFixed(3)) : r.docCount)),
        },
      ],
    };
  };

  // L2-01..04 options
  const unigramOpt = useMemo(() => mkTermOption(a?.unigrams.data.items ?? [], colors.purple), [a?.unigrams.data.items, colors.purple]);
  const bigramOpt = useMemo(() => mkTermOption(a?.bigrams.data.items ?? [], '#2563eb'), [a?.bigrams.data.items]);
  const trigramOpt = useMemo(() => mkTermOption(a?.trigrams.data.items ?? [], '#0d9488'), [a?.trigrams.data.items]);
  const tfidfOpt = useMemo(() => mkTermOption(a?.tfidf.data.items ?? [], '#7c3aed', 'avgScore'), [a?.tfidf.data.items]);

  // L2-05 Co-occurrence heatmap
  const coocOpt: EChartOption | null = useMemo(() => {
    const d = a?.cooccurrence.data;
    if (!d || d.terms.length < 2) return null;
    const idxMap = new Map(d.terms.map((term, i) => [term, i]));
    const maxVal = Math.max(1, ...d.cells.filter((c) => c.termA !== c.termB).map((c) => c.coCount));
    return {
      tooltip: {
        position: 'top',
        formatter: (params: unknown) => {
          const p = params as { value: [number, number, number] };
          const termA = d.terms[p.value[0]];
          const termB = d.terms[p.value[1]];
          const cell = d.cells.find((c) => c.termA === termA && c.termB === termB);
          return `${termA} × ${termB}<br/>${t('Co-occurrences', '共现条数')}: <b>${p.value[2]}</b>${cell ? ` · Lift ${cell.lift}` : ''}`;
        },
      },
      grid: { left: 82, right: 16, top: 12, bottom: 72 },
      xAxis: { type: 'category', data: d.terms, axisLabel: { rotate: 35, fontSize: 10 } },
      yAxis: { type: 'category', data: d.terms, axisLabel: { fontSize: 10 } },
      visualMap: {
        min: 0,
        max: maxVal,
        show: false,
        inRange: { color: ['#f8fafc', '#cbd5e1', '#7c3aed'] },
      },
      series: [
        {
          type: 'heatmap',
          data: d.cells.map((c) => [idxMap.get(c.termA) ?? 0, idxMap.get(c.termB) ?? 0, c.coCount]),
          label: { show: d.terms.length <= 10, fontSize: 9.5 },
        },
      ],
    };
  }, [a?.cooccurrence.data, t]);

  // L2-06 Object comparison
  const objCountOpt: EChartOption | null = useMemo(() => {
    const rows = a?.objectCounts.data.rows ?? [];
    if (!rows.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 46, right: 16, top: 16, bottom: 38 },
      xAxis: { type: 'category', data: rows.map((r) => r.label), axisLabel: { fontSize: 11, width: 90, overflow: 'truncate' } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: t('Exclusive', '独占内容'),
          type: 'bar',
          stack: 'total',
          barMaxWidth: 32,
          itemStyle: { color: colors.purple },
          data: rows.map((r) => r.exclusiveCount),
        },
        {
          name: t('Shared / Overlapping', '跨对象重叠'),
          type: 'bar',
          stack: 'total',
          barMaxWidth: 32,
          itemStyle: { color: '#94a3b8', borderRadius: [4, 4, 0, 0] },
          data: rows.map((r) => r.overlapCount),
        },
      ],
    };
  }, [a?.objectCounts.data.rows, colors.purple, t]);

  // L2-07 Multi-series trend
  const objTrendOpt: EChartOption | null = useMemo(() => {
    const d = a?.objectTrends.data;
    if (!d || !d.points.length || !d.objects.length) return null;
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 16, top: 16, bottom: 40 },
      xAxis: { type: 'category', data: d.points.map((p) => p.bucket), axisLabel: { fontSize: 10.5 } },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10.5, formatter: objTrendMode === 'share' ? '{value}%' : '{value}' },
      },
      series: d.objects.slice(0, 8).map((obj, idx) => ({
        name: obj.label,
        type: 'line' as const,
        smooth: 0.2,
        showSymbol: d.points.length <= 24,
        itemStyle: { color: SERIES_PALETTE[idx % SERIES_PALETTE.length] },
        data: d.points.map((p) => {
          const item = p.series.find((s) => s.objectKey === obj.key);
          return objTrendMode === 'share' ? (item?.sharePct ?? 0) : (item?.count ?? 0);
        }),
      })),
    };
  }, [a?.objectTrends.data, objTrendMode]);

  const platMatrixOpt = useMemo((): EChartOption | null => {
    const d = a?.objectPlatformMatrix.data;
    if (!d || !d.rows.length || !d.cols.length) return null;
    const rIdx = new Map(d.rows.map((r, i) => [r.key, i]));
    const cIdx = new Map(d.cols.map((c, i) => [c.key, i]));
    const vals = d.cells.map((c) => (matrixMetric === 'share' ? c.sharePct : c.count));
    const maxVal = Math.max(1, ...vals);
    return {
      tooltip: {
        position: 'top',
        formatter: (params: unknown) => {
          const p = params as { value: [number, number, number] };
          const col = d.cols[p.value[0]];
          const row = d.rows[p.value[1]];
          const found = d.cells.find((c) => c.colKey === col?.key && c.objectKey === row?.key);
          return `${row?.label} × ${col?.label}<br/>${t('Count', '条数')}: <b>${found?.count ?? 0}</b> (${found?.sharePct ?? 0}%)`;
        },
      },
      grid: { left: 106, right: 20, top: 12, bottom: 52 },
      xAxis: { type: 'category', data: d.cols.map((c) => c.label), axisLabel: { rotate: d.cols.length > 5 ? 25 : 0, fontSize: 10.5 } },
      yAxis: { type: 'category', data: d.rows.map((r) => r.label), axisLabel: { width: 92, overflow: 'truncate', fontSize: 10.5 } },
      visualMap: { min: 0, max: maxVal, show: false, inRange: { color: ['#f8fafc', '#bfdbfe', '#2563eb'] } },
      series: [
        {
          type: 'heatmap',
          data: d.cells.map((c) => [cIdx.get(c.colKey) ?? 0, rIdx.get(c.objectKey) ?? 0, matrixMetric === 'share' ? c.sharePct : c.count]),
          label: { show: true, fontSize: 10.5 },
        },
      ],
    };
  }, [a?.objectPlatformMatrix.data, matrixMetric, t]);

  const commMatrixOpt = useMemo((): EChartOption | null => {
    const d = a?.objectCommunityMatrix.data;
    if (!d || !d.rows.length || !d.cols.length) return null;
    const rIdx = new Map(d.rows.map((r, i) => [r.key, i]));
    const cIdx = new Map(d.cols.map((c, i) => [c.key, i]));
    const vals = d.cells.map((c) => (matrixMetric === 'share' ? c.sharePct : c.count));
    const maxVal = Math.max(1, ...vals);
    return {
      tooltip: {
        position: 'top',
        formatter: (params: unknown) => {
          const p = params as { value: [number, number, number] };
          const col = d.cols[p.value[0]];
          const row = d.rows[p.value[1]];
          const found = d.cells.find((c) => c.colKey === col?.key && c.objectKey === row?.key);
          return `${row?.label} × ${col?.label}<br/>${t('Count', '条数')}: <b>${found?.count ?? 0}</b> (${found?.sharePct ?? 0}%)`;
        },
      },
      grid: { left: 106, right: 20, top: 12, bottom: 52 },
      xAxis: { type: 'category', data: d.cols.map((c) => c.label), axisLabel: { rotate: d.cols.length > 4 ? 25 : 0, fontSize: 10.5 } },
      yAxis: { type: 'category', data: d.rows.map((r) => r.label), axisLabel: { width: 92, overflow: 'truncate', fontSize: 10.5 } },
      visualMap: { min: 0, max: maxVal, show: false, inRange: { color: ['#f8fafc', '#bfdbfe', '#2563eb'] } },
      series: [
        {
          type: 'heatmap',
          data: d.cells.map((c) => [cIdx.get(c.colKey) ?? 0, rIdx.get(c.objectKey) ?? 0, matrixMetric === 'share' ? c.sharePct : c.count]),
          label: { show: true, fontSize: 10.5 },
        },
      ],
    };
  }, [a?.objectCommunityMatrix.data, matrixMetric, t]);

  // L2-11 Overlap Jaccard heatmap
  const overlapOpt: EChartOption | null = useMemo(() => {
    const d = a?.overlapMatrix.data;
    if (!d || d.objects.length < 2) return null;
    const idxMap = new Map(d.objects.map((o, i) => [o.key, i]));
    return {
      tooltip: {
        position: 'top',
        formatter: (params: unknown) => {
          const p = params as { value: [number, number, number] };
          const row = d.objects[p.value[1]];
          const col = d.objects[p.value[0]];
          const cell = d.cells.find((c) => c.rowKey === row?.key && c.colKey === col?.key);
          if (!cell) return '';
          return `${cell.rowLabel} ∩ ${cell.colLabel}<br/>${t('Intersection', '交集')}: <b>${cell.intersectionCount}</b> / ${t('Union', '并集')}: ${cell.unionCount}<br/>Jaccard: <b>${cell.jaccardPct}%</b>`;
        },
      },
      grid: { left: 106, right: 20, top: 12, bottom: 52 },
      xAxis: { type: 'category', data: d.objects.map((o) => o.label), axisLabel: { rotate: d.objects.length > 4 ? 25 : 0, fontSize: 10.5 } },
      yAxis: { type: 'category', data: d.objects.map((o) => o.label), axisLabel: { width: 92, overflow: 'truncate', fontSize: 10.5 } },
      visualMap: { min: 0, max: 100, show: false, inRange: { color: ['#f8fafc', '#ddd6fe', '#6d28d9'] } },
      series: [
        {
          type: 'heatmap',
          data: d.cells.map((c) => [idxMap.get(c.colKey) ?? 0, idxMap.get(c.rowKey) ?? 0, c.jaccardPct]),
          label: {
            show: true,
            fontSize: 10.5,
            formatter: (params: unknown) => {
              const p = params as { value: [number, number, number] };
              return `${p.value[2]}%`;
            },
          },
        },
      ],
    };
  }, [a?.overlapMatrix.data, t]);

  // L2-12 Window comparison bar chart
  const windowCompareOpt: EChartOption | null = useMemo(() => {
    const d = a?.windowComparison.data;
    if (!d || (!d.beforeCount && !d.afterCount)) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 48, right: 16, top: 18, bottom: 38 },
      xAxis: { type: 'category', data: d.metrics.map((m) => m.label) },
      yAxis: { type: 'value' },
      series: [
        { name: d.beforeLabel, type: 'bar', barMaxWidth: 28, itemStyle: { color: '#94a3b8', borderRadius: [4, 4, 0, 0] }, data: d.metrics.map((m) => m.previousValue) },
        { name: d.afterLabel, type: 'bar', barMaxWidth: 28, itemStyle: { color: colors.purple, borderRadius: [4, 4, 0, 0] }, data: d.metrics.map((m) => m.currentValue) },
      ],
    };
  }, [a?.windowComparison.data, colors.purple]);

  // L2-13 Hot term trends
  const hotTermsOpt: EChartOption | null = useMemo(() => {
    const d = a?.hotTermTrends.data;
    if (!d || !d.buckets.length || !d.series.length) return null;
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 16, top: 14, bottom: 38 },
      xAxis: { type: 'category', data: d.buckets, axisLabel: { fontSize: 10.5 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: d.series.map((s, idx) => ({
        name: s.term,
        type: 'line' as const,
        smooth: 0.25,
        itemStyle: { color: SERIES_PALETTE[idx % SERIES_PALETTE.length] },
        data: s.points.map((p) => p.count),
      })),
    };
  }, [a?.hotTermTrends.data]);

  // L2-14 Anomaly spike detection
  const anomalyOpt: EChartOption | null = useMemo(() => {
    const d = a?.anomalyDetection.data;
    if (!d || !d.points.length) return null;
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 42, right: 16, top: 26, bottom: 30 },
      xAxis: { type: 'category', data: d.points.map((p) => p.bucket), axisLabel: { fontSize: 10.5 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: t('Daily Volume', '日声量'),
          type: 'line',
          smooth: 0.2,
          itemStyle: { color: '#2563eb' },
          areaStyle: { opacity: 0.12, color: '#2563eb' },
          markLine: {
            silent: true,
            lineStyle: { type: 'dashed', color: '#94a3b8' },
            data: [{ yAxis: d.points[0]?.baselineAvg ?? 0, name: t('Baseline', '基线均值') }],
          },
          markPoint: {
            itemStyle: { color: '#dc2626' },
            data: d.points
              .filter((p) => p.isAnomaly)
              .map((p) => ({
                name: p.bucket,
                coord: [p.bucket, p.count],
                value: `Z=${p.zScore}`,
              })),
          },
          data: d.points.map((p) => p.count),
        },
      ],
    };
  }, [a?.anomalyDetection.data, t]);

  // L2-15 Window Term Shift diverging bar chart
  const shiftOpt: EChartOption | null = useMemo(() => {
    const d = a?.windowTermShifts.data;
    if (!d) return null;
    const merged = [...d.falling.slice(0, 6).reverse(), ...d.rising.slice(0, 6)];
    if (!merged.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 108, right: 42, top: 10, bottom: 18 },
      xAxis: { type: 'value', axisLabel: { formatter: '{value}pp', fontSize: 10 } },
      yAxis: { type: 'category', data: merged.map((m) => m.term), axisLabel: { fontSize: 11 } },
      series: [
        {
          type: 'bar',
          barMaxWidth: 16,
          data: merged.map((m) => ({
            value: m.deltaPctPoints,
            itemStyle: {
              color: m.deltaPctPoints >= 0 ? '#16a34a' : '#dc2626',
              borderRadius: m.deltaPctPoints >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          })),
        },
      ],
    };
  }, [a?.windowTermShifts.data]);

  const resolvedGroup = useMemo(() => {
    if (!data || !a || data.scope.emptySelection) return null;
    const activeRules = section === 'all' ? ALL_L2_RULES : ALL_L2_RULES.filter((r) => r.section === section);
    return resolvePanelGroup(activeRules, data, overrides, t);
  }, [data, a, section, overrides, t]);

  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <Card key={n} className="p-4">
              <Skeleton className="mb-3 h-5 w-44" />
              <Skeleton className="h-[240px] w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm font-medium text-destructive">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('Retry L2 Analysis', '重试比较与主题计算')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || !a || data.scope.emptySelection) {
    return (
      <Empty
        icon={<GitCompare size={24} />}
        title={t('Select targets or batches to start L2 comparison', '请选择关键词或批次后再开始比较与主题探索')}
        description={t('L2 includes n-grams, TF-IDF, co-occurrence, multi-object Jaccard overlap, and spike detection.', '涵盖词频与 N-Gram、TF-IDF、共现热力图、对象与批次对比、Jaccard 重叠矩阵以及爆发点探测。')}
      />
    );
  }

  const renderFullL2Panel = (panel: EvaluatedPanel, headerExtras: React.ReactNode) => {
    switch (panel.id) {
      case 'l2.unigrams':
        return (
          <AnalysisChartCard
            title={t('High-Frequency Terms (Unigrams)', '高频词（Unigram）')}
            subtitle={t('Click bar to inspect matching posts in Content Explorer', '点击词条下钻查看含该词的原帖')}
            block={a.unigrams}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={unigramOpt}
            height={270}
            headerExtras={headerExtras}
            columns={[
              { key: 'term', label: t('Term', '词条') },
              { key: 'docCount', label: t('Docs', '命中内容数') },
              { key: 'termCount', label: t('Mentions', '总出现次数') },
              { key: 'sharePct', label: t('Share %', '覆盖率%') },
            ]}
            rows={a.unigrams.data.items.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
            onChartEvents={{
              click: (params) => {
                const name = (params as { name?: string })?.name;
                if (name) onTraceToSearch({ query: name }, `${t('Term', '高频词')}: ${name}`);
              },
            }}
          />
        );
      case 'l2.tfidf':
        return (
          <AnalysisChartCard
            title={t('TF-IDF Distinctive Keywords', 'TF-IDF 特征词排行')}
            subtitle={t('Surfaces domain-specific terms over ubiquitous filler words', '抑制泛滥常用词，突出高信息量主题词')}
            block={a.tfidf}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={tfidfOpt}
            height={270}
            headerExtras={headerExtras}
            columns={[
              { key: 'term', label: t('Term', '特征词') },
              { key: 'avgScore', label: t('Avg TF-IDF', '平均 TF-IDF') },
              { key: 'docCount', label: t('Docs', '命中条数') },
              { key: 'sharePct', label: t('Share %', '占比%') },
            ]}
            rows={a.tfidf.data.items.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
            onChartEvents={{
              click: (params) => {
                const name = (params as { name?: string })?.name;
                if (name) onTraceToSearch({ query: name }, `TF-IDF: ${name}`);
              },
            }}
          />
        );
      case 'l2.bigrams':
        return (
          <AnalysisChartCard
            title={t('Two-Word Phrases (Bigrams)', '高频二元短语（Bigram）')}
            subtitle={t('Adjacent word pairs across English & Chinese phrases', '相邻双词短语频率统计')}
            block={a.bigrams}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={bigramOpt}
            height={250}
            headerExtras={headerExtras}
            columns={[
              { key: 'term', label: t('Bigram', '二元词组') },
              { key: 'docCount', label: t('Docs', '命中内容数') },
              { key: 'termCount', label: t('Mentions', '出现次数') },
              { key: 'sharePct', label: t('Share %', '覆盖率%') },
            ]}
            rows={a.bigrams.data.items.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.trigrams':
        return (
          <AnalysisChartCard
            title={t('Three-Word Expressions (Trigrams)', '高频三元短语（Trigram）')}
            subtitle={t('Recurring 3-token collocations', '连续三词共现短语排行')}
            block={a.trigrams}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={trigramOpt}
            height={250}
            headerExtras={headerExtras}
            columns={[
              { key: 'term', label: t('Trigram', '三元表达') },
              { key: 'docCount', label: t('Docs', '命中内容数') },
              { key: 'termCount', label: t('Mentions', '出现次数') },
              { key: 'sharePct', label: t('Share %', '覆盖率%') },
            ]}
            rows={a.trigrams.data.items.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.cooccurrence':
        return (
          <AnalysisChartCard
            title={t('Term Co-occurrence Heatmap', '关键词共现矩阵与强度')}
            subtitle={t('Pairs appearing together in the same post/comment', '统计同文档共现频次及 Lift 关联提升度')}
            block={a.cooccurrence}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={coocOpt}
            height={330}
            headerExtras={headerExtras}
            columns={[
              { key: 'termA', label: t('Term A', '词 A') },
              { key: 'termB', label: t('Term B', '词 B') },
              { key: 'coCount', label: t('Co-occurrences', '共现条数') },
              { key: 'lift', label: 'Lift' },
            ]}
            rows={a.cooccurrence.data.topPairs.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.objectCounts':
        return (
          <AnalysisChartCard
            title={t('Object Volume & Exclusivity Comparison', '对比对象声量与独占对比')}
            subtitle={t('Exclusive vs shared content counts across targets or batches', '区分各研究对象的独占条数与跨对象重叠条数')}
            block={a.objectCounts}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={objCountOpt}
            height={270}
            headerExtras={headerExtras}
            columns={[
              { key: 'label', label: t('Object', '对比对象') },
              { key: 'contentCount', label: t('Total Items', '总内容数') },
              { key: 'exclusiveCount', label: t('Exclusive', '独占条数') },
              { key: 'overlapCount', label: t('Overlap', '重叠条数') },
              { key: 'avgEngagementScore', label: t('Avg Eng', '篇均互动分') },
            ]}
            rows={a.objectCounts.data.rows.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.objectTrends':
        return (
          <AnalysisChartCard
            title={t('Multi-Series Trend Over Time', '多对象时间趋势对比')}
            subtitle={t('Daily discussion trajectory across selected objects', '对比多个研究对象的每日声量走势与占比变化')}
            block={a.objectTrends}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={objTrendOpt}
            height={270}
            headerExtras={headerExtras}
            controls={
              <ToggleGroup value={[objTrendMode]} onValueChange={(vals) => vals[0] && setObjTrendMode(vals[0] as 'count' | 'share')}>
                <ToggleGroupItem value="count">{t('Count', '绝对数量')}</ToggleGroupItem>
                <ToggleGroupItem value="share">{t('Share %', '占比 %')}</ToggleGroupItem>
              </ToggleGroup>
            }
            columns={[
              { key: 'bucket', label: t('Date', '日期') },
              { key: 'totalCount', label: t('Total', '当日总计') },
            ]}
            rows={a.objectTrends.data.points.map((r) => ({ bucket: r.bucket, totalCount: r.totalCount }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.objectPlatformMatrix':
        return (
          <AnalysisChartCard
            title={t('Object × Platform Matrix', '对比对象 × 平台交叉分布')}
            subtitle={t('Platform mix across each keyword or batch', '对比不同对象在各社媒平台的来源重心')}
            block={a.objectPlatformMatrix}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={platMatrixOpt}
            height={260}
            headerExtras={headerExtras}
            controls={
              <ToggleGroup value={[matrixMetric]} onValueChange={(vals) => vals[0] && setMatrixMetric(vals[0] as 'count' | 'share')}>
                <ToggleGroupItem value="count">{t('Matrix: Count', '数量')}</ToggleGroupItem>
                <ToggleGroupItem value="share">{t('Matrix: Row %', '占比%')}</ToggleGroupItem>
              </ToggleGroup>
            }
            columns={[
              { key: 'objectLabel', label: t('Object', '对象') },
              { key: 'colLabel', label: t('Platform', '平台') },
              { key: 'count', label: t('Count', '条数') },
              { key: 'sharePct', label: t('Row Share %', '对象内占比%') },
            ]}
            rows={a.objectPlatformMatrix.data.cells.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.objectCommunityMatrix':
        return (
          <AnalysisChartCard
            title={t('Object × Community Matrix', '对比对象 × 社区分布矩阵')}
            subtitle={t('Top communities by object overlap', '展示各对比对象在前排核心社区的覆盖密度')}
            block={a.objectCommunityMatrix}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={commMatrixOpt}
            height={260}
            headerExtras={headerExtras}
            controls={
              <ToggleGroup value={[matrixMetric]} onValueChange={(vals) => vals[0] && setMatrixMetric(vals[0] as 'count' | 'share')}>
                <ToggleGroupItem value="count">{t('Matrix: Count', '数量')}</ToggleGroupItem>
                <ToggleGroupItem value="share">{t('Matrix: Row %', '占比%')}</ToggleGroupItem>
              </ToggleGroup>
            }
            columns={[
              { key: 'objectLabel', label: t('Object', '对象') },
              { key: 'colLabel', label: t('Community', '社区') },
              { key: 'count', label: t('Count', '条数') },
              { key: 'sharePct', label: t('Share %', '占比%') },
            ]}
            rows={a.objectCommunityMatrix.data.cells.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.overlapMatrix':
        return (
          <AnalysisChartCard
            title={t('Overlap & Jaccard Similarity Matrix', '内容重叠度与 Jaccard 矩阵')}
            subtitle={t('J(A, B) = |A ∩ B| / |A ∪ B| — measure target/batch redundancy', '按交并比 J(A,B)=|A∩B|/|A∪B| 衡量重合程度')}
            block={a.overlapMatrix}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={overlapOpt}
            height={280}
            headerExtras={headerExtras}
            columns={[
              { key: 'rowLabel', label: t('Object A', '对象 A') },
              { key: 'colLabel', label: t('Object B', '对象 B') },
              { key: 'intersectionCount', label: t('|A ∩ B|', '交集条数') },
              { key: 'unionCount', label: t('|A ∪ B|', '并集条数') },
              { key: 'jaccardPct', label: 'Jaccard %' },
            ]}
            rows={a.overlapMatrix.data.cells.filter((c) => c.rowKey <= c.colKey).map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.windowComparison':
        return (
          <AnalysisChartCard
            title={t('Time-Window Before vs After Comparison', '前后时间窗口指标对比')}
            subtitle={t('Compares sample volume and avg engagement across a split date', '对比选定分界日前后两个时段的内容与互动表现')}
            block={a.windowComparison}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={windowCompareOpt}
            height={280}
            headerExtras={headerExtras}
            controls={
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">{t('Split:', '分界日:')}</span>
                <input
                  type="date"
                  value={windowSplitAt}
                  onChange={(e) => onWindowSplitAtChange(e.target.value)}
                  className="h-6 rounded border border-input bg-background px-1.5 text-[11px]"
                />
              </div>
            }
            columns={[
              { key: 'label', label: t('Metric', '指标') },
              { key: 'previousValue', label: t('Before', '前半段') },
              { key: 'currentValue', label: t('After', '后半段') },
              { key: 'delta', label: t('Delta', '绝对变化') },
              { key: 'status', label: t('Trend', '方向') },
            ]}
            rows={a.windowComparison.data.metrics.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.objectDistinctiveTerms':
        return (
          <div className="space-y-3">
            <AnalysisChartCard
              title={t('Distinctive Terms per Object (Log-Odds Diff)', '多对象差异特征词对照')}
              subtitle={t('Terms disproportionately associated with each keyword or batch vs the rest', '按 Dirichlet Log-Odds 突出各对象独有关注点')}
              block={a.objectDistinctiveTerms}
              projectName={projectName}
              keywordLabels={keywordLabels}
              option={null}
              defaultView="table"
              headerExtras={headerExtras}
              columns={[
                { key: 'label', label: t('Object', '对象') },
                { key: 'term', label: t('Distinctive Term', '差异词') },
                { key: 'docCount', label: t('Docs', '组内命中') },
                { key: 'inGroupPct', label: t('Group %', '组内占比%') },
                { key: 'restPct', label: t('Rest %', '其余占比%') },
                { key: 'score', label: 'Log-Odds' },
              ]}
              rows={a.objectDistinctiveTerms.data.groups.flatMap((g) =>
                g.distinctiveTerms.map((dt) => ({ label: g.label, ...dt })),
              )}
              exportDisabled={exportDisabled}
            />
            {a.objectDistinctiveTerms.data.groups.length > 0 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {a.objectDistinctiveTerms.data.groups.map((grp) => (
                  <Card key={grp.objectKey} className="p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">{grp.label}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">{grp.contentCount}</Badge>
                    </div>
                    {grp.distinctiveTerms.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">{t('No distinctive terms yet.', '暂无显著差异特征词。')}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {grp.distinctiveTerms.map((dt) => (
                          <button
                            key={dt.term}
                            type="button"
                            onClick={() => onTraceToSearch({ query: dt.term }, `${grp.label}: ${dt.term}`)}
                            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] hover:border-primary/60 hover:text-primary"
                            title={`${t('In group', '组内')}: ${dt.inGroupPct}% vs ${t('Rest', '其余')}: ${dt.restPct}%`}
                          >
                            <span>{dt.term}</span>
                            <span className="font-mono text-[9.5px] text-muted-foreground">+{dt.score.toFixed(1)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        );
      case 'l2.hotTermTrends':
        return (
          <AnalysisChartCard
            title={t('Top Hot Terms Over Time', '高频热词逐日趋势')}
            subtitle={t('Daily frequency curves of top scope keywords', '追踪核心热词在各时间桶的提及走势')}
            block={a.hotTermTrends}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={hotTermsOpt}
            height={270}
            headerExtras={headerExtras}
            columns={[
              { key: 'term', label: t('Term', '热词') },
              { key: 'totalDocCount', label: t('Total Docs', '总命中数') },
              { key: 'growthPct', label: t('Period Growth %', '首尾增幅%') },
            ]}
            rows={a.hotTermTrends.data.series.map((s) => ({ term: s.term, totalDocCount: s.totalDocCount, growthPct: s.growthPct }))}
            exportDisabled={exportDisabled}
          />
        );
      case 'l2.anomalyDetection':
        return (
          <AnalysisChartCard
            title={t('Volume Spike & Anomaly Detection', '内容爆发点与异常探测')}
            subtitle={t('Z-score spikes mark days above baseline; click point to view evidence', '标记显著偏离基线均值的时间峰值，点击钻取当天证据')}
            block={a.anomalyDetection}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={anomalyOpt}
            height={270}
            headerExtras={headerExtras}
            controls={
              <Select
                value={sensitivity}
                onChange={(e) => onSensitivityChange(e.target.value as 'low' | 'medium' | 'high')}
                className="h-7 w-28 text-[11px]"
              >
                <option value="high">{t('High (Z≥1.5)', '高敏感 Z≥1.5')}</option>
                <option value="medium">{t('Medium (Z≥2.0)', '中敏感 Z≥2.0')}</option>
                <option value="low">{t('Low (Z≥2.5)', '低敏感 Z≥2.5')}</option>
              </Select>
            }
            columns={[
              { key: 'bucket', label: t('Date', '日期') },
              { key: 'count', label: t('Count', '内容数') },
              { key: 'baselineAvg', label: t('Baseline', '基线均值') },
              { key: 'zScore', label: 'Z-Score' },
              { key: 'direction', label: t('Status', '状态') },
            ]}
            rows={a.anomalyDetection.data.points.map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
            onChartEvents={{
              click: (params) => {
                const name = (params as { name?: string })?.name;
                if (!name) return;
                const dayMs = Date.parse(`${name}T00:00:00.000Z`);
                if (!Number.isFinite(dayMs)) return;
                onTraceToSearch(
                  { from: `${name}T00:00:00.000Z`, to: new Date(dayMs + 86_400_000).toISOString() },
                  `${t('Spike Date', '爆发日期')}: ${name}`,
                );
              },
            }}
          />
        );
      case 'l2.windowTermShifts':
      default:
        return (
          <AnalysisChartCard
            title={t('Time-Window Lexical Shift (Rising vs Falling Terms)', '时间窗词频跃升 / 回落对比')}
            subtitle={t('Percentage-point share change before vs after the split date', '对比时间分界前后的讨论占比变化（百分点）')}
            block={a.windowTermShifts}
            projectName={projectName}
            keywordLabels={keywordLabels}
            option={shiftOpt}
            height={290}
            headerExtras={headerExtras}
            columns={[
              { key: 'term', label: t('Term', '词条') },
              { key: 'direction', label: t('Direction', '变化方向') },
              { key: 'beforeSharePct', label: t('Before %', '前期占比%') },
              { key: 'afterSharePct', label: t('After %', '后期占比%') },
              { key: 'deltaPctPoints', label: t('Delta (pp)', '变化百分点') },
            ]}
            rows={[...a.windowTermShifts.data.rising, ...a.windowTermShifts.data.falling].map((r) => ({ ...r }))}
            exportDisabled={exportDisabled}
          />
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* L2 Section & Comparison Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <ToggleGroup value={[section]} onValueChange={(vals) => vals[0] && setSection(vals[0] as typeof section)}>
            <ToggleGroupItem value="all">{t('All (15)', '全部 15 项')}</ToggleGroupItem>
            <ToggleGroupItem value="text">{t('Text Features (5)', '文本特征')}</ToggleGroupItem>
            <ToggleGroupItem value="compare">{t('Comparison (7)', '多维比较')}</ToggleGroupItem>
            <ToggleGroupItem value="change">{t('Change & Spikes (3)', '变化探索')}</ToggleGroupItem>
          </ToggleGroup>

          <ToggleGroup value={[compareMode]} onValueChange={(vals) => vals[0] && onCompareModeChange(vals[0] as 'target' | 'batch')}>
            <ToggleGroupItem value="target">{t('By Keyword/Target', '按关键词对比')}</ToggleGroupItem>
            <ToggleGroupItem value="batch">{t('By Batch', '按数据批次对比')}</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {data.isSampled && (
            <Badge variant="outline">
              {t(`Text sampled ${data.sampledCount}/${data.totalInScope}`, `文本抽样 ${data.sampledCount}/${data.totalInScope} 条（结构对比为全量）`)}
            </Badge>
          )}
          <Badge variant="secondary">
            {data.cacheStatus === 'hit' ? t('PG16 Cache Hit', '命中 PG16 缓存') : t('Fresh Computed', '实时计算')}
          </Badge>
        </div>
      </div>

      {resolvedGroup && (
        <AdaptiveLayerLayout
          group={resolvedGroup}
          onSetOverride={setOverride}
          onClearOverride={clearOverride}
          onResetAll={resetLayer}
          renderFullPanel={renderFullL2Panel}
        />
      )}
    </div>
  );
}
