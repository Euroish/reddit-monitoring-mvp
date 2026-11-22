import { ArrowRight, CalendarDays, Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n/translations';

/**
 * Lightweight preview event shape aligned with PR #16's AiReleaseEventSchema.
 * When PR #16 (/v1/ai/events) merges into main, PublicInfoHomePage can pass real
 * published events directly into this component without changing layout or markup.
 */
export interface AiPreviewEvent {
  id: string;
  vendorName: string;
  title: string;
  eventDate: string;
  eventType: string;
  eventStatus: string;
}

interface AiReleasePreviewProps {
  apiEnabled?: boolean;
  events?: AiPreviewEvent[];
  loading?: boolean;
  error?: string | null;
  onNavigate: (path: string) => void;
}

export function AiReleasePreview({
  apiEnabled = false,
  events = [],
  loading = false,
  error = null,
  onNavigate,
}: AiReleasePreviewProps) {
  const { t } = useI18n();

  return (
    <section className="sh-feature-card sh-feature-card--ai" aria-labelledby="sh-ai-preview-heading">
      <div className="sh-feature-hd">
        <div className="sh-feature-title-group">
          <span className="sh-feature-icon-box" aria-hidden="true">
            <CalendarDays size={16} />
          </span>
          <div>
            <h2 id="sh-ai-preview-heading">{t('AI Product Releases', 'AI 产品动态')}</h2>
            <p className="sh-feature-sub">
              {t('Verified model releases & version timeline', '追踪已核验的 AI 模型发布、更新与版本路线')}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="sh-feature-cta"
          onClick={() => onNavigate('/ai')}
        >
          <span>{t('Full Calendar', '查看完整日历')}</span>
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>

      <div className="sh-feature-body">
        {!apiEnabled ? (
          <div className="sh-ai-pending">
            <div className="sh-ai-pending-badge">
              <Sparkles size={13} aria-hidden="true" />
              <span>{t('AI Release Center Integration', 'AI 发布中心接入中')}</span>
            </div>
            <p>
              {t(
                'Structured vendor release events will appear here automatically once the verified AI release API (/v1/ai/events) is enabled on this instance.',
                '当前主干尚未启用结构化 AI 发布事件接口（/v1/ai/events）。接入后将在此自动展示已核验的近期模型发布与官方更新，不展示虚构时间线。',
              )}
            </p>
            <button
              type="button"
              className="sh-inline-link"
              onClick={() => onNavigate('/ai')}
            >
              <span>{t('Explore AI News section', '前往 AI 资讯专区')}</span>
              <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
        ) : loading ? (
          <div className="sh-feature-state" aria-busy="true">
            {t('Loading verified AI release events...', '正在加载已核验 AI 发布事件…')}
          </div>
        ) : error ? (
          <div className="sh-feature-state sh-feature-state--error" role="alert">
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="sh-feature-state">
            {t('No verified AI releases in the recent window.', '近期暂无已核验的 AI 模型发布事件。')}
          </div>
        ) : (
          <ul className="sh-ai-event-list">
            {events.slice(0, 4).map((ev) => (
              <li key={ev.id} className="sh-ai-event-item">
                <span className="sh-ai-vendor-pill">{ev.vendorName}</span>
                <button
                  type="button"
                  className="sh-ai-event-btn"
                  onClick={() => onNavigate(`/ai?event=${encodeURIComponent(ev.id)}`)}
                >
                  {ev.title}
                </button>
                <time className="sh-ai-event-date tabular-nums" dateTime={ev.eventDate}>
                  {ev.eventDate}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
