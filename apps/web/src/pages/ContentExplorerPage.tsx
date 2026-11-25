import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
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
  usePublicSourcesQuery,
  useQuotasSummaryQuery,
  useResearchScopeQuery,
  useResearchTaskEvidenceQuery,
  useSaveAnnotationMutation,
  useSourcesQuery,
  useThreadQuery,
} from '../api/hooks';
import { ObservationChart } from '../components/charts/ObservationChart';
import { ThreadTreeView } from '../components/charts/ThreadTreeView';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Empty } from '../components/ui/empty';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
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
import { safeHttpUrl, toSafeUtcIso, toUtcDatetimeLocal } from '../lib/sourceLabels';

function ExportResultsButton({ actor, onClick }: { actor: Actor | null; onClick: () => void }) {
  const { t } = useI18n();
  const viewer = actor?.clientKind === 'browser' && actor.role === 'viewer';
  const quota = useQuotasSummaryQuery(viewer);
  const denied = viewer && quota.data?.effectivePolicy.exportEnabled === false;
  const notice = denied ? t('Export is disabled for your account.', '当前账号的导出权限已关闭。') : '';
  return (
    <>
      <button
        type="button"
        className="ds-btn ds-btn--ghost"
        onClick={onClick}
        disabled={denied}
        aria-describedby={notice ? 'stream-export-notice' : undefined}
      >
        <Download size={14} />
        <span>{t('Export Results', '导出检索结果')}</span>
      </button>
      {notice && (
        <small id="stream-export-notice" role="status">
          {notice}
        </small>
      )}
    </>
  );
}

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
  onOpenAuth,
  onNavigate,
}: {
  actor: Actor | null;
  initialQueryString: string;
  initialDetailId: string | null;
  onClearDetailId: () => void;
  onOpenAuth?: (tab?: 'login' | 'register', reason?: string) => void;
  onNavigate?: (path: string) => void;
}) {
  const { t } = useI18n();
  const isAuthed = Boolean(actor);
  const canWrite = actor?.role === 'owner' || actor?.role === 'admin';

  const projectsQuery = useProjectsQuery(isAuthed);
  const sourcesQuery = useSourcesQuery(isAuthed);
  const publicSourcesQuery = usePublicSourcesQuery(!isAuthed);
  const projects = projectsQuery.data?.projects || [];
  const sources = isAuthed
    ? sourcesQuery.data?.sources || []
    : (publicSourcesQuery.data?.sources || []).map((s) => ({ id: s.id, label: s.label }));

  const initialSp = useMemo(() => new URLSearchParams(initialQueryString), [initialQueryString]);
  const spView = initialSp.get('view');
  const fromResearch = initialSp.get('fromResearch') === '1';
  const researchLayer = initialSp.get('researchLayer') || 'l1';
  const researchLabel = initialSp.get('researchLabel') || '';
  const [analysisTaskId, setAnalysisTaskId] = useState(() => initialSp.get('analysisTaskId') || '');
  const [taskSentiment, setTaskSentiment] = useState<
    '' | 'positive' | 'neutral' | 'negative' | 'unclassified'
  >(() => (initialSp.get('sentiment') as '' | 'positive' | 'neutral' | 'negative' | 'unclassified') || '');
  const [taskTopicIndex, setTaskTopicIndex] = useState<number | undefined>(() => {
    const raw = initialSp.get('topicIndex');
    if (raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  });
  const [evidenceOffset, setEvidenceOffset] = useState(0);

  const [projectId, setProjectId] = useState(() => initialSp.get('projectId') || '');
  const [sourceId, setSourceId] = useState(() => initialSp.get('sourceId') || '');
  const [sourceIdsParam, setSourceIdsParam] = useState<string[]>(() => initialSp.getAll('sourceIds'));
  const [batchIdsParam, setBatchIdsParam] = useState<string[]>(() => initialSp.getAll('batchIds'));
  const [platform, setPlatform] = useState<'' | Platform>(() => (initialSp.get('platform') as Platform) || '');
  const [kind, setKind] = useState<'' | ContentKind>(() => (initialSp.get('kind') as ContentKind) || '');
  const [community, setCommunity] = useState(() => initialSp.get('community') || '');
  const [language, setLanguage] = useState(() => initialSp.get('language') || '');
  const [queryText, setQueryText] = useState(() => initialSp.get('query') || '');
  const [termDraft, setTermDraft] = useState('');
  const [anyTermsText, setAnyTermsText] = useState(() => initialSp.getAll('anyTerms').join(', '));
  const [allTermsText, setAllTermsText] = useState(() => initialSp.getAll('allTerms').join(', '));
  const [exclusionsText, setExclusionsText] = useState(() => initialSp.getAll('exclusions').join(', '));
  const [searchScope, setSearchScope] = useState<SearchScope>(
    () => (initialSp.get('searchScope') as SearchScope) || 'title_text',
  );
  const [signal, setSignal] = useState<'' | SignalType>(() => (initialSp.get('signal') as SignalType) || '');
  const [timePreset, setTimePreset] = useState<'all' | '7' | '30' | '90' | 'custom'>(() =>
    initialSp.get('from') || initialSp.get('to') ? 'custom' : 'all',
  );
  const [fromIso, setFromIso] = useState(() => toUtcDatetimeLocal(initialSp.get('from')));
  const [toIso, setToIso] = useState(() => toUtcDatetimeLocal(initialSp.get('to')));
  const [timeBasis, setTimeBasis] = useState<'published' | 'collected'>(() =>
    initialSp.get('timeBasis') === 'collected' ? 'collected' : 'published',
  );
  const [threadAware, setThreadAware] = useState<boolean>(() => {
    const ta = initialSp.get('threadAware');
    return ta === null ? true : ta === 'true';
  });
  const [advOpen, setAdvOpen] = useState(
    Boolean(
      initialSp.getAll('anyTerms').length ||
        initialSp.getAll('allTerms').length ||
        initialSp.getAll('exclusions').length ||
        initialSp.get('community') ||
        initialSp.get('signal') ||
        initialSp.get('language'),
    ),
  );

  const scopeTreeQuery = useResearchScopeQuery(projectId || undefined, Boolean(projectId) && isAuthed);
  const projectBatches = useMemo(
    () => scopeTreeQuery.data?.targetGroups.flatMap((g) => g.batches) ?? [],
    [scopeTreeQuery.data],
  );

  const [detailState, setDetailState] = useState<{
    id: string | null;
    tab: 'overview' | 'thread' | 'note';
    clearedInit?: boolean;
  }>({ id: null, tab: spView === 'threads' ? 'thread' : 'overview' });

  const filterKey = JSON.stringify({
    projectId,
    sourceId,
    sourceIdsParam,
    batchIdsParam,
    platform,
    kind,
    community,
    language,
    queryText,
    anyTermsText,
    allTermsText,
    exclusionsText,
    searchScope,
    signal,
    fromIso,
    toIso,
    timeBasis,
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
    const parsedFrom = toSafeUtcIso(fromIso);
    const parsedTo = toSafeUtcIso(toIso);
    return {
      ...(projectId ? { projectId } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(sourceIdsParam.length ? { sourceIds: sourceIdsParam } : {}),
      ...(batchIdsParam.length ? { batchIds: batchIdsParam } : {}),
      ...(platform ? { platform } : {}),
      ...(kind ? { kind } : {}),
      ...(community.trim() ? { community: community.trim() } : {}),
      ...(language.trim() ? { language: language.trim() } : {}),
      ...(queryText.trim() ? { query: queryText.trim() } : {}),
      ...(anyTerms.length ? { anyTerms } : {}),
      ...(allTerms.length ? { allTerms } : {}),
      ...(exclusions.length ? { exclusions } : {}),
      searchScope,
      ...(signal ? { signal } : {}),
      ...(parsedFrom ? { from: parsedFrom } : {}),
      ...(parsedTo ? { to: parsedTo } : {}),
      ...(timeBasis !== 'published' ? { timeBasis } : {}),
      threadAware,
      limit: 25,
      ...(cursor ? { cursor } : {}),
    };
  }, [
    projectId,
    sourceId,
    sourceIdsParam,
    batchIdsParam,
    platform,
    kind,
    community,
    language,
    queryText,
    anyTermsText,
    allTermsText,
    exclusionsText,
    searchScope,
    signal,
    fromIso,
    toIso,
    timeBasis,
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
  const contentQuery = useContentListQuery(
    activeFilter,
    projectId || undefined,
    !filterValidationMsg && !(Boolean(projectId) && Boolean(analysisTaskId) && isAuthed),
  );

  const evidenceMode = Boolean(projectId && analysisTaskId && isAuthed);
  const evidenceQuery = useResearchTaskEvidenceQuery(
    projectId || undefined,
    analysisTaskId || undefined,
    {
      ...(taskSentiment ? { sentiment: taskSentiment } : {}),
      ...(taskTopicIndex !== undefined ? { topicIndex: taskTopicIndex } : {}),
      limit: 30,
      offset: evidenceOffset,
    },
    evidenceMode,
  );

  const cursorScopeChanged =
    contentQuery.error instanceof ApiError &&
    contentQuery.error.status === 409 &&
    contentQuery.error.code === 'cursor_scope_changed';

  const items = useMemo(() => contentQuery.data?.items ?? [], [contentQuery.data?.items]);
  const evidenceItems = useMemo(() => evidenceQuery.data?.items ?? [], [evidenceQuery.data?.items]);
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

  // Export
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [maxRows, setMaxRows] = useState(10000);
  const [exporting, setExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<{
    message: string;
    nextCursor?: string | null;
    isError?: boolean;
  } | null>(null);

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
            ? t(`Exported ${r.exportedCount} rows (truncated).`, `已导出 ${r.exportedCount} 条结果（因行数上限已截断）。`)
            : t(`Verified complete export: ${r.exportedCount} rows.`, `已完整导出当前检索结果：共 ${r.exportedCount} 条。`),
          nextCursor: r.truncated ? r.nextCursor : null,
        });
      } else {
        setExportFeedback({ message: t('CSV export completed.', '已完成 CSV 结果导出。') });
      }
      setExportOpen(false);
    } catch (err) {
      setExportFeedback({ message: formatApiError(err), isError: true });
    } finally {
      setExporting(false);
    }
  };

  const applyTimePreset = (preset: 'all' | '7' | '30' | '90' | 'custom') => {
    setTimePreset(preset);
    if (preset === 'all') {
      setFromIso('');
      setToIso('');
    } else if (preset !== 'custom') {
      const days = Number(preset);
      const endMs = Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000;
      const startMs = endMs - days * 86_400_000;
      setFromIso(new Date(startMs).toISOString().slice(0, 16));
      setToIso(new Date(endMs).toISOString().slice(0, 16));
    }
    setCursor(undefined);
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
    setSourceId('');
    setSourceIdsParam([]);
    setBatchIdsParam([]);
    setPlatform('');
    setKind('');
    setCommunity('');
    setLanguage('');
    setQueryText('');
    setTermDraft('');
    setAnyTermsText('');
    setAllTermsText('');
    setExclusionsText('');
    setSignal('');
    setTimePreset('all');
    setFromIso('');
    setToIso('');
    setTimeBasis('published');
    setAnalysisTaskId('');
    setTaskSentiment('');
    setTaskTopicIndex(undefined);
    setEvidenceOffset(0);
    setCursor(undefined);
  };

  const activeProject = projects.find((p) => p.id === projectId);
  const projectHasZeroData = Boolean(
    projectId &&
      scopeTreeQuery.isSuccess &&
      scopeTreeQuery.data.dateBounds.totalCount === 0,
  );
  const isForbiddenError =
    contentQuery.error instanceof ApiError && contentQuery.error.status === 403;

  return (
    <div className="ds-page">
      <div className="crumb">
        <button type="button" onClick={() => onNavigate?.('/projects?view=list')}>
          {t('Research Workspace', '研究工作区')}
        </button>
        <span>/</span>
        {activeProject && (
          <>
            <button
              type="button"
              onClick={() => onNavigate?.(`/projects?view=overview&projectId=${encodeURIComponent(activeProject.id)}`)}
            >
              {activeProject.name}
            </button>
            <span>/</span>
          </>
        )}
        <b>{t('Content Search', '内容检索')}</b>
      </div>

      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{t('Content Search', '内容检索与原文查阅')}</h1>
            <Badge variant="secondary">
              {activeProject
                ? t(`Project scope: ${activeProject.name}`, `范围：${activeProject.name} 已采集样本`)
                : t('Scope: All authorized samples', '范围：全部已授权样本')}
            </Badge>
          </div>
          <p className="page-desc">
            {t(
              'Search original posts, comments, and articles; inspect full context, thread trees, annotations, and export results.',
              '按关键词、平台、采集批次、社区与时间范围查询原始内容；支持阅读正文、查看讨论树、批注收藏与结果导出。',
            )}
          </p>
        </div>

        <div className="page-actions" style={{ position: 'relative' }}>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            onClick={() => {
              if (!isAuthed) {
                onOpenAuth?.('login', t('Sign in to save search queries.', '登录后可保存常用查询到我的研究。'));
                return;
              }
              setSaveQueryOpen((v) => !v);
            }}
          >
            <BookmarkPlus size={14} />
            <span>{t('Save Query', '保存查询')}</span>
          </button>

          <ExportResultsButton
            actor={actor}
            onClick={() => {
              if (!isAuthed) {
                onOpenAuth?.('login', t('Sign in to export filtered results.', '登录后可导出筛选结果。'));
                return;
              }
              setExportOpen((v) => !v);
            }}
          />

          {exportOpen && (
            <div className="ds-pop" style={{ top: 'calc(100% + 6px)', right: 0, width: 295, padding: 12 }}>
              <div className="pop-hd">
                <span>{t('Export Search Results', '导出当前检索结果')}</span>
                <span>50k max</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, marginBottom: 10 }}>
                <span>{t('Format', '文件格式')}</span>
                <div className="seg">
                  <button type="button" className={exportFormat === 'csv' ? 'on' : ''} onClick={() => setExportFormat('csv')}>
                    CSV
                  </button>
                  <button type="button" className={exportFormat === 'json' ? 'on' : ''} onClick={() => setExportFormat('json')}>
                    JSON
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 11.5, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{t('Max Rows', '最大导出行数')}</span>
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
                {exporting ? t('Exporting...', '正在导出...') : t('Download Results', '下载当前结果')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Provenance Banner when arriving from Content Research */}
      {fromResearch && projectId && onNavigate && (
        <div
          className="wb-alert wb-alert--info"
          style={{ marginBottom: 12, justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}
        >
          <span>
            {evidenceMode
              ? t('Showing evidence matched by Deep Research task', '当前正在查看「深入研究」任务命中的证据样本')
              : t('Filtered from Content Research', '当前条件来自「内容研究」分析下钻')}
            {researchLabel ? `（${researchLabel}）` : ''}
            {t(' — you can adjust filters below or return to the research view.', '，可继续微调下方条件，或返回原研究视图。')}
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {evidenceMode && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  setAnalysisTaskId('');
                  setTaskSentiment('');
                  setTaskTopicIndex(undefined);
                  setEvidenceOffset(0);
                }}
              >
                {t('Exit Task Evidence Mode', '退出任务证据视图')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() =>
                onNavigate(
                  `/projects?view=overview&projectId=${encodeURIComponent(projectId)}&layer=${encodeURIComponent(researchLayer)}`,
                )
              }
            >
              <ArrowLeft size={12} />
              <span>{t('Back to Content Research', '返回内容研究')}</span>
            </Button>
          </div>
        </div>
      )}

      {/* Inline Save Query Box */}
      {saveQueryOpen && (
        <form
          onSubmit={handleSaveQuery}
          style={{
            background: '#ffffff',
            border: '1px solid var(--line)',
            borderRadius: 7,
            padding: '12px 14px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <label htmlFor="save-query-name" style={{ fontSize: 12, fontWeight: 600 }}>
            {t('Query Name:', '查询名称')}
          </label>
          <input
            id="save-query-name"
            className="wb-input"
            style={{ minWidth: 240, flex: 1 }}
            value={saveQueryName}
            onChange={(e) => setSaveQueryName(e.target.value)}
            placeholder={t('e.g. FinOps Billing Pain · 30d', '例如：账单波动痛点 · 近30天')}
            required
          />
          <button type="submit" className="ds-btn">
            {t('Confirm Save', '确认保存查询')}
          </button>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setSaveQueryOpen(false)}>
            {t('Cancel', '取消')}
          </button>
        </form>
      )}

      {saveStatus && (
        <div className="wb-alert wb-alert--info" style={{ marginBottom: 12 }}>
          {saveStatus}
        </div>
      )}
      {cursorNotice && (
        <div className="wb-alert wb-alert--warn" style={{ marginBottom: 12 }}>
          {cursorNotice}
        </div>
      )}
      {exportFeedback && (
        <div className={`wb-alert ${exportFeedback.isError ? 'wb-alert--error' : 'wb-alert--success'}`} style={{ marginBottom: 12 }}>
          <span>{exportFeedback.message}</span>
          {exportFeedback.nextCursor && (
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              style={{ height: 26, fontSize: 11 }}
              onClick={() => runExport(exportFeedback.nextCursor!)}
            >
              {t('Download Next Segment', '续段下载')}
            </button>
          )}
        </div>
      )}

      {/* Search Card */}
      <div className="search-card">
        <form className="search-main" onSubmit={handleTermSubmit}>
          <Search size={15} color="var(--faint)" />
          <div className="term-chips">
            {queryText && (
              <span className="term-chip">
                {queryText}
                <button
                  type="button"
                  onClick={() => {
                    setQueryText('');
                    setCursor(undefined);
                  }}
                >
                  <X size={11} />
                </button>
              </span>
            )}
          </div>
          <input
            className="search-input"
            value={termDraft}
            onChange={(e) => setTermDraft(e.target.value)}
            placeholder={t(
              'Search keywords, phrases, or original text (press Enter)...',
              '输入检索词、短语或原文内容后回车（支持中文双字词与短代码如 算力 / o3）…',
            )}
          />
          <button type="submit" className="ds-btn" style={{ height: 34, padding: '0 16px' }}>
            {t('Search', '检索')}
          </button>
        </form>

        {/* Primary Quick Filter Row (§5.10.3) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 10,
            marginTop: 12,
          }}
        >
          {isAuthed && (
            <div className="wb-field">
              <label>{t('Project', '研究项目')}</label>
              <Select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setBatchIdsParam([]);
                  setSourceIdsParam([]);
                  setCursor(undefined);
                }}
              >
                <option value="">{t('All Authorized Projects/Sources', '全部已授权范围')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="wb-field">
            <label>{t('Platform', '平台')}</label>
            <Select
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value as '' | Platform);
                setCursor(undefined);
              }}
            >
              <option value="">{t('All platforms', '全部平台')}</option>
              <option value="reddit">Reddit</option>
              <option value="x">X</option>
              <option value="bluesky">Bluesky</option>
              <option value="web">Web</option>
            </Select>
          </div>

          <div className="wb-field">
            <label>{t('Content Type', '内容类型')}</label>
            <Select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as '' | ContentKind);
                setCursor(undefined);
              }}
            >
              <option value="">{t('All types', '全部类型')}</option>
              <option value="post">{t('Posts', '帖文')}</option>
              <option value="comment">{t('Comments', '评论')}</option>
              <option value="article">{t('Articles', '文章')}</option>
            </Select>
          </div>

          <div className="wb-field">
            <label>{t('Collection Source', '采集关键词 / 来源')}</label>
            <Select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setSourceIdsParam([]);
                setCursor(undefined);
              }}
            >
              <option value="">
                {sourceIdsParam.length > 0
                  ? t(`Selected (${sourceIdsParam.length} sources)`, `已选 ${sourceIdsParam.length} 个来源`)
                  : t('All sources', '全部来源')}
              </option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>

          {projectId && projectBatches.length > 0 && (
            <div className="wb-field">
              <label>{t('Data Batch', '数据批次')}</label>
              <Select
                value={batchIdsParam.length === 1 ? batchIdsParam[0] : ''}
                onChange={(e) => {
                  setBatchIdsParam(e.target.value ? [e.target.value] : []);
                  setCursor(undefined);
                }}
              >
                <option value="">
                  {batchIdsParam.length > 1
                    ? t(`Selected (${batchIdsParam.length} batches)`, `已选 ${batchIdsParam.length} 个批次`)
                    : t('All project batches', '全部项目批次')}
                </option>
                {projectBatches.map((b) => (
                  <option key={b.batchId} value={b.batchId}>
                    {b.label} ({b.itemCount})
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="wb-field">
            <label>{t('Time Range', '发布时间')}</label>
            <Select value={timePreset} onChange={(e) => applyTimePreset(e.target.value as typeof timePreset)}>
              <option value="all">{t('All time', '全部时间')}</option>
              <option value="7">{t('Last 7 days', '近 7 天')}</option>
              <option value="30">{t('Last 30 days', '近 30 天')}</option>
              <option value="90">{t('Last 90 days', '近 90 天')}</option>
              <option value="custom">{t('Custom range', '自定义日期')}</option>
            </Select>
          </div>
        </div>

        {/* Advanced Search Toggle Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ds-btn ds-btn--quiet"
            style={{ fontSize: 11.5, height: 28 }}
            onClick={() => setAdvOpen((v) => !v)}
          >
            <Sliders size={13} />
            <span>{t('Advanced Search & Filters', '高级检索（标题/正文匹配 · 布尔词组 · 社区 · 痛点信号 · 讨论折叠）')}</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
              {threadAware
                ? t('Comments fold to root post', '已开启按讨论主题折叠评论')
                : t('Direct matching items', '按单条内容直接展示')}
            </span>
            <button type="button" className="auth-link" onClick={resetAll}>
              {t('Reset all', '清空全部条件')}
            </button>
          </div>
        </div>

        <div className={`adv-filters ${advOpen ? 'open' : ''}`}>
          <div className="adv-inner">
            <div className="adv-field">
              <label>{t('Match Position & Community', '匹配位置与社区')}</label>
              <div style={{ display: 'grid', gap: 6 }}>
                <Select
                  value={searchScope}
                  onChange={(e) => {
                    setSearchScope(e.target.value as SearchScope);
                    setCursor(undefined);
                  }}
                >
                  <option value="title_text">{t('Title & Body', '标题与正文')}</option>
                  <option value="title">{t('Title only', '仅匹配标题')}</option>
                  <option value="text">{t('Body only', '仅匹配正文')}</option>
                </Select>
                <Input
                  className="wb-input"
                  value={community}
                  onChange={(e) => {
                    setCommunity(e.target.value);
                    setCursor(undefined);
                  }}
                  placeholder={t('Community (e.g. ChatGPT)', '社区名称（如 ChatGPT / LocalLLaMA）')}
                />
                <Select
                  value={signal}
                  onChange={(e) => {
                    setSignal(e.target.value as '' | SignalType);
                    setCursor(undefined);
                  }}
                >
                  <option value="">{t('All Signals', '全部讨论信号')}</option>
                  <option value="pain">{t('Pain Signals', '痛点与问题讨论')}</option>
                  <option value="discussion">{t('High-Reply Threads', '高互动讨论')}</option>
                </Select>
              </div>
            </div>

            <div className="adv-field">
              <label>{t('Boolean Clauses (comma separated)', '三段布尔词组（逗号分隔）')}</label>
              <div style={{ display: 'grid', gap: 6 }}>
                <Input
                  className="wb-input"
                  value={anyTermsText}
                  onChange={(e) => {
                    setAnyTermsText(e.target.value);
                    setCursor(undefined);
                  }}
                  placeholder="OR (任意命中): pricing, billing"
                />
                <Input
                  className="wb-input"
                  value={allTermsText}
                  onChange={(e) => {
                    setAllTermsText(e.target.value);
                    setCursor(undefined);
                  }}
                  placeholder="AND (全部命中): latency"
                />
                <Input
                  className="wb-input"
                  value={exclusionsText}
                  onChange={(e) => {
                    setExclusionsText(e.target.value);
                    setCursor(undefined);
                  }}
                  placeholder="NOT (排除词): hiring"
                />
              </div>
            </div>

            <div className="adv-field">
              <label>{t('Custom Dates & Thread Folding', '自定义时间范围与讨论折叠')}</label>
              <div style={{ display: 'grid', gap: 6 }}>
                <input
                  type="datetime-local"
                  aria-label={t('Start date', '起始时间')}
                  className="wb-input"
                  value={fromIso}
                  onChange={(e) => {
                    setTimePreset('custom');
                    setFromIso(e.target.value);
                    setCursor(undefined);
                  }}
                />
                <input
                  type="datetime-local"
                  aria-label={t('End date', '结束时间')}
                  className="wb-input"
                  value={toIso}
                  onChange={(e) => {
                    setTimePreset('custom');
                    setToIso(e.target.value);
                    setCursor(undefined);
                  }}
                />
                <div className="toggle-line" style={{ padding: '4px 0' }}>
                  <span>{t('Fold comments to thread root', '按讨论主题折叠评论')}</span>
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

      {/* Results Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 8px', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {evidenceMode ? (
            <>
              <b style={{ color: 'var(--ink)' }}>{evidenceQuery.data?.total ?? evidenceItems.length}</b>{' '}
              {t('matched task evidence items', '条任务命中证据样本')}
            </>
          ) : (
            <>
              <b style={{ color: 'var(--ink)' }}>{items.length}</b>{' '}
              {nextCursor
                ? t('items loaded (more results available)', '条已加载结果（当前仅加载了部分匹配结果，可继续加载下一页）')
                : t('matching items loaded', '条已加载匹配结果')}
            </>
          )}
        </div>
        <button
          type="button"
          className="icon-square"
          style={{ width: 30, height: 30 }}
          onClick={() => (evidenceMode ? void evidenceQuery.refetch() : void contentQuery.refetch())}
          title={t('Refresh', '刷新列表')}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Results List & Distinguished Empty/Error States (§5.10.4) */}
      <div className="result-list">
        <div className="res-head">
          <span>{t('Discussion', '讨论内容')}</span>
          <span>{t('Score / Likes', '热度')}</span>
          <span>{t('Replies', '评论')}</span>
          <span>{t('Signal', '信号')}</span>
          <span></span>
        </div>

        {evidenceMode ? (
          evidenceQuery.isError ? (
            <div style={{ padding: 16 }}>
              <Alert variant="destructive" className="flex items-center justify-between gap-3">
                <span>{formatApiError(evidenceQuery.error)}</span>
                <Button type="button" variant="outline" size="xs" onClick={() => void evidenceQuery.refetch()}>
                  <RefreshCw size={12} />
                  <span>{t('Retry', '重试')}</span>
                </Button>
              </Alert>
            </div>
          ) : evidenceQuery.isLoading ? (
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : evidenceItems.length === 0 ? (
            <div style={{ padding: 20 }}>
              <Empty
                title={t('No task evidence items match this slice', '当前任务分片下没有可显示的证据样本')}
                description={t(
                  'Try exiting Task Evidence Mode to browse all project discussions.',
                  '可能是权限范围变化或该分段暂无匹配条目，可点击下方退出任务证据视图恢复自由检索。',
                )}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAnalysisTaskId('');
                      setTaskSentiment('');
                      setTaskTopicIndex(undefined);
                      setEvidenceOffset(0);
                    }}
                  >
                    {t('Exit Task Evidence Mode', '退出任务证据视图')}
                  </Button>
                }
              />
            </div>
          ) : (
            evidenceItems.map((item) => {
              const primaryMetric = item.platform === 'reddit' ? (item.metricScore ?? 0) : (item.metricLikes ?? item.metricScore ?? 0);
              return (
                <div key={item.id} className="res-row" onClick={() => setDetailId(item.id)}>
                  <div>
                    <div className="res-top">
                      <span
                        className="tag tag--line"
                        style={{ height: 19, fontSize: 9.5, textTransform: item.platform === 'x' ? 'uppercase' : 'capitalize' }}
                      >
                        {item.platform} · {item.kind === 'post' ? t('Post', '帖文') : item.kind === 'comment' ? t('Comment', '评论') : item.kind}
                      </span>
                      {item.sentimentLabel && (
                        <span className="tag" style={{ height: 19, fontSize: 9.5 }}>
                          {t('Sentiment', '情感')}: {item.sentimentLabel}
                        </span>
                      )}
                      {item.topicIndex !== null && (
                        <span className="tag" style={{ height: 19, fontSize: 9.5 }}>
                          {t('Topic', '主题')} #{item.topicIndex + 1}
                        </span>
                      )}
                    </div>
                    <div className="res-title">{item.title || item.text?.slice(0, 96) || item.externalId}</div>
                    {item.text && <div className="res-excerpt">{item.text}</div>}
                    <div className="res-meta">
                      <span>{item.authorHandle || t('Unknown author', '匿名/未知作者')}</span>
                      {item.communityName && (
                        <>
                          <span>·</span>
                          <span>{item.communityName}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>
                        {item.publishedAt
                          ? item.publishedAt.slice(0, 16).replace('T', ' ') + ' UTC'
                          : t('Unknown publish time', '发布时间未知')}
                      </span>
                    </div>
                  </div>
                  <div className="res-stat">
                    {primaryMetric.toLocaleString()}
                    <span>{item.platform === 'reddit' ? 'score' : 'likes'}</span>
                  </div>
                  <div className="res-stat">
                    {item.metricComments ?? 0}
                    <span>{t('replies', '评论')}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="sig neutral">{Math.round(item.engagementScore)} eng</span>
                  </div>
                  <button
                    type="button"
                    style={{
                      border: 0,
                      background: 'none',
                      padding: 0,
                      color: 'var(--faint)',
                      cursor: 'pointer',
                      display: 'grid',
                      placeItems: 'center',
                    }}
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
          )
        ) : contentQuery.isError ? (
          <div style={{ padding: 16 }}>
            <Alert variant="destructive" className="flex items-center justify-between gap-3">
              <span>
                {isForbiddenError
                  ? t('You do not have permission to access data under this scope.', '当前账号权限下暂无可访问的数据。')
                  : `${t('Search request failed:', '检索请求失败：')}${formatApiError(contentQuery.error)}`}
              </span>
              <Button type="button" variant="outline" size="xs" onClick={() => void contentQuery.refetch()}>
                <RefreshCw size={12} />
                <span>{t('Retry', '重试')}</span>
              </Button>
            </Alert>
          </div>
        ) : contentQuery.isLoading ? (
          <div style={{ padding: 16, display: 'grid', gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: 20 }}>
            {projectHasZeroData ? (
              <Empty
                title={t('No data collected in this project yet', '当前项目尚未采集数据')}
                description={t(
                  'Go to Data Ingestion to collect posts or attach existing data batches before searching.',
                  '请先前往「数据接入」发起采集或导入已有数据批次，再进行内容检索与阅读。',
                )}
                action={
                  onNavigate && projectId ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onNavigate(`/projects?view=collect&projectId=${encodeURIComponent(projectId)}`)}
                    >
                      {t('Go to Data Ingestion', '前往数据接入')}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Empty
                title={t('No matching discussions found', '当前检索条件下没有匹配内容')}
                description={t(
                  'Try adjusting keywords, widening the date window, or clearing filters.',
                  '项目已有数据，但当前检索词或筛选条件未命中内容，可尝试更换词组、放宽时间范围或重置条件。',
                )}
                action={
                  <Button type="button" variant="outline" size="sm" onClick={resetAll}>
                    {t('Reset Filters', '重置检索条件')}
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          items.map((item) => {
            const { score, comments } = getScoreAndComments(item);
            const isPain = PAIN_RE.test(`${item.title || ''} ${item.text || ''}`);
            const isDisc = comments >= 10;

            return (
              <div key={item.id} className="res-row" onClick={() => setDetailId(item.id)}>
                <div>
                  <div className="res-top">
                    <span
                      className="tag tag--line"
                      style={{ height: 19, fontSize: 9.5, textTransform: item.platform === 'x' ? 'uppercase' : 'capitalize' }}
                    >
                      {item.platform} · {item.kind === 'post' ? t('Post', '帖文') : item.kind === 'comment' ? t('Comment', '评论') : item.kind}
                    </span>
                    <span className="tag" style={{ height: 19, fontSize: 9.5 }}>
                      {item.externalId}
                    </span>
                    {item.contextMissing && (
                      <span className="tag" style={{ height: 19, fontSize: 9.5, background: '#fdf3e1', color: '#8a5a12' }}>
                        <AlertTriangle size={10} /> {t('Parent post not yet collected', '上层原帖未入库')}
                      </span>
                    )}
                    {!item.publishedAt && (
                      <span className="tag" style={{ height: 19, fontSize: 9.5, background: '#fdf0ec', color: '#8f3f2a' }}>
                        {t('Publish time unknown', '发布时间未知')}
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
                    <span>
                      {item.publishedAt
                        ? item.publishedAt.slice(0, 16).replace('T', ' ') + ' UTC'
                        : t('Unknown publish time', '发布时间未知')}
                    </span>
                  </div>
                </div>

                <div className="res-stat">
                  {score.toLocaleString()}
                  <span>{item.platform === 'reddit' ? 'score' : 'likes'}</span>
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
                  style={{
                    border: 0,
                    background: 'none',
                    padding: 0,
                    color: 'var(--faint)',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                  }}
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

        <div
          style={{
            padding: '11px 16px',
            background: '#fdfefb',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 11.5,
            color: 'var(--muted)',
          }}
        >
          {evidenceMode ? (
            <>
              <span>
                {t('Showing', '当前第')} {evidenceOffset + 1} -{' '}
                {Math.min(evidenceOffset + evidenceItems.length, evidenceQuery.data?.total ?? 0)}{' '}
                {t('of', '/')} {evidenceQuery.data?.total ?? 0}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {evidenceOffset > 0 && (
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    style={{ height: 28, fontSize: 11 }}
                    onClick={() => setEvidenceOffset(Math.max(0, evidenceOffset - 30))}
                  >
                    {t('Previous Page', '上一页')}
                  </button>
                )}
                <button
                  type="button"
                  className="ds-btn"
                  style={{ height: 28, fontSize: 11 }}
                  disabled={evidenceOffset + evidenceItems.length >= (evidenceQuery.data?.total ?? 0)}
                  onClick={() => setEvidenceOffset(evidenceOffset + 30)}
                >
                  {t('Next Page', '下一页')}
                </button>
              </div>
            </>
          ) : (
            <>
              <span>
                {nextCursor
                  ? t('More matching items are available on the next page', '仍有更多匹配样本，点击右侧继续加载')
                  : t('All matching items in current scope have been loaded', '当前条件下的匹配结果已全部加载')}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {cursor && (
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    style={{ height: 28, fontSize: 11 }}
                    onClick={() => setCursor(undefined)}
                  >
                    {t('First Page', '回到第一页')}
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
            </>
          )}
        </div>
      </div>

      {/* Tabbed Content Detail Drawer */}
      {detailId && (
        <ContentDetailDrawer
          key={`${detailId}:${defaultDrawerTab}`}
          actor={actor}
          projectId={projectId || undefined}
          canWrite={canWrite}
          contentId={detailId}
          initialTab={defaultDrawerTab}
          scopeQuery={threadScope}
          onOpenAuth={onOpenAuth}
          onClose={() => {
            setDetailId(null);
            onClearDetailId();
          }}
        />
      )}

      {cursorScopeChanged && (
        <div className="wb-alert wb-alert--warn" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <span>
            {t('Search scope changed while paging. Reset to page 1.', '筛选条件或项目数据版本已更新，请重置到第一页。')}
          </span>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            style={{ height: 26, fontSize: 11 }}
            onClick={() => {
              setCursor(undefined);
              setCursorNotice(t('Reset to page 1.', '已回到第一页。'));
            }}
          >
            {t('Reset to Page 1', '回到第一页')}
          </button>
        </div>
      )}
    </div>
  );
}

function ContentDetailDrawer({
  actor,
  projectId,
  canWrite,
  contentId,
  initialTab = 'overview',
  scopeQuery,
  onOpenAuth,
  onClose,
}: {
  actor: Actor | null;
  projectId?: string;
  canWrite: boolean;
  contentId: string;
  initialTab?: 'overview' | 'thread' | 'note';
  scopeQuery: ListQuery;
  onOpenAuth?: (tab?: 'login' | 'register', reason?: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const detailQuery = useContentDetailQuery(contentId);
  const annQuery = useAnnotationQuery(actor ? contentId : null);
  const saveAnnMut = useSaveAnnotationMutation();
  const hydrateMut = useHydrateMutation();
  const [hydrateJobIds, setHydrateJobIds] = useState<string[]>([]);
  const [hydrateMsg, setHydrateMsg] = useState<string | null>(null);
  const hydrateIdemRef = useRef<string>(generateUuidV4());
  const batchJobsQuery = useBatchJobsQuery(hydrateJobIds);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.auth-overlay')) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      const res = await saveAnnMut.mutateAsync({ contentId, edit: { favorite, note, revision: annRev } });
      setRevOverride({ key: contentId, rev: res.revision });
      setAnnDraft({ key: `${contentId}:${res.revision}`, favorite, note });
      setAnnMsg(t(`Saved cleanly · revision ${res.revision}`, `批注已保存 · rev ${res.revision}`));
    } catch (err) {
      setAnnMsg(formatApiError(err));
    }
  };

  const item = detailQuery.data?.content;
  const { score, comments } = item ? getScoreAndComments(item) : { score: 0, comments: 0 };
  const threadNodesCount = threadQuery.data?.nodes.length ?? 0;
  const canHydrateThisPost = Boolean(
    projectId &&
      canWrite &&
      item &&
      item.platform === 'reddit' &&
      item.kind === 'post' &&
      item.externalId.startsWith('t3_'),
  );
  const commentsIncomplete = Boolean(item && item.kind === 'post' && comments > Math.max(0, threadNodesCount - 1));

  const handleHydrateSingle = async () => {
    if (!projectId || !item) return;
    setHydrateMsg(null);
    try {
      const res = await hydrateMut.mutateAsync({
        projectId,
        contentIds: [item.id],
        maxCommentsPerPost: 25,
        idempotencyKey: hydrateIdemRef.current,
      });
      setHydrateJobIds(res.jobIds);
      hydrateIdemRef.current = generateUuidV4();
      setHydrateMsg(t(`Queued ${res.jobIds.length} comment collection job.`, `已加入评论补充采集队列（${res.jobIds.length} 个任务）。`));
    } catch (err) {
      setHydrateMsg(formatApiError(err));
    }
  };

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
              <span>{item.availability === 'available' ? t('Available', '内容可用') : item.availability}</span>
              {commentsIncomplete && (
                <>
                  <span>·</span>
                  <span className="tag" style={{ height: 18, fontSize: 9.5, background: '#fdf3e1', color: '#8a5a12' }}>
                    {t('Comments partially collected', '部分评论尚未采集')}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="tabs" style={{ marginTop: 12, borderBottom: 0 }}>
            <button type="button" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}>
              {t('Overview & Snapshots', '正文与观测曲线')}
            </button>
            <button type="button" aria-selected={tab === 'thread'} onClick={() => setTab('thread')}>
              {t('Thread Tree', '讨论树')} ({threadNodesCount})
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
                  <b style={{ display: 'block', fontSize: 18, fontFamily: 'var(--font-display)', marginTop: 2 }}>
                    {score.toLocaleString()}
                  </b>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px' }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--faint)' }}>
                    {t('Reported Replies', '平台记录评论')}
                  </span>
                  <b style={{ display: 'block', fontSize: 18, fontFamily: 'var(--font-display)', marginTop: 2 }}>{comments}</b>
                </div>
                <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px' }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'var(--faint)' }}>
                    {t('Snapshots', '观测快照')}
                  </span>
                  <b style={{ display: 'block', fontSize: 18, fontFamily: 'var(--font-display)', marginTop: 2 }}>
                    {item.observations.length}
                  </b>
                </div>
              </div>

              {canHydrateThisPost && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'var(--wb-teal-tint, #eef6f3)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {t('Supplemental Comment Collection', '补充采集此帖评论')}
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={hydrateMut.isPending}
                      onClick={handleHydrateSingle}
                    >
                      {hydrateMut.isPending ? t('Dispatching...', '派发中...') : t('Collect Comments', '补充采集评论')}
                    </Button>
                  </div>
                  {hydrateMsg && <div style={{ fontSize: 11.5 }}>{hydrateMsg}</div>}
                  {batchJobsQuery.data?.jobs && batchJobsQuery.data.jobs.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {batchJobsQuery.data.jobs.map((j) => (
                        <span key={j.id} className="tag tag--lilac">
                          {j.id.slice(0, 8)} · {j.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--faint)', fontWeight: 650, marginBottom: 6 }}>
                  {t('Observation Trajectory', '单内容多快照指标演变')}
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
            <div className="space-y-3">
              {commentsIncomplete && (
                <div className="wb-alert wb-alert--info" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    {t(
                      'Some comments for this post have not been collected yet.',
                      '当前主帖的部分评论数据尚未完整采集入库。',
                    )}
                  </span>
                  {canHydrateThisPost && (
                    <Button type="button" size="xs" variant="outline" onClick={handleHydrateSingle} disabled={hydrateMut.isPending}>
                      {t('Collect Comments', '补充采集')}
                    </Button>
                  )}
                </div>
              )}
              <ThreadTreeView
                thread={threadQuery.data}
                view={threadView}
                onChangeView={setThreadView}
                loading={threadQuery.isLoading}
              />
            </div>
          )}

          {tab === 'note' &&
            (actor ? (
              <form onSubmit={handleSaveAnn} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 650 }}>
                    {t('Personal Annotation', '个人研究批注')}
                  </span>
                  <span className="tag tag--line">rev {annRev}</span>
                </div>

                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
                  <span>{t('Bookmark as high-signal evidence', '收藏这条证据')}</span>
                </label>

                <textarea
                  className="wb-textarea"
                  aria-label={t('Research note', '研究批注')}
                  rows={5}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t(
                    'Write researcher insights or next actions (up to 2000 chars)...',
                    '写下你的判断、证据出处或下一步动作（不超过 2000 字符）…',
                  )}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--faint)' }}>
                  <span>{t('Preserves local draft on version conflict', '发生版本冲突时自动保留本地草稿')}</span>
                  <span>{note.length} / 2000</span>
                </div>

                {annMsg && <div className="wb-alert wb-alert--info">{annMsg}</div>}

                <div>
                  <button type="submit" className="ds-btn" disabled={saveAnnMut.isPending}>
                    <Bookmark size={13} />
                    <span>{saveAnnMut.isPending ? t('Saving...', '保存中...') : t('Save Annotation', '保存到我的研究')}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="story-guest-note">
                <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
                  {t(
                    'Sign in to bookmark items and save personal research annotations.',
                    '登录后即可收藏证据并保存个人研究批注。',
                  )}
                </p>
                <button
                  type="button"
                  className="ds-btn"
                  onClick={() => onOpenAuth?.('login', t('Sign in to annotate content.', '登录后可保存研究批注'))}
                >
                  <Bookmark size={13} />
                  <span>{t('Sign in to annotate', '登录后收藏与记录笔记')}</span>
                </button>
              </div>
            ))}
        </div>

        <footer className="dw-ft">
          <button type="button" className="ds-btn ds-btn--quiet" onClick={() => setTab('note')}>
            <Heart size={13} color={favorite ? '#c99b1d' : undefined} />
            <span>{favorite ? t('Bookmarked', '已收藏') : t('Bookmark', '收藏与批注')}</span>
          </button>
          <span style={{ flex: 1 }} />
          {(() => {
            const safeUrl = safeHttpUrl(item?.url);
            return safeUrl ? (
              <a href={safeUrl} target="_blank" rel="noreferrer" className="ds-btn ds-btn--ghost">
                <ExternalLink size={13} />
                <span>{t('Open Original', '打开原帖')}</span>
              </a>
            ) : null;
          })()}
        </footer>
      </aside>
    </div>
  );
}
