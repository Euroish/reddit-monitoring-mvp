import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  BookmarkPlus,
  Download,
  ExternalLink,
  Heart,
  RefreshCw,
  Search,
  Sliders,
  Star,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import {
  formatApiError,
  useAnnotationQuery,
  useBatchJobsQuery,
  useContentDetailQuery,
  useContentListQuery,
  useCreateSavedQueryMutation,
  useHydrateMutation,
  useProjectsQuery,
  useSaveAnnotationMutation,
  useSourcesQuery,
  useThreadQuery,
} from '../api/hooks';
import { ObservationChart } from '../components/charts/ObservationChart';
import { ThreadTreeView } from '../components/charts/ThreadTreeView';
import {
  type Actor,
  ApiError,
  type ContentKind,
  type ListQuery,
  type Platform,
  type PublicContent,
  type SearchScope,
  type SignalType,
  formatContentAuthor,
  generateUuidV4,
  validateFilterInput,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';

const PAIN_RE =
  /\b(broken|bug|slow|expensive|pricing|sucks|frustrated|unusable|churn|blocked|timeout|hate|pain|issue|fail(?:ed|ing)?|refund|friction|overage)\b|崩溃|卡顿|太贵|难用|踩坑|报错|封号|吐槽|痛/i;

function parseTermsInput(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getScoreAndComments(item: PublicContent): { score: number; comments: number } {
  const latest = item.observations[item.observations.length - 1];
  const m = latest?.metrics || {};
  const score = Number(m['reddit.score'] ?? m['x.likes'] ?? m['bluesky.likes'] ?? 0);
  const comments = Number(m['reddit.num_comments'] ?? m['x.replies'] ?? m['bluesky.replies'] ?? 0);
  return { score, comments };
}

export function ContentExplorerPage({
  actor,
  initialQueryString,
  initialDetailId,
  onClearDetailId,
}: {
  actor: Actor;
  initialQueryString: string;
  initialDetailId: string | null;
  onClearDetailId: () => void;
}) {
  const { t } = useI18n();
  const canWrite = actor.role === 'owner' || actor.role === 'admin';

  const projectsQuery = useProjectsQuery(true);
  const sourcesQuery = useSourcesQuery(true);
  const projects = projectsQuery.data?.projects || [];
  const sources = sourcesQuery.data?.sources || [];

  const initialSp = useMemo(() => new URLSearchParams(initialQueryString), [initialQueryString]);
  const spView = initialSp.get('view');

  const [projectId, setProjectId] = useState(() => initialSp.get('projectId') || '');
  const [sourceId, setSourceId] = useState(() => initialSp.get('sourceId') || '');
  const [platform, setPlatform] = useState<'' | Platform>(() => (initialSp.get('platform') as Platform) || '');
  const [kind, setKind] = useState<'' | ContentKind>(() => (initialSp.get('kind') as ContentKind) || '');
  const [queryText, setQueryText] = useState(() => initialSp.get('query') || '');
  const [termDraft, setTermDraft] = useState('');
  const [anyTermsText, setAnyTermsText] = useState(() => initialSp.getAll('anyTerms').join(', '));
  const [allTermsText, setAllTermsText] = useState(() => initialSp.getAll('allTerms').join(', '));
  const [exclusionsText, setExclusionsText] = useState(() => initialSp.getAll('exclusions').join(', '));
  const [searchScope, setSearchScope] = useState<SearchScope>(() => (initialSp.get('searchScope') as SearchScope) || 'title_text');
  const [signal, setSignal] = useState<'' | SignalType>(() => (initialSp.get('signal') as SignalType) || '');
  const [fromIso, setFromIso] = useState(() => initialSp.get('from') || '');
  const [toIso, setToIso] = useState(() => initialSp.get('to') || '');
  const [threadAware, setThreadAware] = useState<boolean>(() => {
    const ta = initialSp.get('threadAware');
    return ta === null ? true : ta === 'true';
  });
  const [advOpen, setAdvOpen] = useState(false);

  const [detailState, setDetailState] = useState<{
    id: string | null;
    tab: 'overview' | 'thread' | 'note';
    clearedInit?: boolean;
  }>({ id: null, tab: spView === 'threads' ? 'thread' : 'overview' });

  const filterKey = JSON.stringify({
    projectId,
    sourceId,
    platform,
    kind,
    queryText,
    anyTermsText,
    allTermsText,
    exclusionsText,
    searchScope,
    signal,
    fromIso,
    toIso,
    threadAware,
  });
  const [cursorState, setCursorState] = useState<{ key: string; val?: string }>({ key: '' });
  const cursor = cursorState.key === filterKey ? cursorState.val : undefined;
  const setCursor = (val?: string) => setCursorState({ key: filterKey, val });
  const [cursorNotice, setCursorNotice] = useState<string | null>(null);

  const activeFilter: ListQuery = useMemo(() => {
    const anyTerms = parseTermsInput(anyTermsText);
    const allTerms = parseTermsInput(allTermsText);
    const exclusions = parseTermsInput(exclusionsText);
    return {
      ...(projectId ? { projectId } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(platform ? { platform } : {}),
      ...(kind ? { kind } : {}),
      ...(queryText.trim() ? { query: queryText.trim() } : {}),
      ...(anyTerms.length ? { anyTerms } : {}),
      ...(allTerms.length ? { allTerms } : {}),
      ...(exclusions.length ? { exclusions } : {}),
      searchScope,
      ...(signal ? { signal } : {}),
      ...(fromIso ? { from: new Date(fromIso).toISOString() } : {}),
      ...(toIso ? { to: new Date(toIso).toISOString() } : {}),
      threadAware,
      limit: 25,
      ...(cursor ? { cursor } : {}),
    };
  }, [
    projectId,
    sourceId,
    platform,
    kind,
    queryText,
    anyTermsText,
    allTermsText,
    exclusionsText,
    searchScope,
    signal,
    fromIso,
    toIso,
    threadAware,
    cursor,
  ]);

  const filterValidationMsg = useMemo(() => validateFilterInput(activeFilter), [activeFilter]);
  const threadScope = useMemo(() => {
    const clean = { ...activeFilter };
    delete clean.limit;
    delete clean.cursor;
    return clean;
  }, [activeFilter]);
  const contentQuery = useContentListQuery(activeFilter, projectId || undefined, !filterValidationMsg);

  const cursorScopeChanged =
    contentQuery.error instanceof ApiError &&
    contentQuery.error.status === 409 &&
    contentQuery.error.code === 'cursor_scope_changed';

  const items = useMemo(() => contentQuery.data?.items ?? [], [contentQuery.data?.items]);
  const nextCursor = contentQuery.data?.nextCursor || null;

  const detailId =
    detailState.id ??
    (!detailState.clearedInit && initialDetailId ? initialDetailId : null) ??
    (!detailState.clearedInit && spView === 'threads' && items.length > 0 ? items[0].id : null);
  const defaultDrawerTab: 'overview' | 'thread' | 'note' = detailState.id
    ? detailState.tab
    : spView === 'threads'
      ? 'thread'
      : 'overview';
  const setDetailId = (id: string | null) =>
    setDetailState((prev) => ({ id, tab: prev.tab, clearedInit: id === null }));
  const setDefaultDrawerTab = (tab: 'overview' | 'thread' | 'note') =>
    setDetailState((prev) => ({ ...prev, tab }));

  // Save Query
  const [saveQueryOpen, setSaveQueryOpen] = useState(false);
  const [saveQueryName, setSaveQueryName] = useState('');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const createSavedQueryMut = useCreateSavedQueryMutation();

  const handleSaveQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus(null);
    try {
      const cleanFilter: ListQuery = { ...activeFilter };
      delete cleanFilter.cursor;
      delete cleanFilter.limit;
      await createSavedQueryMut.mutateAsync({ name: saveQueryName.trim() || 'Untitled Query', filter: cleanFilter });
      setSaveQueryOpen(false);
      setSaveQueryName('');
      setSaveStatus(t('Saved query added to Personal Workspace.', '已保存查询至个人工作区。'));
    } catch (err) {
      setSaveStatus(formatApiError(err));
    }
  };

  // Streaming Export
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [maxRows, setMaxRows] = useState(10000);
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{ message: string; nextCursor?: string | null; isError?: boolean } | null>(null);

  const runExport = async (overrideCursor?: string) => {
    setExporting(true);
    setExportFeedback(null);
    try {
      const base: ListQuery = { ...activeFilter };
      delete base.cursor;
      delete base.limit;
      const res = await apiClient.exportContent({
        ...base,
        format: exportFormat,
        maxRows,
        ...(overrideCursor ? { cursor: overrideCursor } : {}),
      });
      const blob = new Blob([res.text], {
        type: res.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);

      if (res.jsonResult) {
        const r = res.jsonResult.result;
        setExportFeedback({
          message: r.truncated
            ? t(`Exported ${r.exportedCount} rows (complete=true, truncated).`, `已校验完整导出 ${r.exportedCount} 条（result.complete=true，已截断）。`)
            : t(`Verified complete export: ${r.exportedCount} rows (complete=true).`, `已校验并导出：共 ${r.exportedCount} 条（result.complete=true）。`),
          nextCursor: r.truncated ? r.nextCursor : null,
        });
      } else {
        setExportFeedback({ message: t('CSV streaming export completed.', '已完成防公式注入 CSV 流式导出。') });
      }
      setExportOpen(false);
    } catch (err) {
      setExportFeedback({ message: formatApiError(err), isError: true });
    } finally {
      setExporting(false);
    }
  };

  // Batch Reddit Hydration
  const [selectedHydrateIds, setSelectedHydrateIds] = useState<string[]>([]);
  const [maxCommentsPerPost, setMaxCommentsPerPost] = useState(25);
  const [hydrateJobIds, setHydrateJobIds] = useState<string[]>([]);
  const [hydrateMsg, setHydrateMsg] = useState<string | null>(null);
  const hydrateMut = useHydrateMutation();
  const hydrateIdemRef = useRef<{ sig: string; key: string }>({ sig: '', key: generateUuidV4() });
  const batchJobsQuery = useBatchJobsQuery(hydrateJobIds);

  const toggleHydrateSelect = (id: string) => {
    setSelectedHydrateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 30 ? [...prev, id] : prev,
    );
  };

  const handleHydrate = async () => {
    if (!projectId || selectedHydrateIds.length === 0) return;
    setHydrateMsg(null);
    const sig = JSON.stringify({ projectId, ids: [...selectedHydrateIds].sort(), maxCommentsPerPost });
    if (hydrateIdemRef.current.sig !== sig) {
      hydrateIdemRef.current = { sig, key: generateUuidV4() };
    }
    try {
      const res = await hydrateMut.mutateAsync({
        projectId,
        contentIds: selectedHydrateIds,
        maxCommentsPerPost,
        idempotencyKey: hydrateIdemRef.current.key,
      });
      setHydrateJobIds(res.jobIds);
      setSelectedHydrateIds([]);
      hydrateIdemRef.current = { sig: '', key: generateUuidV4() };
      setHydrateMsg(t(`Dispatched ${res.jobIds.length} hydration job(s) to queue.`, `已入队 ${res.jobIds.length} 个评论水合任务。`));
    } catch (err) {
      setHydrateMsg(formatApiError(err));
    }
  };

  const handleTermSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = termDraft.trim();
    if (!cleaned) return;
    setQueryText(cleaned);
    setTermDraft('');
    setCursor(undefined);
  };

  const resetAll = () => {
    setProjectId('');
    setSourceId('');
    setPlatform('');
    setKind('');
    setQueryText('');
    setTermDraft('');
    setAnyTermsText('');
    setAllTermsText('');
    setExclusionsText('');
    setSignal('');
    setFromIso('');
    setToIso('');
    setCursor(undefined);
  };

  return (
    <div className="ds-page">
      <div className="crumb">
        <span>{t('Workbench', '工作台')}</span>
        <span>/</span>
        <span>{t('Research', '研究')}</span>
        <span>/</span>
        <b>{t('Content Explorer', '内容检索')}</b>
      </div>

      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{t('Content & Thread Explorer', '内容检索与讨论树')}</h1>
            <span className="tag tag--line" style={{ height: 22, fontSize: 10 }}>
              coverage: stored_sample · totalMatching: null
            </span>
          </div>
          <p className="page-desc">
            {t(
              'Filter stored multi-platform discussions with NFKC terms, signal patterns, cursor pagination, and thread-aware folding.',
              '基于三段式词组、痛点信号、UTC 半开区间与讨论树感知进行高精度检索；支持 50k 流式导出与单帖多快照钻取。',
            )}
          </p>
        </div>

        <div className="page-actions" style={{ position: 'relative' }}>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            onClick={() => setSaveQueryOpen((v) => !v)}
          >
            <BookmarkPlus size={14} />
            <span>{t('Save Query', '保存查询')}</span>
          </button>

          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            onClick={() => setExportOpen((v) => !v)}
          >
            <Download size={14} />
            <span>{t('Stream Export', '流式导出')}</span>
          </button>

          {exportOpen && (
            <div className="ds-pop" style={{ top: 'calc(100% + 6px)', right: 0, width: 295, padding: 12 }}>
              <div className="pop-hd">
                <span>{t('Export Current Filter', '导出当前筛选口径')}</span>
                <span>50k max</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, marginBottom: 10 }}>
                <span>{t('Format', '文件格式')}</span>
                <div className="seg">
                  <button type="button" className={exportFormat === 'csv' ? 'on' : ''} onClick={() => setExportFormat('csv')}>CSV</button>
                  <button type="button" className={exportFormat === 'json' ? 'on' : ''} onClick={() => setExportFormat('json')}>JSON</button>
                </div>
              </div>
              <div style={{ fontSize: 11.5, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{t('Max Rows', '最大行数')}</span>
                  <b style={{ fontFamily: 'var(--font-mono)' }}>{maxRows.toLocaleString()}</b>
                </div>
                <input
                  type="range"
                  min={1000}
                  max={50000}
                  step={1000}
                  value={maxRows}
                  onChange={(e) => setMaxRows(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--wb-purple)' }}
                />
              </div>
              <button
                type="button"
                className="ds-btn"
                style={{ width: '100%', height: 32, fontSize: 12 }}
                disabled={exporting}
                onClick={() => runExport()}
              >
                {exporting ? t('Exporting...', '流式导出中...') : t('Download Verified Export', '开始校验并导出')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline Save Query Box */}
      {saveQueryOpen && (
        <form
          onSubmit={handleSaveQuery}
          style={{ background: '#ffffff', border: '1px solid var(--line)', borderRadius: 7, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t('Query Name:', '查询名称：')}</span>
          <input
            className="wb-input"
            style={{ minWidth: 240, flex: 1 }}
            value={saveQueryName}
            onChange={(e) => setSaveQueryName(e.target.value)}
            placeholder={t('e.g. FinOps Billing Pain · 30d', '例如：账单波动痛点 · 近30天')}
            required
          />
          <button type="submit" className="ds-btn">{t('Confirm Save', '确认保存')}</button>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setSaveQueryOpen(false)}>{t('Cancel', '取消')}</button>
        </form>
      )}

      {saveStatus && <div className="wb-alert wb-alert--info" style={{ marginBottom: 12 }}>{saveStatus}</div>}
      {cursorNotice && <div className="wb-alert wb-alert--warn" style={{ marginBottom: 12 }}>{cursorNotice}</div>}
      {exportFeedback && (
        <div className={`wb-alert ${exportFeedback.isError ? 'wb-alert--error' : 'wb-alert--success'}`} style={{ marginBottom: 12 }}>
          <span>{exportFeedback.message}</span>
          {exportFeedback.nextCursor && (
            <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 26, fontSize: 11 }} onClick={() => runExport(exportFeedback.nextCursor!)}>
              {t('Download Next Segment', '续段下载')}
            </button>
          )}
        </div>
      )}

      {/* DeepSeek Search Card */}
      <div className="search-card">
        <form className="search-main" onSubmit={handleTermSubmit}>
          <Search size={15} color="var(--faint)" />
          <div className="term-chips">
            {queryText && (
              <span className="term-chip">
                {queryText}
                <button type="button" onClick={() => { setQueryText(''); setCursor(undefined); }}>
                  <X size={11} />
                </button>
              </span>
            )}
          </div>
          <input
            className="search-input"
            value={termDraft}
            onChange={(e) => setTermDraft(e.target.value)}
            placeholder={t('Enter search phrase (>=3 alnum chars) and press Enter...', '输入核心检索词后回车（至少 3 个连续字母或数字）…')}
          />
          <button type="submit" className="ds-btn" style={{ height: 34, padding: '0 16px' }}>
            {t('Search', '检索')}
          </button>
        </form>

        {/* 4-Column DeepSeek Filter Grid */}
        <div className="filter-grid">
          <div className="fb-block">
            <div className="fbb-label">
              <span>{t('Platform', '平台')}</span>
              <span>{platform || t('All', '全部')}</span>
            </div>
            <div className="pill-select">
              {(['', 'reddit', 'x', 'bluesky', 'web'] as const).map((p) => (
                <button
                  key={p || 'all'}
                  type="button"
                  className={platform === p ? 'on' : ''}
                  onClick={() => {
                    setPlatform(p);
                    setCursor(undefined);
                  }}
                >
                  {p === '' ? t('All', '全部') : p === 'x' ? 'X' : p}
                </button>
              ))}
            </div>
          </div>

          <div className="fb-block">
            <div className="fbb-label"><span>{t('Signal', '信号')}</span></div>
            <div className="seg ink" style={{ width: '100%' }}>
              {([
                ['', t('All', '全部')],
                ['discussion', t('Thread', '讨论')],
                ['pain', t('Pain', '痛点')],
              ] as const).map(([v, l]) => (
                <button
                  key={v || 'all'}
                  type="button"
                  className={signal === v ? 'on' : ''}
                  style={{ flex: 1 }}
                  onClick={() => {
                    setSignal(v);
                    setCursor(undefined);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 6 }}>
              {t('Pain = lexicon + reply structure', '痛点 = 中英文词库命中 + 高互动结构')}
            </div>
          </div>

          <div className="fb-block">
            <div className="fbb-label"><span>{t('Content Kind', '内容形态')}</span></div>
            <div className="pill-select">
              {(['', 'post', 'comment', 'article'] as const).map((k) => (
                <button
                  key={k || 'all'}
                  type="button"
                  className={kind === k ? 'on' : ''}
                  onClick={() => {
                    setKind(k);
                    setCursor(undefined);
                  }}
                >
                  {k === '' ? t('All', '全部') : k}
                </button>
              ))}
            </div>
          </div>

          <div className="fb-block">
            <div className="fbb-label"><span>{t('Match Scope', '匹配范围')}</span></div>
            <div className="seg" style={{ width: '100%' }}>
              {([
                ['title', t('Title', '标题')],
                ['text', t('Body', '正文')],
                ['title_text', t('Both', '两者')],
              ] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  className={searchScope === v ? 'on' : ''}
                  style={{ flex: 1 }}
                  onClick={() => {
                    setSearchScope(v);
                    setCursor(undefined);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 6 }}>
              {t('Does not cross U+001F delimiter', '严格不跨标题/正文分隔符')}
            </div>
          </div>
        </div>

        {/* Advanced Accordion Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ds-btn ds-btn--quiet"
            style={{ fontSize: 11.5, height: 28 }}
            onClick={() => setAdvOpen((v) => !v)}
          >
            <Sliders size={13} />
            <span>{t('Advanced Clauses, Project & UTC Window', '更多条件（项目上下文 / 三段布尔词 / UTC 时间窗）')}</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
              {threadAware
                ? t('threadAware ON · comments fold to root', '讨论树感知已开启 · 评论命中上溯根帖')
                : t('threadAware OFF · direct hits only', '讨论树感知已关闭')}
            </span>
            <button type="button" className="auth-link" onClick={resetAll}>
              {t('Reset all', '清空全部')}
            </button>
          </div>
        </div>

        <div className={`adv-filters ${advOpen ? 'open' : ''}`}>
          <div className="adv-inner">
            <div className="adv-field">
              <label>{t('Project & Source Scope', '限定项目与来源')}</label>
              <div style={{ display: 'grid', gap: 6 }}>
                <select
                  className="wb-select"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setCursor(undefined);
                  }}
                >
                  <option value="">{t('All Authorized Sources', '全部已授权来源')}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  className="wb-select"
                  value={sourceId}
                  onChange={(e) => {
                    setSourceId(e.target.value);
                    setCursor(undefined);
                  }}
                >
                  <option value="">{t('Any Source', '全部来源')}</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="adv-field">
              <label>{t('Boolean Terms (anyTerms / allTerms / exclusions)', '布尔词组（逗号分隔）')}</label>
              <div style={{ display: 'grid', gap: 6 }}>
                <input className="wb-input" value={anyTermsText} onChange={(e) => { setAnyTermsText(e.target.value); setCursor(undefined); }} placeholder="OR: pricing, billing" />
                <input className="wb-input" value={allTermsText} onChange={(e) => { setAllTermsText(e.target.value); setCursor(undefined); }} placeholder="AND: latency" />
                <input className="wb-input" value={exclusionsText} onChange={(e) => { setExclusionsText(e.target.value); setCursor(undefined); }} placeholder="NOT: hiring" />
              </div>
            </div>

            <div className="adv-field">
              <label>{t('UTC [from, to) & Structure', '时间窗 [from, to) 与讨论树开关')}</label>
              <div style={{ display: 'grid', gap: 6 }}>
                <input type="datetime-local" className="wb-input" value={fromIso} onChange={(e) => { setFromIso(e.target.value); setCursor(undefined); }} />
                <input type="datetime-local" className="wb-input" value={toIso} onChange={(e) => { setToIso(e.target.value); setCursor(undefined); }} />
                <div className="toggle-line" style={{ padding: '4px 0' }}>
                  <span>threadAware</span>
                  <button
                    type="button"
                    className="ds-switch"
                    aria-checked={threadAware}
                    onClick={() => {
                      setThreadAware((v) => !v);
                      setCursor(undefined);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {filterValidationMsg && (
          <div className="wb-alert wb-alert--error" style={{ marginTop: 10 }}>
            {filterValidationMsg}
          </div>
        )}
      </div>

      {/* Batch Reddit Hydration Bar (projectId context + write role) */}
      {projectId && canWrite && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 7,
            background: 'var(--wb-teal-tint, #eef6f3)',
            border: '1px solid rgba(var(--accent2-rgb), 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12 }}>
            <b>{t('Batch Reddit Comment Hydration', 'Reddit 批量评论水合队列')}</b>
            <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>
              {t(`Selected ${selectedHydrateIds.length}/30 root Reddit posts (t3_*)`, `已选择 ${selectedHydrateIds.length}/30 根 Reddit 主帖 (t3_*)`)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>maxCommentsPerPost:</span>
            <input
              type="number"
              className="wb-input"
              style={{ width: 64, padding: '4px 7px' }}
              min={1}
              max={50}
              value={maxCommentsPerPost}
              onChange={(e) => setMaxCommentsPerPost(Math.min(50, Math.max(1, Number(e.target.value) || 25)))}
            />
            <button
              type="button"
              className="ds-btn"
              style={{ height: 30, fontSize: 11 }}
              disabled={selectedHydrateIds.length === 0 || hydrateMut.isPending}
              onClick={handleHydrate}
            >
              {t('Dispatch Hydrate', '派发水合')}
            </button>
          </div>
          {hydrateMsg && <div style={{ width: '100%', fontSize: 11.5, fontWeight: 600 }}>{hydrateMsg}</div>}
          {batchJobsQuery.data?.jobs && batchJobsQuery.data.jobs.length > 0 && (
            <div style={{ width: '100%', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {batchJobsQuery.data.jobs.map((j) => (
                <span key={j.id} className="tag tag--lilac">
                  {j.id.slice(0, 8)} · {j.status} ({j.phase || j.provider_state.phase})
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          <b style={{ color: 'var(--ink)' }}>{items.length}</b> {t('loaded rows · cursor scoped to filter hash', '条已加载结果 · 游标绑定当前筛选指纹')}
        </div>
        <button type="button" className="icon-square" style={{ width: 30, height: 30 }} onClick={() => contentQuery.refetch()} title={t('Refresh', '刷新列表')}>
          <RefreshCw size={13} />
        </button>
      </div>

      {/* DeepSeek Result List */}
      <div className="result-list">
        <div className="res-head">
          <span>{t('Discussion', '讨论内容')}</span>
          <span>{t('Score / Likes', '热度')}</span>
          <span>{t('Replies', '评论')}</span>
          <span>{t('Signal', '信号')}</span>
          <span></span>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '42px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
            {contentQuery.isLoading
              ? t('Loading stored content stream...', '正在检索已存内容流...')
              : t('No matching discussions found. Adjust query terms or reset filters.', '当前筛选条件下没有匹配数据。')}
          </div>
        ) : (
          items.map((item) => {
            const { score, comments } = getScoreAndComments(item);
            const isPain = PAIN_RE.test(`${item.title || ''} ${item.text || ''}`);
            const isDisc = comments >= 10;
            const isRedditRoot = item.platform === 'reddit' && item.kind === 'post' && item.externalId.startsWith('t3_');

            return (
              <div key={item.id} className="res-row" onClick={() => setDetailId(item.id)}>
                <div>
                  <div className="res-top">
                    {projectId && canWrite && isRedditRoot && (
                      <input
                        type="checkbox"
                        checked={selectedHydrateIds.includes(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleHydrateSelect(item.id)}
                        title={t('Select Reddit root t3_* for batch hydration', '勾选纳入 Reddit 批量评论水合')}
                      />
                    )}
                    <span className="tag tag--line" style={{ height: 19, fontSize: 9.5, textTransform: item.platform === 'x' ? 'uppercase' : 'capitalize' }}>
                      {item.platform} · {item.kind}
                    </span>
                    <span className="tag" style={{ height: 19, fontSize: 9.5 }}>
                      {item.externalId}
                    </span>
                    {item.contextMissing && (
                      <span className="tag" style={{ height: 19, fontSize: 9.5, background: '#fdf3e1', color: '#8a5a12' }}>
                        <AlertTriangle size={10} /> contextMissing
                      </span>
                    )}
                    {!item.publishedAt && (
                      <span className="tag" style={{ height: 19, fontSize: 9.5, background: '#fdf0ec', color: '#8f3f2a' }}>
                        publishedAt: null
                      </span>
                    )}
                  </div>
                  <div className="res-title">{item.title || item.text?.slice(0, 96) || `[${item.textState}]`}</div>
                  {item.text && <div className="res-excerpt">{item.text}</div>}
                  <div className="res-meta">
                    <span>{formatContentAuthor(item.author)}</span>
                    <span>·</span>
                    <span>{[...new Set(item.observations.map((o) => o.provider))].join(' + ')}</span>
                    <span>·</span>
                    <span>{item.publishedAt ? item.publishedAt.slice(0, 16).replace('T', ' ') + ' UTC' : t('Unknown publish time', '发布时间未知')}</span>
                  </div>
                </div>

                <div className="res-stat">
                  {score.toLocaleString()}
                  <span>{item.platform === 'reddit' ? 'upvotes' : 'likes'}</span>
                </div>

                <div className="res-stat">
                  {comments}
                  <span>{t('replies', '评论')}</span>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span className={`sig ${isPain ? 'pain' : isDisc ? 'disc' : 'neutral'}`}>
                    {isPain ? t('Pain', '痛点') : isDisc ? t('Thread', '讨论') : t('Neutral', '中性')}
                  </span>
                </div>

                <button
                  type="button"
                  style={{ border: 0, background: 'none', padding: 0, color: 'var(--faint)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDefaultDrawerTab('note');
                    setDetailId(item.id);
                  }}
                  title={t('Annotate or Bookmark', '批注与收藏')}
                >
                  <Star size={14} />
                </button>
              </div>
            );
          })
        )}

        <div style={{ padding: '11px 16px', background: '#fdfefb', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: 'var(--muted)' }}>
          <span>{nextCursor ? t('More stored items available via cursor', '仍有更多匹配样本') : t('End of stream · nextCursor: null', '已到底部 · nextCursor: null')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {cursor && (
              <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 28, fontSize: 11 }} onClick={() => setCursor(undefined)}>
                {t('First Page', '回到首页')}
              </button>
            )}
            <button
              type="button"
              className="ds-btn"
              style={{ height: 28, fontSize: 11 }}
              disabled={!nextCursor}
              onClick={() => nextCursor && setCursor(nextCursor)}
            >
              {t('Load Next Page', '加载下一页')}
            </button>
          </div>
        </div>
      </div>

      {/* DeepSeek Tabbed Content Detail Drawer */}
      {detailId && (
        <ContentDetailDrawer
          key={`${detailId}:${defaultDrawerTab}`}
          contentId={detailId}
          initialTab={defaultDrawerTab}
          scopeQuery={threadScope}
          onClose={() => {
            setDetailId(null);
            onClearDetailId();
          }}
        />
      )}
      {cursorScopeChanged && (
        <div className="wb-alert wb-alert--warn" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <span>{t('Scope changed (409 cursor_scope_changed). Reset cursor to page 1.', '过滤条件或项目版本号已变更（409），请重置游标到第一页。')}</span>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            style={{ height: 26, fontSize: 11 }}
            onClick={() => {
              setCursor(undefined);
              setCursorNotice(t('Cursor reset to page 1.', '已重置游标到第一页。'));
            }}
          >
            {t('Reset Cursor', '重置第一页')}
          </button>
        </div>
      )}
    </div>
  );
}

function ContentDetailDrawer({
  contentId,
  initialTab = 'overview',
  scopeQuery,
  onClose,
}: {
  contentId: string;
  initialTab?: 'overview' | 'thread' | 'note';
  scopeQuery: ListQuery;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const detailQuery = useContentDetailQuery(contentId);
  const annQuery = useAnnotationQuery(contentId);
  const saveAnnMut = useSaveAnnotationMutation(contentId);

  const [tab, setTab] = useState<'overview' | 'thread' | 'note'>(initialTab);
  const [threadView, setThreadView] = useState<'top' | 'matches' | 'op'>('top');
  const threadQuery = useThreadQuery(contentId, scopeQuery, threadView);

  const serverAnn = annQuery.data?.annotation;
  const serverKey = `${contentId}:${serverAnn?.revision ?? 0}`;
  const [annDraft, setAnnDraft] = useState<{ key: string; favorite: boolean; note: string } | null>(null);
  const [revOverride, setRevOverride] = useState<{ key: string; rev: number } | null>(null);
  const [annMsg, setAnnMsg] = useState<string | null>(null);

  const favorite = annDraft?.key === serverKey ? annDraft.favorite : (serverAnn?.favorite ?? false);
  const note = annDraft?.key === serverKey ? annDraft.note : (serverAnn?.note ?? '');
  const annRev = revOverride?.key === contentId ? revOverride.rev : (serverAnn?.revision ?? 0);

  const setFavorite = (val: boolean) => setAnnDraft({ key: serverKey, favorite: val, note });
  const setNote = (val: string) => setAnnDraft({ key: serverKey, favorite, note: val });

  const handleSaveAnn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnnMsg(null);
    try {
      const res = await saveAnnMut.mutateAsync({ favorite, note, revision: annRev });
      setRevOverride({ key: contentId, rev: res.revision });
      setAnnDraft({ key: `${contentId}:${res.revision}`, favorite, note });
      setAnnMsg(t(`Saved cleanly · revision ${res.revision}`, `批注已保存 · 乐观锁 rev ${res.revision}`));
    } catch (err) {
      setAnnMsg(formatApiError(err));
    }
  };

  const item = detailQuery.data?.content;
  const { score, comments } = item ? getScoreAndComments(item) : { score: 0, comments: 0 };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer-panel" role="dialog" aria-label={t('Content Detail', '内容详情')} onClick={(e) => e.stopPropagation()}>
        <header className="dw-hd">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span className="tag tag--lilac" style={{ textTransform: 'uppercase' }}>
              {item ? `${item.platform} · ${item.kind} · ${item.externalId}` : t('Loading...', '加载中...')}
            </span>
            <button type="button" className="icon-square" style={{ width: 30, height: 30, borderRadius: '50%' }} onClick={onClose}>
              <X size={14} />
            </button>
          </div>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 650, lineHeight: 1.38, marginTop: 9 }}>
            {item?.title || item?.text?.slice(0, 90) || contentId}
          </h3>
          {item && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10.5, color: 'var(--faint)', marginTop: 6 }}>
              <span>{formatContentAuthor(item.author)}</span>
              <span>·</span>
              <span>availability: {item.availability}</span>
              <span>·</span>
              <span>textState: {item.textState}</span>
              {item.contextMissing && (
                <span className="tag" style={{ height: 18, fontSize: 9.5, background: '#fdf3e1', color: '#8a5a12' }}>
                  contextMissing: true
                </span>
              )}
            </div>
          )}

          <div className="tabs" style={{ marginTop: 12, borderBottom: 0 }}>
            <button type="button" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
              {t('Overview & Snapshots', '概览与观测曲线')}
            </button>
            <button type="button" aria-selected={tab === 'thread'} onClick={() => setTab('thread')}>
              {t('Thread Tree', '讨论树')} ({threadQuery.data?.nodes.length ?? 0})
            </button>
            <button type="button" aria-selected={tab === 'note'} onClick={() => setTab('note')}>
              {t('Annotation', '研究批注')} (rev {annRev})
            </button>
          </div>
        </header>

        <div className="dw-body">
          {tab === 'overview' && item && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {item.text && (
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--faint)', fontWeight: 650, marginBottom: 6 }}>
                    {t('Body Text', '内容正文')}
                  </div>
                  <div style={{ background: '#fbfcf7', border: '1px solid var(--line)', borderRadius: 6, padding: 12, fontSize: 12.5, lineHeight: 1.65, color: 'var(--ink-2)' }}>
                    {item.text}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px' }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--faint)' }}>
                    {item.platform === 'reddit' ? 'Upvotes' : 'Likes'}
                  </span>
                  <b style={{ display: 'block', fontSize: 18, fontFamily: 'var(--font-display)', marginTop: 2 }}>{score.toLocaleString()}</b>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px' }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--faint)' }}>{t('Comments', '评论数')}</span>
                  <b style={{ display: 'block', fontSize: 18, fontFamily: 'var(--font-display)', marginTop: 2 }}>{comments}</b>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px' }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--faint)' }}>{t('Snapshots', '观测快照')}</span>
                  <b style={{ display: 'block', fontSize: 18, fontFamily: 'var(--font-display)', marginTop: 2 }}>{item.observations.length}</b>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--faint)', fontWeight: 650, marginBottom: 6 }}>
                  {t('Observation Trajectory (ECharts Split Axes)', '单内容多快照指标演变 (ECharts 分轴轨迹)')}
                </div>
                <ObservationChart observations={item.observations} />
              </div>

              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--faint)', fontWeight: 650, marginBottom: 6 }}>
                  {t('Provider Observations Log', '各渠道独立观测记录')}
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden', fontSize: 11 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr .8fr', padding: '7px 10px', background: '#fbfcf7', borderBottom: '1px solid var(--line)', fontWeight: 600, color: 'var(--faint)', fontSize: 9.5, textTransform: 'uppercase' }}>
                    <span>{t('Provider', '渠道')}</span>
                    <span>{t('Observed / Fetched (UTC)', '观测时间')}</span>
                    <span style={{ textAlign: 'right' }}>{t('Maturity', '成熟度')}</span>
                  </div>
                  {item.observations.map((obs, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.4fr .8fr', padding: '7px 10px', borderBottom: idx === item.observations.length - 1 ? 0 : '1px solid #f3f5ee' }}>
                      <b>{obs.provider}</b>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
                        {(obs.sourceObservedAt || obs.fetchedAt).slice(0, 16).replace('T', ' ')}
                      </span>
                      <span style={{ textAlign: 'right', color: 'var(--ink-3)' }}>{obs.maturity}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'thread' && (
            <ThreadTreeView
              thread={threadQuery.data}
              view={threadView}
              onChangeView={setThreadView}
              loading={threadQuery.isLoading}
            />
          )}

          {tab === 'note' && (
            <form onSubmit={handleSaveAnn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 650 }}>
                  {t('Personal Annotation (Optimistic Lock)', '个人研究批注（乐观锁并发控制）')}
                </span>
                <span className="tag tag--line">revision {annRev}</span>
              </div>

              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
                <span>{t('Bookmark as high-signal evidence', '标星收藏为高价值证据')}</span>
              </label>

              <textarea
                className="wb-textarea"
                rows={5}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('Write researcher insights or next actions (up to 2000 chars)...', '写下你的判断、证据出处或下一步动作（不超过 2000 字符）…')}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--faint)' }}>
                <span>{t('Preserves local draft on 409 conflict', '发生乐观锁 409 冲突时自动保留本地草稿')}</span>
                <span>{note.length} / 2000</span>
              </div>

              {annMsg && <div className="wb-alert wb-alert--info">{annMsg}</div>}

              <div>
                <button type="submit" className="ds-btn" disabled={saveAnnMut.isPending}>
                  <Bookmark size={13} />
                  <span>{saveAnnMut.isPending ? t('Saving...', '保存中...') : t('Save Annotation', '保存批注')}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        <footer className="dw-ft">
          <button
            type="button"
            className="ds-btn ds-btn--quiet"
            onClick={() => setTab('note')}
          >
            <Heart size={13} color={favorite ? '#c99b1d' : undefined} />
            <span>{favorite ? t('Bookmarked', '已收藏') : t('Bookmark', '收藏与批注')}</span>
          </button>
          <span style={{ flex: 1 }} />
          {item?.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="ds-btn ds-btn--ghost">
              <ExternalLink size={13} />
              <span>{t('Open Original', '打开原帖')}</span>
            </a>
          )}
        </footer>
      </aside>
    </div>
  );
}
