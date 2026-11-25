import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Flame,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ShieldOff,
  Sliders,
  Sparkles,
  ThumbsUp,
  VolumeX,
  X,
} from 'lucide-react';
import {
  formatApiError,
  useFeedHotQuery,
  useFeedPreferencesQuery,
  useFeedStreamQuery,
  useRecordFeedEventsMutation,
  useResetFeedPreferencesMutation,
  useUpdateFeedPreferencesMutation,
} from '../../api/hooks';
import type {
  Actor,
  FeedCardDto,
  FeedEventType,
  FeedMode,
  Platform,
} from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { formatRelativeTime, safeHttpUrl } from '../../lib/sourceLabels';

interface FeedV2ViewProps {
  actor: Actor | null;
  modeView: 'stream' | 'hot-v2';
  onOpenAuth: (tab?: 'login' | 'register', reason?: string) => void;
  onOpenDetail?: (contentId: string) => void;
}

const STREAM_MODES: Array<{ value: FeedMode; en: string; zh: string }> = [
  { value: 'foryou', en: 'For You Mix', zh: '破茧混排' },
  { value: 'hot', en: 'Hot Signals', zh: '热门讨论' },
  { value: 'following', en: 'Following', zh: '关注主题' },
  { value: 'explore', en: 'Cross-Domain Explore', zh: '跨域探索' },
];

const HOT_WINDOWS: Array<'6h' | '24h' | '48h' | '7d'> = ['6h', '24h', '48h', '7d'];

const VELOCITY_LABEL = {
  surging: { en: 'Surging', zh: '飙升' },
  rising: { en: 'Rising', zh: '升温' },
  steady: { en: 'Steady', zh: '平稳' },
} as const;

