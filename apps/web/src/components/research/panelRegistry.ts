import { useCallback, useState } from 'react';
import type {
  AnalysisBlock,
  L1OverviewResponse,
  L2ComparisonResponse,
  L3SentimentSummary,
  L3TopicSummary,
} from '@/contracts/research';

export type TranslateFn = (en: string, zh: string) => string;

export type PanelLayer = 'l1' | 'l2' | 'l3';
export type PanelDisplayState = 'full' | 'compact' | 'collapsed' | 'unavailable';
export type PanelUserOverride = 'expanded' | 'compact' | 'collapsed';
export type PanelSpan = 'full' | 'half';

export interface CompactMetricItem {
  label: string;
  value: string;
  hint?: string;
}

export interface PanelEvaluationResult {
  autoState: PanelDisplayState;
  autoReason?: string;
  recoveryHint?: string;
  metricPreview?: string;
  compactMetrics?: CompactMetricItem[];
  compactSummary?: string;
  preferredSpan?: PanelSpan;
}

export interface PanelPolicyRule<TCtx> {
  id: string;
  layer: PanelLayer;
  section?: string;
  titleEn: string;
  titleZh: string;
  priority: number;
  defaultSpan: PanelSpan;
  compactCapable: boolean;
  dependencies: readonly string[];
  evaluate: (ctx: TCtx, t: TranslateFn) => PanelEvaluationResult;
}

export interface EvaluatedPanel {
  id: string;
  layer: PanelLayer;
  section?: string;
  title: string;
  priority: number;
  defaultSpan: PanelSpan;
  resolvedSpan: PanelSpan;
  compactCapable: boolean;
  dependencies: readonly string[];
  autoState: PanelDisplayState;
  effectiveState: PanelDisplayState;
  userOverride?: PanelUserOverride;
  autoReason?: string;
  recoveryHint?: string;
  metricPreview?: string;
  compactMetrics?: CompactMetricItem[];
  compactSummary?: string;
}

export interface ResolvedPanelGroup {
  active: EvaluatedPanel[];
  collapsed: EvaluatedPanel[];
  unavailable: EvaluatedPanel[];
  hasOverrides: boolean;
  counts: {
    full: number;
    compact: number;
    collapsed: number;
    unavailable: number;
  };
}

const PREF_STORAGE_PREFIX = 'siftline.research.panelPrefs.';

