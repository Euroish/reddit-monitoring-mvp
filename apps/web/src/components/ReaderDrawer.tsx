import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Bookmark, MessageSquare, X } from "lucide-react";
import type { Actor, PublicContent } from "../../../../packages/contracts/src/source-content";
import { api, type Run } from "../api";
import { formatExactTime, formatRelativeTime, safeHttpUrl, tierShort } from "../sourceLabels";
import type { OpenAuthFn, ReaderPreview, StoryEvidenceView } from "../types";
import { AnnotationEditor } from "./AnnotationEditor";

function extractHeroImage(preview: ReaderPreview, full?: PublicContent): string | null {
  const fromPreview = safeHttpUrl(preview.thumbnail);
  if (fromPreview) return fromPreview;
  if (!full?.media?.length) return null;
  for (const media of full.media) {
    const candidate = safeHttpUrl(media.previewUrl) ?? (media.type === "image" ? safeHttpUrl(media.url) : null);
    if (candidate) return candidate;
  }
  return null;
}

function extractDiscussionUrl(full?: PublicContent): string | null {
  if (!full) return null;
  if (full.platform === "reddit" || full.platform === "x") {
    return safeHttpUrl(full.url);
  }
  return null;
}

export default function ReaderDrawer({
  preview,
  user,
  run,
  openAuth,
  onSelectRelated,
  onClose,
}: {
  preview: ReaderPreview;
  user: Actor | null;
  run: Run;
  openAuth: OpenAuthFn;
  onSelectRelated?: (item: StoryEvidenceView) => void;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);

  const detail = useQuery({
    queryKey: ["content-detail", preview.id],
    queryFn: () => api<{ content: PublicContent }>(`/content/${preview.id}`),
    staleTime: 60_000,
  });

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLButtonElement>("button.drawer-close")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const openModals = document.querySelectorAll('.auth-modal[role="dialog"], dialog[open]');
      if (openModals.length > 0) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);

  const full = detail.data?.content;
  const title = full?.title || preview.title || "无标题内容";
  const sourceUrl = safeHttpUrl(full?.url ?? preview.url);
  const discussionUrl = extractDiscussionUrl(full);
  const publishedAt = full?.publishedAt ?? preview.publishedAt ?? preview.discoveredAt ?? null;
  const author = full?.author?.displayName ?? full?.author?.handle ?? preview.author ?? null;
  const heroImage = extractHeroImage(preview, full);
  const rawText = full?.text?.trim() || preview.excerpt?.trim() || "";
  const paragraphs = rawText
    ? rawText.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
    : [];

  return (
    <div
      className="reader-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="reader-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="内容阅读详情"
      >
        <div className="reader-topbar">
          <div className="reader-meta-pills">
            {preview.tier && (
              <span className={`tier-pill tier-${preview.tier.toLowerCase()}`}>
                {tierShort[preview.tier]}
              </span>
            )}
            {preview.sourceLabel && <span className="reader-source">{preview.sourceLabel}</span>}
            {!preview.sourceLabel && (full?.platform ?? preview.platform) && (
              <span className="reader-source">{full?.platform ?? preview.platform}</span>
            )}
          </div>
          <div className="reader-top-actions">
            {sourceUrl && (
              <a
                className="reader-origin-link"
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                打开原文 <ArrowUpRight size={14} />
              </a>
            )}
            <button
              type="button"
              className="icon-btn drawer-close"
              aria-label="关闭阅读抽屉"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="reader-scroll">
          <header className="reader-header">
            <h2>{title}</h2>
            <div className="reader-byline">
              {author && author !== preview.sourceLabel && <span>{author}</span>}
              <time
                dateTime={publishedAt ?? undefined}
                title={formatExactTime(publishedAt)}
              >
                {formatExactTime(publishedAt)} · {formatRelativeTime(publishedAt)}
              </time>
            </div>
          </header>

          {heroImage && (
            <figure className="reader-figure">
              <img
                src={heroImage}
                alt=""
                loading="lazy"
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
            </figure>
          )}

          <div className="reader-prose">
            {detail.isPending && !paragraphs.length && (
              <p role="status" className="muted">正在读取正文…</p>
            )}
            {detail.error && !paragraphs.length && (
              <p role="alert" className="muted">未能读取完整正文：{detail.error.message}</p>
            )}
            {paragraphs.length > 0 ? (
              paragraphs.map((para, index) => <p key={index}>{para}</p>)
            ) : !detail.isPending ? (
              <p className="muted">该条记录仅包含标题或摘要，请点击上方“打开原文”查看完整报道。</p>
            ) : null}
          </div>

          {discussionUrl && discussionUrl !== sourceUrl && (
            <div className="reader-ext-bar">
              <a className="button-link" href={discussionUrl} target="_blank" rel="noreferrer">
                <MessageSquare size={14} /> 查看原讨论
              </a>
            </div>
          )}

          {preview.related && preview.related.length > 0 && (
            <section className="reader-section">
              <h3>多源印证与相关报道（{preview.related.length}）</h3>
              <ul className="reader-related-list">
                {preview.related.map((item) => {
                  const href = safeHttpUrl(item.url);
                  return (
                    <li key={item.id}>
                      <div className="reader-related-meta">
                        <span className={`tier-pill tier-${item.tier.toLowerCase()}`}>
                          {tierShort[item.tier]}
                        </span>
                        <span>{item.sourceLabel}</span>
                        <time title={formatExactTime(item.publishedAt ?? item.discoveredAt)}>
                          {formatRelativeTime(item.publishedAt ?? item.discoveredAt)}
                        </time>
                      </div>
                      <div className="reader-related-row">
                        {onSelectRelated ? (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => onSelectRelated(item)}
                          >
                            {item.title}
                          </button>
                        ) : href ? (
                          <a href={href} target="_blank" rel="noreferrer">{item.title}</a>
                        ) : (
                          <span>{item.title}</span>
                        )}
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="subtle-ext"
                            aria-label={`打开原文：${item.title}`}
                          >
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

          <section className="reader-section reader-notes">
            <h3>收藏与研究批注</h3>
            {user ? (
              <AnnotationEditor key={preview.id} contentId={preview.id} run={run} />
            ) : (
              <div className="reader-guest-note">
                <p>收藏证据与记录研究批注将自动同步至个人研究空间。</p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => openAuth("login", "登录后可收藏内容并记录研究批注")}
                >
                  <Bookmark size={14} /> 登录后收藏与记录笔记
                </button>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