function SparklineSvg({ values }: { values: number[] }) {
  if (values.length < 2) {
    return <span style={{ fontSize: 11, color: 'var(--muted)' }}>—</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 72;
  const h = 22;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="热度趋势线">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

function FeedCardItem({
  card,
  rank,
  corroborationCount,
  sparkline,
  authenticated,
  onFeedback,
  onOpenDetail,
  onRegisterVisible,
}: {
  card: FeedCardDto;
  rank?: number;
  corroborationCount?: number;
  sparkline?: number[];
  authenticated: boolean;
  onFeedback: (card: FeedCardDto, eventType: FeedEventType) => void;
  onOpenDetail?: (id: string) => void;
  onRegisterVisible: (el: HTMLElement | null, id: string) => void;
}) {
  const { lang, t } = useI18n();
  const safeUrl = safeHttpUrl(card.url);
  const firstImage = card.media.find((m) => m.type === 'image' && safeHttpUrl(m.previewUrl || m.url));
  const firstImgUrl = firstImage ? safeHttpUrl(firstImage.previewUrl || firstImage.url) : null;
  const firstLinkDomain = card.media.find((m) => m.domain)?.domain;

  return (
    <article
      ref={(el) => onRegisterVisible(el, card.id)}
      className={`wb-card feed-v2-card feed-v2-card--${card.cardLayout}`}
      data-card-id={card.id}
      data-layout={card.cardLayout}
      style={{ padding: 14, display: 'grid', gap: 10 }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {rank !== undefined && (
            <span className="tag tag--ink tabular-nums" style={{ fontWeight: 700 }}>
              #{rank}
            </span>
          )}
          <span className="tag tag--line">{card.platform.toUpperCase()}</span>
          <span className="tag tag--lilac">{card.reason.label}</span>
          {card.intentTag && <span className="tag">{card.intentTag}</span>}
          {card.source.community && <span className="tag">r/{card.source.community}</span>}
          {card.source.flair && <span className="tag">{card.source.flair}</span>}
          {corroborationCount !== undefined && corroborationCount > 1 && (
            <span className="tag tag--amber tabular-nums">
              {t(`${corroborationCount} sources`, `${corroborationCount} 源共振`)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--muted)' }}>
          {sparkline && <SparklineSvg values={sparkline} />}
          <span className="tabular-nums" title={t('Normalized unified heat', '跨平台归一化热度')}>
            <Flame size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 3 }} />
            {card.discussion.unifiedHeat.toFixed(1)} · {VELOCITY_LABEL[card.discussion.heatVelocity][lang]}
          </span>
          {card.publishedAt && <span className="tabular-nums">{formatRelativeTime(card.publishedAt)}</span>}
        </div>
      </header>

      {card.cardLayout === 'quote_social' && card.author && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-2)' }}>
          <span style={{ fontWeight: 600 }}>
            {card.author.displayName || `@${card.author.handle}`}
          </span>
          <span style={{ color: 'var(--muted)' }}>@{card.author.handle}</span>
          {card.author.verified && <span className="tag tag--ok">{t('Verified', '已认证')}</span>}
          {card.author.followersCount != null && (
            <span className="tabular-nums" style={{ color: 'var(--muted)' }}>
              {card.author.followersCount.toLocaleString()} {t('followers', '粉丝')}
            </span>
          )}
        </div>
      )}

      {card.cardLayout === 'hero_media' && firstImgUrl && (
        <div style={{ borderRadius: 6, overflow: 'hidden', maxHeight: 220, background: 'var(--paper)' }}>
          <img
            src={firstImgUrl}
            alt={card.headline}
            loading="lazy"
            style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          {onOpenDetail ? (
            <button
              type="button"
              onClick={() => {
                if (authenticated) onFeedback(card, 'open');
                onOpenDetail(card.id);
              }}
              style={{
                border: 0,
                background: 'none',
                padding: 0,
                textAlign: 'left',
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.4,
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
            >
              {card.headline}
            </button>
          ) : (
            <strong style={{ fontSize: 15, lineHeight: 1.4 }}>{card.headline}</strong>
          )}
          {safeUrl && (
            <a
              href={safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { if (authenticated) onFeedback(card, 'open'); }}
              className="ds-btn ds-btn--ghost"
              style={{ height: 26, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {t('Source', '原文')}
            </a>
          )}
        </div>

        {card.tldr && (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>{card.tldr}</p>
        )}

        {card.cardLayout === 'link_preview' && firstLinkDomain && (
          <div className="tag tag--line" style={{ width: 'fit-content' }}>
            {firstLinkDomain}
          </div>
        )}
      </div>

      {card.topCommentsPreview.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 6,
            background: 'var(--paper)',
            borderLeft: '2px solid var(--line)',
          }}
        >
          {card.topCommentsPreview.map((c, idx) => (
            <div key={idx} style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--ink-2)' }}>
              <strong style={{ color: 'var(--ink)' }}>{c.author}</strong>
              {c.score != null && (
                <span className="tabular-nums" style={{ color: 'var(--muted)', marginLeft: 6 }}>
                  +{c.score}
                </span>
              )}
              <span style={{ marginLeft: 6 }}>{c.text}</span>
            </div>
          ))}
        </div>
      )}

      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 2 }}>
        <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--muted)' }} className="tabular-nums">
          <span>{card.source.label}</span>
          {card.discussion.score != null && <span>{t('Score', '赞')}: {card.discussion.score}</span>}
          {card.discussion.comments != null && (
            <span>
              <MessageSquare size={11} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 3 }} />
              {card.discussion.comments}
            </span>
          )}
          {card.discussion.views != null && <span>{t('Views', '浏览')}: {card.discussion.views.toLocaleString()}</span>}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`ds-btn ${card.viewerState.useful ? '' : 'ds-btn--ghost'}`}
            style={{ height: 26, padding: '0 8px', fontSize: 11 }}
            onClick={() => onFeedback(card, 'useful')}
          >
            <ThumbsUp size={11} />
            <span>{t('Useful', '有用')}</span>
          </button>
          <button
            type="button"
            className={`ds-btn ${card.viewerState.bookmarked ? '' : 'ds-btn--ghost'}`}
            style={{ height: 26, padding: '0 8px', fontSize: 11 }}
            onClick={() => onFeedback(card, 'bookmark')}
          >
            <Bookmark size={11} />
            <span>{card.viewerState.bookmarked ? t('Saved', '已收藏') : t('Save', '收藏')}</span>
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            style={{ height: 26, padding: '0 8px', fontSize: 11 }}
            onClick={() => onFeedback(card, 'dismiss')}
            title={t('Less like this', '减少此类推荐')}
          >
            <X size={11} />
            <span>{t('Dismiss', '不感兴趣')}</span>
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            style={{ height: 26, padding: '0 8px', fontSize: 11 }}
            onClick={() => onFeedback(card, 'mute_source')}
            title={t('Mute this source', '静音此来源')}
          >
            <VolumeX size={11} />
            <span>{t('Mute source', '静音来源')}</span>
          </button>
          {card.author && (
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              style={{ height: 26, padding: '0 8px', fontSize: 11 }}
              onClick={() => onFeedback(card, 'mute_author')}
              title={t('Mute this author', '屏蔽作者')}
            >
              <ShieldOff size={11} />
              <span>{t('Mute author', '屏蔽作者')}</span>
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

export function FeedV2View({ actor, modeView, onOpenAuth, onOpenDetail }: FeedV2ViewProps) {
  const { t } = useI18n();
  const authenticated = Boolean(actor && actor.clientKind === 'browser');

  const [streamMode, setStreamMode] = useState<FeedMode>('foryou');
  const [platform, setPlatform] = useState<'' | Platform>('');
  const [includeNews, setIncludeNews] = useState(false);
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [hotWindow, setHotWindow] = useState<'6h' | '24h' | '48h' | '7d'>('48h');
  const [hotOffset, setHotOffset] = useState(0);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [muteKeywordInput, setMuteKeywordInput] = useState('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const streamQ = useFeedStreamQuery(
    {
      mode: streamMode,
      platform: platform || undefined,
      includeNews,
      limit: 20,
      excludeIds: excludeIds.length ? excludeIds : undefined,
    },
    modeView === 'stream',
  );
  const hotQ = useFeedHotQuery(
    {
      window: hotWindow,
      platform: platform || undefined,
      limit: 25,
      offset: hotOffset,
    },
    modeView === 'hot-v2',
  );

  const prefsQ = useFeedPreferencesQuery(authenticated);
  const updatePrefsMut = useUpdateFeedPreferencesMutation();
  const resetPrefsMut = useResetFeedPreferencesMutation();
  const recordEventMut = useRecordFeedEventsMutation();

  // Report true viewport impressions only after a card intersects >= 60% for >= 500ms.
  const observedEls = useRef<Map<string, HTMLElement>>(new Map());
  const reportedIds = useRef<Set<string>>(new Set());
  const pendingTimers = useRef<Map<string, number>>(new Map());
  const pendingEvents = useRef<Array<{ contentId: string; eventType: FeedEventType; dwellMs?: number }>>([]);
  const recordMutRef = useRef(recordEventMut.mutate);
  useEffect(() => {
    recordMutRef.current = recordEventMut.mutate;
  }, [recordEventMut.mutate]);

  useEffect(() => {
    if (!authenticated) return;
    const queue = pendingEvents.current;
    const flush = recordMutRef.current;
    const flushTimer = window.setInterval(() => {
      if (!queue.length) return;
      flush(queue.splice(0, 50));
    }, 2000);
    return () => {
      window.clearInterval(flushTimer);
      if (queue.length) {
        flush(queue.splice(0, 50));
      }
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || typeof IntersectionObserver === 'undefined') return;
    const timers = pendingTimers.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.cardId;
          if (!id || reportedIds.current.has(id)) continue;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            if (!timers.has(id)) {
              const handle = window.setTimeout(() => {
                timers.delete(id);
                if (!reportedIds.current.has(id)) {
                  reportedIds.current.add(id);
                  pendingEvents.current.push({ contentId: id, eventType: 'impression', dwellMs: 600 });
                }
              }, 500);
              timers.set(id, handle);
            }
          } else {
            const existing = timers.get(id);
            if (existing !== undefined) {
              window.clearTimeout(existing);
              timers.delete(id);
            }
          }
        }
      },
      { threshold: [0.6] },
    );
    for (const el of observedEls.current.values()) observer.observe(el);
    return () => {
      observer.disconnect();
      for (const h of timers.values()) window.clearTimeout(h);
      timers.clear();
    };
  }, [authenticated, modeView, streamQ.data, hotQ.data]);

  const registerVisibleEl = (el: HTMLElement | null, id: string) => {
    if (el) observedEls.current.set(id, el);
    else observedEls.current.delete(id);
  };

  const handleFeedback = (card: FeedCardDto, eventType: FeedEventType) => {
    if (!authenticated) {
      onOpenAuth('login', t('Sign in to save feedback and customize your feed.', '登录后即可收藏、屏蔽来源或调节破茧探索比例。'));
      return;
    }
    setActionMsg(null);
    recordEventMut.mutate(
      [{ contentId: card.id, eventType }],
      {
        onSuccess: () => {
          if (eventType === 'dismiss') setActionMsg(t('Dismissed card and updated affinity.', '已标记不感兴趣并调整推荐权重。'));
          if (eventType === 'mute_source') setActionMsg(t(`Muted ${card.source.label}.`, `已静音来源 ${card.source.label}。`));
          if (eventType === 'mute_author') setActionMsg(t(`Muted author @${card.author?.handle ?? ''}.`, `已屏蔽作者 @${card.author?.handle ?? ''}。`));
        },
        onError: (err) => setActionMsg(formatApiError(err)),
      },
    );
  };

  const prefs = prefsQ.data;
  const explorePct = Math.round((prefs?.exploreRatio ?? streamQ.data?.meta.exploreRatio ?? 0.2) * 100);
  const items = useMemo(() => streamQ.data?.items ?? [], [streamQ.data?.items]);
  const hotItems = useMemo(() => hotQ.data?.items ?? [], [hotQ.data?.items]);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {modeView === 'stream' ? (
            <div className="seg" role="group" aria-label={t('Feed stream mode', '信息流混合模式')}>
              {STREAM_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={streamMode === m.value ? 'on' : ''}
                  onClick={() => { setExcludeIds([]); setStreamMode(m.value); }}
                >
                  {t(m.en, m.zh)}
                </button>
              ))}
            </div>
          ) : (
            <div className="seg" role="group" aria-label={t('Hot leaderboard window', '热榜时间窗')}>
              {HOT_WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={hotWindow === w ? 'on' : ''}
                  onClick={() => { setHotOffset(0); setHotWindow(w); }}
                >
                  {w}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="wb-select"
              aria-label={t('Platform filter', '平台筛选')}
              value={platform}
              onChange={(e) => { setHotOffset(0); setExcludeIds([]); setPlatform(e.target.value as '' | Platform); }}
              style={{ minWidth: 110 }}
            >
              <option value="">{t('All platforms', '全平台')}</option>
              <option value="reddit">Reddit</option>
              <option value="x">X</option>
              <option value="bluesky">Bluesky</option>
              <option value="web">Web / Feed</option>
            </select>

            {modeView === 'stream' && (
              <>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={includeNews}
                    onChange={(e) => { setExcludeIds([]); setIncludeNews(e.target.checked); }}
                  />
                  <span>{t('Include News lane', '含 news 渠道')}</span>
                </label>
                <button
                  type="button"
                  className={`ds-btn ${prefsOpen ? '' : 'ds-btn--ghost'}`}
                  onClick={() => {
                    if (!authenticated) {
                      onOpenAuth('login', t('Sign in to tune explore ratio and mute rules.', '登录后可调节探索占比与静音偏好。'));
                      return;
                    }
                    setPrefsOpen((v) => !v);
                  }}
                >
                  <Sliders size={13} />
                  <span>{t(`Explore ${explorePct}%`, `破茧探索 ${explorePct}%`)}</span>
                </button>
              </>
            )}

            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              onClick={() => (modeView === 'stream' ? streamQ.refetch() : hotQ.refetch())}
            >
              <RefreshCw size={13} />
              <span>{t('Refresh', '刷新')}</span>
            </button>
          </div>
        </div>

        {modeView === 'stream' && streamQ.data && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--muted)' }}>
            <span className="tag tag--line tabular-nums">
              {t(`Candidates: ${streamQ.data.meta.candidateCount}`, `候选池：${streamQ.data.meta.candidateCount}`)}
            </span>
            <span className="tag tag--line tabular-nums">
              {t(`Unseen: ${streamQ.data.meta.unseenRemaining}`, `未读剩余：${streamQ.data.meta.unseenRemaining}`)}
            </span>
            {Object.entries(streamQ.data.meta.channelMix).map(([k, v]) => (
              <span key={k} className="tag tabular-nums">{k}: {v}</span>
            ))}
          </div>
        )}

        {modeView === 'hot-v2' && hotQ.data && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--muted)' }} className="tabular-nums">
            <span className="tag tag--line">
              {t(`Total ranked: ${hotQ.data.totalCount}`, `上榜总量：${hotQ.data.totalCount}`)}
            </span>
            <span>{t('Window', '统计窗')}: {new Date(hotQ.data.from).toLocaleString()} ~ {new Date(hotQ.data.to).toLocaleString()}</span>
          </div>
        )}

        {prefsOpen && authenticated && prefs && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                <Sparkles size={13} />
                <span>{t('Filter-bubble explore ratio (0% - 50%)', '跨池探索比例（0%–50%）')}</span>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={Math.round(prefs.exploreRatio * 100)}
                  onChange={(e) => updatePrefsMut.mutate({ exploreRatio: Number(e.target.value) / 100 })}
                />
                <strong className="tabular-nums">{Math.round(prefs.exploreRatio * 100)}%</strong>
              </label>

              <button
                type="button"
                className="ds-btn ds-btn--ghost"
                disabled={resetPrefsMut.isPending}
                onClick={() => resetPrefsMut.mutate(undefined, {
                  onSuccess: () => {
                    reportedIds.current.clear();
                    setExcludeIds([]);
                    setActionMsg(t('Interest affinity and seen history reset.', '已重置个人兴趣画像与已读记录。'));
                  },
                })}
              >
                <RotateCcw size={12} />
                <span>{t('Reset Interest Profile', '重置兴趣画像')}</span>
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                className="wb-input"
                style={{ maxWidth: 220 }}
                value={muteKeywordInput}
                onChange={(e) => setMuteKeywordInput(e.target.value)}
                placeholder={t('Mute keyword (e.g. airdrop)', '屏蔽关键词')}
              />
              <button
                type="button"
                className="ds-btn ds-btn--ghost"
                disabled={!muteKeywordInput.trim() || updatePrefsMut.isPending}
                onClick={() => {
                  const nextKw = muteKeywordInput.trim().toLowerCase();
                  if (!nextKw) return;
                  const merged = [...new Set([...prefs.mutedKeywords, nextKw])];
                  updatePrefsMut.mutate({ mutedKeywords: merged }, { onSuccess: () => setMuteKeywordInput('') });
                }}
              >
                {t('Add muted keyword', '添加静音词')}
              </button>

              {prefs.mutedKeywords.map((kw) => (
                <button
                  key={kw}
                  type="button"
                  className="tag tag--line"
                  onClick={() => updatePrefsMut.mutate({ mutedKeywords: prefs.mutedKeywords.filter((x) => x !== kw) })}
                  title={t('Click to remove', '点击取消静音')}
                >
                  {kw} ×
                </button>
              ))}
              {prefs.mutedSources.length > 0 && (
                <button
                  type="button"
                  className="tag tag--amber"
                  onClick={() => updatePrefsMut.mutate({ mutedSources: [] })}
                >
                  {t(`Clear ${prefs.mutedSources.length} muted sources ×`, `清空 ${prefs.mutedSources.length} 个静音源 ×`)}
                </button>
              )}
              {prefs.mutedAuthors.length > 0 && (
                <button
                  type="button"
                  className="tag tag--amber"
                  onClick={() => updatePrefsMut.mutate({ mutedAuthors: [] })}
                >
                  {t(`Clear ${prefs.mutedAuthors.length} muted authors ×`, `清空 ${prefs.mutedAuthors.length} 位屏蔽作者 ×`)}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {actionMsg && (
        <div className="wb-alert wb-alert--info" role="status">
          <span>{actionMsg}</span>
        </div>
      )}

      {modeView === 'stream' ? (
        <>
          {streamQ.isError && <div className="wb-alert wb-alert--error">{formatApiError(streamQ.error)}</div>}
          {streamQ.isPending && <div className="wb-card" style={{ padding: 20 }}>{t('Loading multi-pool feed stream…', '正在加载四池破茧信息流…')}</div>}
          {streamQ.isSuccess && items.length === 0 && (
            <div className="wb-card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
              {t('No matching cards remain in the active stream pool.', '当前筛选与去重条件下暂无更多候选卡片，可重置兴趣或换个模式查看。')}
            </div>
          )}
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((card) => (
              <FeedCardItem
                key={card.id}
                card={card}
                authenticated={authenticated}
                onFeedback={handleFeedback}
                onOpenDetail={onOpenDetail}
                onRegisterVisible={registerVisibleEl}
              />
            ))}
          </div>
          {streamQ.data && items.length > 0 && streamQ.data.meta.unseenRemaining > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                className="ds-btn"
                onClick={() => {
                  const nextExcludes = [...new Set([...excludeIds, ...items.map((c) => c.id)])].slice(-120);
                  setExcludeIds(nextExcludes);
                }}
              >
                {t('Next deduplicated batch', '加载下一批去重内容')}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {hotQ.isError && <div className="wb-alert wb-alert--error">{formatApiError(hotQ.error)}</div>}
          {hotQ.isPending && <div className="wb-card" style={{ padding: 20 }}>{t('Loading cross-platform hot board…', '正在加载跨平台热榜…')}</div>}
          {hotQ.isSuccess && hotItems.length === 0 && (
            <div className="wb-card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
              {t('No items observed in the selected hot window.', '所选时间窗内尚无满足条件的热榜条目。')}
            </div>
          )}
          <div style={{ display: 'grid', gap: 12 }}>
            {hotItems.map((entry) => (
              <FeedCardItem
                key={entry.card.id}
                card={entry.card}
                rank={entry.rank}
                corroborationCount={entry.corroborationCount}
                sparkline={entry.sparkline}
                authenticated={authenticated}
                onFeedback={handleFeedback}
                onOpenDetail={onOpenDetail}
                onRegisterVisible={registerVisibleEl}
              />
            ))}
          </div>
          {hotQ.data && (hotOffset > 0 || hotQ.data.nextOffset !== null) && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              <button
                type="button"
                className="ds-btn ds-btn--ghost"
                disabled={hotOffset === 0}
                onClick={() => setHotOffset(Math.max(0, hotOffset - 25))}
              >
                {t('Prev page', '上一页')}
              </button>
              <button
                type="button"
                className="ds-btn"
                disabled={hotQ.data.nextOffset === null}
                onClick={() => {
                  if (hotQ.data?.nextOffset != null) setHotOffset(hotQ.data.nextOffset);
                }}
              >
                {t('Next page', '下一页')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
