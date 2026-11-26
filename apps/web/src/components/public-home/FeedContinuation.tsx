import { ArrowRight, BookOpen, Loader2, RefreshCw, Search } from 'lucide-react';
import { useI18n } from '../../i18n/translations';

interface FeedContinuationProps {
  hasMore: boolean;
  isFetchingNextPage: boolean;
  fetchNextError: string | null;
  visibleCount: number;
  selectedGroup: string;
  channelScope?: 'info' | 'social';
  onLoadMore: () => void;
  onNavigate: (path: string) => void;
}

export function FeedContinuation({
  hasMore,
  isFetchingNextPage,
  fetchNextError,
  visibleCount,
  selectedGroup,
  channelScope = 'info',
  onLoadMore,
  onNavigate,
}: FeedContinuationProps) {
  const { t } = useI18n();
  const fullFeedPath =
    channelScope === 'social'
      ? '/app/feed?scope=social&view=stream'
      : selectedGroup
        ? `/app/feed?scope=info&sourceGroup=${encodeURIComponent(selectedGroup)}`
        : '/app/feed?scope=info';

  return (
    <div className="sh-continuation">
      {fetchNextError && (
        <div className="sh-continuation-error" role="alert">
          <span>{fetchNextError}</span>
          <button
            type="button"
            className="sh-btn-outline"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            <RefreshCw size={13} aria-hidden="true" />
            <span>{t('Retry page', '重试加载')}</span>
          </button>
        </div>
      )}

      {hasMore ? (
        <div className="sh-continuation-actions">
          <button
            type="button"
            className="sh-load-more-btn"
            disabled={isFetchingNextPage}
            onClick={onLoadMore}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 size={15} className="sh-spin" aria-hidden="true" />
                <span>{t('Loading more picks...', '正在加载更多精选…')}</span>
              </>
            ) : (
              <span>{t('Load More Picks', '加载更多精选')}</span>
            )}
          </button>

          <button
            type="button"
            className="sh-inline-link"
            onClick={() => onNavigate(fullFeedPath)}
          >
            <BookOpen size={13} aria-hidden="true" />
            <span>{t('Open full feed & filters', '打开完整信息流与筛选')}</span>
            <ArrowRight size={12} aria-hidden="true" />
          </button>
        </div>
      ) : visibleCount > 0 ? (
        <div className="sh-continuation-end">
          <p>
            {t(
              'You have reached the end of the current 7-day stored sample window for this view.',
              '已浏览完当前 7 天已存样本窗口内的全部精选内容。',
            )}
          </p>
          <div className="sh-continuation-end-links">
            <button
              type="button"
              className="sh-btn-outline"
              onClick={() => onNavigate(fullFeedPath)}
            >
              <BookOpen size={13} aria-hidden="true" />
              <span>{t('Full Feed (/app/feed)', '进入完整信息流')}</span>
            </button>
            <button
              type="button"
              className="sh-btn-outline"
              onClick={() => onNavigate('/content')}
            >
              <Search size={13} aria-hidden="true" />
              <span>{t('Search Historical Archive', '检索历史归档 (/content)')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
