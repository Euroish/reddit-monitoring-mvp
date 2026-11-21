import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  formatApiError,
  useAnnotationsListQuery,
  useInfiniteStoriesQuery,
  usePublicSourcesQuery,
  useSaveAnnotationMutation,
} from '../api/hooks';
import { ReaderDrawer } from '../components/stories/ReaderDrawer';
import type { ReaderPreview } from '../components/stories/readerTypes';
import { StoryMicrocharts } from '../components/stories/StoryMicrocharts';
import type {
  Actor,
  SourceTier,
  StoryView,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';
import {
  SOURCE_GROUPS,
  type SourceGroupKey,
  TIER_SHORT,
  decodeHtmlEntities,
  formatExactTime,
  formatRelativeTime,
  safeHttpUrl,
  shiftUtcDate,
} from '../lib/sourceLabels';

const BADGE_LABELS = {
  surge: { zh: '飙升', en: 'Surge' },
  rising: { zh: '升温', en: 'Rising' },
  new: { zh: '新上榜', en: 'New' },
} as const;

const VIEW_META: Record<StoryView, { titleZh: string; titleEn: string; subZh: string; subEn: string }> = {
  latest: {
    titleZh: '今日精选',
    titleEn: "Today's Stories",
    subZh: '跨来源多源印证去重信息流 · 已存样本口径 (stored_sample)',
    subEn: 'Cross-source deduplicated editorial stories · stored_sample',
  },
  hot: {
    titleZh: '48 小时热度',
    titleEn: '48h Momentum',
    subZh: '按 48 小时多源报道密度与时间衰减排序 · 零虚构基线',
    subEn: 'Ranked by 48h multi-source coverage density and recency',
  },
  digest: {
    titleZh: '08:00 日报',
    titleEn: '08:00 Daily Digest',
    subZh: '按日归档的重要信号事件摘要，支持按日回溯',
    subEn: 'Daily signal briefing with day-by-day archive browsing',
  },
};

const DENSITY_KEY = 'siftline.feed.density';

function loadDensity(): 'comfortable' | 'compact' {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function StoriesPage({
  actor,
  initialSearchString = '',
  basePath = '/app/feed',
  onNavigate,
  onOpenAuth,
}: {
  actor: Actor | null;
  initialSearchString?: string;
  basePath?: string;
  onNavigate: (path: string) => void;
  onOpenAuth: (tab?: 'login' | 'register', reason?: string) => void;
}) {
  const { lang, t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);

  const sp = useMemo(() => new URLSearchParams(initialSearchString), [initialSearchString]);
  const rawView = sp.get('view');
  const view: StoryView = rawView === 'hot' || rawView === 'digest' ? rawView : 'latest';
  const date = view === 'digest' ? sp.get('date') : null;
  const sourceGroup = sp.get('sourceGroup') ?? '';
  const tier = (sp.get('tier') as SourceTier | '') ?? '';
  const language = sp.get('language') ?? '';
  const sourceId = sp.get('sourceId') ?? '';

  const [density, setDensity] = useState<'comfortable' | 'compact'>(loadDensity);
  const [reader, setReader] = useState<ReaderPreview | null>(null);
  const annotations = useAnnotationsListQuery(Boolean(actor)).data?.annotations;
  const savedIds = useMemo(
    () => new Set(annotations?.filter((item) => item.favorite).map((item) => item.content_id)),
    [annotations],
  );
  const { mutateAsync: saveBookmark, isPending: isSavingBookmark } = useSaveAnnotationMutation();
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const publicSourcesQuery = usePublicSourcesQuery(true);
  const publicSources = useMemo(
    () => publicSourcesQuery.data?.sources ?? [],
    [publicSourcesQuery.data?.sources],
  );
  const groupCounts = useMemo(
    () => publicSourcesQuery.data?.groupCounts ?? {},
    [publicSourcesQuery.data?.groupCounts],
  );
  const activeSource = useMemo(
    () => (sourceId ? publicSources.find((s) => s.id === sourceId) : undefined),
    [publicSources, sourceId],
  );

  const storiesQuery = useInfiniteStoriesQuery({
    view,
    ...(date ? { date } : {}),
    limit: 25,
    ...(view === 'latest' ? { diverse: true } : {}),
    ...(sourceGroup ? { sourceGroup } : {}),
    ...(tier ? { tier } : {}),
    ...(language ? { language } : {}),
    ...(sourceId ? { sourceId } : {}),
  });

  const pages = useMemo(() => storiesQuery.data?.pages ?? [], [storiesQuery.data?.pages]);
  const stories = useMemo(() => pages.flatMap((p) => p.items), [pages]);
  const totalCount = pages[0]?.totalCount ?? stories.length;
  const remaining = Math.max(0, totalCount - stories.length);
  const activeDate = date ?? new Date().toISOString().slice(0, 10);

  const copyDigest = useCallback(async () => {
    const lines = [
      `# SIFTLINE 08:00 Daily Digest (${activeDate})`,
      '',
      ...stories.map((story, idx) => {
        const item = story.representative;
        const title = decodeHtmlEntities(item.title);
        const href = safeHttpUrl(item.url);
        const link = href ? `[${title}](${href})` : title;
        const multi = story.sourceCount >= 2 ? ` · ${story.sourceCount} sources` : '';
        return `${idx + 1}. ${link} — *${item.sourceLabel}* (${TIER_SHORT[item.tier]}${multi})`;
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setStatusNotice(t('Digest copied as Markdown.', '已复制日报 Markdown 到剪贴板。'));
    } catch {
      setStatusNotice(t('Clipboard unavailable in current context.', '当前环境不支持直接写入剪贴板。'));
    }
  }, [activeDate, stories, t]);

  const pushSearch = useCallback(
    (mutator: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(initialSearchString);
      mutator(next);
      const qs = next.toString();
      onNavigate(qs ? `${basePath}?${qs}` : basePath);
    },
    [basePath, initialSearchString, onNavigate],
  );

  const setView = (nextView: StoryView, nextDate?: string | null) => {
    pushSearch((next) => {
      if (nextView === 'latest') next.delete('view');
      else next.set('view', nextView);
      if (nextView === 'digest' && nextDate) next.set('date', nextDate);
      else next.delete('date');
    });
  };

  const setFilterParam = (key: 'sourceGroup' | 'tier' | 'language' | 'sourceId', val: string) => {
    pushSearch((next) => {
      if (val) next.set(key, val);
      else next.delete(key);
    });
  };

  const setDensityMode = (next: 'comfortable' | 'compact') => {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // ignore storage failure
    }
  };

  const handleBookmark = useCallback(
    async (contentId: string) => {
      if (!actor) {
        onOpenAuth('login', t('Sign in to bookmark stories to your workspace.', '登录后可收藏内容到我的研究。'));
        return;
      }
      try {
        await saveBookmark({ contentId });
        setStatusNotice(t('Bookmarked to Workspace.', '已收藏到我的研究。'));
      } catch (err) {
        setStatusNotice(formatApiError(err));
      }
    },
    [actor, onOpenAuth, saveBookmark, t],
  );

  // Keyboard navigation: j/k step articles, m toggles related details
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'j' && e.key !== 'k' && e.key !== 'm') return;
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || reader) return;
      if (document.querySelector('.auth-overlay, .palette-backdrop')) return;
      const cards = Array.from(listRef.current?.querySelectorAll<HTMLElement>('article.story-card') ?? []);
      if (!cards.length) return;
      const activeIdx = cards.findIndex((c) => c === document.activeElement || c.contains(document.activeElement));

      if (e.key === 'j') {
        e.preventDefault();
        const nextCard = cards[activeIdx < 0 ? 0 : Math.min(cards.length - 1, activeIdx + 1)];
        nextCard?.focus();
      } else if (e.key === 'k') {
        e.preventDefault();
        const prevCard = cards[activeIdx <= 0 ? 0 : activeIdx - 1];
        prevCard?.focus();
      } else if (e.key === 'm' && activeIdx >= 0) {
        const details = cards[activeIdx]?.querySelector<HTMLDetailsElement>('details');
        if (details) {
          e.preventDefault();
          details.open = !details.open;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reader]);

  const activeGroupLabel = sourceGroup
    ? SOURCE_GROUPS[sourceGroup as SourceGroupKey]?.[lang] ?? sourceGroup
    : null;
  const heading = activeGroupLabel
    ? activeGroupLabel
    : lang === 'zh'
      ? VIEW_META[view].titleZh
      : VIEW_META[view].titleEn;
  const subHeading = lang === 'zh' ? VIEW_META[view].subZh : VIEW_META[view].subEn;

  return (
    <div className="ds-page story-page">
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{heading}</h1>
            <span className="tag tag--line tabular-nums">
              {totalCount.toLocaleString()} {t('stories', '条报道')}
            </span>
            {activeSource && (
              <span className="tag tag--lilac" style={{ gap: 5 }}>
                <span>{activeSource.label}</span>
                <button
                  type="button"
                  onClick={() => setFilterParam('sourceId', '')}
                  style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', color: 'inherit' }}
                  aria-label={t('Clear source filter', '清除来源筛选')}
                >
                  <X size={11} />
                </button>
              </span>
            )}
          </div>
          <p className="page-desc">{subHeading}</p>
        </div>

        <div className="page-actions">
          <div className="seg" role="group" aria-label={t('Reading density', '阅读密度')}>
            <button
              type="button"
              className={density === 'comfortable' ? 'on' : ''}
              onClick={() => setDensityMode('comfortable')}
            >
              {t('Comfortable', '舒适')}
            </button>
            <button
              type="button"
              className={density === 'compact' ? 'on' : ''}
              onClick={() => setDensityMode('compact')}
            >
              {t('Compact', '紧凑')}
            </button>
          </div>
          <button
            type="button"
            className="icon-square"
            style={{ width: 32, height: 32 }}
            onClick={() => storiesQuery.refetch()}
            title={t('Refresh feed', '刷新信息流')}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* View Switcher & Digest Day Navigation */}
      <div className="story-toolbar">
        <nav className="seg ink" aria-label="信息流视图">
          <button
            type="button"
            className={view === 'latest' ? 'on' : ''}
            onClick={() => setView('latest')}
          >
            {t('Top Stories', '精选信息流')}
          </button>
          <button
            type="button"
            className={view === 'hot' ? 'on' : ''}
            onClick={() => setView('hot')}
          >
            {t('48h Hot', '48h 热度榜')}
          </button>
          <button
            type="button"
            className={view === 'digest' ? 'on' : ''}
            onClick={() => setView('digest')}
          >
            {t('08:00 Digest', '08:00 日报')}
          </button>
        </nav>

        {view === 'digest' && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              style={{ height: 28, fontSize: 11.5, padding: '0 9px' }}
              onClick={() => setView('digest', shiftUtcDate(activeDate, -1))}
            >
              <ChevronLeft size={13} />
              <span>{t('Prev Day', '前一日')}</span>
            </button>
            <span className="tag tag--line tabular-nums" style={{ height: 28 }}>{activeDate}</span>
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              style={{ height: 28, fontSize: 11.5, padding: '0 9px' }}
              onClick={() => setView('digest', shiftUtcDate(activeDate, 1))}
            >
              <span>{t('Next Day', '后一日')}</span>
              <ChevronRight size={13} />
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              style={{ height: 28, fontSize: 11.5, padding: '0 9px' }}
              disabled={stories.length === 0}
              onClick={() => void copyDigest()}
            >
              <Copy size={12} />
              <span>{t('Copy Markdown', '复制 Markdown')}</span>
            </button>
          </div>
        )}

        <div className="seg" role="group" aria-label={t('Authority tier', '来源等级')}>
          {([
            ['', t('All Tiers', '全部等级')],
            ['T1', 'T1'],
            ['T1_5', 'T1.5'],
            ['T2', 'T2'],
          ] as const).map(([val, label]) => (
            <button
              key={val || 'all'}
              type="button"
              aria-pressed={tier === val}
              className={tier === val ? 'on' : ''}
              onClick={() => setFilterParam('tier', val)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="seg" role="group" aria-label={t('Language', '内容语言')}>
          {([
            ['', t('All', '全部')],
            ['zh', '中文'],
            ['en', 'EN'],
          ] as const).map(([val, label]) => (
            <button
              key={val || 'all'}
              type="button"
              aria-pressed={language === val}
              className={language === val ? 'on' : ''}
              onClick={() => setFilterParam('language', val)}
            >
              {label}
            </button>
          ))}
        </div>

        {(sourceGroup || tier || language || sourceId) && (
          <button
            type="button"
            className="auth-link"
            onClick={() =>
              pushSearch((next) => {
                next.delete('sourceGroup');
                next.delete('tier');
                next.delete('language');
                next.delete('sourceId');
              })
            }
          >
            {t('Reset filters', '重置筛选')}
          </button>
        )}
      </div>

      {/* Topic Channel Strip with /v1/public/sources groupCounts */}
      <nav className="story-channels" aria-label="主题频道">
        <button
          type="button"
          className={`story-ch-pill ${!sourceGroup ? 'on' : ''}`}
          onClick={() => setFilterParam('sourceGroup', '')}
        >
          <span>{t('All Channels', '全部频道')}</span>
        </button>
        {(Object.keys(SOURCE_GROUPS) as SourceGroupKey[]).map((key) => {
          const count = groupCounts[key] ?? 0;
          const active = sourceGroup === key;
          return (
            <button
              key={key}
              type="button"
              className={`story-ch-pill ${active ? 'on' : ''}`}
              onClick={() => setFilterParam('sourceGroup', active ? '' : key)}
            >
              <span>{SOURCE_GROUPS[key][lang]}</span>
              {count > 0 && <em className="tabular-nums">{count}</em>}
            </button>
          );
        })}
      </nav>

      {statusNotice && (
        <div role="status" className="wb-alert wb-alert--info" style={{ marginBottom: 12 }}>
          <span>{statusNotice}</span>
          <button type="button" className="auth-link" onClick={() => setStatusNotice(null)}>
            {t('Dismiss', '关闭')}
          </button>
        </div>
      )}

      {storiesQuery.error && (
        <div role="alert" className="wb-alert wb-alert--error" style={{ marginBottom: 12 }}>
          <span>{formatApiError(storiesQuery.error)}</span>
          <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 26, fontSize: 11 }} onClick={() => storiesQuery.refetch()}>
            {t('Retry', '重试')}
          </button>
        </div>
      )}

      {storiesQuery.isPending ? (
        <div className="ds-card" style={{ padding: 36, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          {t('Loading stories stream...', '正在读取信息流…')}
        </div>
      ) : stories.length === 0 ? (
        <div className="ds-card" style={{ padding: 36, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          {t('No stories match the current filter.', '当前筛选条件下暂无事件报道。')}
        </div>
      ) : (
        <div className="story-stream" ref={listRef}>
          {stories.map((story) => {
            const item = story.representative;
            const title = decodeHtmlEntities(item.title);
            const excerpt = decodeHtmlEntities(story.excerpt);
            const href = safeHttpUrl(item.url);
            const thumb = safeHttpUrl(item.thumbnail);
            const timestamp = item.publishedAt ?? item.discoveredAt;
            const showMicrocharts = story.sourceCount >= 2 || view === 'hot';
            const saved = Boolean(actor) && savedIds.has(item.id);

            const openDrawer = () =>
              setReader({
                id: item.id,
                title,
                url: item.url,
                author: item.author,
                sourceLabel: item.sourceLabel,
                tier: item.tier,
                publishedAt: item.publishedAt,
                discoveredAt: item.discoveredAt,
                excerpt,
                thumbnail: item.thumbnail,
                platform: item.platform,
                related: story.related,
              });

            return (
              <article
                key={story.storyKey}
                className={`story-card ${density === 'compact' ? 'is-compact' : ''}`}
                tabIndex={-1}
                data-content-id={item.id}
              >
                <div className="story-meta">
                  <span className={`story-tier-pill tier-${item.tier.toLowerCase()}`}>
                    {TIER_SHORT[item.tier]}
                  </span>
                  <button
                    type="button"
                    className="story-source-btn"
                    onClick={() => setFilterParam('sourceId', item.sourceId)}
                    title={t(`Filter to ${item.sourceLabel}`, `仅看 ${item.sourceLabel}`)}
                  >
                    {item.sourceLabel}
                  </button>
                  {item.author && item.author !== item.sourceLabel && (
                    <span className="story-author">{item.author}</span>
                  )}
                  <time dateTime={timestamp} title={formatExactTime(timestamp)}>
                    {item.publishedAt ? '' : t('Found ', '发现于 ')}
                    {formatRelativeTime(timestamp)}
                  </time>
                  {story.sourceCount >= 2 && (
                    <span className="tag tag--mint tabular-nums" style={{ height: 19, fontSize: 10 }}>
                      {story.sourceCount} {t('sources', '源印证')}
                    </span>
                  )}
                  {view === 'hot' && (
                    <span className="tag tag--lilac tabular-nums" style={{ height: 19, fontSize: 10 }}>
                      {t('Heat', '热度')} {story.heat48h.toFixed(1)}
                    </span>
                  )}
                  {story.badges.map((b) => (
                    <span key={b} className="tag tag--apricot" style={{ height: 19, fontSize: 10 }}>
                      {BADGE_LABELS[b][lang]}
                    </span>
                  ))}
                </div>

                <div className="story-body">
                  <div className="story-copy">
                    <h2 className="story-title">
                      <button type="button" className="story-title-btn" onClick={openDrawer}>
                        {title}
                      </button>
                    </h2>
                    {density === 'comfortable' && excerpt && <p className="story-excerpt">{excerpt}</p>}
                  </div>
                  {thumb && (
                    <button
                      type="button"
                      className="story-thumb-btn"
                      onClick={openDrawer}
                      aria-label={t(`Read: ${title}`, `阅读：${title}`)}
                    >
                      <img
                        src={thumb}
                        alt=""
                        width={112}
                        height={72}
                        loading="lazy"
                        onError={(e) => {
                          const parent = e.currentTarget.parentElement;
                          if (parent) parent.style.display = 'none';
                        }}
                      />
                    </button>
                  )}
                </div>

                {showMicrocharts && <StoryMicrocharts story={story} />}

                <div className="story-actions">
                  <button type="button" className="story-act-btn" onClick={openDrawer}>
                    <BookOpen size={13} />
                    <span>{t('Read', '阅读详情')}</span>
                  </button>
                  <button
                    type="button"
                    className={`story-act-btn ${saved ? 'is-saved' : ''}`}
                    disabled={saved || isSavingBookmark}
                    onClick={() => void handleBookmark(item.id)}
                  >
                    <Bookmark size={13} />
                    <span>{saved ? t('Saved', '已收藏') : t('Bookmark', '收藏')}</span>
                  </button>
                  {href && (
                    <a className="story-act-btn" href={href} target="_blank" rel="noreferrer">
                      <span>{t('Original', '原文')}</span>
                      <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>

                {story.related.length > 0 && (
                  <details className="story-related-fold">
                    <summary>
                      {t(
                        `${story.related.length} related report(s) from other sources`,
                        `展开 ${story.related.length} 条同事件关联报道`,
                      )}
                    </summary>
                    <ul>
                      {story.related.map((rel) => {
                        const relTitle = decodeHtmlEntities(rel.title);
                        const relHref = safeHttpUrl(rel.url);
                        return (
                          <li key={rel.id}>
                            <span className={`story-tier-pill tier-${rel.tier.toLowerCase()}`}>
                              {TIER_SHORT[rel.tier]}
                            </span>
                            <button
                              type="button"
                              className="story-link-btn"
                              onClick={() =>
                                setReader({
                                  id: rel.id,
                                  title: relTitle,
                                  url: rel.url,
                                  author: rel.author,
                                  sourceLabel: rel.sourceLabel,
                                  tier: rel.tier,
                                  publishedAt: rel.publishedAt,
                                  discoveredAt: rel.discoveredAt,
                                  thumbnail: rel.thumbnail,
                                  platform: rel.platform,
                                })
                              }
                            >
                              {relTitle}
                            </button>
                            <small>{rel.sourceLabel}</small>
                            {relHref && (
                              <a href={relHref} target="_blank" rel="noreferrer" aria-label={`打开原文：${relTitle}`}>
                                <ArrowUpRight size={12} />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}

      {storiesQuery.hasNextPage && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            disabled={storiesQuery.isFetchingNextPage}
            onClick={() => void storiesQuery.fetchNextPage()}
          >
            {storiesQuery.isFetchingNextPage
              ? t('Loading more...', '正在加载更多…')
              : remaining > 0
                ? t(`Load more (${remaining.toLocaleString()} remaining)`, `加载更多（剩余 ${remaining.toLocaleString()} 条）`)
                : t('Load more', '加载更多')}
          </button>
        </div>
      )}

      {reader && (
        <ReaderDrawer
          preview={reader}
          actor={actor}
          onOpenAuth={onOpenAuth}
          onSelectRelated={(rel) =>
            setReader({
              id: rel.id,
              title: decodeHtmlEntities(rel.title),
              url: rel.url,
              author: rel.author,
              sourceLabel: rel.sourceLabel,
              tier: rel.tier,
              publishedAt: rel.publishedAt,
              discoveredAt: rel.discoveredAt,
              thumbnail: rel.thumbnail,
              platform: rel.platform,
            })
          }
          onClose={() => setReader(null)}
        />
      )}
    </div>
  );
}
