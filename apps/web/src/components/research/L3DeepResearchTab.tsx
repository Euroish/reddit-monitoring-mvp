import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  formatApiError,
  useCancelResearchTaskMutation,
  useCreateResearchTaskMutation,
  useDeleteResearchTaskMutation,
  useResearchTasksQuery,
  useRetryResearchTaskMutation,
} from '@/api/hooks';
import type {
  AnalysisBlock,
  AnalysisScopeRequest,
  L3ResearchTaskRecord,
  L3SentimentSummary,
  L3TopicSummary,
} from '@/contracts/research';
import { useI18n } from '@/i18n/translations';
import { useChartColors } from '../charts/chartUtils';
import type { EChartOption } from '../charts/EChartBox';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Empty } from '../ui/empty';
import { Progress } from '../ui/progress';
import { Select } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { AdaptiveLayerLayout } from './AdaptivePanelLayout';
import { AnalysisChartCard } from './AnalysisChartCard';
import {
  L3_SENTIMENT_PANEL_RULES,
  L3_TOPIC_PANEL_RULES,
  resolvePanelGroup,
  usePanelPreferences,
  type EvaluatedPanel,
} from './panelRegistry';

const L3_PANEL_IDS = [
  ...L3_SENTIMENT_PANEL_RULES.map((r) => r.id),
  ...L3_TOPIC_PANEL_RULES.map((r) => r.id),
];

const SENTIMENT_COLORS: Record<'positive' | 'neutral' | 'negative' | 'unclassified', string> = {
  positive: '#16a34a',
  neutral: '#64748b',
  negative: '#dc2626',
  unclassified: '#cbd5e1',
};

