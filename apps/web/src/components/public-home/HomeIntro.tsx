import type { FormEvent } from 'react';
import { ArrowRight, BookOpen, Database, Search, X } from 'lucide-react';
import type { Platform } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';

interface HomeIntroProps {
  searchTerm: string;
  searchPlatform: '' | Platform;
  searchError: string | null;
  activeSourceCount: number | null;
  onSearchTermChange: (value: string) => void;
  onSearchPlatformChange: (value: '' | Platform) => void;
  onSearchSubmit: (e: FormEvent) => void;
  onNavigate: (path: string) => void;
}

export function HomeIntro({
  searchTerm,
  searchPlatform,
  searchError,
  activeSourceCount,
  onSearchTermChange,
  onSearchPlatformChange,
  onSearchSubmit,
  onNavigate,
}: HomeIntroProps) {
  const { t } = useI18n();

  return (
    <section className="sh-hero" aria-labelledby="sh-hero-heading">
      <svg className="sh-hero-rings" viewBox="0 0 1200 320" fill="none" aria-hidden="true">
        <circle cx="1050" cy="40" r="240" stroke="currentColor" strokeOpacity="0.09" strokeWidth="1" />
        <circle cx="1050" cy="40" r="340" stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
        <circle cx="140" cy="260" r="210" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
      </svg>

      <div className="sh-hero-inner">
        <h1 id="sh-hero-heading" className="sh-hero-title">
          {t('Spot what matters, one step ahead.', '重要变化，先一步发现。')}
        </h1>
        <p className="sh-hero-sub">
          {t(
            'Trusted multi-source discovery · Deduplicated stories · Direct path to research',
            '可信信源发现 · 多源报道聚合 · 从今日阅读直达深度研究',
          )}
        </p>

        <form className="sh-search-bar" onSubmit={onSearchSubmit} role="search">
          <div className="sh-search-input-wrap">
            <Search size={16} className="sh-search-icon" aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              placeholder={t(
                'Search stored stories & discussions (e.g. OpenAI, PostgreSQL, pricing)...',
                '搜索已收录报道、产品动态与社区讨论（例如：多语言、OpenAI、数据库）…',
              )}
              aria-label={t('Search public content', '检索公开内容')}
            />
            {searchTerm && (
              <button
                type="button"
                className="sh-search-clear"
                aria-label={t('Clear search', '清空搜索词')}
                onClick={() => onSearchTermChange('')}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="sh-search-controls">
            <select
              className="sh-platform-select"
              aria-label={t('Filter by platform', '按平台筛选')}
              value={searchPlatform}
              onChange={(e) => onSearchPlatformChange(e.target.value as '' | Platform)}
            >
              <option value="">{t('All Platforms', '全部平台')}</option>
              <option value="web">Web / RSS / HN</option>
              <option value="reddit">Reddit</option>
              <option value="x">X</option>
              <option value="bluesky">Bluesky</option>
            </select>

            <button type="submit" className="sh-search-submit">
              {t('Search', '立即检索')}
            </button>
          </div>
        </form>

        {searchError && (
          <div role="alert" className="sh-search-error">
            {searchError}
          </div>
        )}

        <div className="sh-scope-strip">
          <button
            type="button"
            className="sh-scope-link"
            onClick={() => onNavigate('/docs#coverage')}
          >
            <Database size={13} aria-hidden="true" />
            <span>
              {activeSourceCount !== null && activeSourceCount > 0
                ? t(
                    `${activeSourceCount} configured public sources · stored_sample`,
                    `${activeSourceCount} 个公开已配置信源 · 已存样本口径`,
                  )
                : t('Coverage: stored_sample', '样本口径：stored_sample')}
            </span>
          </button>

          <span className="sh-scope-sep" aria-hidden="true">·</span>

          <button
            type="button"
            className="sh-scope-link"
            onClick={() => onNavigate('/app/feed')}
          >
            <BookOpen size={13} aria-hidden="true" />
            <span>{t('Open Full Feed', '进入完整信息流')}</span>
            <ArrowRight size={12} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
