import { ArrowRight, Flame } from 'lucide-react';
import type { StoryItem } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import {
  HOME_HOT_DISPLAY_LIMIT,
  formatTrendSummary,
  hasMeaningfulSparkline,
} from '../../lib/homeFeedPresentation';
import { decodeHtmlEntities } from '../../lib/sourceLabels';

interface SignalHeatPanelProps {
  items: StoryItem[];
  loading: boolean;
  error: string | null;
  channelScope?: 'info' | 'social';
  socialPlatform?: '' | 'reddit' | 'x' | 'bluesky';
  onOpenReader: (story: StoryItem) => void;
  onNavigate: (path: string) => void;
  onRetry: () => void;
}

function MiniSparkline({ story, lang }: { story: StoryItem; lang: 'en' | 'zh' }) {
  const meaningful = hasMeaningfulSparkline(story.sparkline48h);
  if (!meaningful) {
    return (
      <svg
        width="46"
        height="18"
        viewBox="0 0 46 18"
        className="sh-heat-spark sh-heat-spark--flat"
        role="img"
        aria-label={lang === 'zh' ? '暂无明显波动' : 'No measurable 48h curve'}
      >
        <line x1="2" y1="12" x2="44" y2="12" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
      </svg>
    );
  }
  const peak = Math.max(...story.sparkline48h, 0.01);
  const points = story.sparkline48h
    .map((val, idx) => `${2 + idx * 6},${15 - (12 * val) / peak}`)
    .join(' ');
  const tone =
    story.trend === 'down'
      ? 'down'
      : story.trend === 'up' || story.trend === 'new'
        ? 'up'
        : 'neutral';

  return (
    <svg
      width="46"
      height="18"
      viewBox="0 0 46 18"
      className={`sh-heat-spark sh-heat-spark--${tone}`}
      role="img"
      aria-label={
        lang === 'zh'
          ? `48 小时采样热度趋势，当前热度 ${story.heat48h.toFixed(1)}`
          : `48h sampled heat curve, current heat ${story.heat48h.toFixed(1)}`
      }
    >
      <title>
        {lang === 'zh'
          ? `48h 热度 ${story.heat48h.toFixed(1)}`
          : `48h heat ${story.heat48h.toFixed(1)}`}
      </title>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SignalHeatPanel({
  items,
  loading,
  error,
  channelScope = 'info',
  socialPlatform = '',
  onOpenReader,
  onNavigate,
  onRetry,
}: SignalHeatPanelProps) {
  const { lang, t } = useI18n();
  const visible = items.slice(0, HOME_HOT_DISPLAY_LIMIT);
  const headingText = channelScope === 'social'
    ? t('48h Social Momentum', '48 小时社媒热度')
    : t('48h Momentum', '48小时热度');
  const subText = t(
    'Ranked by independent-source coverage, source tier weights, and time decay',
    '按独立来源覆盖、来源等级权重与时间衰减排序',
  );
  const hotParams = new URLSearchParams({ scope: channelScope, view: 'hot' });
  if (channelScope === 'social' && socialPlatform) hotParams.set('platform', socialPlatform);
  const hotTarget = `/app/feed?${hotParams}`;

  return (
    <section className="sh-heat-panel" aria-labelledby="sh-heat-heading">
      <div className="sh-heat-hd">
        <div className="sh-heat-title-wrap">
          <Flame size={16} className="sh-heat-icon" aria-hidden="true" />
          <h2 id="sh-heat-heading">{headingText}</h2>
        </div>
        <button
          type="button"
          className="sh-inline-link"
          onClick={() => onNavigate(hotTarget)}
        >
          <span>{t('Full list', '完整榜单')}</span>
          <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
      <p className="sh-heat-sub">{subText}</p>

      {loading && (
        <div className="sh-heat-state" aria-busy="true">
          {t('Loading 48h momentum...', '正在加载 48 小时热度…')}
        </div>
      )}

      {!loading && error && (
        <div className="sh-heat-state sh-heat-state--error" role="alert">
          <span>{error}</span>
          <button type="button" className="sh-inline-link" onClick={onRetry}>
            {t('Retry', '重试')}
          </button>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="sh-heat-state">
          {t('No 48h momentum stories in the current window.', '近 48 小时窗口内暂无热度上榜事件。')}
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <ol className="sh-heat-list">
          {visible.map((story, idx) => {
            const rep = story.representative;
            const title = decodeHtmlEntities(rep.title);
            const trend = formatTrendSummary(story, lang);
            return (
              <li key={story.storyKey} className="sh-heat-item">
                <span className={`sh-heat-rank tabular-nums ${idx === 0 ? 'is-top' : ''}`}>
                  {idx + 1}
                </span>
                <div className="sh-heat-item-body">
                  <button
                    type="button"
                    className="sh-heat-item-title"
                    onClick={() => onOpenReader(story)}
                  >
                    {title}
                  </button>
                  <div className="sh-heat-item-meta">
                    <span>{rep.sourceLabel}</span>
                    {story.sourceCount >= 2 && (
                      <span>· {t(`${story.sourceCount} sources`, `${story.sourceCount} 源`)}</span>
                    )}
                    <span className={`sh-trend-pill sh-trend-pill--${trend.tone}`}>
                      {trend.label}
                    </span>
                  </div>
                </div>
                <MiniSparkline story={story} lang={lang} />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
