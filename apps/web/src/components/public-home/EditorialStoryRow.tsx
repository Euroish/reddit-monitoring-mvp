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

interface EditorialStoryRowProps {
  story: StoryItem;
  isSaved: boolean;
  savingBookmark: boolean;
  onOpenReader: (story: StoryItem) => void;
  onBookmark: (contentId: string) => void;
}

export function EditorialStoryRow({
  story,
  isSaved,
  savingBookmark,
  onOpenReader,
  onBookmark,
}: EditorialStoryRowProps) {
  const { t } = useI18n();
  const [imgFailed, setImgFailed] = useState(false);

  const rep = story.representative;
  const title = decodeHtmlEntities(rep.title);
  const excerpt = decodeHtmlEntities(story.excerpt);
  const thumbUrl = safeHttpUrl(rep.thumbnail);
  const href = safeHttpUrl(rep.url);
  const timeInfo = formatStoryTimeInfo(rep);

  return (
    <article className="sh-story-row">
      {thumbUrl && !imgFailed && (
        <div className="sh-story-row-thumb">
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        </div>
      )}

      <div className="sh-story-row-main">
        <h3 className="sh-story-row-title">
          <button
            type="button"
            className="sh-title-trigger"
            onClick={() => onOpenReader(story)}
          >
            {title}
          </button>
        </h3>
        {excerpt && <p className="sh-story-row-excerpt">{excerpt}</p>}
      </div>

      <div className="sh-story-row-aside">
        <div className="sh-story-row-meta">
          <span className="sh-tier-chip">{TIER_SHORT[rep.tier]}</span>
          <span className="sh-source-name">{rep.sourceLabel}</span>
          {story.sourceCount >= 2 && (
            <span className="sh-meta-sources">
              <Layers size={11} aria-hidden="true" />
              <span>{story.sourceCount}</span>
            </span>
          )}
          <time dateTime={timeInfo.iso} title={formatExactTime(timeInfo.iso)}>
            {timeInfo.isFallback
              ? t(`Indexed ${formatRelativeTime(timeInfo.iso)}`, `收录于 ${formatRelativeTime(timeInfo.iso)}`)
              : formatRelativeTime(timeInfo.iso)}
          </time>
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
    </article>
  );
}
