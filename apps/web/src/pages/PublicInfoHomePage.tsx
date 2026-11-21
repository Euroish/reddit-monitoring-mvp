import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BookOpen,
  Calendar,
  Flame,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  formatApiError,
  useAnnotationsListQuery,
  usePublicSourcesQuery,
  useSaveAnnotationMutation,
  useStoriesQuery,
} from '../api/hooks';
import { ReaderDrawer } from '../components/stories/ReaderDrawer';
import {
  type ReaderPreview,
  evidenceToReaderPreview,
  storyToReaderPreview,
} from '../components/stories/readerTypes';
import { StoryMicrocharts } from '../components/stories/StoryMicrocharts';
import { type Actor, type Platform, type StoryItem, validateSearchTerm } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import {
  SOURCE_GROUPS,
  type SourceGroupKey,
  TIER_SHORT,
  decodeHtmlEntities,
  formatExactTime,
  formatRelativeTime,
  safeHttpUrl,
} from '../lib/sourceLabels';

interface PublicInfoHomePageProps {
  actor: Actor | null;
  onNavigate: (path: string) => void;
  onOpenAuth: (tab?: 'login' | 'register', reason?: string) => void;
}

const BADGE_LABELS = {
  surge: { zh: '飙升', en: 'Surge' },
  rising: { zh: '升温', en: 'Rising' },
  new: { zh: '新上榜', en: 'New' },
} as const;

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

  const publicSourcesQuery = usePublicSourcesQuery(true);
  const groupCounts = publicSourcesQuery.data?.groupCounts ?? {};

  // Small-limit queries sharing React Query cache with real /v1/content/stories
  const latestQuery = useStoriesQuery({
    view: 'latest',
    limit: 8,
    ...(selectedGroup ? { sourceGroup: selectedGroup } : {}),
  });
  const hotQuery = useStoriesQuery({
    view: 'hot',
    limit: 6,
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

  const handleSearchSubmit = (e: React.FormEvent) => {
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

  const latestItems = latestQuery.data?.items ?? [];
  const hotItems = hotQuery.data?.items ?? [];
  const digestItems = digestQuery.data?.items ?? [];
  const activeGroupLabel = selectedGroup
    ? SOURCE_GROUPS[selectedGroup as SourceGroupKey]?.[lang] ?? selectedGroup
    : null;

  const renderStoryRow = (story: StoryItem) => {
    const rep = story.representative;
    const title = decodeHtmlEntities(rep.title || '无标题内容');
    const excerpt = decodeHtmlEntities(story.excerpt);
    const href = safeHttpUrl(rep.url);
    const isSaved = savedIds.has(rep.id);
    const ts = rep.publishedAt ?? rep.discoveredAt;

    return (
      <article key={story.storyKey} className="story-card" style={{ marginBottom: 0 }}>
        <div className="story-meta">
          <span className={`story-tier-pill tier-${rep.tier.toLowerCase()}`}>{TIER_SHORT[rep.tier]}</span>
          <span className="story-source">{rep.sourceLabel}</span>
          <time dateTime={ts} title={formatExactTime(ts)}>{formatRelativeTime(ts)}</time>
          {story.sourceCount >= 2 && (
            <span className="tag tag--line" style={{ height: 19, fontSize: 10 }}>
              {story.sourceCount} {t('sources', '源印证')}
            </span>
          )}
          {story.badges.map((badge) => (
            <span key={badge} className={`story-badge badge-${badge}`}>
              {BADGE_LABELS[badge][lang]}
            </span>
          ))}
        </div>

        <h3 className="story-title" style={{ marginTop: 6 }}>
          <button
            type="button"
            className="story-title-btn"
            onClick={() => setReader(storyToReaderPreview(story))}
          >
            {title}
          </button>
        </h3>

        {excerpt && <p className="story-excerpt">{excerpt}</p>}

        <div className="story-foot" style={{ marginTop: 8 }}>
          <StoryMicrocharts story={story} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="ds-btn ds-btn--ghost"
                style={{ height: 26, fontSize: 11, padding: '0 8px' }}
              >
                <span>{t('Original', '原文')}</span>
                <ArrowUpRight size={12} />
              </a>
            )}
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              style={{ height: 26, fontSize: 11, padding: '0 8px' }}
              disabled={savingBookmark}
              onClick={() => void handleBookmark(rep.id)}
            >
              <Bookmark size={12} fill={isSaved ? 'currentColor' : 'none'} />
              <span>{isSaved ? t('Saved', '已收藏') : t('Save', '收藏')}</span>
            </button>
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="pih-wrap">
      {/* Compact Information Discovery Hero */}
      <section className="pih-hero">
        <div className="pih-hero-top">
          <div>
            <span className="pih-eyebrow">
              <Sparkles size={12} />
              {t('Live Multi-Source Feed · stored_sample', '多源实时信息流 · 已存样本口径')}
            </span>
            <h1>{t('SIFTLINE Public Signal Feed', 'SIFTLINE 公开信息首页')}</h1>
            <p className="pih-hero-sub">
              {t(
                'Scan cross-source deduplicated stories, 48h momentum, and the 08:00 digest immediately—or jump into the full research workbench.',
                '直读跨来源多源印证的今日精选、48 小时热度与 08:00 日报；需要深度筛选、批注与专题监测时一键进入专业工作台。',
              )}
            </p>
          </div>

          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            onClick={() => onNavigate('/app/feed')}
          >
            <BookOpen size={14} />
            <span>{t('Open Full Feed (/app/feed)', '进入完整信息流')}</span>
            <ArrowRight size={13} />
          </button>
        </div>

        <form className="pih-search-row" onSubmit={handleSearchSubmit}>
          <div className="pih-search-box">
            <Search size={16} color="#6c786a" />
            <input
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setSearchError(null);
              }}
              placeholder={t('Search stored stories & discussions (e.g. OpenAI, Kubernetes, pricing)...', '检索已入库报道与社区讨论（例如：多语言、OpenAI、定价）…')}
              aria-label={t('Search public content', '检索公开内容')}
            />
          </div>
          <select
            className="pih-platform-select"
            aria-label={t('Filter by platform', '按平台筛选')}
            value={searchPlatform}
            onChange={(e) => setSearchPlatform(e.target.value as '' | Platform)}
          >
            <option value="">{t('All Platforms', '全部平台')}</option>
            <option value="web">Web / RSS / HN</option>
            <option value="reddit">Reddit</option>
            <option value="x">X</option>
            <option value="bluesky">Bluesky</option>
          </select>
          <button type="submit" className="sr-btn sr-btn--dark" style={{ height: 44, padding: '0 18px' }}>
            {t('Search', '立即检索')}
          </button>
        </form>

        {searchError && (
          <div role="alert" className="wb-alert wb-alert--error" style={{ marginBottom: 12 }}>
            {searchError}
          </div>
        )}

        {/* 8 Source Group Channels */}
        <div className="pih-quick-channels" role="group" aria-label={t('Browse by channel', '按频道浏览')}>
          <button
            type="button"
            className={`pih-chip ${selectedGroup === '' ? 'is-active' : ''}`}
            onClick={() => setSelectedGroup('')}
          >
            <span>{t('All Channels', '全部频道')}</span>
          </button>
          {(Object.keys(SOURCE_GROUPS) as SourceGroupKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`pih-chip ${selectedGroup === key ? 'is-active' : ''}`}
              onClick={() => setSelectedGroup(selectedGroup === key ? '' : key)}
            >
              <span>{SOURCE_GROUPS[key][lang]}</span>
              {typeof groupCounts[key] === 'number' && (
                <span className="pih-chip-count">{groupCounts[key]}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {notice && (
        <div className="wb-alert wb-alert--info" style={{ marginBottom: 16 }}>
          {notice}
        </div>
      )}

      {/* Main 2-column content grid */}
      <div className="pih-grid">
        {/* Left Column: Today's Highlights / Selected Channel */}
        <div>
          <section className="pih-section" aria-labelledby="pih-latest-heading">
            <div className="pih-section-hd">
              <div>
                <h2 id="pih-latest-heading" className="pih-section-title">
                  <BookOpen size={16} color="var(--wb-teal, #1f7471)" />
                  <span>{activeGroupLabel ? activeGroupLabel : t("Today's Highlights", '今日精选')}</span>
                </h2>
                <p className="pih-section-sub">
                  {t(
                    'Deduplicated real stories ranked by recency and T1 > T1.5 > T2 authority · coverage: stored_sample',
                    '跨源去重、按 T1 > T1.5 > T2 选举一手代表 · 已存样本口径 (stored_sample)',
                  )}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="pih-link-btn"
                  onClick={() => void latestQuery.refetch()}
                  title={t('Refresh', '刷新')}
                >
                  <RefreshCw size={12} />
                </button>
                <button
                  type="button"
                  className="pih-link-btn"
                  onClick={() =>
                    onNavigate(selectedGroup ? `/app/feed?sourceGroup=${encodeURIComponent(selectedGroup)}` : '/app/feed')
                  }
                >
                  <span>{t('View all', '查看全部')}</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>

            {latestQuery.isPending && (
              <div className="pih-empty">{t('Loading latest stories...', '正在加载今日精选…')}</div>
            )}
            {latestQuery.isError && (
              <div className="wb-alert wb-alert--error">{formatApiError(latestQuery.error)}</div>
            )}
            {!latestQuery.isPending && !latestQuery.isError && latestItems.length === 0 && (
              <div className="pih-empty">
                {t('No stories matched this channel in the current stored window.', '当前已存样本窗口内该频道暂无报道。')}
              </div>
            )}
            {latestItems.length > 0 && (
              <div style={{ display: 'grid', gap: 12 }}>
                {latestItems.map(renderStoryRow)}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: 48h Momentum + 08:00 Digest Preview */}
        <div>
          <section className="pih-section" aria-labelledby="pih-hot-heading">
            <div className="pih-section-hd">
              <div>
                <h2 id="pih-hot-heading" className="pih-section-title">
                  <Flame size={16} color="#c2592c" />
                  <span>{t('48h Momentum', '48 小时热度')}</span>
                </h2>
                <p className="pih-section-sub">
                  {t('Multi-source coverage density & recency decay', '48 小时多源报道密度与衰减排序')}
                </p>
              </div>
              <button
                type="button"
                className="pih-link-btn"
                onClick={() => onNavigate('/app/feed?view=hot')}
              >
                <span>{t('View all', '查看全部')}</span>
                <ArrowRight size={13} />
              </button>
            </div>

            {hotQuery.isPending && (
              <div className="pih-empty">{t('Loading 48h momentum...', '正在加载 48 小时热度…')}</div>
            )}
            {hotQuery.isError && (
              <div className="wb-alert wb-alert--error">{formatApiError(hotQuery.error)}</div>
            )}
            {!hotQuery.isPending && !hotQuery.isError && hotItems.length === 0 && (
              <div className="pih-empty">{t('No 48h momentum stories yet.', '近 48 小时暂无热度事件。')}</div>
            )}
            {hotItems.length > 0 && (
              <div className="pih-compact-list">
                {hotItems.map((story) => {
                  const rep = story.representative;
                  const title = decodeHtmlEntities(rep.title);
                  return (
                    <div key={story.storyKey} className="pih-compact-item">
                      <button
                        type="button"
                        className="pih-compact-title"
                        onClick={() => setReader(storyToReaderPreview(story))}
                      >
                        {title}
                      </button>
                      <div className="pih-compact-meta">
                        <span className={`story-tier-pill tier-${rep.tier.toLowerCase()}`}>{TIER_SHORT[rep.tier]}</span>
                        <span>{rep.sourceLabel}</span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {t('Heat', '热度')} {story.heat48h.toFixed(1)}
                        </span>
                        {story.sourceCount >= 2 && (
                          <span>· {story.sourceCount} {t('sources', '源')}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="pih-section" aria-labelledby="pih-digest-heading">
            <div className="pih-section-hd">
              <div>
                <h2 id="pih-digest-heading" className="pih-section-title">
                  <Calendar size={16} color="var(--wb-purple, #6850a8)" />
                  <span>{t('08:00 Daily Digest', '08:00 日报精选')}</span>
                </h2>
                <p className="pih-section-sub">
                  {t('Latest morning briefing preview', '最新一期 08:00 日报摘要')}
                </p>
              </div>
              <button
                type="button"
                className="pih-link-btn"
                onClick={() => onNavigate('/app/feed?view=digest')}
              >
                <span>{t('Full & Archive', '完整与历史日报')}</span>
                <ArrowRight size={13} />
              </button>
            </div>

            {digestQuery.isPending && (
              <div className="pih-empty">{t('Loading digest preview...', '正在加载 08:00 日报…')}</div>
            )}
            {digestQuery.isError && (
              <div className="wb-alert wb-alert--error">{formatApiError(digestQuery.error)}</div>
            )}
            {!digestQuery.isPending && !digestQuery.isError && digestItems.length === 0 && (
              <div className="pih-empty">
                {t('No stories in the latest 08:00 digest window yet.', '当前 08:00 日报窗口内暂无入库条目。')}
              </div>
            )}
            {digestItems.length > 0 && (
              <div className="pih-compact-list">
                {digestItems.map((story) => {
                  const rep = story.representative;
                  const title = decodeHtmlEntities(rep.title);
                  const ts = rep.publishedAt ?? rep.discoveredAt;
                  return (
                    <div key={story.storyKey} className="pih-compact-item">
                      <button
                        type="button"
                        className="pih-compact-title"
                        onClick={() => setReader(storyToReaderPreview(story))}
                      >
                        {title}
                      </button>
                      <div className="pih-compact-meta">
                        <span className={`story-tier-pill tier-${rep.tier.toLowerCase()}`}>{TIER_SHORT[rep.tier]}</span>
                        <span>{rep.sourceLabel}</span>
                        <span>·</span>
                        <time title={formatExactTime(ts)}>{formatRelativeTime(ts)}</time>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
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
