import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  ChevronRight,
  FileText,
  Layers,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { SiftlineLogo } from '../components/BrandMark';
import { docFileUrl } from '../api/client';
import {
  formatApiError,
  useCreateDocMutation,
  useDeleteDocMutation,
  useDocQuery,
  useDocsQuery,
  useUpdateDocMutation,
} from '../api/hooks';
import type {
  Actor,
  DocCategory,
  DocDetail,
  DocInput,
  DocKind,
  DocStatus,
  DocSummary,
} from '../contracts/api';
import { extractHeadings, renderMarkdown } from '../lib/markdown';
import '../styles/docs.css';

interface DocsPageProps {
  actor: Actor | null;
  search: string;
  onNavigate: (path: string) => void;
  onOpenAuth: () => void;
  embedded?: boolean;
}

const CATEGORY_META: Record<DocCategory, { label: string; icon: typeof Layers; hint: string }> = {
  feature: { label: '功能说明', icon: Layers, hint: '每个功能做什么、怎么用、边界在哪' },
  terms: { label: '服务条款', icon: ShieldCheck, hint: '使用前请读一遍的约定与责任划分' },
  notice: { label: '运营公告', icon: Bell, hint: '版本更新、维护窗口与策略调整' },
};

const KIND_LABEL: Record<DocKind, string> = {
  markdown: '站内文档',
  link: '外部链接',
  file: 'PDF 附件',
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function useAdmin(actor: Actor | null) {
  return Boolean(actor && actor.role !== 'viewer' && actor.clientKind === 'browser');
}

/* ------------------------------------------------------------------ editor */

interface Draft {
  id?: string;
  expectedRevision?: number;
  title: string;
  category: DocCategory;
  summary: string;
  kind: DocKind;
  bodyMd: string;
  externalUrl: string;
  pinned: boolean;
  sortRank: number;
  status: DocStatus;
  fileName: string;
  fileData: string;
}

const EMPTY_DRAFT: Draft = {
  title: '',
  category: 'feature',
  summary: '',
  kind: 'markdown',
  bodyMd: '## 概览\n\n在这里写清楚：这个功能解决什么问题、在哪个页面、怎么操作。\n\n## 操作步骤\n\n1. 第一步\n2. 第二步\n\n> 提示：可以用引用块强调容易踩坑的地方。\n',
  externalUrl: '',
  pinned: false,
  sortRank: 100,
  status: 'published',
  fileName: '',
  fileData: '',
};

function Editor({
  draft,
  onClose,
  onSaved,
}: {
  draft: Draft;
  onClose: () => void;
  onSaved: (doc: DocDetail) => void;
}) {
  const [form, setForm] = useState<Draft>(draft);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const createMut = useCreateDocMutation();
  const updateMut = useUpdateDocMutation();
  const [error, setError] = useState<string | null>(null);

  const patch = (next: Partial<Draft>) => setForm((prev) => ({ ...prev, ...next }));

  const submit = async () => {
    setError(null);
    if (!form.title.trim()) {
      setError('请填写标题');
      return;
    }
    if (form.kind === 'link' && !/^https:\/\//i.test(form.externalUrl.trim())) {
      setError('外部链接需要以 https:// 开头');
      return;
    }
    if (form.kind === 'file' && !form.fileData && !form.id) {
      setError('请选择要上传的 PDF 文件');
      return;
    }
    const payload: DocInput = {
      title: form.title.trim(),
      category: form.category,
      summary: form.summary.trim(),
      kind: form.kind,
      bodyMd: form.kind === 'markdown' ? form.bodyMd : '',
      externalUrl: form.kind === 'link' ? form.externalUrl.trim() : undefined,
      pinned: form.pinned,
      sortRank: form.sortRank,
      status: form.status,
    };
    if (form.fileData) {
      payload.file = {
        name: form.fileName || 'document.pdf',
        mime: 'application/pdf',
        dataBase64: form.fileData,
      };
    }
    try {
      const saved = form.id
        ? await updateMut.mutateAsync({ id: form.id, patch: { ...payload, expectedRevision: form.expectedRevision } })
        : await createMut.mutateAsync(payload);
      onSaved(saved);
    } catch (err) {
      setError(formatApiError(err));
    }
  };

  return (
    <div className="dc-modal" role="dialog" aria-modal="true" aria-label="编辑文档">
      <div className="dc-sheet">
        <header className="dc-sheet-hd">
          <div>
            <b>{form.id ? '编辑文档' : '新建文档'}</b>
            <small>保存后立刻对所有人可见（草稿只对管理员可见）</small>
          </div>
          <button type="button" className="dc-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </header>

        <div className="dc-sheet-bd">
          <div className="dc-form-row">
            <label className="dc-field dc-field--grow">
              <span>标题</span>
              <input
                value={form.title}
                maxLength={120}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="例如：信息流的三视图与筛选"
              />
            </label>
            <label className="dc-field">
              <span>分类</span>
              <select value={form.category} onChange={(e) => patch({ category: e.target.value as DocCategory })}>
                {(Object.keys(CATEGORY_META) as DocCategory[]).map((key) => (
                  <option key={key} value={key}>
                    {CATEGORY_META[key].label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="dc-field">
            <span>摘要（列表里显示的一句话）</span>
            <input
              value={form.summary}
              maxLength={400}
              onChange={(e) => patch({ summary: e.target.value })}
              placeholder="一句话说明这份文档解决什么问题"
            />
          </label>

          <div className="dc-form-row">
            <label className="dc-field">
              <span>内容形式</span>
              <select value={form.kind} onChange={(e) => patch({ kind: e.target.value as DocKind })}>
                <option value="markdown">站内文档（在线编写，推荐）</option>
                <option value="link">外部链接（已托管在别处）</option>
                <option value="file">PDF 附件（上传单个文件）</option>
              </select>
            </label>
            <label className="dc-field">
              <span>状态</span>
              <select value={form.status} onChange={(e) => patch({ status: e.target.value as DocStatus })}>
                <option value="published">已发布</option>
                <option value="draft">草稿</option>
              </select>
            </label>
            <label className="dc-field dc-field--narrow">
              <span>排序（小在前）</span>
              <input
                type="number"
                min={0}
                max={9999}
                value={form.sortRank}
                onChange={(e) => patch({ sortRank: Number(e.target.value) || 0 })}
              />
            </label>
          </div>

          <label className="dc-switch">
            <input type="checkbox" checked={form.pinned} onChange={(e) => patch({ pinned: e.target.checked })} />
            <span>
              置顶显示
              <small>置顶文档会出现在文档中心首页最上方，并按排序值排列</small>
            </span>
          </label>

          {form.kind === 'markdown' && (
            <div className="dc-editor">
              <div className="dc-editor-tabs">
                <button type="button" className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>
                  编写
                </button>
                <button type="button" className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
                  预览
                </button>
                <span className="dc-editor-hint">支持 # 标题、- 列表、**加粗**、`代码`、&gt; 引用、表格与 ``` 代码块</span>
              </div>
              {tab === 'write' ? (
                <textarea
                  className="dc-textarea"
                  value={form.bodyMd}
                  onChange={(e) => patch({ bodyMd: e.target.value })}
                  spellCheck={false}
                />
              ) : (
                <div
                  className="dc-preview doc-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(form.bodyMd) }}
                />
              )}
            </div>
          )}

          {form.kind === 'link' && (
            <label className="dc-field">
              <span>外部链接（https:// 开头）</span>
              <input
                value={form.externalUrl}
                onChange={(e) => patch({ externalUrl: e.target.value })}
                placeholder="https://example.com/handbook/feature-guide"
              />
            </label>
          )}

          {form.kind === 'file' && (
            <div className="dc-field">
              <span>PDF 附件（单个文件，最大 8 MB）</span>
              <div className="dc-file-pick">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 8 * 1024 * 1024) {
                      setError('文件超过 8 MB，请压缩后再上传');
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      const raw = String(reader.result ?? '');
                      patch({ fileData: raw.split(',')[1] ?? '', fileName: file.name });
                      setError(null);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
                <span>{form.fileData ? `已选择：${form.fileName || 'document.pdf'}` : '尚未选择文件（编辑已有文档时不选则保留原附件）'}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="dc-alert">
              <AlertTriangle size={13} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="dc-sheet-ft">
          <button type="button" className="dc-btn dc-btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="dc-btn dc-btn--primary"
            disabled={createMut.isPending || updateMut.isPending}
            onClick={() => void submit()}
          >
            {createMut.isPending || updateMut.isPending ? '保存中…' : '保存文档'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- navigation */

function DocNav({
  docs,
  selected,
  query,
  onQuery,
  onSelect,
  canManage,
  onCreate,
}: {
  docs: DocSummary[];
  selected: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (slug: string | null) => void;
  canManage: boolean;
  onCreate: () => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(
      (doc) => doc.title.toLowerCase().includes(q) || doc.summary.toLowerCase().includes(q),
    );
  }, [docs, query]);
  const pinned = filtered.filter((doc) => doc.pinned);

  return (
    <aside className="dc-nav" aria-label="文档目录">
      <label className="dc-search">
        <Search size={13} />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="搜索文档" aria-label="搜索文档" />
      </label>

      <button type="button" className={`dc-nav-all ${selected === null ? 'on' : ''}`} onClick={() => onSelect(null)}>
        <BookOpen size={12} />
        文档中心首页
      </button>

      <div className="dc-nav-group">
        <p className="dc-nav-title">
          <Pin size={10} /> 置顶
        </p>
        <button type="button" className="dc-nav-item" onClick={() => onSelect('__guide')}>
          <span className="dc-nav-name">产品使用说明</span>
          <em className="dc-tag">内置</em>
        </button>
        {pinned.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className={`dc-nav-item ${selected === doc.slug ? 'on' : ''}`}
            onClick={() => onSelect(doc.slug)}
          >
            <span className="dc-nav-name">{doc.title}</span>
            {doc.status === 'draft' && <em className="dc-tag dc-tag--draft">草稿</em>}
          </button>
        ))}
      </div>

      {(Object.keys(CATEGORY_META) as DocCategory[]).map((category) => {
        const inCategory = filtered.filter((doc) => doc.category === category);
        const items = inCategory.filter((doc) => !doc.pinned);
        const meta = CATEGORY_META[category];
        return (
          <div key={category} className="dc-nav-group">
            <p className="dc-nav-title">
              <meta.icon size={10} /> {meta.label}
            </p>
            {inCategory.length === 0 && <p className="dc-nav-empty">暂无文档</p>}
            {items.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className={`dc-nav-item ${selected === doc.slug ? 'on' : ''}`}
                onClick={() => onSelect(doc.slug)}
              >
                <span className="dc-nav-name">{doc.title}</span>
                {doc.status === 'draft' && <em className="dc-tag dc-tag--draft">草稿</em>}
              </button>
            ))}
          </div>
        );
      })}

      {canManage && (
        <button type="button" className="dc-create" onClick={onCreate}>
          <Plus size={13} />
          新建文档
        </button>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------- index */

function DocIndex({
  docs,
  query,
  canManage,
  onCreate,
  onSelect,
  onGuide,
}: {
  docs: DocSummary[];
  query: string;
  canManage: boolean;
  onCreate: () => void;
  onSelect: (slug: string) => void;
  onGuide: () => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter(
      (doc) => doc.title.toLowerCase().includes(q) || doc.summary.toLowerCase().includes(q),
    );
  }, [docs, query]);
  const pinned = filtered.filter((doc) => doc.pinned);

  const card = (doc: DocSummary) => (
    <button key={doc.id} type="button" className="dc-card" onClick={() => onSelect(doc.slug)}>
      <span className="dc-card-kind">
        {CATEGORY_META[doc.category].label} · {KIND_LABEL[doc.kind]}
      </span>
      <b>{doc.title}</b>
      <span className="dc-card-sum">{doc.summary || '暂无摘要'}</span>
      <span className="dc-card-meta">
        更新于 {formatDate(doc.updatedAt)}
        {doc.status === 'draft' && <em className="dc-tag dc-tag--draft">草稿</em>}
      </span>
    </button>
  );

  return (
    <div className="dc-doc">
      <header className="dc-hero">
        <p className="dc-eyebrow">SIFTLINE 文档中心</p>
        <h1>产品文档</h1>
        <p className="dc-hero-lede">
          功能说明、服务条款与运营公告都在这里。所有文档由团队自己维护，改动即时生效，历史版本按更新时间倒序可见。
        </p>
        <div className="dc-hero-actions">
          <button type="button" className="dc-btn dc-btn--primary" onClick={onGuide}>
            阅读产品使用说明
            <ChevronRight size={14} />
          </button>
          {canManage && (
            <button type="button" className="dc-btn" onClick={onCreate}>
              <Plus size={13} />
              新建文档
            </button>
          )}
        </div>
      </header>

      <section className="dc-section">
        <h2>
          <Pin size={13} /> 置顶
        </h2>
        <div className="dc-cards">
          <button type="button" className="dc-card dc-card--pin" onClick={onGuide}>
            <span className="dc-card-kind">使用说明 · 图文教程</span>
            <b>产品使用说明</b>
            <span className="dc-card-sum">从登录到做出第一份结论：10 个章节、10 张示意图，含口径说明与常见问题。</span>
            <span className="dc-card-meta">内置页面 · 随产品一块更新</span>
          </button>
          {pinned.map(card)}
        </div>
      </section>

      {(Object.keys(CATEGORY_META) as DocCategory[]).map((category) => {
        const meta = CATEGORY_META[category];
        const inCategory = filtered.filter((doc) => doc.category === category);
        const items = inCategory.filter((doc) => !doc.pinned);
        return (
          <section key={category} className="dc-section">
            <h2>
              <meta.icon size={13} /> {meta.label}
            </h2>
            <p className="dc-section-hint">{meta.hint}</p>
            {inCategory.length === 0 ? (
              <p className="dc-empty">
                这里还没有文档。
                {canManage && (
                  <button type="button" className="dc-link" onClick={onCreate}>
                    现在就写第一篇
                  </button>
                )}
              </p>
            ) : (
              <>
                {items.length > 0 ? (
                  <div className="dc-list">{items.map(card)}</div>
                ) : (
                  <p className="dc-empty">该分类的文档都已在置顶区展示。</p>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ reader */

function DocReader({
  doc,
  canManage,
  onEdit,
  onDelete,
  onTogglePin,
  onBack,
  busy,
}: {
  doc: DocDetail;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headings = useMemo(() => extractHeadings(doc.bodyMd), [doc.bodyMd]);
  const html = useMemo(() => (doc.kind === 'markdown' ? renderMarkdown(doc.bodyMd) : ''), [doc.bodyMd, doc.kind]);
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    const root = bodyRef.current?.closest('.dc-scroll') as HTMLElement | null;
    if (!root || !headings.length) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top + 90;
      let current = headings[0].id;
      for (const heading of headings) {
        const el = document.getElementById(heading.id);
        if (el && el.getBoundingClientRect().top <= top) current = heading.id;
      }
      setActive(current);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener('scroll', onScroll);
  }, [headings]);

  return (
    <div className="dc-reader">
      <div className="dc-crumb">
        <button type="button" onClick={onBack}>
          文档中心
        </button>
        <ChevronRight size={11} />
        <span>{CATEGORY_META[doc.category].label}</span>
      </div>

      <header className="dc-doc-hd">
        <div>
          <h1>{doc.title}</h1>
          <p className="dc-doc-meta">
            更新于 {formatDate(doc.updatedAt)} · 版本 {doc.revision} · {KIND_LABEL[doc.kind]}
            {doc.status === 'draft' && <em className="dc-tag dc-tag--draft">草稿</em>}
            {doc.pinned && (
              <em className="dc-tag dc-tag--pin">
                <Pin size={9} /> 置顶
              </em>
            )}
          </p>
        </div>
        {canManage && (
          <div className="dc-doc-actions">
            <button type="button" className="dc-icon-btn" onClick={onTogglePin} title={doc.pinned ? '取消置顶' : '置顶'}>
              {doc.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <button type="button" className="dc-icon-btn" onClick={onEdit} title="编辑">
              <Pencil size={14} />
            </button>
            <button type="button" className="dc-icon-btn dc-icon-btn--danger" onClick={onDelete} title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </header>

      {doc.summary && <p className="dc-doc-summary">{doc.summary}</p>}

      {doc.kind === 'markdown' && (
        <div className="dc-body-wrap">
          <div ref={bodyRef} className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
          {headings.length > 1 && (
            <nav className="dc-toc" aria-label="本页目录">
              <p>本页目录</p>
              {headings.map((heading) => (
                <a
                  key={heading.id}
                  href={`#${heading.id}`}
                  className={`${active === heading.id ? 'on' : ''} lvl${heading.level}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {heading.text}
                </a>
              ))}
            </nav>
          )}
        </div>
      )}

      {doc.kind === 'link' && doc.externalUrl && (
        <div className="dc-external">
          <FileText size={22} />
          <div>
            <b>这份文档托管在外部地址</b>
            <p>{doc.externalUrl}</p>
          </div>
          <a className="dc-btn dc-btn--primary" href={doc.externalUrl} target="_blank" rel="noreferrer noopener">
            打开文档
          </a>
        </div>
      )}

      {doc.kind === 'file' && (
        <div className="dc-file">
          <div className="dc-file-hd">
            <FileText size={15} />
            <span>
              {doc.fileName ?? 'document.pdf'}
              {doc.fileSize ? ` · ${(doc.fileSize / 1024 / 1024).toFixed(2)} MB` : ''}
            </span>
            <a className="dc-btn dc-btn--ghost" href={docFileUrl(doc.slug)} target="_blank" rel="noreferrer noopener">
              在新窗口打开
            </a>
          </div>
          <iframe className="dc-pdf" src={docFileUrl(doc.slug)} title={doc.title} />
        </div>
      )}

      <footer className="dc-doc-ft">
        <button type="button" className="dc-btn dc-btn--ghost" onClick={onBack}>
          返回文档中心
        </button>
        {busy && <span className="dc-saving">正在保存…</span>}
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export function DocsPage({ actor, search, onNavigate, onOpenAuth, embedded = false }: DocsPageProps) {
  const canManage = useAdmin(actor);
  const docsQuery = useDocsQuery(true);
  const selected = useMemo(() => new URLSearchParams(search).get('doc'), [search]);
  const docQuery = useDocQuery(selected && selected !== '__guide' ? selected : null);
  const updateMut = useUpdateDocMutation();
  const deleteMut = useDeleteDocMutation();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const docs = docsQuery.data ?? [];

  const open = useCallback(
    (slug: string | null) => {
      if (slug === '__guide') {
        onNavigate('/guide');
        return;
      }
      onNavigate(slug ? `/docs?doc=${encodeURIComponent(slug)}` : '/docs');
    },
    [onNavigate],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selected]);

  const openEditor = (doc?: DocDetail) => {
    if (!doc) {
      setDraft({ ...EMPTY_DRAFT });
      return;
    }
    setDraft({
      id: doc.id,
      expectedRevision: doc.revision,
      title: doc.title,
      category: doc.category,
      summary: doc.summary,
      kind: doc.kind,
      bodyMd: doc.bodyMd,
      externalUrl: doc.externalUrl ?? '',
      pinned: doc.pinned,
      sortRank: doc.sortRank,
      status: doc.status,
      fileName: doc.fileName ?? '',
      fileData: '',
    });
  };

  const togglePin = async (doc: DocDetail) => {
    try {
      setActionError(null);
      await updateMut.mutateAsync({ id: doc.id, patch: { pinned: !doc.pinned, expectedRevision: doc.revision } });
    } catch (err) {
      setActionError(formatApiError(err));
    }
  };

  const remove = async (doc: DocDetail) => {
    if (!window.confirm(`删除「${doc.title}」？此操作不可撤销。`)) return;
    try {
      setActionError(null);
      await deleteMut.mutateAsync(doc.id);
      open(null);
    } catch (err) {
      setActionError(formatApiError(err));
    }
  };

  return (
    <div className={`dc-root ${embedded ? 'dc-root--embedded' : ''}`}>
      {actionError && (
        <div className="dc-error dc-error--action" role="alert">
          <AlertTriangle size={14} />
          <p>{actionError}</p>
          <button type="button" className="dc-icon-btn" onClick={() => setActionError(null)} title="关闭">
            ×
          </button>
        </div>
      )}
      {!embedded && (
      <header className="dc-top">
        <button type="button" className="dc-brand" onClick={() => onNavigate('/')} aria-label="SIFTLINE">
          <SiftlineLogo size={22} showWordmark={false} />
          <span>
            <b>SIFTLINE</b>
            <small>产品文档</small>
          </span>
        </button>
        <div className="dc-top-r">
          <button type="button" className="dc-top-link" onClick={() => onNavigate('/guide')}>
            使用说明
          </button>
          <button type="button" className="dc-top-link" onClick={() => onNavigate('/product')}>
            产品介绍
          </button>
          <button
            type="button"
            className="dc-btn dc-btn--primary dc-btn--sm"
            onClick={() => (actor ? onNavigate('/projects') : onOpenAuth())}
          >
            {actor ? '返回工作台' : '登录工作台'}
          </button>
        </div>
      </header>
      )}

      <div className="dc-layout">
        <DocNav
          docs={docs}
          selected={selected === '__guide' ? '__guide' : selected}
          query={query}
          onQuery={setQuery}
          onSelect={open}
          canManage={canManage}
          onCreate={() => openEditor()}
        />

        <div className="dc-scroll" ref={scrollRef}>
          {docsQuery.isLoading && <p className="dc-loading">正在读取文档…</p>}
          {docsQuery.isError && (
            <div className="dc-error">
              <AlertTriangle size={15} />
              <div>
                <b>文档读取失败</b>
                <p>{formatApiError(docsQuery.error)}</p>
              </div>
              <button type="button" className="dc-btn dc-btn--ghost" onClick={() => void docsQuery.refetch()}>
                <RefreshCw size={13} />
                重试
              </button>
            </div>
          )}
          {!docsQuery.isLoading && !docsQuery.isError && !selected && (
            <DocIndex
              docs={docs}
              query={query}
              canManage={canManage}
              onCreate={() => openEditor()}
              onSelect={open}
              onGuide={() => onNavigate('/guide')}
            />
          )}
          {selected && selected !== '__guide' && docQuery.isLoading && <p className="dc-loading">正在打开文档…</p>}
          {selected && selected !== '__guide' && docQuery.isError && (
            <div className="dc-error">
              <AlertTriangle size={15} />
              <div>
                <b>没有找到这份文档</b>
                <p>{formatApiError(docQuery.error)}</p>
              </div>
              <button type="button" className="dc-btn dc-btn--ghost" onClick={() => open(null)}>
                返回列表
              </button>
            </div>
          )}
          {selected && selected !== '__guide' && docQuery.data && (
            <DocReader
              doc={docQuery.data}
              canManage={canManage}
              busy={updateMut.isPending || deleteMut.isPending}
              onEdit={() => openEditor(docQuery.data)}
              onDelete={() => void remove(docQuery.data!)}
              onTogglePin={() => void togglePin(docQuery.data!)}
              onBack={() => open(null)}
            />
          )}
        </div>
      </div>

      {draft && (
        <Editor
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(saved) => {
            setDraft(null);
            void docsQuery.refetch();
            if (saved) open(saved.slug);
          }}
        />
      )}

    </div>
  );
}