export function L3DeepResearchTab({
  projectId,
  projectName,
  scope,
  dataVersion,
  keywordLabels,
  exportDisabled,
  onOpenContentDetail,
  onTraceToSearch,
}: {
  projectId: string;
  projectName: string;
  scope: AnalysisScopeRequest;
  dataVersion?: string;
  keywordLabels: string[];
  exportDisabled?: boolean;
  onOpenContentDetail: (contentId: string) => void;
  onTraceToSearch: (extraQs: Record<string, string | string[] | undefined>, label?: string) => void;
}) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [sampleLimit, setSampleLimit] = useState<number>(3000);
  const [numTopics, setNumTopics] = useState<number>(5);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const { overrides, setOverride, clearOverride, resetLayer } = usePanelPreferences(projectId, L3_PANEL_IDS);

  const tasksQuery = useResearchTasksQuery(projectId, Boolean(projectId));
  const createMut = useCreateResearchTaskMutation(projectId);
  const cancelMut = useCancelResearchTaskMutation(projectId);
  const retryMut = useRetryResearchTaskMutation(projectId);
  const deleteMut = useDeleteResearchTaskMutation(projectId);

  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data?.tasks]);
  const activeTask: L3ResearchTaskRecord | undefined = useMemo(() => {
    if (selectedTaskId) {
      const hit = tasks.find((tk) => tk.id === selectedTaskId);
      if (hit) return hit;
    }
    return tasks.find((tk) => tk.status === 'succeeded') ?? tasks[0];
  }, [tasks, selectedTaskId]);

  const handleLaunch = async (taskType: 'sentiment' | 'topic_modeling') => {
    setActionError(null);
    try {
      const res = await createMut.mutateAsync({
        taskType,
        scope,
        config: {
          sampleLimit,
          ...(taskType === 'topic_modeling' ? { numTopics, maxVocab: 400 } : {}),
        },
      });
      setSelectedTaskId(res.task.id);
    } catch (err) {
      setActionError(formatApiError(err));
    }
  };

  const sentimentSummary =
    activeTask?.status === 'succeeded' && activeTask.summary?.taskType === 'sentiment'
      ? (activeTask.summary as L3SentimentSummary)
      : null;

  const topicSummary =
    activeTask?.status === 'succeeded' && activeTask.summary?.taskType === 'topic_modeling'
      ? (activeTask.summary as L3TopicSummary)
      : null;

  const sentimentDistOption: EChartOption | null = useMemo(() => {
    if (!sentimentSummary || sentimentSummary.sampleCount === 0) return null;
    const labels: Record<'positive' | 'neutral' | 'negative' | 'unclassified', string> = {
      positive: t('Positive', '正面'),
      neutral: t('Neutral / Mixed', '中性/混合'),
      negative: t('Negative', '负面'),
      unclassified: t('Unclassified', '未判（无词典命中）'),
    };
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      series: [
        {
          type: 'pie',
          radius: ['42%', '72%'],
          center: ['50%', '44%'],
          itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
          label: { fontSize: 11, formatter: '{b} {d}%' },
          data: sentimentSummary.counts.map((c) => ({
            name: labels[c.label],
            rawKey: c.label,
            value: c.count,
            itemStyle: { color: SENTIMENT_COLORS[c.label] },
          })),
        },
      ],
    };
  }, [sentimentSummary, t]);

  const sentimentTrendOption: EChartOption | null = useMemo(() => {
    if (!sentimentSummary || !sentimentSummary.trend.length) return null;
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { fontSize: 11 } },
      grid: { left: 42, right: 16, top: 14, bottom: 38 },
      xAxis: { type: 'category', data: sentimentSummary.trend.map((pt) => pt.bucket), axisLabel: { fontSize: 10.5 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        { name: t('Positive', '正面'), type: 'bar', stack: 's', itemStyle: { color: SENTIMENT_COLORS.positive }, data: sentimentSummary.trend.map((p) => p.positive) },
        { name: t('Neutral', '中性'), type: 'bar', stack: 's', itemStyle: { color: SENTIMENT_COLORS.neutral }, data: sentimentSummary.trend.map((p) => p.neutral) },
        { name: t('Negative', '负面'), type: 'bar', stack: 's', itemStyle: { color: SENTIMENT_COLORS.negative }, data: sentimentSummary.trend.map((p) => p.negative) },
        { name: t('Unclassified', '未判'), type: 'bar', stack: 's', itemStyle: { color: SENTIMENT_COLORS.unclassified }, data: sentimentSummary.trend.map((p) => p.unclassified) },
      ],
    };
  }, [sentimentSummary, t]);

  const topicBarOption: EChartOption | null = useMemo(() => {
    if (!topicSummary || !topicSummary.topics.length) return null;
    const rev = [...topicSummary.topics].reverse();
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 165, right: 44, top: 10, bottom: 18 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: {
        type: 'category',
        data: rev.map((tp) => tp.label),
        axisLabel: { width: 152, overflow: 'truncate', fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 20,
          itemStyle: { color: colors.purple, borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10.5 },
          data: rev.map((tp) => ({ value: tp.docCount, topicIndex: tp.topicIndex })),
        },
      ],
    };
  }, [topicSummary, colors.purple]);

  const mkL3Block = <T,>(
    analysisId: string,
    groupingBasis: 'sentiment' | 'topic',
    sampleCount: number,
    dataPayload: T,
    summaryText: string,
    summaryBullets: string[],
    notes: string[],
  ): AnalysisBlock<T> => ({
    analysisId,
    methodVersion: activeTask?.algorithmVersion ?? '1.0.0',
    projectId,
    scope: activeTask?.scope ?? {
      selectedSourceIds: scope.sourceIds ?? [],
      selectedBatchIds: scope.batchIds ?? [],
      emptySelection: false,
      timeBasis: scope.timeBasis ?? 'published',
      platforms: scope.platforms ?? [],
      kinds: scope.kinds ?? [],
      communities: scope.communities ?? [],
      languages: scope.languages ?? [],
      threadAware: scope.threadAware ?? true,
      bucket: scope.bucket ?? 'day',
      includeUndated: scope.includeUndated ?? true,
    },
    dataVersion: activeTask?.dataVersion ?? dataVersion ?? 'current',
    sampleCount,
    coverage: {
      model: 'partial_sample',
      label: t(`Task sampled up to ${activeTask?.sampleLimit ?? sampleLimit} items`, `按任务上限采样最多 ${activeTask?.sampleLimit ?? sampleLimit} 条`),
      datedCount: sampleCount,
      undatedCount: 0,
      isCompleteScope: sampleCount < (activeTask?.sampleLimit ?? sampleLimit),
    },
    methodology: {
      dedupBasis: 'canonical_content_id',
      groupingBasis,
      denominatorLabel: t('Task Sampled Items', '深入分析任务样本总数'),
      denominatorValue: sampleCount,
      multiMembershipAllowed: false,
      notes,
    },
    summaryText,
    summaryBullets,
    data: dataPayload,
    generatedAt: activeTask?.finishedAt ?? activeTask?.createdAt ?? new Date().toISOString(),
    status: sampleCount === 0 ? 'empty' : 'ok',
  });

  const statusBadge = (st: L3ResearchTaskRecord['status']) => {
    if (st === 'succeeded') return <Badge variant="secondary" className="gap-1 text-emerald-700"><CheckCircle2 size={11} />{t('Succeeded', '已完成')}</Badge>;
    if (st === 'running') return <Badge variant="secondary" className="gap-1 text-blue-700"><Loader2 size={11} className="animate-spin" />{t('Running', '运行中')}</Badge>;
    if (st === 'queued') return <Badge variant="outline" className="gap-1"><Clock size={11} />{t('Queued', '排队中')}</Badge>;
    if (st === 'cancelled') return <Badge variant="outline" className="gap-1 text-muted-foreground"><XCircle size={11} />{t('Cancelled', '已取消')}</Badge>;
    return <Badge variant="destructive" className="gap-1"><AlertTriangle size={11} />{t('Failed', '失败')}</Badge>;
  };

  const sentimentGroup = useMemo(() => {
    if (!sentimentSummary) return null;
    return resolvePanelGroup(L3_SENTIMENT_PANEL_RULES, sentimentSummary, overrides, t);
  }, [sentimentSummary, overrides, t]);

  const topicGroup = useMemo(() => {
    if (!topicSummary) return null;
    return resolvePanelGroup(L3_TOPIC_PANEL_RULES, topicSummary, overrides, t);
  }, [topicSummary, overrides, t]);

  const renderSentimentPanel = (panel: EvaluatedPanel, headerExtras: React.ReactNode) => {
    if (!sentimentSummary || !activeTask) return null;
    if (panel.id === 'l3.sentimentDist') {
      return (
        <AnalysisChartCard
          title={t('Sentiment Polarity Distribution', '情感极性分布（含未判样本）')}
          subtitle={t('Click a slice to inspect evidence in Content Explorer', '点击扇区下钻查看对应情感倾向的原文证据')}
          block={mkL3Block(
            'L3-SENTIMENT-01',
            'sentiment',
            sentimentSummary.sampleCount,
            sentimentSummary.counts,
            sentimentSummary.summaryText,
            sentimentSummary.summaryBullets,
            [
              t('Honest unclassified reporting: items with zero lexicon matches are never forced to neutral.', '未命中词典的客观或无态度文本保持为 unclassified（未判），不强行归入中性。'),
            ],
          )}
          projectName={projectName}
          keywordLabels={keywordLabels}
          option={sentimentDistOption}
          height={270}
          headerExtras={headerExtras}
          columns={[
            { key: 'label', label: t('Polarity', '极性') },
            { key: 'count', label: t('Count', '条数') },
            { key: 'sharePct', label: t('Share %', '占比%') },
          ]}
          rows={sentimentSummary.counts.map((c) => ({ ...c }))}
          exportDisabled={exportDisabled}
          onChartEvents={{
            click: (params) => {
              const p = params as { name?: string; data?: { rawKey?: string } };
              const rawKey = p?.data?.rawKey;
              if (!rawKey) return;
              onTraceToSearch(
                { analysisTaskId: activeTask.id, sentiment: rawKey },
                `${t('Sentiment', '情感倾向')}: ${p.name ?? rawKey}`,
              );
            },
          }}
        />
      );
    }
    if (panel.id === 'l3.sentimentTrend') {
      return (
        <AnalysisChartCard
          title={t('Sentiment Over Time', '情感倾向时间演变趋势')}
          subtitle={t('Daily sentiment polarity shift across analyzed samples', '按日追踪正面、负面与未判讨论的此消彼长')}
          block={mkL3Block(
            'L3-SENTIMENT-02',
            'sentiment',
            sentimentSummary.sampleCount,
            sentimentSummary.trend,
            t('Tracks daily shifts across positive, neutral, negative, and unclassified buckets.', '按日追踪正面、负面与未判讨论的此消彼长。'),
            [],
            [],
          )}
          projectName={projectName}
          keywordLabels={keywordLabels}
          option={sentimentTrendOption}
          height={270}
          headerExtras={headerExtras}
          columns={[
            { key: 'bucket', label: t('Date', '日期') },
            { key: 'positive', label: t('Positive', '正面') },
            { key: 'neutral', label: t('Neutral', '中性') },
            { key: 'negative', label: t('Negative', '负面') },
            { key: 'unclassified', label: t('Unclassified', '未判') },
          ]}
          rows={sentimentSummary.trend.map((r) => ({ ...r }))}
          exportDisabled={exportDisabled}
        />
      );
    }
    return (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-xs font-semibold">{t('Strongest Sentiment Exemplars', '高分正面 / 负面代表性样本')}</CardTitle>
          <div className="flex items-center gap-1.5">{headerExtras}</div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {sentimentSummary.exemplars.map((ex) => (
            <button
              key={ex.contentId}
              type="button"
              onClick={() => onOpenContentDetail(ex.contentId)}
              className="flex flex-col gap-1 rounded-lg border border-border/80 bg-muted/15 p-2.5 text-left transition hover:border-primary/60"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className={ex.label === 'positive' ? 'border-emerald-400 text-emerald-700' : 'border-red-400 text-red-700'}
                >
                  {ex.label === 'positive' ? t('Positive', '正面') : t('Negative', '负面')} ({ex.score.toFixed(2)})
                </Badge>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">{ex.platform}</span>
              </div>
              {ex.title && <div className="line-clamp-1 text-xs font-semibold text-foreground">{ex.title}</div>}
              <p className="line-clamp-2 text-[11px] text-muted-foreground">{ex.excerpt}</p>
            </button>
          ))}
        </CardContent>
      </Card>
    );
  };

  const renderTopicPanel = (panel: EvaluatedPanel, headerExtras: React.ReactNode) => {
    if (!topicSummary || !activeTask) return null;
    if (panel.id === 'l3.topicsChart') {
      return (
        <AnalysisChartCard
          title={t('NMF Topic Share Distribution', 'NMF 主题分布与核心词簇')}
          subtitle={t('Click any topic bar to view matching content in Content Explorer', '点击主题柱条在内容检索中查看该主题下全部证据样本')}
          block={mkL3Block(
            'L3-TOPICS-01',
            'topic',
            topicSummary.sampleCount,
            topicSummary.topics,
            topicSummary.summaryText,
            topicSummary.summaryBullets,
            [
              t(`Deterministic NMF over normalized TF-IDF matrix (${topicSummary.vocabularySize} vocab terms).`, `基于归一化 TF-IDF 词袋矩阵的确定性非负矩阵分解（词表 ${topicSummary.vocabularySize} 词）。`),
            ],
          )}
          projectName={projectName}
          keywordLabels={keywordLabels}
          option={topicBarOption}
          height={Math.max(240, topicSummary.topics.length * 42)}
          headerExtras={headerExtras}
          columns={[
            { key: 'topicIndex', label: '#' },
            { key: 'label', label: t('Topic', '主题名称') },
            { key: 'docCount', label: t('Docs', '命中条数') },
            { key: 'sharePct', label: t('Share %', '占比%') },
            { key: 'avgScore', label: t('Avg Cohesion', '平均归属分') },
          ]}
          rows={topicSummary.topics.map((tp) => ({
            topicIndex: tp.topicIndex,
            label: tp.label,
            docCount: tp.docCount,
            sharePct: tp.sharePct,
            avgScore: tp.avgScore,
          }))}
          exportDisabled={exportDisabled}
          onChartEvents={{
            click: (params) => {
              const p = params as { name?: string; data?: { topicIndex?: number } };
              const topicIdx = p?.data?.topicIndex;
              if (topicIdx === undefined) return;
              onTraceToSearch(
                { analysisTaskId: activeTask.id, topicIndex: String(topicIdx) },
                p?.name ?? `${t('Topic', '主题')} ${topicIdx + 1}`,
              );
            },
          }}
        />
      );
    }
    return (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="text-xs font-semibold">{t('Topic Keyword Weights & Representative Excerpts', '主题关键词权重与代表样本明细')}</CardTitle>
          <div className="flex items-center gap-1.5">{headerExtras}</div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {topicSummary.topics.map((tp) => (
            <Card key={tp.topicIndex} className="flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-xs font-semibold text-foreground">{tp.label}</CardTitle>
                  <Badge variant="secondary" className="font-mono text-[10.5px]">
                    {tp.docCount} ({tp.sharePct}%)
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2.5 text-xs">
                <div className="flex flex-wrap gap-1">
                  {tp.topTerms.map((term) => (
                    <Badge key={term.term} variant="outline" className="text-[10.5px] font-normal">
                      {term.term} <span className="ml-1 font-mono text-[9.5px] text-muted-foreground">{(term.weight * 100).toFixed(1)}%</span>
                    </Badge>
                  ))}
                </div>
                <div className="space-y-1.5">
                  {tp.representativeExcerpts.slice(0, 2).map((ex) => (
                    <button
                      key={ex.contentId}
                      type="button"
                      onClick={() => onOpenContentDetail(ex.contentId)}
                      className="block w-full rounded border border-border/60 bg-muted/20 p-2 text-left hover:border-primary/60"
                    >
                      {ex.title && <div className="line-clamp-1 text-[11px] font-medium text-foreground">{ex.title}</div>}
                      <div className="line-clamp-2 text-[10.5px] text-muted-foreground">{ex.excerpt}</div>
                    </button>
                  ))}
                </div>
                <div className="flex justify-end pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      onTraceToSearch(
                        { analysisTaskId: activeTask.id, topicIndex: String(tp.topicIndex) },
                        tp.label,
                      )
                    }
                  >
                    <span>{t('Inspect topic items in Search', '在内容检索中查看该主题')}</span>
                    <ArrowRight size={11} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* L3 Tool Launch Catalog */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles size={15} className="text-primary" />
                <span>{t('Deep Research Tools (On-Demand Background Tasks)', '按需触发型深度分析工具')}</span>
              </CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(
                  'Runs asynchronously over the currently applied Research Scope without consuming quota unless launched. Results persist in PostgreSQL with data-version tracking.',
                  '基于当前已应用的「研究范围」后台异步计算并持久化存储结果，不随页面切换自动重算；若范围数据发生变化会提示版本过期。',
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t('Sample Limit:', '样本上限')}</span>
              <Select
                value={String(sampleLimit)}
                onChange={(e) => setSampleLimit(Number(e.target.value))}
                className="h-7 w-28 text-xs"
              >
                <option value="500">500 {t('items', '条')}</option>
                <option value="2000">2,000 {t('items', '条')}</option>
                <option value="3000">3,000 {t('items', '条')}</option>
                <option value="5000">5,000 {t('items', '条')}</option>
                <option value="10000">10,000 {t('items', '条')}</option>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* Tool 1: Sentiment Analysis */}
          <div className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3.5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Brain size={14} className="text-primary" />
                  <span>{t('Bilingual Sentiment Classification', '中英双语情感倾向分析')}</span>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">lexicon_bilingual_v1</Badge>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {t(
                  'Detects positive, neutral/mixed, negative polarity with negation & intensifier handling. Items without sentiment cues are reported transparently as unclassified.',
                  '结合中英文正负词典、否定前缀翻转与程度副词加权对帖文与评论打分；客观陈述或无词典命中的样本如实归为“未判”。',
                )}
              </p>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-muted-foreground">{t('Async queue · Cancelable', '后台队列 · 支持中断')}</span>
              <Button
                type="button"
                size="sm"
                disabled={createMut.isPending}
                onClick={() => void handleLaunch('sentiment')}
              >
                <Play size={12} />
                <span>{t('Run Sentiment Task', '发起情感分析')}</span>
              </Button>
            </div>
          </div>

          {/* Tool 2: NMF Topic Modeling */}
          <div className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3.5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Layers size={14} className="text-primary" />
                  <span>{t('Topic Discovery (Deterministic NMF)', '潜在主题发现（NMF 矩阵分解）')}</span>
                </div>
                <Badge variant="outline" className="font-mono text-[10px]">nmf_tfidf_v1</Badge>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {t(
                  'Discovers latent discussion clusters over TF-IDF vectors cleanly inside Node/TS, extracting top keywords and representative evidence per topic.',
                  '基于 TF-IDF 加权词袋矩阵进行确定性非负矩阵分解，自动聚出隐含讨论话题、核心词汇权重与代表性原帖证据。',
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">{t('Topics (K):', '主题数 K:')}</span>
                <Select
                  value={String(numTopics)}
                  onChange={(e) => setNumTopics(Number(e.target.value))}
                  className="h-7 w-20 text-xs"
                >
                  <option value="3">3</option>
                  <option value="5">5</option>
                  <option value="7">7</option>
                  <option value="10">10</option>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={createMut.isPending}
                onClick={() => void handleLaunch('topic_modeling')}
              >
                <Play size={12} />
                <span>{t('Run Topic Discovery', '发起主题发现')}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {actionError && (
        <div className="wb-alert wb-alert--error">{actionError}</div>
      )}

      {/* Task Queue & History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Analysis Task History & Live Queue', '任务队列与历史分析结果')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tasksQuery.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : tasks.length === 0 ? (
            <Empty
              icon={<Brain size={20} />}
              title={t('No deep research tasks yet', '当前项目尚未运行过深入分析任务')}
              description={t('Launch Sentiment Classification or Topic Discovery above whenever needed.', '在上方选择需要深入挖掘的分析工具后点击发起即可。')}
            />
          ) : (
            <div className="space-y-2">
              {tasks.map((tk) => {
                const isSelected = activeTask?.id === tk.id;
                const isActive = tk.status === 'queued' || tk.status === 'running';
                return (
                  <div
                    key={tk.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs transition ${
                      isSelected ? 'border-primary/70 bg-primary/5' : 'border-border bg-card hover:bg-muted/20'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedTaskId(tk.id)}
                          className="font-semibold text-foreground hover:text-primary"
                        >
                          {tk.taskType === 'sentiment'
                            ? t('Sentiment Classification', '情感倾向分析')
                            : t('Topic Discovery', '潜在主题发现')}
                        </button>
                        {statusBadge(tk.status)}
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {new Date(tk.createdAt).toLocaleString()}
                        </span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {tk.sampleCount > 0 ? `${tk.sampleCount} ${t('items', '条')}` : `≤${tk.sampleLimit}`}
                        </Badge>
                        {tk.isStale && (
                          <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px]">
                            {t('Stale dataVersion', '数据版本已变更')}
                          </Badge>
                        )}
                      </div>
                      {isActive && (
                        <div className="flex items-center gap-2">
                          <Progress value={tk.progressPct} className="h-1.5 flex-1" />
                          <span className="font-mono text-[10.5px] text-muted-foreground">
                            {tk.progressPct}% · {tk.progressStage}
                          </span>
                        </div>
                      )}
                      {tk.errorMessage && (
                        <p className="text-[11px] text-destructive">{tk.errorMessage}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {tk.status === 'succeeded' && (
                        <Button
                          type="button"
                          variant={isSelected ? 'default' : 'outline'}
                          size="xs"
                          onClick={() => setSelectedTaskId(tk.id)}
                        >
                          {isSelected ? t('Viewing', '当前查看') : t('View Result', '查看结果')}
                        </Button>
                      )}
                      {isActive && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={cancelMut.isPending}
                          onClick={() => void cancelMut.mutateAsync(tk.id)}
                        >
                          <Square size={10} />
                          <span>{t('Cancel', '取消')}</span>
                        </Button>
                      )}
                      {(tk.status === 'failed' || tk.status === 'cancelled' || (tk.status === 'succeeded' && tk.isStale)) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={retryMut.isPending}
                          onClick={() => void retryMut.mutateAsync(tk.id)}
                        >
                          <RotateCcw size={11} />
                          <span>{tk.isStale ? t('Re-run', '重跑') : t('Retry', '重试')}</span>
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={deleteMut.isPending}
                        onClick={() => void deleteMut.mutateAsync(tk.id)}
                        title={t('Delete task', '删除任务')}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Task Results */}
      {activeTask && activeTask.isStale && activeTask.status === 'succeeded' && (
        <div className="wb-alert wb-alert--warn" style={{ justifyContent: 'space-between' }}>
          <span>
            {t(
              'Underlying project data changed since this task completed. Re-run to analyze the latest scope.',
              '项目内容自本次任务完成以来已发生变更（dataVersion 不一致），建议点击“重跑”以覆盖最新数据。',
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void retryMut.mutateAsync(activeTask.id)}
          >
            <RotateCcw size={11} />
            <span>{t('Re-run Now', '立即重跑')}</span>
          </Button>
        </div>
      )}

      {sentimentGroup && activeTask && (
        <AdaptiveLayerLayout
          group={sentimentGroup}
          onSetOverride={setOverride}
          onClearOverride={clearOverride}
          onResetAll={resetLayer}
          renderFullPanel={renderSentimentPanel}
        />
      )}

      {topicGroup && activeTask && (
        <AdaptiveLayerLayout
          group={topicGroup}
          onSetOverride={setOverride}
          onClearOverride={clearOverride}
          onResetAll={resetLayer}
          renderFullPanel={renderTopicPanel}
        />
      )}
    </div>
  );
}
