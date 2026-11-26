import { type FormEvent, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import {
  formatApiError,
  useAnnotationsListQuery,
  useInfiniteStoriesQuery,
  usePublicSourcesQuery,
  useSaveAnnotationMutation,
  useStoriesQuery,
} from '../api/hooks';
import { useAiEventsQuery } from '../api/ai-client';
import { AiReleasePreview } from '../components/public-home/AiReleasePreview';
import { DailyBriefPreview } from '../components/public-home/DailyBriefPreview';
import { EditorialStoryCard } from '../components/public-home/EditorialStoryCard';
import { EditorialStoryRow } from '../components/public-home/EditorialStoryRow';
import { FeaturedSignal } from '../components/public-home/FeaturedSignal';
import { FeedChannelNav } from '../components/public-home/FeedChannelNav';
import { FeedContinuation } from '../components/public-home/FeedContinuation';
import { HomeIntro } from '../components/public-home/HomeIntro';
import { SignalHeatPanel } from '../components/public-home/SignalHeatPanel';
import { ReaderDrawer } from '../components/stories/ReaderDrawer';
import {
  type ReaderPreview,
  evidenceToReaderPreview,
  storyToReaderPreview,
} from '../components/stories/readerTypes';
import { type Actor, type Platform, type StoryItem, validateSearchTerm } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import {
  HOME_FEED_PAGE_SIZE,
  HOME_HOT_DISPLAY_LIMIT,
  buildHomeFeedSections,
  selectHomeFeaturedStory,
} from '../lib/homeFeedPresentation';
import { SOURCE_GROUPS, type SourceGroupKey } from '../lib/sourceLabels';
import '../styles/signal-home.css';

interface PublicInfoHomePageProps {
  actor: Actor | null;
  onNavigate: (path: string) => void;
  onOpenAuth: (tab?: 'login' | 'register', reason?: string) => void;
}

export function PublicInfoHomePage({
  actor,
  onNavigate,
  onOpenAuth,
}: PublicInfoHomePageProps) {
  const { lang, t } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchPlatform, setSearchPlatform] = useState<'' | Platform>('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [homeScope, setHomeScope] = useState<'info' | 'social'>('info');
  const [socialPlatform, setSocialPlatform] = useState<'' | 'reddit' | 'x' | 'bluesky'>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [reader, setReader] = useState<ReaderPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cachedGlobalLatest, setCachedGlobalLatest] = useState<StoryItem[]>([]);

  const publicSourcesQuery = usePublicSourcesQuery(true);
  const infoGroupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of publicSourcesQuery.data?.sources ?? []) {
      if (s.platform === 'web' && s.sourceGroup) {
        counts[s.sourceGroup] = (counts[s.sourceGroup] ?? 0) + s.count48h;
      }
    }
    return counts;
  }, [publicSourcesQuery.data?.sources]);
  const socialPlatformCounts = useMemo(() => {
    const counts: Record<'reddit' | 'x' | 'bluesky', number> = { reddit: 0, x: 0, bluesky: 0 };
    for (const s of publicSourcesQuery.data?.sources ?? []) {
      if (s.platform === 'reddit' || s.platform === 'x' || s.platform === 'bluesky') {
        counts[s.platform] += s.count48h;
      }
    }
    return counts;
  }, [publicSourcesQuery.data?.sources]);
  const activeSourceCount = publicSourcesQuery.data ? publicSourcesQuery.data.sources.length : null;

  // Single continuous paginated stream for Today's Picks + More Picks
  const picksQuery = useInfiniteStoriesQuery({
    view: 'latest',
    limit: HOME_FEED_PAGE_SIZE,
    channelScope: homeScope,
    ...(homeScope === 'info' && selectedGroup ? { sourceGroup: selectedGroup } : {}),
    ...(homeScope === 'social' && socialPlatform ? { platform: socialPlatform } : {}),
  });

  const handleSelectHomeScope = (nextScope: 'info' | 'social') => {
    if (nextScope === homeScope) return;
    setCachedGlobalLatest([]);
    setSelectedGroup('');
    setSocialPlatform('');
    setHomeScope(nextScope);
  };

  const handleSelectGroup = (nextGroup: string) => {
    if (selectedGroup === '' && nextGroup !== '' && picksQuery.data?.pages[0]?.items) {
      setCachedGlobalLatest(picksQuery.data.pages[0].items);
    }
    setSelectedGroup(nextGroup);
  };

  const hotQuery = useStoriesQuery({
    view: 'hot',
    channelScope: homeScope,
    limit: HOME_HOT_DISPLAY_LIMIT + 1,
  });

  const digestQuery = useStoriesQuery({
    view: 'digest',
    channelScope: 'info',
    limit: 5,
  });

  const aiEventsQuery = useAiEventsQuery({ limit: 4 }, true);

  const annotations = useAnnotationsListQuery(Boolean(actor)).data?.annotations;
  const savedIds = useMemo(
    () => new Set(annotations?.filter((a) => a.favorite).map((a) => a.content_id)),
    [annotations],
  );
  const { mutateAsync: saveBookmark, isPending: savingBookmark } = useSaveAnnotationMutation();

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSearchError(null);
    const trimmed = searchTerm.trim();
    if (trimmed) {
      const err = validateSearchTerm(trimmed);
      if (err) {
        setSearchError(err);
        return;
      }
    }
    const sp = new URLSearchParams();
    if (trimmed) sp.set('query', trimmed);
    if (searchPlatform) sp.set('platform', searchPlatform);
    const qs = sp.toString();
    onNavigate(qs ? `/content?${qs}` : '/content');
  };

  const handleBookmark = async (contentId: string) => {
    if (!actor) {
      onOpenAuth('login', t('Sign in to bookmark stories to your workspace.', '登录后可收藏内容到我的研究。'));
      return;
    }
    try {
      await saveBookmark({ contentId });
      setNotice(t('Bookmarked to Workspace.', '已收藏到我的研究。'));
    } catch (err) {
      setNotice(formatApiError(err));
    }
  };

  const openStoryReader = (story: StoryItem) => {
    setReader(storyToReaderPreview(story));
  };

  const hotItems = useMemo(() => hotQuery.data?.items ?? [], [hotQuery.data?.items]);
  const globalLatestItems = useMemo(
    () =>
      selectedGroup === ''
        ? picksQuery.data?.pages[0]?.items ?? cachedGlobalLatest
        : cachedGlobalLatest,
    [selectedGroup, picksQuery.data?.pages, cachedGlobalLatest],
  );

  const featuredSelection = useMemo(
    () => selectHomeFeaturedStory(globalLatestItems, hotItems),
    [globalLatestItems, hotItems],
  );

  const feedSections = useMemo(
    () =>
      buildHomeFeedSections({
        pages: picksQuery.data?.pages ?? [],
        featured: featuredSelection?.story ?? null,
        hotItems,
        selectedGroup,
      }),
    [picksQuery.data?.pages, featuredSelection?.story, hotItems, selectedGroup],
  );

  const activeGroupLabel = selectedGroup
    ? SOURCE_GROUPS[selectedGroup as SourceGroupKey]?.[lang] ?? selectedGroup
    : null;

  const featuredLoading =
    hotQuery.isPending && picksQuery.isPending && cachedGlobalLatest.length === 0;
  const featuredError =
    !featuredSelection && hotQuery.isError && picksQuery.isError
      ? formatApiError(picksQuery.error)
      : null;

  const leadGridModifier =
    feedSections.leadCards.length === 1
      ? 'sh-lead-grid--1'
      : feedSections.leadCards.length === 2
        ? 'sh-lead-grid--2'
        : '';

  return (
    <div className="sh-page">
      <HomeIntro
        searchTerm={searchTerm}
        searchPlatform={searchPlatform}
        searchError={searchError}
        activeSourceCount={activeSourceCount}
        onSearchTermChange={(v) => {
          setSearchTerm(v);
          setSearchError(null);
        }}
        onSearchPlatformChange={setSearchPlatform}
        onSearchSubmit={handleSearchSubmit}
        onNavigate={onNavigate}
      />

      <div className="sh-container">
        <div
          className="sh-channel-nav"
          role="group"
          aria-label={t('Content domain', '内容展示板块')}
          style={{ marginBottom: 14 }}
        >
          <button
            type="button"
            aria-pressed={homeScope === 'info'}
            className={`sh-channel-tab ${homeScope === 'info' ? 'is-active' : ''}`}
            onClick={() => handleSelectHomeScope('info')}
          >
            <span>{t('Info Stream', '资讯信息流')}</span>
          </button>
          <button
            type="button"
            aria-pressed={homeScope === 'social'}
            className={`sh-channel-tab ${homeScope === 'social' ? 'is-active' : ''}`}
            onClick={() => handleSelectHomeScope('social')}
          >
            <span>{t('Social Feed (Reddit / X)', '社媒动态（Reddit / X）')}</span>
          </button>
        </div>

        {notice && (
          <div className="sh-notice" role="status">
            <span>{notice}</span>
            <button
              type="button"
              className="sh-inline-link"
              onClick={() => setNotice(null)}
            >
              {t('Dismiss', '关闭')}
            </button>
          </div>
        )}

        {/* 1. Focus Band: Featured Signal + 48h Momentum */}
        <section className="sh-band" aria-labelledby="sh-focus-heading">
          <div className="sh-section-bar">
            <div className="sh-section-heading-group">
              <h2 id="sh-focus-heading" className="sh-section-heading">
                {t('Focus Signals', '焦点信号')}
              </h2>
              <p className="sh-section-sub">
                {t('Key changes & 48h momentum from stored sources', '值得关注的关键变化与 48 小时热度')}
              </p>
            </div>
          </div>

          <div className="sh-focus-grid">
            <FeaturedSignal
              selection={featuredSelection}
              loading={featuredLoading}
              error={featuredError}
              isSaved={featuredSelection ? savedIds.has(featuredSelection.story.representative.id) : false}
              savingBookmark={savingBookmark}
              onOpenReader={openStoryReader}
              onBookmark={(id) => void handleBookmark(id)}
              onRetry={() => {
                void hotQuery.refetch();
                void picksQuery.refetch();
              }}
            />

            <SignalHeatPanel
              items={hotItems}
              loading={hotQuery.isPending}
              error={hotQuery.isError ? formatApiError(hotQuery.error) : null}
              channelScope={homeScope}
              onOpenReader={openStoryReader}
              onNavigate={onNavigate}
              onRetry={() => void hotQuery.refetch()}
            />
          </div>
        </section>

        {/* 2. Today's Picks / Social Stream */}
        <section className="sh-band" aria-labelledby="sh-picks-heading">
          <div className="sh-section-bar">
            <div className="sh-section-heading-group">
              <h2 id="sh-picks-heading" className="sh-section-heading">
                {homeScope === 'social'
                  ? socialPlatform === 'reddit'
                    ? 'Reddit'
                    : socialPlatform === 'x'
                      ? 'X'
                      : socialPlatform === 'bluesky'
                        ? 'Bluesky'
                        : t('Social Stream', '社媒动态')
                  : activeGroupLabel ?? t("Today's Picks", '今日精选')}
              </h2>
              <p className="sh-section-sub">
                {homeScope === 'social'
                  ? t(
                      'Community discussions & social signals from Reddit / X · Recent 7-day window',
                      '来自 Reddit / X 等社媒平台的近期讨论与信号 · 最近 7 天样本窗口',
                    )
                  : t(
                      'Automatically deduplicated from trusted sources · Recent 7-day window',
                      '来自可信信源的近期自动去重精选 · 最近 7 天样本窗口',
                    )}
              </p>
            </div>

            <div className="sh-section-actions">
              <button
                type="button"
                className="sh-btn-outline"
                onClick={() => void picksQuery.refetch()}
                disabled={picksQuery.isFetching}
              >
                <RefreshCw size={13} className={picksQuery.isFetching ? 'sh-spin' : ''} aria-hidden="true" />
                <span>{t('Refresh', '刷新')}</span>
              </button>
            </div>
          </div>

          {homeScope === 'info' ? (
            <FeedChannelNav
              selectedGroup={selectedGroup}
              groupCounts={infoGroupCounts}
              onSelectGroup={handleSelectGroup}
            />
          ) : (
            <div className="sh-channel-nav" role="group" aria-label={t('Browse by social platform', '按社媒平台筛选')}>
              {([
                ['', t('All Social', '全部社媒'), socialPlatformCounts.reddit + socialPlatformCounts.x + socialPlatformCounts.bluesky],
                ['reddit', 'Reddit', socialPlatformCounts.reddit],
                ['x', 'X', socialPlatformCounts.x],
                ['bluesky', 'Bluesky', socialPlatformCounts.bluesky],
              ] as const).map(([plat, label, count]) => {
                const active = socialPlatform === plat;
                return (
                  <button
                    key={plat || 'all'}
                    type="button"
                    aria-pressed={active}
                    className={`sh-channel-tab ${active ? 'is-active' : ''}`}
                    onClick={() => setSocialPlatform(plat && active ? '' : plat)}
                  >
                    <span>{label}</span>
                    {count > 0 && <span className="sh-channel-count tabular-nums">{count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {picksQuery.isPending && (
            <div className="sh-feed-empty" aria-busy="true">
              {t('Loading recent stories...', '正在加载今日精选…')}
            </div>
          )}

          {picksQuery.isError && feedSections.allVisible.length === 0 && (
            <div className="sh-feed-empty" role="alert">
              <span>{formatApiError(picksQuery.error)}</span>
              <button type="button" className="sh-btn-outline" onClick={() => void picksQuery.refetch()}>
                <RefreshCw size={13} aria-hidden="true" />
                <span>{t('Retry', '重新加载')}</span>
              </button>
            </div>
          )}

          {!picksQuery.isPending && !picksQuery.isError && feedSections.allVisible.length === 0 && (
            <div className="sh-feed-empty">
              <span>
                {t(
                  'No stories matched this channel in the current 7-day stored sample window.',
                  '当前 7 天已存样本窗口内该频道暂无匹配报道。',
                )}
              </span>
              {selectedGroup && (
                <button type="button" className="sh-btn-outline" onClick={() => handleSelectGroup('')}>
                  {t('View All Picks', '查看全部精选')}
                </button>
              )}
            </div>
          )}

          {feedSections.leadCards.length > 0 && (
            <div className={`sh-lead-grid ${leadGridModifier}`}>
              {feedSections.leadCards.map((story, idx) => (
                <EditorialStoryCard
                  key={story.storyKey}
                  story={story}
                  variantIndex={idx}
                  isSaved={savedIds.has(story.representative.id)}
                  savingBookmark={savingBookmark}
                  onOpenReader={openStoryReader}
                  onBookmark={(id) => void handleBookmark(id)}
                />
              ))}
            </div>
          )}

          {feedSections.upperRows.length > 0 && (
            <div className="sh-row-list">
              {feedSections.upperRows.map((story) => (
                <EditorialStoryRow
                  key={story.storyKey}
                  story={story}
                  isSaved={savedIds.has(story.representative.id)}
                  savingBookmark={savingBookmark}
                  onOpenReader={openStoryReader}
                  onBookmark={(id) => void handleBookmark(id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* 3. Mid-Page Feature Band (Inserted ONCE) */}
        <div className="sh-feature-band">
          <AiReleasePreview
            apiEnabled={true}
            events={aiEventsQuery.data?.items ?? []}
            loading={aiEventsQuery.isPending}
            error={aiEventsQuery.isError ? formatApiError(aiEventsQuery.error) : null}
            onNavigate={onNavigate}
          />

          <DailyBriefPreview
            feed={digestQuery.data}
            loading={digestQuery.isPending}
            error={digestQuery.isError ? formatApiError(digestQuery.error) : null}
            onOpenReader={openStoryReader}
            onNavigate={onNavigate}
            onRetry={() => void digestQuery.refetch()}
          />
        </div>

        {/* 4. More Picks (Continuation of Same Paginated Feed) */}
        {(feedSections.lowerRows.length > 0 || feedSections.hasMore) && (
          <section className="sh-band" aria-labelledby="sh-more-heading">
            <div className="sh-section-bar">
              <div className="sh-section-heading-group">
                <h2 id="sh-more-heading" className="sh-section-heading">
                  {t('More Picks', '更多精选')}
                </h2>
                <p className="sh-section-sub">
                  {t(
                    'Continuing the same deduplicated stream across stored sources',
                    '延续同一精选流的更多近期报道与行业观察',
                  )}
                </p>
              </div>
              <button
                type="button"
                className="sh-inline-link"
                onClick={() =>
                  onNavigate(
                    homeScope === 'social'
                      ? '/app/feed?scope=social&view=stream'
                      : selectedGroup
                        ? `/app/feed?scope=info&sourceGroup=${encodeURIComponent(selectedGroup)}`
                        : '/app/feed?scope=info',
                  )
                }
              >
                <span>{homeScope === 'social' ? t('Full Social Feed', '浏览完整社媒流') : t('Full Feed', '浏览完整信息流')}</span>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            </div>

            {feedSections.lowerRows.length > 0 && (
              <div className="sh-row-list">
                {feedSections.lowerRows.map((story) => (
                  <EditorialStoryRow
                    key={story.storyKey}
                    story={story}
                    isSaved={savedIds.has(story.representative.id)}
                    savingBookmark={savingBookmark}
                    onOpenReader={openStoryReader}
                    onBookmark={(id) => void handleBookmark(id)}
                  />
                ))}
              </div>
            )}

            <FeedContinuation
              hasMore={feedSections.hasMore}
              isFetchingNextPage={picksQuery.isFetchingNextPage}
              fetchNextError={
                picksQuery.isFetchNextPageError ? formatApiError(picksQuery.error) : null
              }
              visibleCount={feedSections.allVisible.length}
              selectedGroup={selectedGroup}
              channelScope={homeScope}
              onLoadMore={() => void picksQuery.fetchNextPage()}
              onNavigate={onNavigate}
            />
          </section>
        )}

        {/* End state when all items fit in upper section and no further pages exist */}
        {feedSections.lowerRows.length === 0 && !feedSections.hasMore && feedSections.allVisible.length > 0 && (
          <FeedContinuation
            hasMore={false}
            isFetchingNextPage={false}
            fetchNextError={null}
            visibleCount={feedSections.allVisible.length}
            selectedGroup={selectedGroup}
            channelScope={homeScope}
            onLoadMore={() => void picksQuery.fetchNextPage()}
            onNavigate={onNavigate}
          />
        )}
      </div>

      {reader && (
        <ReaderDrawer
          preview={reader}
          actor={actor}
          onOpenAuth={(tab, reason) => onOpenAuth(tab, reason)}
          onSelectRelated={(ev) => setReader(evidenceToReaderPreview(ev, reader.related))}
          onClose={() => setReader(null)}
        />
      )}
    </div>
  );
}
