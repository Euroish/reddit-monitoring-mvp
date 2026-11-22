import { useEffect, useState } from 'react';
import { BookOpen, Check, Copy, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { useAiEventDetailQuery } from '../../api/ai-client';
import { useI18n } from '../../i18n/translations';
import { safeHttpUrl } from '../../lib/sourceLabels';

interface AiEventDrawerProps {
  eventId: string | null;
  onClose: () => void;
  onSelectEvent: (eventId: string) => void;
  onOpenContent?: (contentId: string) => void;
}

export function AiEventDrawer({ eventId, onClose, onSelectEvent, onOpenContent }: AiEventDrawerProps) {
  const { t, lang } = useI18n();
  const detailQ = useAiEventDetailQuery(eventId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [eventId, onClose]);

  if (!eventId) return null;

  const ev = detailQ.data;

  const copyShareUrl = () => {
    const shareUrl = `${window.location.origin}/ai?event=${encodeURIComponent(eventId)}`;
    void navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="ai-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={ev?.title || t('AI Release Detail', 'AI 发布详情')}
      onClick={onClose}
    >
      <div className="ai-drawer" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--teal, #009f81)' }}>
            <ShieldCheck size={15} />
            {t('Official Evidence Verified', '官方证据已核验')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ai-pill-btn" onClick={copyShareUrl}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t('Copied', '已复制链接') : t('Share', '分享链接')}
            </button>
            <button type="button" className="ai-pill-btn" aria-label={t('Close drawer', '关闭详情抽屉')} onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>

        {detailQ.isLoading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>{t('Loading event details...', '正在加载详情...')}</p>
        ) : !ev ? (
          <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>{t('Event not found or unpublished.', '事件不存在或已撤回。')}</p>
        ) : (
          <>
            <div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: 'var(--opal-soft, #e8f1ee)' }}>
                  {ev.vendorName}
                </span>
                <span style={{ fontSize: 12, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--line)' }}>
                  {ev.eventType}
                </span>
                <span style={{ fontSize: 12, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--line)' }}>
                  {ev.eventStatus}
                </span>
              </div>
              <h2 style={{ margin: '0 0 8px', fontSize: 21, lineHeight: 1.3 }}>{ev.title}</h2>
              {(lang === 'zh' ? ev.summaryZh || ev.summaryEn : ev.summaryEn || ev.summaryZh) && (
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--muted)' }}>
                  {lang === 'zh' ? ev.summaryZh || ev.summaryEn : ev.summaryEn || ev.summaryZh}
                </p>
              )}
            </div>

            <div className="ai-drawer__meta-grid">
              <div className="ai-drawer__meta-card">
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{t('Event Date', '事件日期')}</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {ev.datePrecision === 'month' ? `${ev.eventDate.slice(0, 7)} (${t('month', '月精度')})` : ev.eventDate}
                </div>
              </div>
              <div className="ai-drawer__meta-card">
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{t('Source Tier', '来源级别')}</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{ev.sourceTier}</div>
              </div>
              {ev.officialAnnouncedOn && (
                <div className="ai-drawer__meta-card">
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{t('Announced On', '官宣日期')}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{ev.officialAnnouncedOn}</div>
                </div>
              )}
              {ev.availableFrom && (
                <div className="ai-drawer__meta-card">
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{t('Available From', '开放日期')}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{ev.availableFrom}</div>
                </div>
              )}
            </div>

            {Array.isArray(ev.keyChanges) && ev.keyChanges.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{t('Key Changes', '核心变更')}</h3>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.65 }}>
                  {ev.keyChanges.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}

            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{t('Official & Primary Evidence', '官方与主证据链')}</h3>
              {ev.references.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t('No linked references.', '暂无关联链接。')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ev.references.map((ref) => (
                    <div
                      key={ref.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid var(--line)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: ref.role === 'primary' ? 'var(--teal)' : 'var(--muted)' }}>
                          {ref.role === 'primary' ? t('Primary Official Source', '官方主证据') : ref.sourceTier}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {ref.title || ref.url}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {ref.contentId && onOpenContent && (
                          <button type="button" className="ai-pill-btn" onClick={() => onOpenContent(ref.contentId!)}>
                            <BookOpen size={13} /> {t('Read', '正文')}
                          </button>
                        )}
                        {safeHttpUrl(ref.url) && (
                          <a
                            href={safeHttpUrl(ref.url)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ai-pill-btn"
                            style={{ textDecoration: 'none' }}
                          >
                            <ExternalLink size={13} /> {t('Source', '原文')}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {ev.specs.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{t('Observed Specs & Pricing', '规格与价格观测（含来源与单位）')}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ev.specs.map((sp) => (
                    <div key={sp.id} className="ai-drawer__meta-card" style={{ fontSize: 12.5 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        {sp.sourceNamespace} · {sp.observedAt.slice(0, 10)}
                      </div>
                      <div style={{ color: 'var(--muted)' }}>
                        {sp.contextLength ? `Context: ${sp.contextLength.toLocaleString()} · ` : ''}
                        {sp.inputPrice ? `In: ${sp.inputPrice} ` : ''}
                        {sp.outputPrice ? `Out: ${sp.outputPrice} ` : ''}
                        ({sp.currency} / {sp.priceUnit})
                      </div>
                      {sp.rawUnitNote && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{sp.rawUnitNote}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ev.versionChain.length > 1 && (
              <div>
                <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{t('Model Version Lifecycle', '同模型版本演进链')}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ev.versionChain.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className={`ai-pill-btn ${node.id === ev.id ? 'is-active' : ''}`}
                      style={{ justifyContent: 'space-between', borderRadius: 10 }}
                      onClick={() => onSelectEvent(node.id)}
                    >
                      <span>{node.title}</span>
                      <span style={{ fontSize: 11.5, opacity: 0.8 }}>{node.eventDate}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