export function loadPanelPreferences(projectId: string): Record<string, PanelUserOverride> {
  if (typeof window === 'undefined' || !projectId) return {};
  try {
    const raw = window.sessionStorage.getItem(`${PREF_STORAGE_PREFIX}${projectId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, PanelUserOverride> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 'expanded' || v === 'compact' || v === 'collapsed') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePanelPreferences(projectId: string, prefs: Record<string, PanelUserOverride>): void {
  if (typeof window === 'undefined' || !projectId) return;
  try {
    if (Object.keys(prefs).length === 0) {
      window.sessionStorage.removeItem(`${PREF_STORAGE_PREFIX}${projectId}`);
    } else {
      window.sessionStorage.setItem(`${PREF_STORAGE_PREFIX}${projectId}`, JSON.stringify(prefs));
    }
  } catch {
    // ignore storage quota errors
  }
}

export function usePanelPreferences(projectId: string, layerPanelIds: readonly string[]) {
  const [overridesByProject, setOverridesByProject] = useState<
    Record<string, Record<string, PanelUserOverride>>
  >({});

  const overrides = overridesByProject[projectId] ?? loadPanelPreferences(projectId);

  const setOverride = useCallback(
    (panelId: string, next: PanelUserOverride) => {
      setOverridesByProject((prev) => {
        const base = prev[projectId] ?? loadPanelPreferences(projectId);
        const updated = { ...base, [panelId]: next };
        savePanelPreferences(projectId, updated);
        return { ...prev, [projectId]: updated };
      });
    },
    [projectId],
  );

  const clearOverride = useCallback(
    (panelId: string) => {
      setOverridesByProject((prev) => {
        const base = { ...(prev[projectId] ?? loadPanelPreferences(projectId)) };
        delete base[panelId];
        savePanelPreferences(projectId, base);
        return { ...prev, [projectId]: base };
      });
    },
    [projectId],
  );

  const resetLayer = useCallback(() => {
    const idSet = new Set(layerPanelIds);
    setOverridesByProject((prev) => {
      const base = prev[projectId] ?? loadPanelPreferences(projectId);
      const next: Record<string, PanelUserOverride> = {};
      for (const [k, v] of Object.entries(base)) {
        if (!idSet.has(k)) next[k] = v;
      }
      savePanelPreferences(projectId, next);
      return { ...prev, [projectId]: next };
    });
  }, [projectId, layerPanelIds]);

  return { overrides, setOverride, clearOverride, resetLayer };
}

/**
 * Promotes any orphan half-width panel before a full-width panel or at the end of a row
 * to full-width so the 2-column CSS Grid never leaves empty half-row holes.
 */
export function computeDenseGridSpans<T extends { resolvedSpan: PanelSpan }>(items: readonly T[]): T[] {
  const result = items.map((item) => ({ ...item }));
  let halfParity = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i].resolvedSpan === 'full') {
      if (halfParity === 1 && i > 0) {
        result[i - 1].resolvedSpan = 'full';
      }
      halfParity = 0;
    } else {
      halfParity = (halfParity + 1) % 2;
    }
  }
  if (halfParity === 1 && result.length > 0) {
    result[result.length - 1].resolvedSpan = 'full';
  }
  return result;
}

export function resolvePanelGroup<TCtx>(
  rules: readonly PanelPolicyRule<TCtx>[],
  ctx: TCtx,
  overrides: Record<string, PanelUserOverride>,
  t: TranslateFn,
): ResolvedPanelGroup {
  const activeRaw: EvaluatedPanel[] = [];
  const collapsed: EvaluatedPanel[] = [];
  const unavailable: EvaluatedPanel[] = [];
  let hasOverrides = false;

  for (const rule of rules) {
    const ev = rule.evaluate(ctx, t);
    const override = overrides[rule.id];
    let effectiveState: PanelDisplayState = ev.autoState;

    if (ev.autoState !== 'unavailable' && override) {
      if (override === 'expanded') {
        effectiveState = 'full';
        if (ev.autoState !== 'full') hasOverrides = true;
      } else if (override === 'compact' && rule.compactCapable) {
        effectiveState = 'compact';
        if (ev.autoState !== 'compact') hasOverrides = true;
      } else if (override === 'collapsed') {
        effectiveState = 'collapsed';
        if (ev.autoState !== 'collapsed') hasOverrides = true;
      }
    }

    const panel: EvaluatedPanel = {
      id: rule.id,
      layer: rule.layer,
      section: rule.section,
      title: t(rule.titleEn, rule.titleZh),
      priority: rule.priority,
      defaultSpan: rule.defaultSpan,
      resolvedSpan: ev.preferredSpan ?? rule.defaultSpan,
      compactCapable: rule.compactCapable,
      dependencies: rule.dependencies,
      autoState: ev.autoState,
      effectiveState,
      userOverride: override,
      autoReason:
        override === 'collapsed' && ev.autoState !== 'collapsed'
          ? t('Manually collapsed by user preference', '已按个人偏好手动折叠')
          : ev.autoReason,
      recoveryHint: ev.recoveryHint,
      metricPreview: ev.metricPreview,
      compactMetrics: ev.compactMetrics,
      compactSummary: ev.compactSummary,
    };

    if (effectiveState === 'full' || effectiveState === 'compact') {
      activeRaw.push(panel);
    } else if (effectiveState === 'collapsed') {
      collapsed.push(panel);
    } else {
      unavailable.push(panel);
    }
  }

  activeRaw.sort((a, b) => b.priority - a.priority);
  const active = computeDenseGridSpans(activeRaw);

  return {
    active,
    collapsed,
    unavailable,
    hasOverrides,
    counts: {
      full: active.filter((p) => p.effectiveState === 'full').length,
      compact: active.filter((p) => p.effectiveState === 'compact').length,
      collapsed: collapsed.length,
      unavailable: unavailable.length,
    },
  };
}

function blockErrorResult(block: AnalysisBlock<unknown> | undefined, t: TranslateFn): PanelEvaluationResult | null {
  if (!block || block.status !== 'error') return null;
  return {
    autoState: 'unavailable',
    autoReason: block.summaryText || t('Panel computation failed; try refreshing.', '该分析面板计算异常，请刷新重试。'),
    recoveryHint: t('Click Refresh Analysis above to retry.', '可点击上方「刷新分析」重试计算。'),
  };
}

// ============================================================================
// L1 Overview Policy Registry (centralized thresholds matching §L1 contracts)
// ============================================================================

const PLATFORM_NAMES: Record<string, string> = { reddit: 'Reddit', x: 'X', bluesky: 'Bluesky', web: 'Web' };

export const L1_PANEL_RULES: readonly PanelPolicyRule<L1OverviewResponse>[] = [
  {
    id: 'l1.trend',
    layer: 'l1',
    titleEn: 'Discussion Trend',
    titleZh: '讨论趋势',
    priority: 95,
    defaultSpan: 'full',
    compactCapable: true,
    dependencies: ['trend.points >= 2', 'sampleCount >= 3'],
    evaluate: (data, t) => {
      const err = blockErrorResult(data.analyses.trend, t);
      if (err) return err;
      const pts = data.analyses.trend.data.points;
      const sampleCount = data.analyses.trend.sampleCount;
      if (sampleCount === 0 || pts.length === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No dated content items in the current research scope.', '当前研究范围内暂无带有效时间锚点的内容样本。'),
          recoveryHint: t('Enable batches or broaden the date window above.', '扩大日期范围或启用带发布时间的批次后恢复可用。'),
        };
      }
      if (pts.length < 2) {
        return {
          autoState: 'collapsed',
          autoReason: t(`Only ${pts.length} active time bucket (${pts[0].bucket}); trend trajectory requires multiple periods.`, `当前仅命中 1 个有效时间分组（${pts[0].bucket}），暂无法观察跨期走势。`),
          recoveryHint: t('Appears automatically once content spans at least 2 time buckets.', '当持续采集或筛选跨度覆盖至少 2 个时间分桶后自动恢复展示。'),
          metricPreview: `${pts[0].bucket} · ${pts[0].totalCount} ${t('items', '条')}`,
        };
      }
      if (pts.length === 2 || sampleCount < 5) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        const peak = pts.reduce((a, b) => (b.totalCount > a.totalCount ? b : a), pts[0]);
        return {
          autoState: 'compact',
          autoReason: t(`Short time span (${pts.length} buckets / ${sampleCount} items); shown as compact trend summary.`, `当前有效时间跨度较短（${pts.length} 个分桶、${sampleCount} 条样本），已精简为趋势摘要指标。`),
          recoveryHint: t('Expands to full curve chart once ≥3 time buckets and ≥5 samples accumulate.', '累积 ≥3 个时间分桶且 ≥5 条样本后自动展开完整趋势图。'),
          preferredSpan: 'half',
          compactMetrics: [
            { label: t('Active Buckets', '活跃分桶'), value: `${pts.length}` },
            { label: t('Peak Bucket', '峰值时段'), value: `${peak.bucket} (${peak.totalCount})` },
            { label: t('Latest Bucket', '最新分桶'), value: `${last.bucket} (${last.totalCount})`, hint: `${first.bucket} → ${last.bucket}` },
          ],
          compactSummary: data.analyses.trend.summaryText,
        };
      }
      return { autoState: 'full', preferredSpan: 'full' };
    },
  },
  {
    id: 'l1.topContent',
    layer: 'l1',
    titleEn: 'Top Discussions & Representative Content',
    titleZh: '热门讨论与代表内容',
    priority: 92,
    defaultSpan: 'full',
    compactCapable: false,
    dependencies: ['topContent.items >= 1'],
    evaluate: (data, t) => {
      const err = blockErrorResult(data.analyses.topContent, t);
      if (err) return err;
      const items = data.analyses.topContent.data.items;
      if (items.length === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No matching representative discussions found in current scope.', '当前研究范围内暂无代表性讨论内容。'),
          recoveryHint: t('Add data batches or relax scope filters to inspect top discussions.', '补充数据批次或放宽筛选条件后恢复。'),
        };
      }
      return { autoState: 'full', preferredSpan: 'full' };
    },
  },
  {
    id: 'l1.platforms',
    layer: 'l1',
    titleEn: 'Platform Distribution',
    titleZh: '平台分布',
    priority: 90,
    defaultSpan: 'half',
    compactCapable: true,
    dependencies: ['platforms.rows >= 2'],
    evaluate: (data, t) => {
      const err = blockErrorResult(data.analyses.platforms, t);
      if (err) return err;
      const rows = data.analyses.platforms.data.rows;
      if (rows.length === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No platform distribution data available.', '当前范围暂无平台分布数据。'),
          recoveryHint: t('Attach or collect at least one batch with content.', '纳入有效数据批次后可用。'),
        };
      }
      if (rows.length === 1) {
        const only = rows[0];
        const pName = PLATFORM_NAMES[only.platform] ?? only.platform;
        return {
          autoState: 'compact',
          preferredSpan: 'half',
          autoReason: t(`Single platform (${pName} = 100%); donut/bar chart replaced with compact summary.`, `当前研究范围仅包含单一平台（${pName} 占 100%），已精简为摘要指标，避免低区分度饼图占用空间。`),
          recoveryHint: t('Automatically restores full distribution chart when ≥2 platforms are present.', '接入 Reddit / X / Bluesky 等第 2 个平台数据后自动恢复图表展示。'),
          metricPreview: `${pName} 100% (${only.contentCount})`,
          compactMetrics: [
            { label: t('Active Platform', '当前覆盖平台'), value: pName },
            { label: t('Content Count', '内容总量'), value: `${only.contentCount.toLocaleString()} (100%)` },
            { label: t('Posts / Comments', '帖文 / 评论'), value: `${only.postsCount} / ${only.commentsCount}` },
          ],
          compactSummary: data.analyses.platforms.summaryText,
        };
      }
      return { autoState: 'full', preferredSpan: 'half' };
    },
  },
  {
    id: 'l1.keywords',
    layer: 'l1',
    titleEn: 'Collection Keyword Distribution',
    titleZh: '采集关键词分布',
    priority: 85,
    defaultSpan: 'half',
    compactCapable: true,
    dependencies: ['keywords.rows >= 2', 'sampleCount >= 4'],
    evaluate: (data, t) => {
      const err = blockErrorResult(data.analyses.keywords, t);
      if (err) return err;
      const rows = data.analyses.keywords.data.rows;
      const total = data.analyses.keywords.data.deduplicatedTotal;
      if (rows.length === 0 || total === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No collection target hits in the current scope.', '当前范围暂无关键词或采集目标命中数据。'),
          recoveryHint: t('Select active targets or collect new data.', '选中研究对象或采集数据后恢复。'),
        };
      }
      if (rows.length <= 1) {
        const only = rows[0];
        return {
          autoState: 'collapsed',
          autoReason: t(`Only 1 keyword/target active ("${only.label}"); comparative bar chart adds no differentiation.`, `当前范围仅包含 1 个关键词/采集目标（${only.label}），分布柱状图无横向对比价值，已自动收起。`),
          recoveryHint: t('Automatically expands once ≥2 keywords or collection targets are selected.', '在研究范围中选中或引入第 2 个关键词/采集目标后自动恢复展示。'),
          metricPreview: `${only.label} · ${only.contentCount} ${t('items', '条')}`,
        };
      }
      if (total < 4) {
        return {
          autoState: 'compact',
          preferredSpan: 'half',
          autoReason: t(`Small sample size (${total} items across ${rows.length} targets); shown as compact breakdown.`, `当前多关键词样本量较少（共 ${total} 条），已精简为紧凑计数摘要。`),
          recoveryHint: t('Automatically restores bar chart at ≥4 deduplicated items.', '样本量达到 4 条及以上后自动恢复柱状图。'),
          compactMetrics: rows.slice(0, 3).map((r) => ({
            label: r.label,
            value: `${r.contentCount} (${r.sharePct}%)`,
          })),
          compactSummary: data.analyses.keywords.summaryText,
        };
      }
      return { autoState: 'full', preferredSpan: 'half' };
    },
  },
  {
    id: 'l1.sources',
    layer: 'l1',
    titleEn: 'Community & Source Ranking',
    titleZh: '来源与社区分布',
    priority: 80,
    defaultSpan: 'half',
    compactCapable: true,
    dependencies: ['distinct sources or communities >= 2'],
    evaluate: (data, t) => {
      const err = blockErrorResult(data.analyses.sources, t);
      if (err) return err;
      const src = data.analyses.sources.data;
      const primary = src.communities.length > 0 ? src.communities : src.collectionSources;
      const maxLen = Math.max(src.communities.length, src.collectionSources.length);
      if (primary.length === 0 || src.deduplicatedTotal === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No community or source breakdown available for current scope.', '当前范围暂无社区或来源排名数据。'),
          recoveryHint: t('Adjust scope filters or collect data from tracked sources.', '调整筛选条件或接入数据后可用。'),
        };
      }
      if (maxLen <= 1) {
        const only = primary[0];
        return {
          autoState: 'collapsed',
          autoReason: t(`All samples originate from a single source/community ("${only.label}").`, `所有样本均来自同一来源/社区（${only.label}），排名对比无差异，已自动折叠。`),
          recoveryHint: t('Automatically displays ranking chart when ≥2 communities or collection sources are covered.', '数据覆盖至少 2 个不同社区或采集源后自动恢复显示。'),
          metricPreview: `${only.label} · 100% (${only.contentCount})`,
        };
      }
      if (maxLen === 2 && src.deduplicatedTotal < 6) {
        return {
          autoState: 'compact',
          preferredSpan: 'half',
          autoReason: t(`Only 2 sources with ${src.deduplicatedTotal} items; shown concisely.`, `当前仅有 2 个来源且样本较少（${src.deduplicatedTotal} 条），已精简展示。`),
          recoveryHint: t('Expands to full ranking chart when ≥3 sources or ≥6 samples are present.', '达到 ≥3 个来源或 ≥6 条样本后恢复完整排名图。'),
          compactMetrics: primary.slice(0, 2).map((s) => ({
            label: s.label,
            value: `${s.contentCount} (${s.sharePct}%)`,
          })),
          compactSummary: data.analyses.sources.summaryText,
        };
      }
      return { autoState: 'full', preferredSpan: 'half' };
    },
  },
  {
    id: 'l1.engagement',
    layer: 'l1',
    titleEn: 'Engagement Breakdown by Platform',
    titleZh: '各平台互动情况',
    priority: 75,
    defaultSpan: 'full',
    compactCapable: true,
    dependencies: ['engagement.platforms >= 1', 'non-zero metrics'],
    evaluate: (data, t) => {
      const err = blockErrorResult(data.analyses.engagement, t);
      if (err) return err;
      const plats = data.analyses.engagement.data.platforms;
      if (plats.length === 0 || data.analyses.engagement.sampleCount === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No engagement metrics in current scope.', '当前范围暂无互动指标数据。'),
          recoveryHint: t('Include posts/batches with platform engagement fields.', '纳入包含互动数据的批次后可用。'),
        };
      }
      const hasAnyMetric = plats.some(
        (p) => p.totalPrimaryMetric > 0 || p.reportedRepliesSum > 0 || p.collectedCommentsCount > 0,
      );
      if (!hasAnyMetric) {
        return {
          autoState: 'collapsed',
          autoReason: t('All engagement counters (likes/score/replies) are 0 in the current scope.', '当前范围内样本点赞/Score/评论数均为 0，柱状图无高度信息。'),
          recoveryHint: t('Restores automatically when samples include non-zero engagement activity.', '接入含真实互动数的样本后自动恢复。'),
          metricPreview: `0 ${t('engagements', '互动')}`,
        };
      }
      if (plats.length === 1) {
        const only = plats[0];
        const pName = PLATFORM_NAMES[only.platform] ?? only.platform;
        return {
          autoState: 'compact',
          preferredSpan: 'half',
          autoReason: t(`Single platform (${pName}) active; summarized as engagement KPI metrics.`, `仅单平台（${pName}）有互动数据，已精简为紧凑指标卡（可按需手动展开图表）。`),
          recoveryHint: t('Multi-platform bar comparison resumes when ≥2 platforms have data.', '当 ≥2 个平台均存在数据时自动恢复跨平台柱状对比图。'),
          metricPreview: `${pName}: ${only.totalPrimaryMetric} ${only.primaryMetricLabel}`,
          compactMetrics: [
            { label: `${pName} · ${only.primaryMetricLabel}`, value: only.totalPrimaryMetric.toLocaleString(), hint: `${t('Avg/Post', '篇均')} ${only.avgPrimaryMetric}` },
            { label: t('Platform Replies', '平台记录评论'), value: only.reportedRepliesSum.toLocaleString() },
            { label: t('Collected Comments', '实际已采评论'), value: only.collectedCommentsCount.toLocaleString() },
          ],
          compactSummary: data.analyses.engagement.summaryText,
        };
      }
      return { autoState: 'full', preferredSpan: 'full' };
    },
  },
  {
    id: 'l1.kinds',
    layer: 'l1',
    titleEn: 'Content Morphology',
    titleZh: '内容类型分布',
    priority: 70,
    defaultSpan: 'half',
    compactCapable: true,
    dependencies: ['distinct active content kinds >= 2'],
    evaluate: (data, t) => {
      const err = blockErrorResult(data.analyses.kinds, t);
      if (err) return err;
      const { totals, byPlatform } = data.analyses.kinds.data;
      if (totals.total === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No content morphology breakdown available.', '当前范围暂无内容类型数据。'),
          recoveryHint: t('Enable data batches to inspect post/comment/article mix.', '启用数据批次后可用。'),
        };
      }
      const activeKinds = [totals.posts > 0, totals.comments > 0, totals.articles > 0].filter(Boolean).length;
      if (activeKinds <= 1 && byPlatform.length <= 1) {
        const kindLabel = totals.posts > 0 ? t('Posts', '帖文') : totals.comments > 0 ? t('Comments', '评论') : t('Articles', '文章');
        return {
          autoState: 'collapsed',
          autoReason: t(`100% single type (${kindLabel}) on 1 platform; stacked morphology chart carries no variance.`, `当前数据均为单一平台下的单一类型（${kindLabel} 100%），堆叠分布无对比意义，已自动折叠。`),
          recoveryHint: t('Automatically displays when comments/articles or ≥2 platforms are added.', '补充评论采集、文章或第 2 个平台数据后自动恢复展示。'),
          metricPreview: `${kindLabel} 100% (${totals.total})`,
        };
      }
      if (activeKinds <= 1) {
        const kindLabel = totals.posts > 0 ? t('Posts', '帖文') : totals.comments > 0 ? t('Comments', '评论') : t('Articles', '文章');
        return {
          autoState: 'compact',
          preferredSpan: 'half',
          autoReason: t(`Only ${kindLabel} present across platforms; shown as compact platform totals.`, `当前仅包含单一类型（${kindLabel}），已精简为各平台摘要分布。`),
          recoveryHint: t('Expands to stacked bar chart once multiple content types (e.g. comments) are collected.', '采集评论或文章形成多形态构成后自动恢复堆叠图。'),
          compactMetrics: byPlatform.slice(0, 3).map((bp) => ({
            label: `${PLATFORM_NAMES[bp.platform] ?? bp.platform} (${kindLabel})`,
            value: bp.totalCount.toLocaleString(),
          })),
          compactSummary: data.analyses.kinds.summaryText,
        };
      }
      return { autoState: 'full', preferredSpan: 'half' };
    },
  },
];

// ============================================================================
// L2 Topics & Comparison Policy Registry (15 Panels across text/compare/change)
// ============================================================================

export function buildL2PanelRules(): readonly PanelPolicyRule<L2ComparisonResponse>[] {
  return [
    // Section: Text Features
    {
      id: 'l2.unigrams',
      layer: 'l2',
      section: 'text',
      titleEn: 'High-Frequency Terms (Unigrams)',
      titleZh: '高频词（Unigram）',
      priority: 95,
      defaultSpan: 'half',
      compactCapable: true,
      dependencies: ['sampleCount >= 2', 'terms >= 1'],
      evaluate: (d, t) => {
        const b = d.analyses.unigrams;
        const err = blockErrorResult(b, t);
        if (err) return err;
        if (b.sampleCount < 2 || b.data.items.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t(`Requires at least 2 text items (currently ${b.sampleCount}).`, `高频词统计至少需要 2 条有效文本（当前 ${b.sampleCount} 条）。`),
            recoveryHint: t('Collect or enable more content items.', '纳入 ≥2 条有效文本后可用。'),
          };
        }
        if (b.data.items.length < 4 || b.sampleCount < 4) {
          return {
            autoState: 'compact',
            preferredSpan: 'half',
            autoReason: t(`Only ${b.data.items.length} frequent terms extracted from ${b.sampleCount} items.`, `当前样本仅提取出 ${b.data.items.length} 个高频词，已精简展示。`),
            recoveryHint: t('Automatically restores full bar chart with ≥4 terms & ≥4 samples.', '样本与高频词均达到 4 条/项后恢复完整柱图。'),
            compactMetrics: b.data.items.slice(0, 3).map((it) => ({
              label: it.term,
              value: `${it.docCount} (${it.sharePct}%)`,
            })),
            compactSummary: b.summaryText,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.tfidf',
      layer: 'l2',
      section: 'text',
      titleEn: 'TF-IDF Distinctive Keywords',
      titleZh: 'TF-IDF 特征词排行',
      priority: 93,
      defaultSpan: 'half',
      compactCapable: true,
      dependencies: ['sampleCount >= 3', 'terms >= 1'],
      evaluate: (d, t) => {
        const b = d.analyses.tfidf;
        const err = blockErrorResult(b, t);
        if (err) return err;
        if (b.sampleCount < 3 || b.data.items.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t(`TF-IDF requires ≥3 text items for IDF weighting (currently ${b.sampleCount}).`, `TF-IDF 特征权重要求至少 3 条文本样本（当前 ${b.sampleCount} 条）。`),
            recoveryHint: t('Increase sample count to ≥3 items.', '扩大范围至 ≥3 条文本样本后可用。'),
          };
        }
        if (b.data.items.length < 4) {
          return {
            autoState: 'compact',
            preferredSpan: 'half',
            autoReason: t(`Only ${b.data.items.length} TF-IDF terms reached threshold.`, `命中阈值的 TF-IDF 特征词不足 4 个，已精简展示。`),
            recoveryHint: t('Expands when ≥4 distinctive terms are extracted.', '提取出 ≥4 个显著特征词后自动展开。'),
            compactMetrics: b.data.items.slice(0, 3).map((it) => ({
              label: it.term,
              value: `${(it.avgScore ?? 0).toFixed(3)}`,
              hint: `${it.docCount} ${t('docs', '条')}`,
            })),
            compactSummary: b.summaryText,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.bigrams',
      layer: 'l2',
      section: 'text',
      titleEn: 'Two-Word Phrases (Bigrams)',
      titleZh: '高频二元短语（Bigram）',
      priority: 72,
      defaultSpan: 'half',
      compactCapable: true,
      dependencies: ['sampleCount >= 5', 'bigrams >= 3'],
      evaluate: (d, t) => {
        const b = d.analyses.bigrams;
        const err = blockErrorResult(b, t);
        if (err) return err;
        if (b.data.items.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No recurring adjacent two-word phrases detected.', '当前文本中未提取出重复出现的二元连续短语。'),
            recoveryHint: t('Add more discussion text samples.', '增加更丰富的讨论文本后可用。'),
          };
        }
        if (b.sampleCount < 5 || b.data.items.length < 3) {
          return {
            autoState: 'collapsed',
            autoReason: t(`Sparse bigram matches (${b.data.items.length} phrases across ${b.sampleCount} items).`, `当前二元短语命中较稀疏（${b.data.items.length} 组 / ${b.sampleCount} 条文本），默认收起。`),
            recoveryHint: t('Automatically restores when ≥5 samples yield ≥3 recurring bigrams.', '文本样本 ≥5 条且出现至少 3 组二元短语后自动展开。'),
            metricPreview: `${b.data.items[0]?.term} (${b.data.items[0]?.docCount})`,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.trigrams',
      layer: 'l2',
      section: 'text',
      titleEn: 'Three-Word Expressions (Trigrams)',
      titleZh: '高频三元短语（Trigram）',
      priority: 64,
      defaultSpan: 'half',
      compactCapable: false,
      dependencies: ['sampleCount >= 8', 'trigrams >= 2'],
      evaluate: (d, t) => {
        const b = d.analyses.trigrams;
        const err = blockErrorResult(b, t);
        if (err) return err;
        if (b.data.items.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No recurring 3-word collocations found in current scope.', '当前样本中暂未出现重复三元搭配短语。'),
            recoveryHint: t('Appears automatically when long-form discussions contain recurring 3-word phrases.', '引入更多长文本讨论并出现重复三元词组后可用。'),
          };
        }
        if (b.sampleCount < 8 || b.data.items.length < 2) {
          return {
            autoState: 'collapsed',
            autoReason: t(`Few trigram collocations (${b.data.items.length} phrases across ${b.sampleCount} items); collapsed to prioritize high-signal terms.`, `三元短语样本支撑较弱（${b.data.items.length} 组 / ${b.sampleCount} 条），已自动折叠以聚焦核心词条。`),
            recoveryHint: t('Automatically restores once ≥8 text samples yield ≥2 trigrams.', '样本 ≥8 条且提取 ≥2 组三元短语后自动恢复展示。'),
            metricPreview: `${b.data.items.length} ${t('trigrams', '组')}`,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.cooccurrence',
      layer: 'l2',
      section: 'text',
      titleEn: 'Term Co-occurrence Heatmap',
      titleZh: '关键词共现矩阵与强度',
      priority: 78,
      defaultSpan: 'full',
      compactCapable: false,
      dependencies: ['cooccurrence.terms >= 4', 'sampleCount >= 6'],
      evaluate: (d, t) => {
        const b = d.analyses.cooccurrence;
        const err = blockErrorResult(b, t);
        if (err) return err;
        if (b.data.terms.length < 2 || b.data.topPairs.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('Fewer than 2 co-occurring keywords detected.', '尚未识别出足够共现词对（至少需 2 个共现词）。'),
            recoveryHint: t('Increase sample coverage to uncover term associations.', '扩大样本范围后可识别同帖共现词对。'),
          };
        }
        if (b.sampleCount < 6 || b.data.terms.length < 4) {
          return {
            autoState: 'collapsed',
            autoReason: t(`Matrix is sparse (${b.data.terms.length} terms / ${b.sampleCount} items); heatmap collapsed.`, `共现词矩阵过于稀疏（仅 ${b.data.terms.length} 个词 / ${b.sampleCount} 条样本），热力图已自动折叠。`),
            recoveryHint: t('Expands automatically with ≥6 samples and ≥4 co-occurring terms.', '样本 ≥6 条且产生 ≥4 个共现词后自动展开热力图。'),
            metricPreview: `${b.data.terms.length}×${b.data.terms.length} (${b.data.topPairs.length} ${t('pairs', '对')})`,
          };
        }
        return { autoState: 'full', preferredSpan: 'full' };
      },
    },

    // Section: Multi-Object Comparison (Auto-folds cleanly when < 2 objects!)
    {
      id: 'l2.objectCounts',
      layer: 'l2',
      section: 'compare',
      titleEn: 'Object Volume & Exclusivity Comparison',
      titleZh: '对比对象声量与独占对比',
      priority: 90,
      defaultSpan: 'half',
      compactCapable: true,
      dependencies: ['comparison objects >= 2'],
      evaluate: (d, t) => {
        const b = d.analyses.objectCounts;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const rows = b.data.rows;
        if (rows.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No comparison objects available in current mode.', '当前对比模式下暂无有效对象。'),
            recoveryHint: t('Select targets or enable batches above.', '在范围栏选中关键词或数据批次后可用。'),
          };
        }
        if (rows.length < 2) {
          const modeName = d.compareMode === 'batch' ? t('batch', '数据批次') : t('keyword/target', '关键词/目标');
          return {
            autoState: 'collapsed',
            autoReason: t(`Only 1 ${modeName} ("${rows[0].label}") present; multi-object comparison requires ≥2 objects.`, `当前仅包含 1 个${modeName}（${rows[0].label}），缺少对比参照对象，已自动折叠。`),
            recoveryHint: t('Select or add a 2nd target/batch (or switch compare mode) to enable comparison.', '引入第 2 个关键词/数据批次（或切换对比维度至 ≥2 个对象）后自动恢复。'),
            metricPreview: `${rows[0].label} (${rows[0].contentCount})`,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.objectTrends',
      layer: 'l2',
      section: 'compare',
      titleEn: 'Multi-Series Trend Over Time',
      titleZh: '多对象时间趋势对比',
      priority: 88,
      defaultSpan: 'half',
      compactCapable: false,
      dependencies: ['objects >= 2', 'time_buckets >= 2'],
      evaluate: (d, t) => {
        const b = d.analyses.objectTrends;
        const err = blockErrorResult(b, t);
        if (err) return err;
        if (b.data.objects.length === 0 || b.data.points.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No time-series data for object comparison.', '暂无多对象时间趋势数据。'),
            recoveryHint: t('Include dated content across comparison objects.', '引入带发布日期的对象样本后可用。'),
          };
        }
        if (b.data.objects.length < 2) {
          return {
            autoState: 'collapsed',
            autoReason: t('Fewer than 2 comparison objects; multi-series comparison curve is redundant.', '当前对比对象不足 2 个，多对象对比曲线已自动折叠。'),
            recoveryHint: t('Enable at least 2 objects to compare trajectories.', '包含 ≥2 个对比对象后自动恢复。'),
          };
        }
        if (b.data.points.length < 2) {
          return {
            autoState: 'collapsed',
            autoReason: t('Only 1 time bucket in scope; multi-day trajectory diff cannot be observed.', '有效时间分组少于 2 个，无法对比走势差异。'),
            recoveryHint: t('Appears automatically when samples span ≥2 time buckets.', '跨越 ≥2 个时间分桶后自动恢复。'),
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.objectPlatformMatrix',
      layer: 'l2',
      section: 'compare',
      titleEn: 'Object × Platform Matrix',
      titleZh: '对比对象 × 平台交叉分布',
      priority: 82,
      defaultSpan: 'half',
      compactCapable: true,
      dependencies: ['objects >= 2', 'platforms >= 2'],
      evaluate: (d, t) => {
        const b = d.analyses.objectPlatformMatrix;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const { rows, cols, cells } = b.data;
        if (rows.length === 0 || cols.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No Object × Platform cells available.', '暂无对象与平台的交叉分布数据。'),
            recoveryHint: t('Select targets/batches with content.', '选择有效数据后可用。'),
          };
        }
        if (rows.length < 2) {
          return {
            autoState: 'collapsed',
            autoReason: t('Requires ≥2 objects to compare platform mix.', '对比对象不足 2 个，平台交叉矩阵已自动折叠。'),
            recoveryHint: t('Add or select a 2nd object to restore.', '引入第 2 个对比对象后自动恢复。'),
          };
        }
        if (cols.length < 2) {
          return {
            autoState: 'compact',
            preferredSpan: 'half',
            autoReason: t(`All objects are on a single platform (${cols[0].label}); matrix simplified to counts.`, `所有对比对象均位于同一平台（${cols[0].label}），热力图已精简为分布列表。`),
            recoveryHint: t('Expands to full 2D heatmap once ≥2 platforms are covered.', '数据覆盖 ≥2 个平台后自动恢复交叉热力图。'),
            compactMetrics: rows.slice(0, 4).map((r) => {
              const hit = cells.find((c) => c.objectKey === r.key && c.colKey === cols[0].key);
              return { label: r.label, value: `${hit?.count ?? 0} (${hit?.sharePct ?? 0}%)` };
            }),
            compactSummary: b.summaryText,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.objectCommunityMatrix',
      layer: 'l2',
      section: 'compare',
      titleEn: 'Object × Community Matrix',
      titleZh: '对比对象 × 社区分布矩阵',
      priority: 74,
      defaultSpan: 'half',
      compactCapable: false,
      dependencies: ['objects >= 2', 'communities >= 2'],
      evaluate: (d, t) => {
        const b = d.analyses.objectCommunityMatrix;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const { rows, cols } = b.data;
        if (rows.length === 0 || cols.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No community tags available across current objects.', '当前研究范围内暂无社区字段分布数据（例如纯关键词抓取未关联具体社区）。'),
            recoveryHint: t('Include community-scoped data such as Reddit Subreddits.', '包含 Reddit 等带社区维度的样本后可用。'),
          };
        }
        if (rows.length < 2 || cols.length < 2) {
          return {
            autoState: 'collapsed',
            autoReason:
              rows.length < 2
                ? t('Requires ≥2 objects to compare community overlap.', '对比对象不足 2 个，社区交叉矩阵已自动折叠。')
                : t(`Only 1 active community (${cols[0].label}); cross-community matrix collapsed.`, `当前仅含 1 个活跃社区（${cols[0].label}），交叉分布矩阵区分度较低。`),
            recoveryHint: t('Restores automatically when ≥2 objects and ≥2 communities are present.', '存在 ≥2 个对比对象且覆盖 ≥2 个社区后自动恢复。'),
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.overlapMatrix',
      layer: 'l2',
      section: 'compare',
      titleEn: 'Overlap & Jaccard Similarity Matrix',
      titleZh: '内容重叠度与 Jaccard 矩阵',
      priority: 84,
      defaultSpan: 'half',
      compactCapable: true,
      dependencies: ['objects >= 2'],
      evaluate: (d, t) => {
        const b = d.analyses.overlapMatrix;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const { objects, cells } = b.data;
        if (objects.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No objects available for overlap computation.', '暂无可用于计算重叠矩阵的对象。'),
            recoveryHint: t('Select targets or batches above.', '在研究范围选中数据后可用。'),
          };
        }
        if (objects.length < 2) {
          return {
            autoState: 'collapsed',
            autoReason: t('Jaccard similarity requires at least 2 objects (currently 1).', '交并比重合度分析需要至少 2 个对比对象（当前仅 1 个），已自动折叠。'),
            recoveryHint: t('Add or select a 2nd object to compute pairwise overlap.', '包含 ≥2 个对比对象后自动恢复矩阵。'),
          };
        }
        const nonSelfOverlap = cells.some((c) => c.rowKey !== c.colKey && c.intersectionCount > 0);
        if (!nonSelfOverlap) {
          return {
            autoState: 'compact',
            preferredSpan: 'half',
            autoReason: t('0 pairwise intersections across all objects (completely disjoint); compacted to summary.', '各对比对象间交集严格为 0（无重叠样本），已精简为摘要提示。'),
            recoveryHint: t('Expands to full Jaccard heatmap when shared content appears across targets/batches.', '出现跨对象重叠样本（交集 > 0）后自动展开热力图。'),
            compactMetrics: objects.slice(0, 3).map((o) => ({ label: o.label, value: `${o.count} (0% ${t('overlap', '重叠')})` })),
            compactSummary: b.summaryText,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.objectDistinctiveTerms',
      layer: 'l2',
      section: 'compare',
      titleEn: 'Distinctive Terms per Object (Log-Odds Diff)',
      titleZh: '多对象差异特征词对照',
      priority: 86,
      defaultSpan: 'full',
      compactCapable: false,
      dependencies: ['objects >= 2', 'distinctiveTerms >= 1'],
      evaluate: (d, t) => {
        const b = d.analyses.objectDistinctiveTerms;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const groups = b.data.groups;
        if (groups.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No comparison groups available for log-odds extraction.', '当前范围暂无可提取差异词的对象分组。'),
            recoveryHint: t('Select targets or batches above.', '选中研究对象后可用。'),
          };
        }
        if (groups.length < 2) {
          return {
            autoState: 'collapsed',
            autoReason: t('Cross-object lexical differentiation requires ≥2 comparison objects.', '差异特征词（Log-Odds）需要至少 2 个对象互相参照对比，已自动折叠。'),
            recoveryHint: t('Enable at least 2 keywords or batches to surface distinctive terms.', '启用 ≥2 个对比对象后自动展开。'),
          };
        }
        if (!groups.some((g) => g.distinctiveTerms.length > 0)) {
          return {
            autoState: 'collapsed',
            autoReason: t('No statistically distinctive terms exceeded threshold across objects.', '各对象间词汇分布高度接近，未发现显著独有差异词。'),
            recoveryHint: t('Appears automatically when sample size grows or distinct sub-topics emerge.', '样本进一步扩充后若出现显著词汇差异将自动恢复。'),
          };
        }
        return { autoState: 'full', preferredSpan: 'full' };
      },
    },
    {
      id: 'l2.windowComparison',
      layer: 'l2',
      section: 'compare',
      titleEn: 'Time-Window Before vs After Comparison',
      titleZh: '前后时间窗口指标对比',
      priority: 76,
      defaultSpan: 'half',
      compactCapable: false,
      dependencies: ['beforeCount >= 1', 'afterCount >= 1'],
      evaluate: (d, t) => {
        const b = d.analyses.windowComparison;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const { beforeCount, afterCount, splitAt } = b.data;
        if (beforeCount === 0 && afterCount === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No dated samples in either before or after time window.', '前后对比时段内均暂无带时间戳样本。'),
            recoveryHint: t('Select dated data batches or widen the time range.', '包含有效发布时间的样本后可用。'),
          };
        }
        if (beforeCount === 0 || afterCount === 0) {
          const emptySide = beforeCount === 0 ? t('before', '前半段') : t('after', '后半段');
          return {
            autoState: 'collapsed',
            autoReason: t(`Zero samples ${emptySide} split date (${splitAt.slice(0, 10)}); before/after comparison needs samples on both sides.`, `分界日（${splitAt.slice(0, 10)}）的${emptySide}样本数为 0，无法构成前后期对照，已自动折叠。`),
            recoveryHint: t('Adjust split date inside this panel or collect data across a longer period.', '可在展开面板内调整分界日期，或引入跨越多天的数据后自动恢复。'),
            metricPreview: `${beforeCount} vs ${afterCount}`,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },

    // Section: Change & Anomaly Exploration
    {
      id: 'l2.hotTermTrends',
      layer: 'l2',
      section: 'change',
      titleEn: 'Top Hot Terms Over Time',
      titleZh: '高频热词逐日趋势',
      priority: 80,
      defaultSpan: 'half',
      compactCapable: false,
      dependencies: ['buckets >= 2', 'series >= 2'],
      evaluate: (d, t) => {
        const b = d.analyses.hotTermTrends;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const { buckets, series } = b.data;
        if (series.length === 0 || buckets.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No qualifying hot terms with time buckets in scope.', '当前范围暂无足够热词时间序列。'),
            recoveryHint: t('Enable batches with multiple dated text items.', '纳入含日期的文本数据后可用。'),
          };
        }
        if (buckets.length < 2 || series.length < 2) {
          return {
            autoState: 'collapsed',
            autoReason: t(`Requires ≥2 time buckets & ≥2 hot terms (got ${buckets.length} bucket, ${series.length} series).`, `时间分桶或热词数量不足（${buckets.length} 个时段 / ${series.length} 条曲线），折线对比价值有限，已自动折叠。`),
            recoveryHint: t('Automatically restores when data spans ≥2 time buckets.', '数据跨度达到 ≥2 个时间分桶且提取 ≥2 个热词后自动恢复。'),
            metricPreview: `${buckets.length} ${t('buckets', '时段')} · ${series.length} ${t('terms', '热词')}`,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.anomalyDetection',
      layer: 'l2',
      section: 'change',
      titleEn: 'Volume Spike & Anomaly Detection',
      titleZh: '内容爆发点与异常探测',
      priority: 79,
      defaultSpan: 'half',
      compactCapable: true,
      dependencies: ['points >= 4'],
      evaluate: (d, t) => {
        const b = d.analyses.anomalyDetection;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const { points, anomalyCount } = b.data;
        if (points.length === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('No dated time points for baseline anomaly calculation.', '暂无时间序列采样点用于异常峰值计算。'),
            recoveryHint: t('Add dated samples across multiple days.', '接入跨日数据后可用。'),
          };
        }
        if (points.length < 4) {
          return {
            autoState: 'collapsed',
            autoReason: t(`Only ${points.length} time points available; Z-score baseline stability requires ≥4 time buckets.`, `当前仅有 ${points.length} 个时间分桶，Z-Score 统计基线至少需要 4 个采样点才具备显著性，已自动折叠。`),
            recoveryHint: t('Automatically activates once continuous collection covers ≥4 days/buckets.', '持续采集覆盖至少 4 个时间分组后自动恢复。'),
            metricPreview: `${points.length}/4 ${t('buckets', '桶')}`,
          };
        }
        if (anomalyCount === 0 && points.length < 7) {
          return {
            autoState: 'compact',
            preferredSpan: 'half',
            autoReason: t(`No volume spikes detected across ${points.length} buckets; summarized cleanly.`, `在现有 ${points.length} 个分桶内未探测到显著异常峰值，已精简为摘要状态。`),
            recoveryHint: t('Expands automatically on ≥7 buckets or when an anomaly spike triggers.', '时间跨度达 7 桶或探测到异常爆发点时自动展开完整曲线。'),
            compactMetrics: [
              { label: t('Baseline Avg', '基线均值'), value: `${points[0]?.baselineAvg ?? 0}` },
              { label: t('Detected Spikes', '异常爆发数'), value: '0' },
              { label: t('Sampled Buckets', '覆盖时段'), value: `${points.length}` },
            ],
            compactSummary: b.summaryText,
          };
        }
        return { autoState: 'full', preferredSpan: 'half' };
      },
    },
    {
      id: 'l2.windowTermShifts',
      layer: 'l2',
      section: 'change',
      titleEn: 'Time-Window Lexical Shift (Rising vs Falling Terms)',
      titleZh: '时间窗词频跃升 / 回落对比',
      priority: 73,
      defaultSpan: 'full',
      compactCapable: false,
      dependencies: ['before & after items >= 1', 'shifted terms >= 2'],
      evaluate: (d, t) => {
        const b = d.analyses.windowTermShifts;
        const err = blockErrorResult(b, t);
        if (err) return err;
        const count = b.data.rising.length + b.data.falling.length;
        if (count === 0) {
          return {
            autoState: 'unavailable',
            autoReason: t('Insufficient lexical volume across both halves of the split window.', '时间分界前后两半段缺乏足够的词汇频率对比样本。'),
            recoveryHint: t('Requires samples both before and after the split date.', '当分界日前后均有足量文本样本时可用。'),
          };
        }
        if (count < 2) {
          return {
            autoState: 'collapsed',
            autoReason: t('Fewer than 2 terms showed measurable share shift across the window split.', '分界前后占比变化显著的词条不足 2 个，差异图已自动折叠。'),
            recoveryHint: t('Restores automatically when ≥2 shifting terms are found.', '出现 ≥2 个明显跃升或回落词条后自动恢复。'),
          };
        }
        return { autoState: 'full', preferredSpan: 'full' };
      },
    },
  ];
}

// ============================================================================
// L3 Deep Research Policy Registry (Sentiment Quality & Topic Modeling)
// ============================================================================

export interface L3SentimentEvalContext {
  kind: 'sentiment';
  summary: L3SentimentSummary;
}

export interface L3TopicEvalContext {
  kind: 'topic_modeling';
  summary: L3TopicSummary;
}

const LOW_SENTIMENT_COVERAGE_PCT = 25;
const MIN_SENTIMENT_CLASSIFIED = 3;

export const L3_SENTIMENT_PANEL_RULES: readonly PanelPolicyRule<L3SentimentSummary>[] = [
  {
    id: 'l3.sentimentDist',
    layer: 'l3',
    section: 'sentiment',
    titleEn: 'Sentiment Polarity Distribution',
    titleZh: '情感极性分布（含未判样本）',
    priority: 95,
    defaultSpan: 'half',
    compactCapable: true,
    dependencies: ['sampleCount >= 1', 'classifiedRate >= 25% & classifiedCount >= 3'],
    evaluate: (s, t) => {
      if (s.sampleCount === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('0 items were sampled in this sentiment task.', '本轮情感分析任务样本数为 0。'),
          recoveryHint: t('Select a scope with content and re-run Sentiment Analysis.', '扩大样本范围后重新发起情感分析任务。'),
        };
      }
      const classifiedRate = Math.round((s.classifiedCount / s.sampleCount) * 100);
      const pos = s.counts.find((c) => c.label === 'positive')?.count ?? 0;
      const neg = s.counts.find((c) => c.label === 'negative')?.count ?? 0;
      if (classifiedRate < LOW_SENTIMENT_COVERAGE_PCT || s.classifiedCount < MIN_SENTIMENT_CLASSIFIED) {
        return {
          autoState: 'compact',
          preferredSpan: 'half',
          autoReason: t(
            `Low valid sentiment recognition rate (${classifiedRate}%, ${s.classifiedCount}/${s.sampleCount} classified). Prioritizing coverage & data quality alert over detailed pie chart.`,
            `情感有效识别率较低（仅 ${classifiedRate}%，${s.classifiedCount}/${s.sampleCount} 条命中词典），优先展示识别覆盖率与样本质量提示，并折叠细粒度分布图。`,
          ),
          recoveryHint: t(
            `Full distribution chart unlocks automatically when ≥${LOW_SENTIMENT_COVERAGE_PCT}% (and ≥${MIN_SENTIMENT_CLASSIFIED} items) carry detectable sentiment cues.`,
            `当有效情感命中率达到 ≥${LOW_SENTIMENT_COVERAGE_PCT}% 且至少 ${MIN_SENTIMENT_CLASSIFIED} 条有效样本时自动恢复完整分布图。`,
          ),
          metricPreview: `${classifiedRate}% ${t('classified', '有效识别')}`,
          compactMetrics: [
            {
              label: t('Valid Recognition Rate', '有效情感识别率'),
              value: `${classifiedRate}%`,
              hint: `${s.classifiedCount} / ${s.sampleCount} ${t('items', '条')}`,
            },
            {
              label: t('Unclassified (Objective / No Cue)', '未判样本（无词典命中）'),
              value: `${s.unclassifiedCount} (${100 - classifiedRate}%)`,
            },
            { label: t('Positive / Negative', '正面 / 负面命中'), value: `${pos} / ${neg}` },
          ],
          compactSummary: s.summaryText,
        };
      }
      return { autoState: 'full', preferredSpan: 'half' };
    },
  },
  {
    id: 'l3.sentimentTrend',
    layer: 'l3',
    section: 'sentiment',
    titleEn: 'Sentiment Over Time',
    titleZh: '情感倾向时间演变趋势',
    priority: 88,
    defaultSpan: 'half',
    compactCapable: false,
    dependencies: ['classifiedRate >= 25%', 'trend.length >= 2'],
    evaluate: (s, t) => {
      if (s.sampleCount === 0 || s.trend.length === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No dated time trend points in this task result.', '本次情感分析结果中无时间序列分布点。'),
          recoveryHint: t('Run task on dated samples across multiple days.', '在带有效发布时间的跨日样本上运行任务后可用。'),
        };
      }
      const classifiedRate = Math.round((s.classifiedCount / s.sampleCount) * 100);
      if (classifiedRate < LOW_SENTIMENT_COVERAGE_PCT || s.classifiedCount < MIN_SENTIMENT_CLASSIFIED) {
        return {
          autoState: 'collapsed',
          autoReason: t(
            `Valid sentiment rate is only ${classifiedRate}% (${s.classifiedCount} items); time-trend stacked bars are dominated by unclassified noise.`,
            `情感有效识别率过低（仅 ${classifiedRate}% / ${s.classifiedCount} 条），时间演变图绝大多数为“未判”底噪，已自动折叠。`,
          ),
          recoveryHint: t('Restores automatically once valid sentiment recognition exceeds 25% across ≥2 days.', '有效情感命中率 ≥25% 且覆盖 ≥2 个时间分桶后自动恢复。'),
          metricPreview: `${classifiedRate}% · ${s.trend.length} ${t('buckets', '天')}`,
        };
      }
      if (s.trend.length < 2) {
        return {
          autoState: 'collapsed',
          autoReason: t('Only 1 time bucket covered; sentiment evolution cannot be tracked.', '情感结果仅涵盖 1 个时间分桶，难以展示倾向演变轨迹。'),
          recoveryHint: t('Restores automatically when samples cover ≥2 days.', '采集覆盖至少 2 天后再重跑分析即可自动展开。'),
          metricPreview: s.trend[0]?.bucket,
        };
      }
      return { autoState: 'full', preferredSpan: 'half' };
    },
  },
  {
    id: 'l3.sentimentExemplars',
    layer: 'l3',
    section: 'sentiment',
    titleEn: 'Strongest Sentiment Exemplars',
    titleZh: '高分正面 / 负面代表性样本',
    priority: 82,
    defaultSpan: 'full',
    compactCapable: true,
    dependencies: ['exemplars >= 1'],
    evaluate: (s, t) => {
      if (s.exemplars.length === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No clearly positive or negative exemplars reached polarity threshold.', '本次样本中没有达到显著正面/负面打分阈值的典型证据。'),
          recoveryHint: t('Run on broader opinionated discussions.', '在观点表达更丰富的讨论样本上运行后可用。'),
        };
      }
      const classifiedRate = s.sampleCount > 0 ? Math.round((s.classifiedCount / s.sampleCount) * 100) : 0;
      if (classifiedRate < LOW_SENTIMENT_COVERAGE_PCT) {
        return {
          autoState: 'compact',
          preferredSpan: 'full',
          autoReason: t('Low overall classification rate; keeping concise exemplar list.', '整体识别率偏低，已精简展示少数有效命中的强情感样本。'),
          recoveryHint: t('Full exemplar gallery displays once recognition rate ≥25%.', '有效识别率达到 25% 以上后恢复完整列表。'),
          compactMetrics: s.exemplars.slice(0, 3).map((ex) => ({
            label: `${ex.platform.toUpperCase()} · ${ex.label === 'positive' ? t('Positive', '正面') : t('Negative', '负面')} (${ex.score.toFixed(2)})`,
            value: (ex.title || ex.excerpt).slice(0, 48),
          })),
        };
      }
      return { autoState: 'full', preferredSpan: 'full' };
    },
  },
];

export const L3_TOPIC_PANEL_RULES: readonly PanelPolicyRule<L3TopicSummary>[] = [
  {
    id: 'l3.topicsChart',
    layer: 'l3',
    section: 'topics',
    titleEn: 'NMF Topic Share Distribution',
    titleZh: 'NMF 主题分布与核心词簇',
    priority: 95,
    defaultSpan: 'full',
    compactCapable: true,
    dependencies: ['topics >= 2', 'vocabularySize >= 15'],
    evaluate: (tp, t) => {
      if (tp.sampleCount === 0 || tp.topics.length === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('Topic modeling produced 0 active clusters (insufficient vocabulary).', '当前样本词表不足以聚出有效 NMF 主题簇。'),
          recoveryHint: t('Ensure at least 5–10 descriptive text posts exist in scope before re-running.', '扩大至包含更多正文描述的样本后再运行主题发现。'),
        };
      }
      if (tp.topics.length < 2 || tp.vocabularySize < 15) {
        return {
          autoState: 'compact',
          preferredSpan: 'full',
          autoReason: t(
            `Only ${tp.topics.length} topic cluster(s) / ${tp.vocabularySize} vocab words; bar chart compacted to cluster summary.`,
            `仅聚出 ${tp.topics.length} 个主题或有效词表偏小（${tp.vocabularySize} 词），柱状分布图已精简为摘要指标。`,
          ),
          recoveryHint: t('Full chart displays with ≥2 distinct topic clusters and ≥15 vocabulary terms.', '产出 ≥2 个主题且词表 ≥15 词后自动恢复分布柱图。'),
          compactMetrics: tp.topics.slice(0, 3).map((item) => ({
            label: item.label,
            value: `${item.docCount} (${item.sharePct}%)`,
          })),
          compactSummary: tp.summaryText,
        };
      }
      return { autoState: 'full', preferredSpan: 'full' };
    },
  },
  {
    id: 'l3.topicCards',
    layer: 'l3',
    section: 'topics',
    titleEn: 'Topic Keyword Weights & Representative Excerpts',
    titleZh: '主题关键词权重与代表样本明细',
    priority: 85,
    defaultSpan: 'full',
    compactCapable: false,
    dependencies: ['topics >= 1'],
    evaluate: (tp, t) => {
      if (tp.topics.length === 0) {
        return {
          autoState: 'unavailable',
          autoReason: t('No topic clusters extracted.', '尚未生成主题明细卡片。'),
          recoveryHint: t('Re-run topic discovery on a larger text scope.', '扩大文本范围后重跑即可。'),
        };
      }
      return { autoState: 'full', preferredSpan: 'full' };
    },
  },
];
