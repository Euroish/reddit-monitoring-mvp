import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Bookmark, Layers, Sparkles } from 'lucide-react';
import type { StoryItem } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import {
  type FeaturedSelection,
  formatStoryTimeInfo,
  formatTrendSummary,
} from '../../lib/homeFeedPresentation';
import {
  TIER_SHORT,
  decodeHtmlEntities,
  formatExactTime,
  formatRelativeTime,
  safeHttpUrl,
} from '../../lib/sourceLabels';

interface FeaturedSignalProps {
  selection: FeaturedSelection | null;
  loading: boolean;
  error: string | null;
  isSaved: boolean;
  savingBookmark: boolean;
  onOpenReader: (story: StoryItem) => void;
  onBookmark: (contentId: string) => void;
  onRetry: () => void;
}

const REASON_LABELS = {
  multi_source_momentum: { zh: '多源近期关注', en: 'Multi-Source Focus' },
  recent_firsthand: { zh: '一手近期动态', en: 'Firsthand Update' },
  recent_focus: { zh: '近期焦点信号', en: 'Recent Signal' },
} as const;

export function FeaturedSignal({
  selection,
  loading,
  error,
  isSaved,
  savingBookmark,
  onOpenReader,
  onBookmark,
  onRetry,
}: FeaturedSignalProps) {
  const { lang, t } = useI18n();
  const [imgFailedKey, setImgFailedKey] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="sh-featured sh-featured--skeleton" aria-busy="true">
        <div className="sh-skel-line sh-skel-line--short" />
        <div className="sh-skel-line sh-skel-line--title" />
        <div className="sh-skel-line sh-skel-line--title-2" />
        <div className="sh-skel-line sh-skel-line--body" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="sh-featured sh-featured--compact" role="alert">
        <p className="sh-featured-status">{error}</p>
        <button type="button" className="sh-btn-accent" onClick={onRetry}>
          {t('Retry loading signal', '重新加载焦点')}
        </button>
      </div>
    );
  }

  if (!selection) {
    return (
      <div className="sh-featured sh-featured--compact">
        <span className="sh-featured-kicker">
          <Sparkles size={12} aria-hidden="true" />
          <span>{t('Signal Window Empty', '当前窗口暂无焦点')}</span>
        </span>
        <p className="sh-featured-status">
          {t(
            'No stories are available in the current stored sample window. Try searching the full archive or switching channels.',
            '当前已存样本窗口内暂无可展示的焦点报道。可以通过上方搜索检索历史归档或切换频道查看。',
          )}
        </p>
      </div>
    );
  }

  const { story, reasonKey, hotRank, template } = selection;
  const rep = story.representative;
  const title = decodeHtmlEntities(rep.title);
  const excerpt = decodeHtmlEntities(story.excerpt);
  const href = safeHttpUrl(rep.url);
  const thumbUrl = safeHttpUrl(rep.thumbnail);
  const effectiveTemplate =
    template === 'media' && thumbUrl && imgFailedKey !== story.storyKey
      ? 'media'
      : template === 'data'
        ? 'data'
        : 'editorial';
  const timeInfo = formatStoryTimeInfo(rep);
  const trendInfo = formatTrendSummary(story, lang);
  const relatedLabels = Array.from(
    new Set(
      story.related
        .map((r) => r.sourceLabel)
        .filter((label) => label && label !== rep.sourceLabel),
    ),
  ).slice(0, 2);

  const sparkPeak = Math.max(...story.sparkline48h, 0.01);
  const sparkPoints = story.sparkline48h
    .map((val, idx) => `${8 + idx * 28},${68 - (54 * val) / sparkPeak}`)
    .join(' ');

  return (
    <article className={`sh-featured sh-featured--${effectiveTemplate}`} aria-label={t('Featured signal', '焦点信号')}>
      <div className="sh-featured-body">
        <div className="sh-featured-badges">
          <span className="sh-featured-kicker">{REASON_LABELS[reasonKey][lang]}</span>
          <span className="sh-featured-tier">{TIER_SHORT[rep.tier]}</span>
          {hotRank !== null && (
            <span className="sh-featured-rank tabular-nums">
              {t(`48h Heat #${hotRank}`, `48h 热度 #${hotRank}`)}
            </span>
          )}
        </div>

        <h2 className="sh-featured-title">
          <button
            type="button"
            className="sh-featured-title-btn"
            onClick={() => onOpenReader(story)}
          >
            {title}
          </button>
        </h2>

        {excerpt && <p className="sh-featured-excerpt">{excerpt}</p>}

        <div className="sh-featured-meta">
          <span className="sh-featured-source">{rep.sourceLabel}</span>
          {relatedLabels.map((label) => (
            <span key={label} className="sh-featured-source sh-featured-source--secondary">
              {label}
            </span>
          ))}
          {story.sourceCount >= 2 && (
            <span className="sh-featured-count">
              <Layers size={12} aria-hidden="true" />
              <span>{t(`${story.sourceCount} sources`, `${story.sourceCount} 个来源参与`)}</span>
            </span>
          )}
          <time
            className="sh-featured-time"
            dateTime={timeInfo.iso}
            title={formatExactTime(timeInfo.iso)}
          >
            {timeInfo.isFallback
              ? t(`Indexed ${formatRelativeTime(timeInfo.iso)}`, `收录于 ${formatRelativeTime(timeInfo.iso)}`)
              : formatRelativeTime(timeInfo.iso)}
          </time>
        </div>

        <div className="sh-featured-actions">
          <button
            type="button"
            className="sh-btn-accent"
            onClick={() => onOpenReader(story)}
          >
            <span>{t('Read Story', '阅读全文')}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>

          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="sh-btn-dark-ghost"
            >
              <span>{t('Original', '原文')}</span>
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          )}

          <button
            type="button"
            className="sh-btn-dark-ghost"
            disabled={savingBookmark}
            onClick={() => onBookmark(rep.id)}
          >
            <Bookmark size={13} fill={isSaved ? 'currentColor' : 'none'} aria-hidden="true" />
            <span>{isSaved ? t('Saved', '已收藏') : t('Save', '收藏')}</span>
          </button>
        </div>
      </div>

      <div className="sh-featured-visual">
        {effectiveTemplate === 'media' && thumbUrl ? (
          <figure className="sh-featured-media">
            <img
              src={thumbUrl}
              alt=""
              loading="eager"
              referrerPolicy="no-referrer"
              onError={() => setImgFailedKey(story.storyKey)}
            />
          </figure>
        ) : effectiveTemplate === 'data' ? (
          <div className="sh-featured-chart-box">
            <div className="sh-featured-chart-hd">
              <span>{t('48h Sampled Momentum', '48 小时采样热度')}</span>
              <span className="tabular-nums">{trendInfo.label}</span>
            </div>
            <svg
              className="sh-featured-spark"
              viewBox="0 0 212 78"
              role="img"
              aria-label={`已采样热度，从早到晚每 6 小时：${story.sparkline48h.map((v) => v.toFixed(2)).join('，')}`}
            >
              <title>{t('48h sampled momentum (6h buckets)', '48 小时每 6 小时采样热度')}</title>
              <line x1="8" y1="68" x2="204" y2="68" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
              <line x1="8" y1="40" x2="204" y2="40" stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" strokeWidth="1" />
              <polyline
                points={sparkPoints}
                fill="none"
                stroke="var(--wisteria, #dbf477)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {(() => {
              const tiers = ['T1', 'T1_5', 'T2'] as const;
              const tierTotal = tiers.reduce((sum, tier) => sum + story.tierBreakdown[tier], 0);
              if (tierTotal === 0) return null;
              return (
                <div className="sh-featured-chart-ft tabular-nums">
                  <svg
                    width="72"
                    height="10"
                    viewBox="0 0 72 10"
                    role="img"
                    aria-label={`来源分布：${tiers.map((tier) => `${tier} ${story.tierBreakdown[tier]}`).join('，')}`}
                  >
                    <title>{tiers.map((tier) => `${tier}：${story.tierBreakdown[tier]}`).join('，')}</title>
                    {tiers.map((tier, idx) => (
                      <rect
                        key={tier}
                        x={(72 * tiers.slice(0, idx).reduce((s, prev) => s + story.tierBreakdown[prev], 0)) / tierTotal}
                        y="2"
                        width={(72 * story.tierBreakdown[tier]) / tierTotal}
                        height="6"
                        rx="1.5"
                        fill={idx === 0 ? 'var(--wisteria, #dbf477)' : idx === 1 ? 'var(--teal, #258c89)' : 'rgba(255,255,255,0.42)'}
                      />
                    ))}
                  </svg>
                  <span>{t('Heat', '热度')} {story.heat48h.toFixed(1)}</span>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="sh-featured-motif" aria-hidden="true">
            <svg viewBox="0 0 220 190" fill="none">
              <defs>
                <linearGradient id="shPlaneA" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--wisteria, #dbf477)" stopOpacity="0.48" />
                  <stop offset="100%" stopColor="var(--teal, #258c89)" stopOpacity="0.12" />
                </linearGradient>
                <linearGradient id="shPlaneB" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--wisteria, #dbf477)" stopOpacity="0.06" />
                </linearGradient>
              </defs>
              <rect x="26" y="24" width="128" height="92" rx="14" transform="rotate(-7 26 24)" fill="url(#shPlaneA)" stroke="rgba(255,255,255,0.22)" />
              <rect x="64" y="66" width="124" height="88" rx="14" transform="rotate(-7 64 66)" fill="url(#shPlaneB)" stroke="rgba(255,255,255,0.18)" />
              <circle cx="122" cy="108" r="18" fill="var(--wisteria, #dbf477)" fillOpacity="0.2" />
              <circle cx="122" cy="108" r="4" fill="var(--wisteria, #dbf477)" />
            </svg>
          </div>
        )}
      </div>
    </article>
  );
}
