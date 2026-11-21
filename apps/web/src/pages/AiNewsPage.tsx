import { ArrowUpRight, CalendarClock, Sparkles } from 'lucide-react';
import type { Actor } from '../contracts/api';
import { useI18n } from '../i18n/translations';

interface AiNewsPageProps {
  actor?: Actor | null;
  search?: string;
  onNavigate: (path: string) => void;
  onOpenAuth?: (tab?: 'login' | 'register', reason?: string, pendingTarget?: string) => void;
}

export function AiNewsPage({ onNavigate }: AiNewsPageProps) {
  const { t } = useI18n();

  return (
    <div className="pdoc-wrap">
      <div className="pih-hero">
        <span className="pih-eyebrow">
          <CalendarClock size={12} />
          {t('Coming Soon', '即将上线')}
        </span>
        <h1>{t('AI News & Release Radar — Coming Soon', 'AI 资讯即将上线')}</h1>
        <p className="pih-hero-sub">
          {t(
            'This dedicated section will track verified AI model releases, research announcements, and lab updates from real ingested sources. No placeholder models or unverified dates are displayed ahead of launch.',
            '本栏目将在下一阶段接入真实入库的 AI 模型发布、研究动态与官方一手公告。上线前不展示任何虚构模型或未核验的发布时间。',
          )}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            className="sr-btn sr-btn--dark sr-btn--sm"
            onClick={() => onNavigate('/app/feed?sourceGroup=ai-firsthand')}
          >
            <Sparkles size={13} />
            <span>{t('Browse Live AI Firsthand Stories', '先看实时 AI 一手与研发频道')}</span>
            <ArrowUpRight size={13} />
          </button>
          <button
            type="button"
            className="sr-btn sr-btn--outline sr-btn--sm"
            onClick={() => onNavigate('/')}
          >
            <span>{t('Back to Public Home', '返回公开信息首页')}</span>
          </button>
        </div>
      </div>

      <section className="pih-section">
        <div className="pih-section-hd">
          <div>
            <h2 className="pih-section-title">{t('Planned Layout Scope', '预留板块结构')}</h2>
            <p className="pih-section-sub">
              {t('To be populated from real backend feeds in the next milestone', '将在独立任务阶段接入真实后端数据')}
            </p>
          </div>
        </div>
        <div className="pdoc-grid" style={{ marginTop: 0 }}>
          <div className="pdoc-card">
            <h3>{t('Official Lab Releases', '官方实验室发布追踪')}</h3>
            <p>
              {t(
                'Structured timeline of T1 official model & API updates linked back to original announcements.',
                '汇总 T1 官方博客与一手公告，所有条目严格追溯原文链接与发布时间。',
              )}
            </p>
          </div>
          <div className="pdoc-card">
            <h3>{t('Cross-Source Momentum', '跨源讨论热度聚合')}</h3>
            <p>
              {t(
                'Connect official releases with engineering and community discussions across configured sources.',
                '关联官方发布与开发者社区讨论，按已存样本口径展示真实多源印证。',
              )}
            </p>
          </div>
          <div className="pdoc-card">
            <h3>{t('Daily AI Briefing', '每日 AI 重点速览')}</h3>
            <p>
              {t(
                'Integrated with the 08:00 Daily Digest archive for fast daily review.',
                '与 08:00 日报归档打通，便于按日回顾重要技术进展。',
              )}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
