import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import {
  formatApiError,
  useAnnotationsListQuery,
  useInfiniteStoriesQuery,
  usePublicSourcesQuery,
  useSaveAnnotationMutation,
  useStoriesQuery,
} from '../api/hooks';
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
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [reader, setReader] = useState<ReaderPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cachedGlobalLatest, setCachedGlobalLatest] = useState<StoryItem[]>([]);

  const publicSourcesQuery = usePublicSourcesQuery(true);
  const groupCounts = publicSourcesQuery.data?.groupCounts ?? {};
  const activeSourceCount = publicSourcesQuery.data ? publicSourcesQuery.data.sources.length : null;

  // Single continuous paginated stream for Today's Picks + More Picks
  const picksQuery = useInfiniteStoriesQuery({
    view: 'latest',
    limit: HOME_FEED_PAGE_SIZE,
    ...(selectedGroup ? { sourceGroup: selectedGroup } : {}),
  });

  useEffect(() => {
    if (selectedGroup === '' && picksQuery.data?.pages[0]?.items) {
      setCachedGlobalLatest(picksQuery.data.pages[0].items);
    }
  }, [selectedGroup, picksQuery.data]);

  const hotQuery = useStoriesQuery({
    view: 'hot',
    limit: HOME_HOT_DISPLAY_LIMIT + 1,
  });

  const digestQuery = useStoriesQuery({
    view: 'digest',
    limit: 5,
  });

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
              onOpenReader={openStoryReader}
              onNavigate={onNavigate}
              onRetry={() => void hotQuery.refetch()}
            />
          </div>
        </section>

        {/* 2. Today's Picks (Upper Segment of Continuous Feed) */}
        <section className="sh-band" aria-labelledby="sh-picks-heading">
          <div className="sh-section-bar">
            <div className="sh-section-heading-group">
              <h2 id="sh-picks-heading" className="sh-section-heading">
                {activeGroupLabel ?? t("Today's Picks", '今日精选')}
              </h2>
              <p className="sh-section-sub">
                {t(
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

          <FeedChannelNav
            selectedGroup={selectedGroup}
            groupCounts={groupCounts}
            onSelectGroup={setSelectedGroup}
          />

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
                <button type="button" className="sh-btn-outline" onClick={() => setSelectedGroup('')}>
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
            apiEnabled={false}
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
                    selectedGroup
                      ? `/app/feed?sourceGroup=${encodeURIComponent(selectedGroup)}`
                      : '/app/feed',
                  )
                }
              >
                <span>{t('Full Feed', '浏览完整信息流')}</span>
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
