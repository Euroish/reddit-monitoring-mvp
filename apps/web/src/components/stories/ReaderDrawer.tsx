import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, MessageSquare, X } from 'lucide-react';
import {
  formatApiError,
  useAnnotationQuery,
  useContentDetailQuery,
  useSaveAnnotationMutation,
} from '../../api/hooks';
import type {
  Actor,
  PublicContent,
  StoryEvidence,
} from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import {
  TIER_SHORT,
  decodeHtmlEntities,
  formatExactTime,
  formatRelativeTime,
  safeHttpUrl,
} from '../../lib/sourceLabels';
import type { ReaderPreview } from './readerTypes';

export function ReaderDrawer({
  preview,
  actor,
  onOpenAuth,
  onSelectRelated,
  onClose,
}: {
  preview: ReaderPreview;
  actor: Actor | null;
  onOpenAuth: (tab?: 'login' | 'register', reason?: string) => void;
  onSelectRelated: (item: StoryEvidence) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const drawerRef = useRef<HTMLElement>(null);
  const detailQuery = useContentDetailQuery(preview.id);
  const annQuery = useAnnotationQuery(actor ? preview.id : null);
  const saveAnnMut = useSaveAnnotationMutation();

  const serverAnn = annQuery.data?.annotation;
  const serverKey = `${preview.id}:${serverAnn?.revision ?? 0}`;
  const [draft, setDraft] = useState<{ key: string; favorite: boolean; note: string } | null>(null);
  const [revOverride, setRevOverride] = useState<{ key: string; rev: number } | null>(null);
  const [annStatus, setAnnStatus] = useState<string | null>(null);

  const favorite = draft?.key === serverKey ? draft.favorite : (serverAnn?.favorite ?? false);
  const note = draft?.key === serverKey ? draft.note : (serverAnn?.note ?? '');
  const revision = revOverride?.key === preview.id ? revOverride.rev : (serverAnn?.revision ?? 0);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLButtonElement>('button[data-drawer-close]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.auth-overlay')) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);

  const full: PublicContent | undefined = detailQuery.data?.content;
  const title = decodeHtmlEntities(full?.title || preview.title || '无标题内容');
  const sourceUrl = safeHttpUrl(full?.url ?? preview.url);
  const publishedAt = full?.publishedAt ?? preview.publishedAt ?? preview.discoveredAt ?? null;
  const author = full?.author?.displayName ?? full?.author?.handle ?? preview.author ?? null;
  const heroImage = useMemo(() => {
    const fromPreview = safeHttpUrl(preview.thumbnail);
    if (fromPreview) return fromPreview;
    for (const media of full?.media ?? []) {
      const candidate =
        safeHttpUrl(media.previewUrl) ?? (media.type === 'image' ? safeHttpUrl(media.url) : null);
      if (candidate) return candidate;
    }
    return null;
  }, [preview.thumbnail, full]);

  const rawText = decodeHtmlEntities(full?.text?.trim() || preview.excerpt?.trim() || '');
  const paragraphs = rawText
    ? rawText
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
    : [];

  const handleSaveAnn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnnStatus(null);
    try {
      const res = await saveAnnMut.mutateAsync({ contentId: preview.id, edit: { favorite, note, revision } });
      setRevOverride({ key: preview.id, rev: res.revision });
      setDraft({ key: `${preview.id}:${res.revision}`, favorite, note });
      setAnnStatus(t(`Saved · rev ${res.revision}`, `已保存到我的研究 · rev ${res.revision}`));
    } catch (err) {
      setAnnStatus(formatApiError(err));
    }
  };

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="内容阅读详情"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dw-hd">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {preview.tier && (
                <span className={`story-tier-pill tier-${preview.tier.toLowerCase()}`}>
                  {TIER_SHORT[preview.tier]}
                </span>
              )}
              <span className="tag tag--line" style={{ height: 21, fontSize: 10.5 }}>
                {preview.sourceLabel || full?.platform || preview.platform}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ds-btn ds-btn--ghost"
                  style={{ height: 28, fontSize: 11.5, padding: '0 10px' }}
                >
                  <span>{t('Open Original', '打开原文')}</span>
                  <ArrowUpRight size={13} />
                </a>
              )}
              <button
                type="button"
                data-drawer-close
                className="icon-square"
                style={{ width: 28, height: 28, borderRadius: '50%' }}
                aria-label={t('Close reader', '关闭阅读抽屉')}
                onClick={onClose}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, lineHeight: 1.38, marginTop: 10 }}>
            {title}
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--faint)', marginTop: 6 }}>
            {author && author !== preview.sourceLabel && <span>{author}</span>}
            <time dateTime={publishedAt ?? undefined} title={formatExactTime(publishedAt)}>
              {formatExactTime(publishedAt)} · {formatRelativeTime(publishedAt)}
            </time>
          </div>
        </header>

        <div className="dw-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {heroImage && (
            <figure style={{ margin: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)' }}>
              <img
                src={heroImage}
                alt=""
                loading="lazy"
                style={{ width: '100%', maxHeight: 260, objectFit: 'cover', display: 'block' }}
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            </figure>
          )}

          <div className="story-reader-prose">
            {detailQuery.isPending && paragraphs.length === 0 && (
              <p style={{ color: 'var(--faint)', fontSize: 13 }}>{t('Loading full text...', '正在读取正文…')}</p>
            )}
            {detailQuery.error && paragraphs.length === 0 && (
              <p role="alert" style={{ color: '#8f3f2a', fontSize: 12.5 }}>
                {formatApiError(detailQuery.error)}
              </p>
            )}
            {paragraphs.length > 0 ? (
              paragraphs.map((para, idx) => <p key={idx}>{para}</p>)
            ) : !detailQuery.isPending ? (
              <p style={{ color: 'var(--muted)' }}>
                {t(
                  'Only title/excerpt is stored for this record. Open the original link above for full coverage.',
                  '该条记录仅包含标题或摘要，请点击上方“打开原文”查看完整报道。',
                )}
              </p>
            ) : null}
          </div>

          {preview.related && preview.related.length > 0 && (
            <section style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <h3 style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                {t(`Related Coverage (${preview.related.length})`, `多源印证与相关报道（${preview.related.length}）`)}
              </h3>
              <ul className="story-related-list">
                {preview.related.map((rel) => {
                  const href = safeHttpUrl(rel.url);
                  const relTitle = decodeHtmlEntities(rel.title);
                  return (
                    <li key={rel.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--faint)' }}>
                        <span className={`story-tier-pill tier-${rel.tier.toLowerCase()}`}>
                          {TIER_SHORT[rel.tier]}
                        </span>
                        <span>{rel.sourceLabel}</span>
                        <time title={formatExactTime(rel.publishedAt ?? rel.discoveredAt)}>
                          {formatRelativeTime(rel.publishedAt ?? rel.discoveredAt)}
                        </time>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 3 }}>
                        <button
                          type="button"
                          className="story-link-btn"
                          onClick={() => onSelectRelated(rel)}
                        >
                          {relTitle}
                        </button>
                        {href && (
                          <a href={href} target="_blank" rel="noreferrer" aria-label={`打开原文：${relTitle}`} style={{ color: 'var(--faint)', flexShrink: 0 }}>
                            <ArrowUpRight size={13} />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <section style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <h3 style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <MessageSquare size={13} />
              <span>{t('Bookmark & Research Notes', '收藏与研究批注')}</span>
            </h3>
            {actor ? (
              <form onSubmit={handleSaveAnn} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={favorite}
                    onChange={(e) => setDraft({ key: serverKey, favorite: e.target.checked, note })}
                  />
                  <span>{t('Bookmark this item', '收藏这条证据')}</span>
                </label>
                <textarea
                  className="wb-textarea"
                  rows={4}
                  maxLength={2000}
                  aria-label={t('Research note', '研究批注')}
                  value={note}
                  onChange={(e) => setDraft({ key: serverKey, favorite, note: e.target.value })}
                  placeholder={t('Write a research note (max 2000 chars)...', '记录判断、出处或后续跟进要点…')}
                />
                {annStatus && <div className="wb-alert wb-alert--info">{annStatus}</div>}
                <div>
                  <button type="submit" className="ds-btn" disabled={saveAnnMut.isPending}>
                    <Bookmark size={13} />
                    <span>{t('Save to Workspace', '保存到我的研究')}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="story-guest-note">
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  {t(
                    'Bookmarks and notes sync to your personal research workspace after sign-in.',
                    '收藏证据与记录研究批注将自动同步至个人研究空间。',
                  )}
                </p>
                <button
                  type="button"
                  className="ds-btn"
                  onClick={() => onOpenAuth('login', t('Sign in to bookmark stories and save notes.', '登录后可收藏内容并记录研究批注'))}
                >
                  <Bookmark size={13} />
                  <span>{t('Sign in to bookmark & annotate', '登录后收藏与记录笔记')}</span>
                </button>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
