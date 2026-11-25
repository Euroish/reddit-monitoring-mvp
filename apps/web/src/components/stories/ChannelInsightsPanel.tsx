import { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Flame,
  Info,
  Layers,
  PieChart,
  Tag,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Skeleton } from '../ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { EChartBox } from '../charts/EChartBox';
import { useChartColors } from '../charts/chartUtils';
import type { SourceTier, StoryInsights } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import {
  buildActivityTrendOption,
  buildCompositionOption,
  buildHotKeywordsOption,
  buildTopicsTreemapOption,
  type CompositionDimension,
} from './insightChartOptions';
import { evaluateChannelInsights, type InsightPanelDecision, type InsightPanelId } from './insightsPolicy';

const INSIGHTS_PREF_KEY = 'siftline.feed.insights.pref';
type InsightsPref = 'auto' | 'open' | 'closed';

function loadInsightsPref(): InsightsPref {
  try {
    const val = window.localStorage.getItem(INSIGHTS_PREF_KEY);
    if (val === 'open' || val === 'closed') return val;
  } catch {
    // ignore storage failures
  }
  return 'auto';
}

function saveInsightsPref(pref: InsightsPref) {
  try {
    window.localStorage.setItem(INSIGHTS_PREF_KEY, pref);
  } catch {
    // ignore storage failures
  }
}

export interface ActiveInsightsDrilldown {
  term?: string;
  topicId?: string;
  topicLabel?: string;
  bucketFrom?: string;
  bucketTo?: string;
  bucketLabel?: string;
  insightTier?: SourceTier;
  insightSourceGroup?: string;
  insightLanguage?: string;
  insightSourceId?: string;
  dimensionLabel?: string;
}

interface ChannelInsightsPanelProps {
  insights: StoryInsights | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  sourceGroup: string;
  scopeLabel: string;
  density: 'comfortable' | 'compact';
  activeDrilldown: ActiveInsightsDrilldown;
  onSelectTerm: (term: string, label: string) => void;
  onSelectTopic: (topicId: string, label: string) => void;
  onSelectBucket: (fromIso: string, toIso: string, label: string) => void;
  onSelectComposition: (dimension: CompositionDimension, key: string, label: string) => void;
  onRetry: () => void;
}

