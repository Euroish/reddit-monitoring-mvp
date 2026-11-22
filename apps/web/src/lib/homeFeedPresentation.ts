import type { SourceTier, StoryEvidence, StoryFeed, StoryItem } from '../contracts/api.js';
import { decodeHtmlEntities, safeHttpUrl } from './sourceLabels.js';

export const HOME_FEED_PAGE_SIZE = 18;
export const MAX_STORY_OFFSET_LIMIT = 500;
export const HOME_HOT_DISPLAY_LIMIT = 5;

export type FeaturedReasonKey = 'multi_source_momentum' | 'recent_firsthand' | 'recent_focus';
export type FeaturedTemplate = 'media' | 'data' | 'editorial';

export interface FeaturedSelection {
  story: StoryItem;
  reasonKey: FeaturedReasonKey;
  hotRank: number | null;
  template: FeaturedTemplate;
}

export interface HomeFeedSections {
  allVisible: StoryItem[];
  leadCards: StoryItem[];
  upperRows: StoryItem[];
  lowerRows: StoryItem[];
  hasMore: boolean;
  nextOffset: number | null;
  reachedOffsetLimit: boolean;
  totalRawItems: number;
}

export interface StoryTimeInfo {
  iso: string;
  isFallback: boolean;
}

export interface DigestWindowBadge {
  monthLabel: string;
  dayLabel: string;
  dateIso: string;
  windowLabel: string;
}

const TIER_WEIGHT: Record<SourceTier, number> = {
  T1: 3,
  T1_5: 2,
  T2: 1,
};

