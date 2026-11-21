import { BookOpen, ExternalLink, Newspaper } from 'lucide-react';
import type { AiOfficialUpdateItem, AiVendorItem } from '../../api/ai-client';
import { useI18n } from '../../i18n/translations';
import { safeHttpUrl } from '../../lib/sourceLabels';

interface AiOfficialUpdatesProps {
  vendors: AiVendorItem[];
  updates: AiOfficialUpdateItem[];
  loading: boolean;
  selectedVendor: string;
  onSelectVendor: (slug: string) => void;
  onOpenEvent: (eventId: string) => void;
  onOpenContent: (contentId: string) => void;
}

export function AiOfficialUpdates({
  vendors,
  updates,
  loading,
  selectedVendor,
  onSelectVendor,
  onOpenEvent,
  onOpenContent,
}: AiOfficialUpdatesProps) {
  const { t } = useI18n();

  return (
    <section className="ai-section" id="official-updates" aria-label={t('Official AI Updates', '官方一手更新')}>
      <div className="ai-section__head">
        <div>
          <h2 className="ai-section__title">{t('Official First-Hand Updates', '官方一手动态与公告')}</h2>
          <p className="ai-section__sub">
            {t(
              'Directly sourced from official AI vendor blogs, changelogs, and research feeds inside SIFTLINE.',
              '直接汇总自 SIFTLINE 内置的 AI 厂商官方博客、更新日志与研究频道，可直达正文或关联发布事件。',
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`ai-pill-btn ${selectedVendor === '' ? 'is-active' : ''}`}
            onClick={() => onSelectVendor('')}
          >
            {t('All', '全部')}
          </button>
          {vendors.slice(0, 6).map((v) => (
            <button
              key={v.id}
              type="button"
              className={`ai-pill-btn ${selectedVendor === v.slug ? 'is-active' : ''}`}
              onClick={() => onSelectVendor(v.slug)}
            >
              {v.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="ai-card-surface">
          <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: 0 }}>{t('Loading official updates...', '正在加载官方动态...')}</p>
        </div>
      ) : updates.length === 0 ? (
        <div className="ai-card-surface">
          <div className="ai-empty-box">
            <Newspaper size={24} style={{ marginBottom: 8, color: 'var(--teal)' }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 6 }}>
              {t('No official vendor updates collected yet', '暂无已采集的官方一手动态')}
            </div>
            <p style={{ margin: 0 }}>
              {t(
                'Run collection on ai-firsthand sources to populate official announcements here.',
                '当 ai-firsthand 官方来源完成采集后，最新官方公告将自动在此展示。',
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="ai-updates-grid">
          {updates.map((u) => (
            <article key={u.contentId} className="ai-update-card">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--opal-soft, #e8f1ee)', color: 'var(--ink)' }}>
                    {u.vendorName || u.sourceName}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {u.publishedAt ? u.publishedAt.slice(0, 10) : ''}
                  </span>
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: 15.5, lineHeight: 1.4, fontWeight: 700 }}>{u.title}</h3>
                {u.summary && (
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--muted)' }}>
                    {u.summary}
                    {u.summary.length >= 255 ? '…' : ''}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {u.linkedEvents.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {u.linkedEvents.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        className="ai-pill-btn"
                        style={{ padding: '4px 10px', fontSize: 11.5 }}
                        onClick={() => onOpenEvent(ev.id)}
                      >
                        {ev.title} ({ev.eventDate})
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="ai-pill-btn"
                    style={{ padding: '5px 11px', fontSize: 12 }}
                    onClick={() => onOpenContent(u.contentId)}
                  >
                    <BookOpen size={12} /> {t('Read', '快速阅读')}
                  </button>
                  {u.url && safeHttpUrl(u.url) && (
                    <a
                      href={safeHttpUrl(u.url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                    >
                      {t('Official Post', '官方原文')} <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
