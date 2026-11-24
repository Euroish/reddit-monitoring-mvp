import type { StoryInsights } from '../../contracts/api.js';

export type InsightPanelId =
  | 'activityTrend'
  | 'hotKeywords'
  | 'composition'
  | 'risingTerms'
  | 'topics';

export interface InsightPanelDecision {
  id: InsightPanelId;
  status: 'ok' | 'degraded' | 'hidden';
  reason?: string;
}

export interface ChannelInsightsPlan {
  primary: InsightPanelDecision[];
  more: InsightPanelDecision[];
  hidden: InsightPanelDecision[];
  allHidden: boolean;
}

export const MAX_PRIMARY_INSIGHT_PANELS = 3;

const DEFAULT_PRIORITY: InsightPanelId[] = [
  'hotKeywords',
  'risingTerms',
  'topics',
  'activityTrend',
  'composition',
];

const CHANNEL_PRIORITIES: Record<string, InsightPanelId[]> = {
  all: DEFAULT_PRIORITY,
  'ai-firsthand': ['risingTerms', 'topics', 'hotKeywords', 'activityTrend', 'composition'],
  'dev-infra': ['hotKeywords', 'topics', 'risingTerms', 'activityTrend', 'composition'],
  'tech-media': ['topics', 'activityTrend', 'hotKeywords', 'composition', 'risingTerms'],
  science: ['topics', 'hotKeywords', 'activityTrend', 'composition', 'risingTerms'],
  'public-affairs': ['topics', 'composition', 'activityTrend', 'hotKeywords', 'risingTerms'],
  'design-visual': ['composition', 'topics', 'hotKeywords', 'activityTrend', 'risingTerms'],
  lifestyle: ['composition', 'activityTrend', 'hotKeywords', 'topics', 'risingTerms'],
  'social-trends': ['risingTerms', 'activityTrend', 'hotKeywords', 'composition', 'topics'],
};

function hasPanelData(insights: StoryInsights, id: InsightPanelId): boolean {
  switch (id) {
    case 'activityTrend':
      return insights.activityTrend.buckets.some((b: { count: number }) => b.count > 0);
    case 'hotKeywords':
      return insights.hotKeywords.items.length > 0;
    case 'composition': {
      const comp = insights.composition;
      return (
        comp.byChannel.length >= 2 ||
        comp.bySource.length >= 2 ||
        comp.byTier.length >= 2 ||
        comp.byLanguage.length >= 2
      );
    }
    case 'risingTerms':
      return insights.risingTerms.mode !== 'hidden' && insights.risingTerms.items.length > 0;
    case 'topics':
      return insights.topics.mode !== 'hidden' && insights.topics.items.length > 0;
  }
}

export function getChannelPriorityOrder(sourceGroup: string): InsightPanelId[] {
  return CHANNEL_PRIORITIES[sourceGroup || 'all'] ?? DEFAULT_PRIORITY;
}

/**
 * Evaluates backend panel states and orders active Channel Insights panels
 * by the current channel's priority, selecting up to 3 primary cards and
 * routing remaining active cards to "More analysis".
 */
export function evaluateChannelInsights(
  insights: StoryInsights,
  sourceGroup: string,
): ChannelInsightsPlan {
  const order = getChannelPriorityOrder(sourceGroup);
  const active: InsightPanelDecision[] = [];
  const hidden: InsightPanelDecision[] = [];

  for (const id of order) {
    const raw = insights.panels[id];
    const valid = raw.status !== 'hidden' && hasPanelData(insights, id);
    if (!valid) {
      hidden.push({
        id,
        status: 'hidden',
        reason: raw.reason,
      });
      continue;
    }
    active.push({
      id,
      status: raw.status,
      reason: raw.reason,
    });
  }

  return {
    primary: active.slice(0, MAX_PRIMARY_INSIGHT_PANELS),
    more: active.slice(MAX_PRIMARY_INSIGHT_PANELS),
    hidden,
    allHidden: active.length === 0,
  };
}
