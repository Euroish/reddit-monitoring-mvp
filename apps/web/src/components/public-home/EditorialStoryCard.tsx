import { useState } from 'react';
import { ArrowUpRight, Bookmark, Layers } from 'lucide-react';
import type { StoryItem } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { formatStoryTimeInfo } from '../../lib/homeFeedPresentation';
import {
  TIER_SHORT,
  decodeHtmlEntities,
  formatExactTime,
  formatRelativeTime,
  safeHttpUrl,
} from '../../lib/sourceLabels';

interface EditorialStoryCardProps {
  story: StoryItem;
  variantIndex: number;
  isSaved: boolean;
  savingBookmark: boolean;
  onOpenReader: (story: StoryItem) => void;
  onBookmark: (contentId: string) => void;
}

export function EditorialStoryCard({
  story,
  variantIndex,
  isSaved,
  savingBookmark,
  onOpenReader,
  onBookmark,
}: EditorialStoryCardProps) {
  const { t } = useI18n();
  const [imgFailed, setImgFailed] = useState(false);

  const rep = story.representative;
  const title = decodeHtmlEntities(rep.title);
  const excerpt = decodeHtmlEntities(story.excerpt);
  const thumbUrl = safeHttpUrl(rep.thumbnail);
  const href = safeHttpUrl(rep.url);
  const timeInfo = formatStoryTimeInfo(rep);
  const motifIdx = variantIndex % 3;

  return (
    <article className="sh-lead-card">
      <div className={`sh-lead-visual sh-lead-visual--${motifIdx}`}>
        {thumbUrl && !imgFailed ? (
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="sh-lead-motif" aria-hidden="true">
            {motifIdx === 0 && (
              <svg viewBox="0 0 320 120" fill="none" preserveAspectRatio="xMidYMid slice">
                <path d="M-20 96 C 60 28, 160 116, 340 24" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
                <path d="M-20 112 C 80 48, 190 126, 340 44" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5" />
                <circle cx="252" cy="44" r="34" fill="var(--wisteria, #dbf477)" fillOpacity="0.28" />
              </svg>
            )}
            {motifIdx === 1 && (
              <svg viewBox="0 0 320 120" fill="none" preserveAspectRatio="xMidYMid slice">
                <rect x="28" y="18" width="94" height="58" rx="10" fill="currentColor" fillOpacity="0.08" />
                <rect x="86" y="42" width="128" height="62" rx="10" fill="var(--wisteria, #dbf477)" fillOpacity="0.22" />
                <line x1="228" y1="22" x2="292" y2="22" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
                <line x1="228" y1="36" x2="274" y2="36" stroke="currentColor" strokeOpacity="0.14" strokeWidth="2" />
              </svg>
            )}
            {motifIdx === 2 && (
              <svg viewBox="0 0 320 120" fill="none" preserveAspectRatio="xMidYMid slice">
                <circle cx="72" cy="68" r="56" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5" />
                <circle cx="72" cy="68" r="32" fill="var(--teal, #258c89)" fillOpacity="0.14" />
                <path d="M148 86 L204 42 L252 64 L306 24" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        )}
        <span className="sh-lead-badge">
          {TIER_SHORT[rep.tier]} · {rep.sourceLabel}
        </span>
      </div>

      <div className="sh-lead-body">
        <h3 className="sh-lead-title">
          <button
            type="button"
            className="sh-title-trigger"
            onClick={() => onOpenReader(story)}
          >
            {title}
          </button>
        </h3>

        {excerpt && <p className="sh-lead-excerpt">{excerpt}</p>}

        <div className="sh-lead-foot">
          <div className="sh-lead-meta">
            <time dateTime={timeInfo.iso} title={formatExactTime(timeInfo.iso)}>
              {timeInfo.isFallback
                ? t(`Indexed ${formatRelativeTime(timeInfo.iso)}`, `收录于 ${formatRelativeTime(timeInfo.iso)}`)
                : formatRelativeTime(timeInfo.iso)}
            </time>
            {story.sourceCount >= 2 && (
              <span className="sh-meta-sources">
                <Layers size={11} aria-hidden="true" />
                <span>{t(`${story.sourceCount} sources`, `${story.sourceCount} 源`)}</span>
              </span>
            )}
          </div>

          <div className="sh-row-actions">
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="sh-icon-btn"
                title={t('Open original link', '打开原文链接')}
                aria-label={t(`Open original: ${title}`, `打开原文：${title}`)}
              >
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              className={`sh-icon-btn ${isSaved ? 'is-saved' : ''}`}
              disabled={savingBookmark}
              onClick={() => onBookmark(rep.id)}
              title={isSaved ? t('Saved to Workspace', '已收藏') : t('Save to Workspace', '收藏到工作台')}
              aria-label={isSaved ? t(`Saved: ${title}`, `已收藏：${title}`) : t(`Save: ${title}`, `收藏：${title}`)}
            >
              <Bookmark size={14} fill={isSaved ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
