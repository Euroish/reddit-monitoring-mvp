import { ArrowRight, FileText } from 'lucide-react';
import type { StoryFeed, StoryItem } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { formatDigestWindowBadge } from '../../lib/homeFeedPresentation';
import { decodeHtmlEntities } from '../../lib/sourceLabels';

interface DailyBriefPreviewProps {
  feed: StoryFeed | undefined;
  loading: boolean;
  error: string | null;
  onOpenReader: (story: StoryItem) => void;
  onNavigate: (path: string) => void;
  onRetry: () => void;
}

export function DailyBriefPreview({
  feed,
  loading,
  error,
  onOpenReader,
  onNavigate,
  onRetry,
}: DailyBriefPreviewProps) {
  const { lang, t } = useI18n();
  const items = feed?.items ?? [];
  const badge = formatDigestWindowBadge(feed, lang);
  const archiveTarget = badge?.dateIso
    ? `/app/feed?scope=info&view=digest&date=${encodeURIComponent(badge.dateIso)}`
    : '/app/feed?scope=info&view=digest';

  return (
    <section className="sh-feature-card sh-feature-card--brief" aria-labelledby="sh-brief-heading">
      <div className="sh-feature-hd">
        <div className="sh-feature-title-group">
          <span className="sh-feature-icon-box" aria-hidden="true">
            <FileText size={16} />
          </span>
          <div>
            <h2 id="sh-brief-heading">{t('08:00 Daily Brief', '08:00 每日简报')}</h2>
            <p className="sh-feature-sub">
              {badge
                ? badge.windowLabel
                : t('24h rolling window ending 08:00 Asia/Shanghai', '每日 08:00 (UTC+8) 前 24 小时精选摘要')}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="sh-feature-cta"
          onClick={() => onNavigate(archiveTarget)}
        >
          <span>{t('Archive', '查看往期')}</span>
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>

      <div className="sh-feature-body">
        {loading && (
          <div className="sh-feature-state" aria-busy="true">
            {t('Loading 08:00 daily brief...', '正在加载 08:00 每日简报…')}
          </div>
        )}

        {!loading && error && (
          <div className="sh-feature-state sh-feature-state--error" role="alert">
            <span>{error}</span>
            <button type="button" className="sh-inline-link" onClick={onRetry}>
              {t('Retry', '重试')}
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="sh-feature-state">
            {t('No stories recorded in the latest 08:00 digest window yet.', '最近一期 08:00 日报窗口内暂无入库条目。')}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="sh-brief-content">
            {badge && (
              <div className="sh-brief-date-stamp" aria-label={badge.windowLabel}>
                <span className="sh-brief-month">{badge.monthLabel}</span>
                <strong className="sh-brief-day tabular-nums">{badge.dayLabel}</strong>
              </div>
            )}

            <ul className="sh-brief-list">
              {items.slice(0, 4).map((story) => {
                const title = decodeHtmlEntities(story.representative.title);
                return (
                  <li key={story.storyKey} className="sh-brief-item">
                    <span className="sh-brief-dot" aria-hidden="true" />
                    <button
                      type="button"
                      className="sh-brief-title"
                      onClick={() => onOpenReader(story)}
                    >
                      {title}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
