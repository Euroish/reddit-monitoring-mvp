import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Download,
  Edit3,
  Globe,
  Link2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatApiError,
  isMfaRequiredError,
  useContentListQuery,
  useCreateProjectMutation,
  useDeleteProjectMutation,
  useForkProjectMutation,
  useMonitorsQuery,
  useProjectOverviewQuery,
  useProjectsQuery,
  usePublishProjectMutation,
  useQuotasSummaryQuery,
  useSourcesQuery,
  useUpdateProjectMutation,
} from '../api/hooks';
import { apiClient } from '../api/client';
import { InlineMfaStepUp } from '../components/InlineMfaStepUp';
import { Badge } from '../components/ui/badge';
import { IntelligenceAnalyticsView } from '../components/projects/IntelligenceAnalyticsView';
import { ContentResearchWorkspace } from '../components/research/ContentResearchWorkspace';
import { ProjectCollectView } from '../components/ProjectCollectView';
import { ReaderDrawer } from '../components/stories/ReaderDrawer';
import type { ReaderPreview } from '../components/stories/readerTypes';
import '../styles/collection.css';
import {
  ProjectBatchesView,
  ProjectJobsView,
  ProjectListView,
  ViewerPersonalJobsView,
} from '../components/ProjectWorkspaceViews';
import { isResearchSource } from '../lib/collectionLimits';
import {
  type Actor,
  ApiError,
  type ContentKind,
  type ListQuery,
  type Platform,
  type Project,
  type ProjectInput,
  type PublicContent,
  type SearchScope,
  type SignalType,
  validateFilterInput,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';

interface ProjectsPageProps {
  actor: Actor;
  selectedProjectId: string;
  onSelectProjectId: (id: string) => void;
  initialSearchString?: string;
  onNavigate?: (path: string) => void;
  onDrilldown: (projectId: string, extraQs?: string) => void;
  onOpenContentDetail?: (contentId: string) => void;
}

function downloadEvidenceCsv(content: PublicContent[], projectId?: string) {
  function csvCell(raw: unknown) {
    const str = String(raw ?? '').replace(/[\r\n]+/g, ' ');
    const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
    return `"${safe.replace(/"/g, '""')}"`;
  }
  const headers = ['id,platform,kind,title,score,publishedAt,providers'];
  const lines = content.map(item => {
    const metrics = item.observations[item.observations.length - 1]?.metrics || {};
    const score = metrics['reddit.score'] ?? metrics['x.likes'] ?? metrics['bluesky.likes'] ?? '';
    const providers = [...new Set(item.observations.map(observation => observation.provider))].join('|');
    const title = (item.title || item.text || '').slice(0, 120);
    return [item.id, item.platform, item.kind, title, score, item.publishedAt || 'null', providers].map(csvCell).join(',');
  });
  const blob = new Blob([headers.concat(lines).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `siftline-${projectId?.slice(0, 8) || 'overview'}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProjectEvidenceExport({ isAdmin, quota, ready, content, projectId, activeFilter }: {
  isAdmin: boolean;
  quota: ReturnType<typeof useQuotasSummaryQuery>;
  ready: boolean;
  content: PublicContent[];
  projectId?: string;
  activeFilter?: ListQuery;
}) {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [exportErr, setExportErr] = useState('');
  const [exportNotice, setExportNotice] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);
  const [exportMaxRows, setExportMaxRows] = useState<10000 | 50000>(50000);
  const allowed = isAdmin || (quota.isSuccess && quota.data.effectivePolicy.exportEnabled === true);
  const notice = allowed ? '' : quota.isError
    ? t('Could not verify export permission.', '暂时无法核实导出权限。')
    : quota.isPending ? t('Checking export permission…', '正在检查导出权限…')
    : t('Export is disabled for your account.', '当前账号的导出权限已关闭。');

  async function ensureAllowed(): Promise<boolean> {
    if (!allowed || checking) return false;
    if (isAdmin) return true;
    setChecking(true);
    try {
      const latest = await quota.refetch();
      return Boolean(latest.isSuccess && latest.data.effectivePolicy.exportEnabled === true);
    } finally {
      setChecking(false);
    }
  }

  async function downloadSample() {
    setExportErr('');
    setExportNotice(null);
    if (await ensureAllowed()) downloadEvidenceCsv(content, projectId);
  }

  async function downloadExport(format: 'csv' | 'json') {
    if (!projectId) return;
    setExportErr('');
    setExportNotice(null);
    if (!(await ensureAllowed())) return;
    setChecking(true);
    try {
      const res = await apiClient.exportContent({ ...activeFilter, projectId, format, maxRows: exportMaxRows });
      downloadTextFile(
        `siftline-${projectId.slice(0, 8)}-export-${res.exportedCount}.${format}`,
        res.text,
        format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
      );
      if (res.truncated) {
        setExportNotice({
          kind: 'warn',
          text: t(
            `Export truncated at ${res.exportedCount} items (limit ${exportMaxRows}). Additional matching rows exist on the server.`,
            `本次导出已在第 ${res.exportedCount} 条（上限 ${exportMaxRows} 条）处截断，仍有更多匹配记录未导出。`,
          ),
        });
      } else if (res.maybeTruncated) {
        setExportNotice({
          kind: 'warn',
          text: t(
            `CSV reached the ${exportMaxRows}-row export cap (${res.exportedCount} rows). Use JSON export or narrow your date/filter range to confirm completeness.`,
            `CSV 导出已达到 ${exportMaxRows} 行上限（共 ${res.exportedCount} 行），请缩小筛选时间范围或改用 JSON 导出以确认是否完整。`,
          ),
        });
      } else {
        setExportNotice({
          kind: 'info',
          text: t(
            `Exported ${res.exportedCount} items for the current project filter.`,
            `已按当前项目筛选条件导出 ${res.exportedCount} 条完整记录。`,
          ),
        });
      }
    } catch (err) {
      setExportErr(formatApiError(err));
    } finally {
      setChecking(false);
    }
  }

  return <>
    <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void downloadSample()}
      disabled={!ready || content.length === 0 || !allowed || checking} aria-describedby={notice ? 'project-export-notice' : undefined}>
      <Download size={13} />
      <span>{t('Export evidence samples (CSV)', '导出证据样本（CSV）')}</span>
    </button>
    {projectId && (
      <>
        <select
          className="wb-input"
          aria-label={t('Export row cap', '导出行数上限')}
          value={exportMaxRows}
          onChange={(e) => setExportMaxRows(Number(e.target.value) === 10000 ? 10000 : 50000)}
          style={{ width: 'auto', height: 30, fontSize: 11, padding: '0 8px' }}
        >
          <option value={50000}>{t('Up to 50k rows', '最多 50,000 条')}</option>
          <option value={10000}>{t('Up to 10k rows', '最多 10,000 条')}</option>
        </select>
        <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void downloadExport('csv')}
          disabled={!ready || !allowed || checking}>
          <Download size={13} />
          <span>{t('Filtered Export (CSV)', '按筛选导出 (CSV)')}</span>
        </button>
        <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void downloadExport('json')}
          disabled={!ready || !allowed || checking}>
          <Download size={13} />
          <span>{t('Filtered Export (JSON)', '按筛选导出 (JSON)')}</span>
        </button>
      </>
    )}
    {notice && <small id="project-export-notice" role="status">{notice}</small>}
    {exportNotice && (
      <small
        role={exportNotice.kind === 'warn' ? 'alert' : 'status'}
        style={{ color: exportNotice.kind === 'warn' ? '#b45309' : 'var(--muted)' }}
      >
        {exportNotice.text}
      </small>
    )}
    {exportErr && <small role="alert" style={{ color: '#a8462f' }}>{exportErr}</small>}
  </>;
}

function ProjectForkPublishActions({
  project,
  isAdmin,
  onForked,
  onBanner,
}: {
  project: Project;
  isAdmin: boolean;
  onForked: (forkedId: string) => void;
  onBanner: (msg: string | null) => void;
}) {
  const { t } = useI18n();
  const forkMut = useForkProjectMutation();
  const publishMut = usePublishProjectMutation();
  const [mfaNeeded, setMfaNeeded] = useState(false);

  const nextVis = project.visibility === 'shared' ? 'private' : 'shared';

  const runPublish = async () => {
    onBanner(null);
    try {
      await publishMut.mutateAsync({
        projectId: project.id,
        visibility: nextVis,
        revision: project.revision,
      });
      setMfaNeeded(false);
    } catch (err) {
      if (isMfaRequiredError(err)) setMfaNeeded(true);
      else onBanner(formatApiError(err));
    }
  };

  return (
    <>
      {project.is_shared && (
        <button
          type="button"
          className="ds-btn ds-btn--ghost"
          disabled={forkMut.isPending}
          onClick={async () => {
            onBanner(null);
            try {
              const copy = await forkMut.mutateAsync({ projectId: project.id });
              onForked(copy.id);
            } catch (err) {
              onBanner(formatApiError(err));
            }
          }}
        >
          <Copy size={13} />
          <span>{forkMut.isPending ? t('Forking…', '正在复制…') : t('Fork to My Project', '复制到我的私有项目')}</span>
        </button>
      )}
      {isAdmin && project.can_edit && (
        <button
          type="button"
          className="ds-btn ds-btn--ghost"
          disabled={publishMut.isPending}
          onClick={() => void runPublish()}
        >
          <Globe size={13} />
          <span>{project.visibility === 'shared' ? t('Make Private', '设为私有') : t('Publish Shared', '发布为共享主题')}</span>
        </button>
      )}
      {mfaNeeded && <InlineMfaStepUp onVerified={runPublish} onCancel={() => setMfaNeeded(false)} />}
    </>
  );
}

function resolveProjectActiveView(
  urlView: string,
  canWrite: boolean,
  selectedProject: Project | undefined,
): 'list' | 'collect' | 'jobs' | 'my-jobs' | 'batches' | 'overview' | 'intelligence' {
  if (urlView === 'list' || urlView === 'collect' || urlView === 'jobs' || urlView === 'my-jobs' || urlView === 'batches' || urlView === 'overview' || urlView === 'intelligence') {
    return urlView;
  }
  if (canWrite && selectedProject && selectedProject.dataset_mode === 'batch' && (selectedProject.enabled_batch_count ?? 0) === 0) {
    return 'collect';
  }
  return 'overview';
}

function ProjectAdvancedFilterFields({
  t,
  formAnyTerms,
  setFormAnyTerms,
  formAllTerms,
  setFormAllTerms,
  formExclusions,
  setFormExclusions,
  formScope,
  setFormScope,
  formSignal,
  setFormSignal,
  formPlatform,
  setFormPlatform,
  formKind,
  setFormKind,
  formThreadAware,
  setFormThreadAware,
  formIncludePush,
  setFormIncludePush,
}: {
  t: (en: string, zh: string) => string;
  formAnyTerms: string;
  setFormAnyTerms: (v: string) => void;
  formAllTerms: string;
  setFormAllTerms: (v: string) => void;
  formExclusions: string;
  setFormExclusions: (v: string) => void;
  formScope: SearchScope;
  setFormScope: (v: SearchScope) => void;
  formSignal: '' | SignalType;
  setFormSignal: (v: '' | SignalType) => void;
  formPlatform: '' | Platform;
  setFormPlatform: (v: '' | Platform) => void;
  formKind: '' | ContentKind;
  setFormKind: (v: '' | ContentKind) => void;
  formThreadAware: boolean;
  setFormThreadAware: (v: boolean) => void;
  formIncludePush: boolean;
  setFormIncludePush: (v: boolean) => void;
}) {
  return (
    <details className="collection-disclosure">
      <summary>{t('Advanced analysis filter rules (optional)', '高级分析过滤规则（可选，仅过滤已有样本）')}</summary>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        <div className="wb-grid-2">
          <div className="wb-field">
            <label>{t('anyTerms (OR, comma separated)', 'anyTerms（任意命中 OR）')}</label>
            <input className="wb-input" value={formAnyTerms} onChange={(e) => setFormAnyTerms(e.target.value)} placeholder="pricing, billing, churn" />
          </div>
          <div className="wb-field">
            <label>{t('allTerms (AND, comma separated)', 'allTerms（全部命中 AND）')}</label>
            <input className="wb-input" value={formAllTerms} onChange={(e) => setFormAllTerms(e.target.value)} placeholder="kubernetes" />
          </div>
        </div>
        <div className="wb-grid-2">
          <div className="wb-field">
            <label>{t('exclusions (NOT)', 'exclusions（排除词）')}</label>
            <input className="wb-input" value={formExclusions} onChange={(e) => setFormExclusions(e.target.value)} placeholder="hiring, sponsorship" />
          </div>
          <div className="wb-field">
            <label>{t('Search Scope', '词项匹配范围')}</label>
            <select className="wb-select" value={formScope} onChange={(e) => setFormScope(e.target.value as SearchScope)}>
              <option value="title_text">title_text</option>
              <option value="title">title</option>
              <option value="text">text</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div className="wb-field">
            <label>{t('Signal', '信号')}</label>
            <select className="wb-select" value={formSignal} onChange={(e) => setFormSignal(e.target.value as '' | SignalType)}>
              <option value="">All</option>
              <option value="pain">pain</option>
              <option value="discussion">discussion</option>
            </select>
          </div>
          <div className="wb-field">
            <label>{t('Platform', '平台')}</label>
            <select className="wb-select" value={formPlatform} onChange={(e) => setFormPlatform(e.target.value as '' | Platform)}>
              <option value="">All</option>
              <option value="reddit">reddit</option>
              <option value="x">x</option>
              <option value="bluesky">bluesky</option>
            </select>
          </div>
          <div className="wb-field">
            <label>{t('Kind', '形态')}</label>
            <select className="wb-select" value={formKind} onChange={(e) => setFormKind(e.target.value as '' | ContentKind)}>
              <option value="">All</option>
              <option value="post">post</option>
              <option value="comment">comment</option>
              <option value="article">article</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, paddingTop: 4 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={formThreadAware} onChange={(e) => setFormThreadAware(e.target.checked)} />
            <span>thread_aware ({t('fold comments to roots', '评论回溯根帖')})</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={formIncludePush} onChange={(e) => setFormIncludePush(e.target.checked)} />
            <span>include_push_in_trends</span>
          </label>
        </div>
      </div>
    </details>
  );
}

export function ProjectsPage({
  actor,
  selectedProjectId,
  onSelectProjectId,
  initialSearchString = '',
  onNavigate,
  onDrilldown,
  onOpenContentDetail,
}: ProjectsPageProps) {
  const { t } = useI18n();
  const isAdmin = actor.role === 'owner' || actor.role === 'admin';
  const canCreateProject = actor.clientKind === 'browser';
  const [readerPreview, setReaderPreview] = useState<ReaderPreview | null>(null);
  const handleOpenInlineDetail = useCallback((contentId: string) => {
    setReaderPreview({
      id: contentId,
      title: '',
      url: null,
      author: null,
      sourceLabel: '',
      publishedAt: null,
      thumbnail: null,
      platform: '',
    });
  }, []);

  const projectsQuery = useProjectsQuery(true);
  const sourcesQuery = useSourcesQuery(true);
  const quotasSummaryQuery = useQuotasSummaryQuery(true);
  const monitorsQuery = useMonitorsQuery(true);
  const monitors = monitorsQuery.data?.monitors ?? [];
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data?.projects]);
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const researchSources = useMemo(() => sources.filter(isResearchSource), [sources]);

  const searchParams = new URLSearchParams(initialSearchString);
  const urlProjectId = searchParams.get('projectId') || '';
  const urlView = searchParams.get('view') || '';
  const openNewFromUrl = searchParams.get('new') === '1';
  const requestedSourceId = searchParams.get('sourceId');
  const requestedSource = researchSources.find(source => source.id === requestedSourceId);

  const missingUrlProject = Boolean(
    urlProjectId && !projectsQuery.isLoading && !projects.some((p) => p.id === urlProjectId),
  );

  useEffect(() => {
    if (urlProjectId) {
      if (projects.some((p) => p.id === urlProjectId) && urlProjectId !== selectedProjectId) {
        onSelectProjectId(urlProjectId);
      }
      return;
    }
    if (projects.length > 0 && !projects.some((p) => p.id === selectedProjectId)) {
      onSelectProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId, urlProjectId, onSelectProjectId]);

  const selectedProject = missingUrlProject
    ? undefined
    : projects.find((p) => p.id === (urlProjectId || selectedProjectId)) || projects[0];
  const canWrite = Boolean(selectedProject?.can_edit ?? isAdmin);
  const activeView = resolveProjectActiveView(urlView, canWrite, selectedProject);
  const go = useCallback(
    (path: string) => {
      if (onNavigate) onNavigate(path);
    },
    [onNavigate],
  );
  const overviewQuery = useProjectOverviewQuery(selectedProject?.id, selectedProject?.revision);
  const overview = overviewQuery.data;

  const [windowEnd] = useState(() => Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000);
  const windowFrom = new Date(windowEnd - 30 * 86_400_000).toISOString();
  const windowTo = new Date(windowEnd).toISOString();
  const threadAware = selectedProject?.thread_aware ?? true;

  const contentQuery = useContentListQuery({
    limit: 100, sort: 'engagement', threadAware, from: windowFrom, to: windowTo,
    deliveryMode: selectedProject?.dataset_mode === 'source_filter' && !selectedProject.include_push_in_trends
      ? 'pull' : undefined,
  }, selectedProject?.id, activeView === 'overview' && Boolean(selectedProject?.id));
  const rawItems = useMemo(() => {
    const items = contentQuery.data?.items ?? [];
    const engagementOf = (item: PublicContent) => {
      const m = item.observations[item.observations.length - 1]?.metrics || {};
      const comments = Number(m['reddit.num_comments'] ?? m['x.replies'] ?? m['bluesky.replies'] ?? 0) || 0;
      const likes = Number(m['reddit.score'] ?? m['x.likes'] ?? m['bluesky.likes'] ?? 0) || 0;
      return { comments, likes, total: comments + likes };
    };
    return [...items].sort((a, b) => {
      const ea = engagementOf(a);
      const eb = engagementOf(b);
      return eb.total - ea.total
        || eb.comments - ea.comments
        || eb.likes - ea.likes
        || (b.publishedAt || '').localeCompare(a.publishedAt || '');
    });
  }, [contentQuery.data?.items]);

  const [openFilterPop, setOpenFilterPop] = useState<'platforms' | 'signal' | 'kind' | 'share' | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [pageBanner, setPageBanner] = useState<string | null>(null);

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDatasetMode, setFormDatasetMode] = useState<'batch' | 'source_filter'>('batch');
  const [formSourceIds, setFormSourceIds] = useState<string[]>([]);
  const [formAnyTerms, setFormAnyTerms] = useState('');
  const [formAllTerms, setFormAllTerms] = useState('');
  const [formExclusions, setFormExclusions] = useState('');
  const [formScope, setFormScope] = useState<SearchScope>('title_text');
  const [formSignal, setFormSignal] = useState<'' | SignalType>('');
  const [formPlatform, setFormPlatform] = useState<'' | Platform>('');
  const [formKind, setFormKind] = useState<'' | ContentKind>('');
  const [formThreadAware, setFormThreadAware] = useState(true);
  const [formIncludePush, setFormIncludePush] = useState(false);
  const [formRevision, setFormRevision] = useState(1);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict409, setConflict409] = useState(false);

  const createMut = useCreateProjectMutation();
  const updateMut = useUpdateProjectMutation();
  const deleteMut = useDeleteProjectMutation();

  const openCreate = useCallback((presetSource?: typeof requestedSource) => {
    setModalMode('create');
    setFormName('');
    setFormDescription('');
    setFormDatasetMode(presetSource ? 'source_filter' : 'batch');
    setFormSourceIds(presetSource ? [presetSource.id] : []);
    setFormAnyTerms('');
    setFormAllTerms('');
    setFormExclusions('');
    setFormScope('title_text');
    setFormSignal('');
    setFormPlatform('');
    setFormKind('');
    setFormThreadAware(true);
    setFormIncludePush(presetSource?.deliveryMode === 'push');
    setFormRevision(1);
    setFormError(null);
    setConflict409(false);
  }, [setModalMode, setFormName, setFormDescription, setFormDatasetMode, setFormSourceIds,
    setFormAnyTerms, setFormAllTerms, setFormExclusions, setFormScope, setFormSignal,
    setFormPlatform, setFormKind, setFormThreadAware, setFormIncludePush, setFormRevision,
    setFormError, setConflict409]);

  const didHandleUrlNew = useRef(false);
  useEffect(() => {
    if (openNewFromUrl && canCreateProject && !didHandleUrlNew.current) {
      if (requestedSourceId && sourcesQuery.isPending) return;
      const timer = setTimeout(() => {
        didHandleUrlNew.current = true;
        if (requestedSourceId && !requestedSource) {
          setPageBanner(t('The selected source is unavailable or belongs to Information Feed (excluded from Research Projects).', '所选来源当前不可用，或属于资讯信息流来源（不纳入研究项目）。'));
        }
        openCreate(requestedSource);
      }, 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [openNewFromUrl, canCreateProject, openCreate, requestedSource, requestedSourceId, sourcesQuery.isPending, t]);

  useEffect(() => {
    if (!openFilterPop) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-ov-pop]')) {
        setOpenFilterPop(null);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [openFilterPop]);

  const openEdit = (p: Project) => {
    setModalMode('edit');
    setFormName(p.name);
    setFormDescription(p.description ?? '');
    setFormDatasetMode(p.dataset_mode ?? 'source_filter');
    setFormSourceIds([...p.source_ids]);
    setFormAnyTerms((p.filter.anyTerms || []).join(', '));
    setFormAllTerms((p.filter.allTerms || []).join(', '));
    setFormExclusions((p.filter.exclusions || []).join(', '));
    setFormScope(p.filter.searchScope || 'title_text');
    setFormSignal(p.filter.signal || '');
    setFormPlatform(p.filter.platform || '');
    setFormKind(p.filter.kind || '');
    setFormThreadAware(p.thread_aware);
    setFormIncludePush(p.include_push_in_trends);
    setFormRevision(p.revision);
    setFormError(null);
    setConflict409(false);
  };

  const parseCsvTerms = (raw: string) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setConflict409(false);

    if (!formName.trim() || formName.trim().length > 100) {
      setFormError(t('Project name must be 1..100 characters.', '项目名称须为 1..100 个字符。'));
      return;
    }
    if (formDatasetMode === 'source_filter' && formSourceIds.length < 1) {
      setFormError(t('Select at least 1 research source for source-filter mode.', '按来源筛选模式至少须绑定 1 个研究来源。'));
      return;
    }

    const filter: ProjectInput['filter'] = {
      searchScope: formScope,
      ...(parseCsvTerms(formAnyTerms).length ? { anyTerms: parseCsvTerms(formAnyTerms) } : {}),
      ...(parseCsvTerms(formAllTerms).length ? { allTerms: parseCsvTerms(formAllTerms) } : {}),
      ...(parseCsvTerms(formExclusions).length ? { exclusions: parseCsvTerms(formExclusions) } : {}),
      ...(formSignal ? { signal: formSignal } : {}),
      ...(formPlatform ? { platform: formPlatform } : {}),
      ...(formKind ? { kind: formKind } : {}),
    };

    const filterErr = validateFilterInput(filter);
    if (filterErr) {
      setFormError(filterErr);
      return;
    }

    const payload: ProjectInput = {
      name: formName.trim(),
      description: formDescription.trim() || null,
      datasetMode: formDatasetMode,
      sourceIds: formDatasetMode === 'batch' ? [] : formSourceIds,
      filter,
      threadAware: formThreadAware,
      includePushInTrends: formIncludePush,
    };

    try {
      if (modalMode === 'create') {
        const created = await createMut.mutateAsync(payload);
        onSelectProjectId(created.id);
        setModalMode(null);
        go(`/projects?view=${created.dataset_mode === 'batch' ? 'collect' : 'overview'}&projectId=${encodeURIComponent(created.id)}`);
      } else if (modalMode === 'edit' && selectedProject) {
        await updateMut.mutateAsync({
          id: selectedProject.id,
          input: { ...payload, revision: formRevision },
        });
        setModalMode(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict409(true);
      }
      setFormError(formatApiError(err));
    }
  };

  const handleDelete = async (p: Project) => {
    setPageBanner(null);
    if (
      !window.confirm(
        t(
          `Delete project "${p.name}"? Public stored content is preserved.`,
          `确定删除项目“${p.name}”？（已抓取的公共内容不会被删除）`,
        ),
      )
    ) {
      return;
    }
    try {
      await deleteMut.mutateAsync({ id: p.id, revision: p.revision });
    } catch (err) {
      setPageBanner(formatApiError(err));
    }
  };

  const hasBoundPushSource = Boolean(
    selectedProject?.source_ids.some(
      (sid) => sources.find((s) => s.id === sid)?.deliveryMode === 'push',
    ),
  );
  const exportDisabled = !isAdmin && quotasSummaryQuery.data?.effectivePolicy.exportEnabled === false;

  const shareUrl = selectedProject ? new URL(
    `/projects?view=overview&projectId=${encodeURIComponent(selectedProject.id)}`, window.location.origin,
  ).href : '';
  return (
    <div className="ds-page">
      {/* Breadcrumb */}
      <div className="crumb">
        <button type="button" onClick={() => go('/projects?view=list')}>
          {t('Research Workspace', '研究工作区')}
        </button>
        <span>/</span>
        {activeView === 'my-jobs' ? (
          <b>{t('My Collection Jobs', '我的采集任务记录')}</b>
        ) : activeView === 'list' ? (
          <b>{t('All Projects', '全部项目')}</b>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                go(
                  selectedProject
                    ? `/projects?view=overview&projectId=${encodeURIComponent(selectedProject.id)}`
                    : '/projects?view=list',
                )
              }
            >
              {selectedProject?.name || t('Projects', '全部项目')}
            </button>
            <span>/</span>
            <b>
              {activeView === 'collect'
                ? t('Data Ingestion', '数据接入')
                : activeView === 'jobs'
                  ? t('Collection Jobs', '采集任务')
                  : activeView === 'batches'
                    ? t('Data Batches', '数据批次')
                    : activeView === 'intelligence'
                      ? t('Intelligence Insights (V2)', '智能监测洞察 (V2)')
                      : t('Content Research', '内容研究')}
            </b>
          </>
        )}
      </div>

      {/* DeepSeek Page Header */}
      {activeView !== 'collect' && <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{selectedProject ? selectedProject.name : t('Monitoring Overview', '监测总览')}</h1>
            {selectedProject && (
              <>
                <Badge variant="secondary">
                  {selectedProject.dataset_mode === 'batch' ? t('Batch project', '批次型项目') : t('Source-filter project', '来源型项目')}
                </Badge>
                <Badge variant="secondary">
                  {selectedProject.visibility === 'shared' || selectedProject.is_shared ? t('Shared', '共享') : t('Private', '私有')}
                </Badge>
              </>
            )}
          </div>
          {selectedProject && <p className="page-desc">
            {selectedProject.dataset_mode === 'batch'
              ? t(
                  `${selectedProject.enabled_batch_count ?? '—'} enabled batches · ${selectedProject.data_summary?.item_count ?? 0} samples`,
                  `${selectedProject.enabled_batch_count ?? '—'} 个启用批次 · ${selectedProject.data_summary?.item_count ?? 0} 条样本`,
                )
              : t(`${selectedProject.source_ids.length} bound sources`, `${selectedProject.source_ids.length} 个绑定来源`)}
            {' · '}{t('Revision', '版本')} {selectedProject.revision}
            {overview && <> · {t('Coverage', '口径')} <b>{t('Stored samples', '已存样本')}</b></>}
            {(selectedProject.dataset_mode === 'batch' || hasBoundPushSource) && <> · {
              selectedProject.dataset_mode === 'batch' || selectedProject.include_push_in_trends
                ? t('Push/R4 included in trends', '趋势已计入推流/归档样本')
                : t('Trends use pull samples', '趋势使用拉取样本')
            }</>}
          </p>}
        </div>

        <div className="page-actions" data-ov-pop>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              disabled={!selectedProject}
              onClick={() => { setShareCopied(false); setOpenFilterPop(openFilterPop === 'share' ? null : 'share'); }}
            >
              <Link2 size={13} />
              <span>{t('Share', '分享')}</span>
            </button>

            {openFilterPop === 'share' && (
              <div className="ds-pop" style={{ top: 'calc(100% + 6px)', right: 0, width: 290 }}>
                <div className="pop-hd">
                  <span>{t('Share project link', '分享项目链接')}</span>
                  <span>stored_sample</span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, margin: '0 4px 10px' }}>
                  {t('Recipients open the project with their existing access.', '接收者使用已有权限打开此项目。')}
                </p>
                <div style={{ display: 'flex', gap: 6, padding: '6px 8px', background: '#fbfcf7', border: '1px solid var(--line)', borderRadius: 5, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shareUrl}
                  </span>
                  <button
                    type="button"
                    className="ds-btn"
                    style={{ height: 24, padding: '0 9px', fontSize: 10 }}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareUrl);
                        setShareCopied(true);
                      } catch (err) {
                        setPageBanner(formatApiError(err));
                      }
                    }}
                  >
                    <Copy size={11} />
                    {shareCopied ? t('Copied', '已复制') : t('Copy', '复制')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {activeView === 'overview' && selectedProject && (
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              onClick={() => onDrilldown(selectedProject.id)}
            >
              <span>{t('Explore All', '全部检索')}</span>
              <ArrowRight size={13} />
            </button>
          )}

          {activeView === 'overview' && monitors.length > 0 && selectedProject && (
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              onClick={() => go(`/projects?view=intelligence&projectId=${encodeURIComponent(selectedProject.id)}`)}
            >
              <Sparkles size={13} />
              <span>{t('Intelligence V2', '智能洞察 V2')}</span>
            </button>
          )}

          {activeView === 'overview' && <ProjectEvidenceExport
            isAdmin={isAdmin}
            quota={quotasSummaryQuery}
            ready={contentQuery.isSuccess}
            content={rawItems}
            projectId={selectedProject?.id}
            activeFilter={{
              from: windowFrom,
              to: windowTo,
              threadAware,
              deliveryMode: selectedProject?.dataset_mode === 'source_filter' && !selectedProject.include_push_in_trends
                ? 'pull' : undefined,
            }}
          />}

          {selectedProject && (
            <ProjectForkPublishActions
              project={selectedProject}
              isAdmin={isAdmin}
              onForked={(forkedId) => {
                onSelectProjectId(forkedId);
                go(`/projects?view=overview&projectId=${encodeURIComponent(forkedId)}`);
              }}
              onBanner={setPageBanner}
            />
          )}

          {canWrite && selectedProject && (
            <>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => openEdit(selectedProject)}>
                <Edit3 size={13} />
                <span>{t('Edit', '编辑')}</span>
              </button>
              <button
                type="button"
                className="icon-square"
                onClick={() => handleDelete(selectedProject)}
                title={t('Delete Project', '删除项目')}
              >
                <Trash2 size={14} color="#a8462f" />
              </button>
            </>
          )}
          {canCreateProject && (
            <button type="button" className="ds-btn" onClick={() => openCreate()}>
              <Plus size={14} />
              <span>{t('New Research Project', '新建研究项目')}</span>
            </button>
          )}
        </div>
      </div>}

      {activeView !== 'collect' && selectedProject && !canWrite && (
        <div className="wb-alert wb-alert--info" style={{ marginBottom: 14 }}>
          <span>
            {t(
              'Shared project (read-only): you can analyze, drill down, export, and save notes. Create your own private project to collect or manage custom batches.',
              '当前为共享只读项目：可正常分析、钻取、导出并写个人批注；如需自定义采集与批次管理，请点击右上角新建私有研究项目。',
            )}
          </span>
        </div>
      )}

      {pageBanner && <div className="wb-alert wb-alert--error" style={{ marginBottom: 14 }}>{pageBanner}</div>}

      {activeView === 'my-jobs' ? (
        <ViewerPersonalJobsView onNavigate={go} />
      ) : activeView === 'list' ? (
        <ProjectListView
          projects={projects}
          activeProjectId={selectedProject?.id}
          maxProjects={quotasSummaryQuery.data?.effectivePolicy.maxProjects}
          isViewer={!isAdmin}
          monitors={monitors}
          onSelect={(p) => {
            onSelectProjectId(p.id);
            const nextView = p.dataset_mode === 'batch' && (p.enabled_batch_count ?? 0) === 0 ? 'collect' : 'overview';
            go(`/projects?view=${nextView}&projectId=${encodeURIComponent(p.id)}`);
          }}
          onCreate={() => openCreate()}
        />
      ) : missingUrlProject ? (
        <div className="wb-card" style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
            {t('Project not found or no access', '项目不存在或当前账号无权访问')}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
            {t(
              `Requested project ID "${urlProjectId}" is not in your accessible projects list. It may have been deleted or belong to another user.`,
              `请求的 projectId「${urlProjectId}」不在当前账号可访问的项目列表中，可能已被删除或属于其他用户的私有项目。`,
            )}
          </div>
          <button type="button" className="ds-btn" onClick={() => go('/projects?view=list')}>
            {t('Back to All Projects', '返回全部项目')}
          </button>
        </div>
      ) : activeView === 'collect' && selectedProject ? (
        <ProjectCollectView
          key={selectedProject.id}
          actor={actor}
          project={selectedProject}
          sources={sources}
          initialSearch={initialSearchString}
          onNavigate={go}
        />
      ) : activeView === 'jobs' && selectedProject ? (
        <ProjectJobsView
          key={selectedProject.id}
          actor={actor}
          project={selectedProject}
          quota={quotasSummaryQuery.data}
          monitors={monitors}
          jobId={searchParams.get('jobId') ?? undefined}
          onNavigate={go}
          onOpenAnalytics={(monitorId) =>
            go(`/projects?view=intelligence&projectId=${encodeURIComponent(selectedProject.id)}&monitorId=${encodeURIComponent(monitorId)}`)
          }
        />
      ) : activeView === 'batches' && selectedProject ? (
        <ProjectBatchesView key={selectedProject.id} project={selectedProject} batchId={searchParams.get('batchId') ?? undefined} allProjects={projects} onNavigate={go} />
      ) : activeView === 'intelligence' ? (
        <IntelligenceAnalyticsView
          monitors={monitors}
          projectId={selectedProject?.id}
          initialMonitorId={searchParams.get('monitorId') ?? undefined}
          onNavigate={go}
          onOpenContentDetail={handleOpenInlineDetail}
        />
      ) : (
        <>
          {/* Empty State when no project exists yet */}
          {!projectsQuery.isLoading && !selectedProject && (
            <div className="ds-card" style={{ padding: 28, textAlign: 'center', marginBottom: 16 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 650, marginBottom: 6 }}>
                {t('No Monitoring Projects Yet', '尚未创建监测项目')}
              </h3>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 520, margin: '0 auto 14px' }}>
                {t(
                  'Bind one or more sources with a fixed keyword lens to track daily trend anchors and pain-point cohorts.',
                  '绑定一个或多个数据来源与固化检索词组，即可开启每日趋势锚点与痛点人群分析。',
                )}
              </p>
              {canWrite && (
                <button type="button" className="ds-btn" onClick={() => openCreate()}>
                  <Plus size={14} />
                  <span>{t('Create First Project', '创建首个监测项目')}</span>
                </button>
              )}
            </div>
          )}

          {selectedProject && (
            <ContentResearchWorkspace
              project={selectedProject}
              initialLayer={
                searchParams.get('layer') === 'l2'
                  ? 'l2'
                  : searchParams.get('layer') === 'l3'
                    ? 'l3'
                    : 'l1'
              }
              exportDisabled={exportDisabled}
              onOpenContentDetail={handleOpenInlineDetail}
              onNavigate={go}
            />
          )}
        </>
      )}

      {/* Create / Edit Project Modal (Real API + 409 Conflict Guard) */}
      {modalMode && (
        <div className="sr-modal-backdrop" onClick={() => setModalMode(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="project-editor-heading" className="sr-modal" style={{ width: 'min(640px, 100%)', padding: '22px 26px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 id="project-editor-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 650 }}>
                {modalMode === 'create' ? t('Create Monitoring Project', '新建监测项目') : t('Edit Project', '编辑监测项目')}
              </h3>
              <button type="button" className="sr-btn sr-btn--subtle sr-btn--xs" onClick={() => setModalMode(null)}>
                <X size={15} />
              </button>
            </div>

            <div className="wb-alert wb-alert--info" style={{ marginBottom: 14 }}>
              {modalMode === 'create'
                ? formDatasetMode === 'source_filter' && requestedSource
                  ? t('This project will use stored and future samples from the selected source.', '此项目将使用所选来源已入库和后续入库的样本。') + ' · ' + requestedSource.label
                  : t(
                    'New research projects always start with 0 samples. You will define research targets and run a preflight check on the next screen.',
                    '新建研究项目初始样本严格为 0，不会自动继承历史数据。创建后将直接进入「数据接入」配置研究目标与预检。',
                  )
                : t(
                    'Advanced analysis filters govern stored sample aggregation only — never rewrites source crawl targets or triggers paid runs.',
                    '高级分析过滤条件仅作用于已纳入本项目的样本聚合与钻取，不会改写来源采集词，也不会主动触发付费抓取。',
                  )}
            </div>

            {formError && (
              <div className="wb-alert wb-alert--error" style={{ marginBottom: 14, flexDirection: 'column', alignItems: 'flex-start' }}>
                <div>{formError}</div>
                {conflict409 && selectedProject && (
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    style={{ height: 28, fontSize: 11 }}
                    onClick={async () => {
                      await projectsQuery.refetch();
                      const fresh = projectsQuery.data?.projects.find((p) => p.id === selectedProject.id);
                      if (fresh) {
                        setFormRevision(fresh.revision);
                        setConflict409(false);
                        setFormError(t(`Reloaded revision ${fresh.revision}. Local draft preserved.`, `已拉取最新 rev ${fresh.revision}（保留本地输入）。`));
                      }
                    }}
                  >
                    <RefreshCw size={12} /> {t('Reload Latest Revision', '刷新最新 Revision')}
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="wb-field">
                <label htmlFor="monitoring-project-name">{t('Project Name (1..100 chars)', '项目名称（1..100 字符）')}</label>
                <input id="monitoring-project-name" className="wb-input" value={formName} onChange={(e) => setFormName(e.target.value)} maxLength={100} required />
              </div>

              <div className="wb-field">
                <label htmlFor="monitoring-project-desc">{t('Research Topic / Notes (optional)', '研究主题与目标说明（可选）')}</label>
                <input id="monitoring-project-desc" className="wb-input" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} maxLength={500} placeholder={t('e.g. Track developer feedback on AI coding tools', '例如：追踪开发者对 AI 编程工具的真实反馈')} />
              </div>

              {modalMode === 'edit' && formDatasetMode === 'source_filter' && (
              <div className="wb-field">
                <label>{t('Bound Research Sources (min 1 · Information Feed sources excluded)', '绑定研究来源（至少 1 个 · 资讯信息流源已隔离）')}</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, maxHeight: 130, overflowY: 'auto', padding: 8, border: '1px solid var(--line)', borderRadius: 6 }}>
                  {researchSources.map((s) => {
                    const checked = formSourceIds.includes(s.id);
                    return (
                      <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setFormSourceIds((prev) => (checked ? prev.filter((id) => id !== s.id) : [...prev, s.id]))
                          }
                        />
                        <span>[{s.platform.toUpperCase()}] {s.label} ({s.deliveryMode})</span>
                      </label>
                    );
                  })}
                  {researchSources.length === 0 && (
                    <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {t('No research sources configured yet.', '暂无已配置的社媒/归档研究源。')}
                    </span>
                  )}
                </div>
              </div>
              )}

              {modalMode === 'edit' && (
                <ProjectAdvancedFilterFields
                  t={t}
                  formAnyTerms={formAnyTerms}
                  setFormAnyTerms={setFormAnyTerms}
                  formAllTerms={formAllTerms}
                  setFormAllTerms={setFormAllTerms}
                  formExclusions={formExclusions}
                  setFormExclusions={setFormExclusions}
                  formScope={formScope}
                  setFormScope={setFormScope}
                  formSignal={formSignal}
                  setFormSignal={setFormSignal}
                  formPlatform={formPlatform}
                  setFormPlatform={setFormPlatform}
                  formKind={formKind}
                  setFormKind={setFormKind}
                  formThreadAware={formThreadAware}
                  setFormThreadAware={setFormThreadAware}
                  formIncludePush={formIncludePush}
                  setFormIncludePush={setFormIncludePush}
                />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>
                  {modalMode === 'edit' ? `Optimistic lock rev ${formRevision}` : t('Terms require >= 3 alnum chars', '词项须含至少 3 个连续字母/数字')}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setModalMode(null)}>
                    {t('Cancel', '取消')}
                  </button>
                  <button type="submit" className="ds-btn">
                    {modalMode === 'create' ? t('Create Project', '创建项目') : t('Save Changes', '保存修改')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {readerPreview && (
        <ReaderDrawer
          preview={readerPreview}
          actor={actor}
          onOpenAuth={() => {}}
          onSelectRelated={(ev) => handleOpenInlineDetail(ev.id)}
          onOpenFullDetail={onOpenContentDetail}
          onClose={() => setReaderPreview(null)}
        />
      )}
    </div>
  );
}