function normalizeCanonicalUrl(raw: string | null | undefined): string | null {
  const safe = safeHttpUrl(raw);
  if (!safe) return null;
  try {
    const u = new URL(safe);
    u.hash = '';
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${pathname}${u.search}`;
  } catch {
    return null;
  }
}

export function storyIdentityKeys(story: StoryItem): string[] {
  const keys = new Set<string>();
  if (story.storyKey) keys.add(`key:${story.storyKey}`);
  if (story.representative?.id) keys.add(`id:${story.representative.id}`);
  const repUrl = normalizeCanonicalUrl(story.representative?.url);
  if (repUrl) keys.add(`url:${repUrl}`);
  for (const rel of story.related ?? []) {
    if (rel.id) keys.add(`id:${rel.id}`);
    const relUrl = normalizeCanonicalUrl(rel.url);
    if (relUrl) keys.add(`url:${relUrl}`);
  }
  return Array.from(keys);
}

export function storiesOverlap(a: StoryItem, b: StoryItem): boolean {
  const aKeys = new Set(storyIdentityKeys(a));
  for (const key of storyIdentityKeys(b)) {
    if (aKeys.has(key)) return true;
  }
  return false;
}

export function isReadableStory(story: StoryItem | null | undefined): story is StoryItem {
  if (!story || !story.storyKey || !story.representative?.id) return false;
  return decodeHtmlEntities(story.representative.title).trim().length > 0;
}

export function hasMeaningfulSparkline(sparkline: number[] | undefined | null): boolean {
  if (!Array.isArray(sparkline) || sparkline.length !== 8) return false;
  return sparkline.some((v) => Number.isFinite(v) && v > 0);
}

export function resolveFeaturedTemplate(story: StoryItem): FeaturedTemplate {
  if (safeHttpUrl(story.representative.thumbnail)) return 'media';
  if (hasMeaningfulSparkline(story.sparkline48h) && story.heat48h > 0) return 'data';
  return 'editorial';
}

function storyTimestampMs(story: StoryItem): number {
  const raw = story.representative.publishedAt ?? story.representative.discoveredAt ?? story.updatedAt;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function scoreFeaturedCandidate(story: StoryItem, hotRankMap: Map<string, number>, nowMs: number): number {
  const ageHours = Math.max(0, (nowMs - storyTimestampMs(story)) / 3_600_000);
  const recencyBonus = ageHours <= 24 ? 30 : ageHours <= 72 ? 15 : ageHours <= 168 ? 5 : 0;
  const tierBonus = (TIER_WEIGHT[story.representative.tier] ?? 1) * 8;
  const multiSourceBonus = Math.min(story.sourceCount, 5) * 6;
  const excerptBonus = story.excerpt && decodeHtmlEntities(story.excerpt).trim().length >= 24 ? 6 : 0;
  const hotRank = hotRankMap.get(story.storyKey);
  const hotBonus = hotRank !== undefined ? Math.max(4, 18 - hotRank * 3) : 0;
  return recencyBonus + tierBonus + multiSourceBonus + excerptBonus + hotBonus;
}

export function selectHomeFeaturedStory(
  latestItems: StoryItem[],
  hotItems: StoryItem[],
  nowMs: number = Date.now(),
): FeaturedSelection | null {
  const hotRankMap = new Map<string, number>();
  hotItems.forEach((item, idx) => {
    if (isReadableStory(item) && !hotRankMap.has(item.storyKey)) {
      hotRankMap.set(item.storyKey, idx + 1);
    }
  });

  const pool: StoryItem[] = [];
  const seenKeys = new Set<string>();
  for (const item of [...hotItems, ...latestItems]) {
    if (!isReadableStory(item)) continue;
    const ids = storyIdentityKeys(item);
    if (ids.some((k) => seenKeys.has(k))) continue;
    ids.forEach((k) => seenKeys.add(k));
    pool.push(item);
  }

  if (pool.length === 0) return null;

  const sorted = [...pool].sort((a, b) => {
    const scoreDiff =
      scoreFeaturedCandidate(b, hotRankMap, nowMs) - scoreFeaturedCandidate(a, hotRankMap, nowMs);
    if (scoreDiff !== 0) return scoreDiff;
    const updDiff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (Number.isFinite(updDiff) && updDiff !== 0) return updDiff;
    return a.storyKey.localeCompare(b.storyKey);
  });

  const winner = sorted[0];
  let hotRank: number | null = hotRankMap.get(winner.storyKey) ?? null;
  if (hotRank === null) {
    const matchedIdx = hotItems.findIndex((h) => storiesOverlap(h, winner));
    if (matchedIdx >= 0) hotRank = matchedIdx + 1;
  }

  const ageHours = Math.max(0, (nowMs - storyTimestampMs(winner)) / 3_600_000);
  let reasonKey: FeaturedReasonKey = 'recent_focus';
  if (winner.sourceCount >= 2 || hotRank !== null) {
    reasonKey = 'multi_source_momentum';
  } else if (winner.representative.tier === 'T1' && ageHours <= 48) {
    reasonKey = 'recent_firsthand';
  }

  return {
    story: winner,
    reasonKey,
    hotRank,
    template: resolveFeaturedTemplate(winner),
  };
}

export function buildHomeFeedSections(params: {
  pages: StoryFeed[];
  featured: StoryItem | null;
  hotItems: StoryItem[];
  selectedGroup: string;
  leadCardCount?: number;
  upperRowCount?: number;
}): HomeFeedSections {
  const {
    pages,
    featured,
    hotItems,
    selectedGroup,
    leadCardCount = 3,
    upperRowCount = 3,
  } = params;

  const dedupedStream: StoryItem[] = [];
  const seenKeys = new Set<string>();
  let totalRawItems = 0;

  for (const page of pages) {
    for (const item of page.items ?? []) {
      totalRawItems += 1;
      if (!isReadableStory(item)) continue;
      const ids = storyIdentityKeys(item);
      if (ids.some((k) => seenKeys.has(k))) continue;
      ids.forEach((k) => seenKeys.add(k));
      dedupedStream.push(item);
    }
  }

  const hotTop = hotItems.slice(0, HOME_HOT_DISPLAY_LIMIT);
  const excludeList = selectedGroup
    ? featured ? [featured] : []
    : [...(featured ? [featured] : []), ...hotTop];

  const withoutDupes = dedupedStream.filter(
    (item) => !excludeList.some((ref) => storiesOverlap(item, ref)),
  );

  // Guard: never let cross-module exclusion wipe out a sparse feed or channel
  const minKeep = Math.min(2, dedupedStream.length);
  const allVisible = withoutDupes.length >= minKeep ? withoutDupes : dedupedStream;

  const effectiveLead =
    allVisible.length === 0
      ? 0
      : allVisible.length <= 2
        ? allVisible.length
        : Math.min(leadCardCount, allVisible.length);

  const leadCards = allVisible.slice(0, effectiveLead);
  const afterLead = allVisible.slice(effectiveLead);
  const upperRows = afterLead.slice(0, upperRowCount);
  const lowerRows = afterLead.slice(upperRowCount);

  const lastPage = pages[pages.length - 1];
  const rawNextOffset = lastPage?.nextOffset ?? null;
  const reachedOffsetLimit = rawNextOffset === null || rawNextOffset > MAX_STORY_OFFSET_LIMIT;
  const hasMore = rawNextOffset !== null && rawNextOffset <= MAX_STORY_OFFSET_LIMIT;

  return {
    allVisible,
    leadCards,
    upperRows,
    lowerRows,
    hasMore,
    nextOffset: hasMore ? rawNextOffset : null,
    reachedOffsetLimit,
    totalRawItems,
  };
}

export function formatStoryTimeInfo(rep: StoryEvidence): StoryTimeInfo {
  if (rep.publishedAt) {
    return { iso: rep.publishedAt, isFallback: false };
  }
  return { iso: rep.discoveredAt, isFallback: true };
}

export function formatDigestWindowBadge(
  feed: Pick<StoryFeed, 'from' | 'to'> | undefined | null,
  lang: 'en' | 'zh',
): DigestWindowBadge | null {
  if (!feed?.to) return null;
  const ms = Date.parse(feed.to);
  if (!Number.isFinite(ms)) return null;
  const dt = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(dt);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const monthNum = Number(parts.find((p) => p.type === 'month')?.value ?? '0');
  const dayNum = Number(parts.find((p) => p.type === 'day')?.value ?? '0');
  if (!year || !monthNum || !dayNum) return null;

  const dateIso = `${year}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
  const monthNamesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = lang === 'zh' ? `${monthNum}月` : (monthNamesEn[monthNum - 1] ?? `${monthNum}`);
  const dayLabel = lang === 'zh' ? `${dayNum}日` : String(dayNum).padStart(2, '0');
  const windowLabel =
    lang === 'zh'
      ? `${monthNum}月${dayNum}日 08:00 CST 前 24 小时`
      : `24h ending ${monthNamesEn[monthNum - 1]} ${dayNum}, 08:00 CST`;

  return { monthLabel, dayLabel, dateIso, windowLabel };
}

export function formatTrendSummary(
  story: Pick<StoryItem, 'trend' | 'change6h'>,
  lang: 'en' | 'zh',
): { label: string; tone: 'up' | 'down' | 'new' | 'neutral' } {
  if (story.trend === 'new') {
    return { label: lang === 'zh' ? '新上榜' : 'New', tone: 'new' };
  }
  if (story.change6h !== null && Number.isFinite(story.change6h)) {
    const pct = Math.round(story.change6h * 100);
    if (story.trend === 'up' && pct > 0) {
      return { label: `+${pct}%`, tone: 'up' };
    }
    if (story.trend === 'down' && pct < 0) {
      return { label: `${pct}%`, tone: 'down' };
    }
  }
  if (story.trend === 'up') return { label: lang === 'zh' ? '升温' : 'Rising', tone: 'up' };
  if (story.trend === 'down') return { label: lang === 'zh' ? '回落' : 'Cooling', tone: 'down' };
  if (story.trend === 'flat') return { label: lang === 'zh' ? '平稳' : 'Steady', tone: 'neutral' };
  return { label: lang === 'zh' ? '待观察' : 'Observed', tone: 'neutral' };
}