function MicroSparkline({ values, color }: { values: number[]; color: string }) {
  const safe = values.length > 0 ? values : [0, 0];
  const max = Math.max(1, ...safe);
  const w = 54;
  const h = 16;
  const pts = safe
    .map((v, idx) => {
      const x = safe.length === 1 ? w : (idx / (safe.length - 1)) * w;
      const y = h - 2 - (v / max) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="ci-spark" aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

export function ChannelInsightsPanel({
  insights,
  isLoading,
  isFetching,
  error,
  sourceGroup,
  scopeLabel,
  density,
  activeDrilldown,
  onSelectTerm,
  onSelectTopic,
  onSelectBucket,
  onSelectComposition,
  onRetry,
}: ChannelInsightsPanelProps) {
  const { lang, t } = useI18n();
  const colors = useChartColors();
  const [pref, setPref] = useState<InsightsPref>(loadInsightsPref);
  const [showMore, setShowMore] = useState(false);
  const [dimOverride, setDimOverride] = useState<CompositionDimension | null>(null);

  const isExpanded = pref === 'auto' ? density !== 'compact' : pref === 'open';
  const toggleExpanded = () => {
    const nextPref: InsightsPref = isExpanded ? 'closed' : 'open';
    setPref(nextPref);
    saveInsightsPref(nextPref);
  };

  const plan = useMemo(
    () => (insights ? evaluateChannelInsights(insights, sourceGroup) : null),
    [insights, sourceGroup],
  );

  const activeDim: CompositionDimension = useMemo(() => {
    if (!insights) return 'channel';
    const dimMap: Record<CompositionDimension, number> = {
      channel: insights.composition.byChannel.length,
      source: insights.composition.bySource.length,
      tier: insights.composition.byTier.length,
      language: insights.composition.byLanguage.length,
    };
    if (dimOverride && dimMap[dimOverride] >= 2) return dimOverride;
    return insights.composition.recommendedDimension;
  }, [dimOverride, insights]);

  const compositionItems = useMemo(() => {
    if (!insights) return [];
    const comp = insights.composition;
    switch (activeDim) {
      case 'channel':
        return comp.byChannel.map((x) => ({ ...x, isOther: false }));
      case 'source':
        return comp.bySource.map((x) => ({ ...x }));
      case 'tier':
        return comp.byTier.map((x) => ({ ...x, isOther: false }));
      case 'language':
        return comp.byLanguage.map((x) => ({ ...x, isOther: false }));
    }
  }, [activeDim, insights]);

  const activeCompositionKey = useMemo(() => {
    if (activeDim === 'channel') return activeDrilldown.insightSourceGroup;
    if (activeDim === 'tier') return activeDrilldown.insightTier;
    if (activeDim === 'language') return activeDrilldown.insightLanguage;
    return activeDrilldown.insightSourceId;
  }, [activeDim, activeDrilldown]);

  const renderPanelCard = (decision: InsightPanelDecision) => {
    if (!insights) return null;
    const id: InsightPanelId = decision.id;

    if (id === 'activityTrend') {
      const topBuckets = insights.activityTrend.buckets;
      const option = buildActivityTrendOption(insights.activityTrend, colors, activeDrilldown.bucketFrom, lang);
      const granularityLabel =
        insights.activityTrend.bucketGranularity === '2h'
          ? t('2h bins', '每2小时')
          : insights.activityTrend.bucketGranularity === '6h'
            ? t('6h bins', '每6小时')
            : t('Daily', '按日');

      return (
        <Card key={id} size="sm" className="ci-card" data-insight-panel="activityTrend">
          <CardHeader className="ci-card-head">
            <div className="ci-card-title-wrap">
              <Activity size={13} className="ci-icon" />
              <CardTitle className="ci-card-title">{t('Activity Trend', '资讯活跃趋势')}</CardTitle>
              <Badge variant="outline" className="ci-pill-badge">{granularityLabel}</Badge>
            </div>
            <p className="ci-card-sub">{insights.activityTrend.summaryText}</p>
          </CardHeader>
          <CardContent className="ci-card-body">
            <EChartBox
              height={132}
              option={option}
              ariaLabel={t('Activity trend bar chart', '资讯活跃趋势柱状图')}
              onEvents={{
                click: (raw) => {
                  const p = raw as { dataIndex?: number };
                  const bucket = typeof p.dataIndex === 'number' ? topBuckets[p.dataIndex] : undefined;
                  if (bucket) onSelectBucket(bucket.from, bucket.to, bucket.bucket);
                },
              }}
            />
          </CardContent>
        </Card>
      );
    }

    if (id === 'hotKeywords') {
      const topItems = insights.hotKeywords.items.slice(0, 6).reverse();
      const option = buildHotKeywordsOption(insights.hotKeywords.items, colors, activeDrilldown.term, lang);
      return (
        <Card key={id} size="sm" className="ci-card" data-insight-panel="hotKeywords">
          <CardHeader className="ci-card-head">
            <div className="ci-card-title-wrap">
              <Tag size={13} className="ci-icon" />
              <CardTitle className="ci-card-title">{t('Hot Keywords', '热门关键词')}</CardTitle>
              <Badge variant="outline" className="ci-pill-badge tabular-nums">
                {insights.hotKeywords.analyzedTextCount} {t('texts', '篇文本')}
              </Badge>
            </div>
            <p className="ci-card-sub">
              {t('Unique story document frequency · click bar to filter', '去重事件提及数 · 点击条形筛选下方列表')}
            </p>
          </CardHeader>
          <CardContent className="ci-card-body">
            <EChartBox
              height={132}
              option={option}
              ariaLabel={t('Hot keywords chart', '热门关键词横向条形图')}
              onEvents={{
                click: (raw) => {
                  const p = raw as { dataIndex?: number };
                  const item = typeof p.dataIndex === 'number' ? topItems[p.dataIndex] : undefined;
                  if (item) onSelectTerm(item.term, item.displayTerm);
                },
              }}
            />
          </CardContent>
        </Card>
      );
    }

    if (id === 'composition') {
      const topItems = compositionItems.slice(0, 5).reverse();
      const option = buildCompositionOption(compositionItems, colors, activeCompositionKey, lang);
      const dims: Array<{ id: CompositionDimension; label: string; count: number }> = [
        { id: 'channel', label: t('Channel', '频道'), count: insights.composition.byChannel.length },
        { id: 'source', label: t('Source', '来源'), count: insights.composition.bySource.length },
        { id: 'tier', label: t('Tier', '等级'), count: insights.composition.byTier.length },
        { id: 'language', label: t('Lang', '语种'), count: insights.composition.byLanguage.length },
      ];
      return (
        <Card key={id} size="sm" className="ci-card" data-insight-panel="composition">
          <CardHeader className="ci-card-head">
            <div className="ci-card-title-wrap" style={{ justifyContent: 'space-between', width: '100%' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <PieChart size={13} className="ci-icon" />
                <CardTitle className="ci-card-title">{t('Source & Content Mix', '来源及内容构成')}</CardTitle>
              </span>
              <div className="ci-dim-tabs" role="group" aria-label={t('Composition dimension', '构成维度')}>
                {dims
                  .filter((d) => d.count >= 2 || d.id === activeDim)
                  .map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`ci-dim-btn ${activeDim === d.id ? 'on' : ''}`}
                      onClick={() => setDimOverride(d.id)}
                    >
                      {d.label}
                    </button>
                  ))}
              </div>
            </div>
            <p className="ci-card-sub">
              {activeDim === 'source'
                ? t(
                    `${insights.composition.allParticipatingSourceCount} participating sources (incl. corroborated)`,
                    `共 ${insights.composition.allParticipatingSourceCount} 个来源参与报道（含合并印证）`,
                  )
                : t('Share of deduplicated events · click bar to filter', '去重事件构成占比 · 点击条形筛选')}
            </p>
          </CardHeader>
          <CardContent className="ci-card-body">
            <EChartBox
              height={132}
              option={option}
              ariaLabel={t('Composition chart', '来源及内容构成图表')}
              onEvents={{
                click: (raw) => {
                  const p = raw as { dataIndex?: number };
                  const item = typeof p.dataIndex === 'number' ? topItems[p.dataIndex] : undefined;
                  if (item && !item.isOther) onSelectComposition(activeDim, item.key, item.label);
                },
              }}
            />
          </CardContent>
        </Card>
      );
    }

    if (id === 'risingTerms') {
      const items = insights.risingTerms.items.slice(0, 5);
      return (
        <Card key={id} size="sm" className="ci-card" data-insight-panel="risingTerms">
          <CardHeader className="ci-card-head">
            <div className="ci-card-title-wrap">
              <Flame size={13} className="ci-icon" />
              <CardTitle className="ci-card-title">{t('Rising Terms', '正在升温的词汇')}</CardTitle>
              {decision.status === 'degraded' && (
                <Badge variant="outline" className="ci-pill-badge">{t('Emerging', '新词发现')}</Badge>
              )}
            </div>
            <p className="ci-card-sub" title={insights.risingTerms.comparabilityNote}>
              {insights.risingTerms.comparabilityNote}
            </p>
          </CardHeader>
          <CardContent className="ci-card-body">
            <div className="ci-rising-list">
              {items.map((item) => {
                const selected = Boolean(
                  activeDrilldown.term && activeDrilldown.term.toLowerCase() === item.term.toLowerCase(),
                );
                const deltaText = item.isNew
                  ? t('New', '新上榜')
                  : `${item.deltaPctPoints >= 0 ? '+' : ''}${item.deltaPctPoints.toFixed(1)}pp`;
                return (
                  <button
                    key={item.term}
                    type="button"
                    className={`ci-rising-row ${selected ? 'on' : ''}`}
                    onClick={() => onSelectTerm(item.term, item.displayTerm)}
                  >
                    <span className="ci-rising-term" title={item.displayTerm}>
                      {item.displayTerm}
                    </span>
                    <MicroSparkline values={item.sparkline} color={selected ? colors.teal : colors.purple} />
                    <span className="ci-rising-meta tabular-nums">
                      <span>{item.currentCount}</span>
                      <em className={item.isNew ? 'is-new' : 'is-up'}>{deltaText}</em>
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      );
    }

    // topics
    const option = buildTopicsTreemapOption(insights.topics.items, colors, activeDrilldown.topicId, lang);
    return (
      <Card key={id} size="sm" className="ci-card" data-insight-panel="topics">
        <CardHeader className="ci-card-head">
          <div className="ci-card-title-wrap">
            <Layers size={13} className="ci-icon" />
            <CardTitle className="ci-card-title">{t('Top Topics', '近期主要话题')}</CardTitle>
            {decision.status === 'degraded' && (
              <Badge variant="outline" className="ci-pill-badge">{t('Co-occurrence', '共现聚类')}</Badge>
            )}
          </div>
          <p className="ci-card-sub">
            {insights.topics.qualityNote ??
              t(
                `${insights.topics.clusterCount} clusters covering ${insights.topics.assignedCount} stories`,
                `自动归纳 ${insights.topics.clusterCount} 个主题 · 点击色块定位关联事件`,
              )}
          </p>
        </CardHeader>
        <CardContent className="ci-card-body">
          <EChartBox
            height={132}
            option={option}
            ariaLabel={t('Topics treemap', '近期主要话题矩形树图')}
            onEvents={{
              click: (raw) => {
                const p = raw as { data?: { topicId?: string; name?: string } };
                if (p.data?.topicId && p.data.name) {
                  onSelectTopic(p.data.topicId, p.data.name);
                }
              },
            }}
          />
        </CardContent>
      </Card>
    );
  };

  if (error) {
    return (
      <section className="ci-shell is-error" aria-label={t('Channel Insights', '频道洞察')}>
        <div className="ci-head">
          <span className="ci-head-left">
            <BarChart3 size={14} className="ci-icon" />
            <strong>{t('Channel Insights', '频道洞察')}</strong>
            <span className="ci-muted-note">{t('Insights temporarily unavailable.', '频道洞察暂未就绪，不影响下方信息流阅读。')}</span>
          </span>
          <button type="button" className="ci-head-btn" onClick={onRetry}>
            {t('Retry', '重试')}
          </button>
        </div>
      </section>
    );
  }

  if (isLoading && !insights) {
    return (
      <section className="ci-shell" aria-label={t('Channel Insights', '频道洞察')}>
        <div className="ci-head">
          <span className="ci-head-left">
            <BarChart3 size={14} className="ci-icon" />
            <strong>{t('Channel Insights', '频道洞察')}</strong>
            <span className="ci-muted-note">{t('Analyzing current channel…', '正在生成当前频道洞察…')}</span>
          </span>
        </div>
        {isExpanded && (
          <div className="ci-grid" style={{ ['--ci-cols' as string]: 3 }}>
            {[0, 1, 2].map((i) => (
              <Card key={i} size="sm" className="ci-card">
                <CardHeader className="ci-card-head">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40 mt-1" />
                </CardHeader>
                <CardContent className="ci-card-body">
                  <Skeleton className="h-[132px] w-full rounded-md" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    );
  }

  if (!insights || !plan) return null;

  if (plan.allHidden) {
    return (
      <section className="ci-shell is-minimal" aria-label={t('Channel Insights', '频道洞察')}>
        <div className="ci-head">
          <span className="ci-head-left">
            <BarChart3 size={14} className="ci-icon" />
            <strong>{t('Channel Insights', '频道洞察')}</strong>
            <span className="ci-muted-note">
              {t(
                `Too few matching events (${insights.sample.analyzedCount}) for reliable analytics.`,
                `当前筛选样本较少（${insights.sample.analyzedCount} 条去重事件），暂自动收敛分析图表以聚焦阅读。`,
              )}
            </span>
          </span>
        </div>
      </section>
    );
  }

  const colCount = Math.min(3, Math.max(1, plan.primary.length));

  return (
    <TooltipProvider>
      <section
        className={`ci-shell ${isFetching ? 'is-syncing' : ''}`}
        aria-label={t('Channel Insights', '频道洞察')}
      >
        <Collapsible open={isExpanded} onOpenChange={toggleExpanded}>
          <div className="ci-head">
            <div className="ci-head-left">
              <BarChart3 size={14} className="ci-icon" />
              <strong>{t('Channel Insights', '频道洞察')}</strong>
              <span className="ci-scope-pill">{scopeLabel}</span>
              <span className="ci-sample-note tabular-nums">
                {insights.sample.capped
                  ? t(
                      `Recent ${insights.sample.analyzedCount} / ${insights.sample.windowTotalCount} events`,
                      `基于近 ${insights.sample.analyzedCount} / ${insights.sample.windowTotalCount} 条去重事件`,
                    )
                  : t(
                      `${insights.sample.analyzedCount} unique stories`,
                      `基于 ${insights.sample.analyzedCount} 条去重事件`,
                    )}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="ci-info-btn"
                      aria-label={t('Methodology details', '查看口径说明')}
                    />
                  }
                >
                  <Info size={12} />
                </TooltipTrigger>
                <TooltipContent>
                  <div>
                    {t(
                      `Anchored by published/discovered time (${insights.sample.coverage}). Text coverage ${insights.quality.textCoveragePct}% across ${insights.quality.activeSourceCount} sources.`,
                      `统计口径：按事件发布/发现时间锚定（${insights.sample.coverage}）。当前有效文本覆盖率 ${insights.quality.textCoveragePct}% ，涉及 ${insights.quality.activeSourceCount} 个主信息源。`,
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="ci-head-right">
              {isExpanded && plan.more.length > 0 && (
                <button
                  type="button"
                  className="ci-head-btn"
                  onClick={() => setShowMore((prev) => !prev)}
                >
                  <span>
                    {showMore
                      ? t('Less analysis', '收起更多')
                      : t(`More analysis (${plan.more.length})`, `更多分析 (${plan.more.length})`)}
                  </span>
                  {showMore ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              )}
              <CollapsibleTrigger
                render={<button type="button" className="ci-head-btn is-toggle" />}
              >
                <span>{isExpanded ? t('Collapse', '收起洞察') : t('Expand insights', '展开洞察')}</span>
                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </CollapsibleTrigger>
            </div>
          </div>

          <CollapsibleContent>
            <div className="ci-grid" style={{ ['--ci-cols' as string]: colCount }}>
              {plan.primary.map((decision) => renderPanelCard(decision))}
            </div>

            {showMore && plan.more.length > 0 && (
              <div
                className="ci-grid ci-grid--more"
                style={{ ['--ci-cols' as string]: Math.min(3, Math.max(1, plan.more.length)) }}
              >
                {plan.more.map((decision) => renderPanelCard(decision))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </section>
    </TooltipProvider>
  );
}
