import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Check,
  Copy,
  Database,
  Download,
  Edit3,
  Globe,
  Layers,
  Link2,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import {
  formatApiError,
  useContentListQuery,
  useCreateProjectMutation,
  useDeleteProjectMutation,
  useProjectOverviewQuery,
  useProjectsQuery,
  useQuotasSummaryQuery,
  useSourcesQuery,
  useUpdateProjectMutation,
} from '../api/hooks';
import { KpiCard } from '../components/workbench/KpiCard';
import { Alert } from '../components/ui/alert';
import { Card } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Table } from '../components/ui/table';
import { KpiSparkChart } from '../components/charts/KpiSparkChart';
import { DailyTrendChart } from '../components/charts/DailyTrendChart';
import { DistributionCards } from '../components/charts/DistributionCharts';
import { useChartColors } from '../components/charts/chartUtils';
import { CrossPlatformAnalyticsPanel } from '../components/CrossPlatformAnalyticsPanel';
import { ProjectCollectView } from '../components/ProjectCollectView';
import '../styles/collection.css';
import {
  ProjectBatchesView,
  ProjectJobsView,
  ProjectListView,
} from '../components/ProjectWorkspaceViews';
import { isResearchSource } from '../lib/collectionLimits';
import {
  type Actor,
  ApiError,
  type ContentKind,
  type Platform,
  type Project,
  type ProjectInput,
  type SearchScope,
  type SignalType,
  formatContentAuthor,
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
  onOpenContentDetail: (contentId: string) => void;
}

const PAIN_RE =
  /\b(broken|bug|slow|expensive|pricing|sucks|frustrated|unusable|churn|blocked|timeout|hate|pain|issue|fail(?:ed|ing)?|refund|friction|overage)\b|崩溃|卡顿|太贵|难用|踩坑|报错|封号|吐槽|痛/i;

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
  const colors = useChartColors();
  const isAdmin = actor.role === 'owner' || actor.role === 'admin';
  const canCreateProject = actor.clientKind === 'browser';

  const projectsQuery = useProjectsQuery(true);
  const sourcesQuery = useSourcesQuery(true);
  const quotasSummaryQuery = useQuotasSummaryQuery(true);
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data?.projects]);
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const researchSources = useMemo(() => sources.filter(isResearchSource), [sources]);

  const searchParams = new URLSearchParams(initialSearchString);
  const urlProjectId = searchParams.get('projectId') || '';
  const urlView = searchParams.get('view') || '';
  const activeSection = searchParams.get('section') || '';
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
  const activeView: 'list' | 'collect' | 'jobs' | 'batches' | 'overview' =
    urlView === 'list' || urlView === 'collect' || urlView === 'jobs' || urlView === 'batches' || urlView === 'overview'
      ? urlView
      : canWrite && selectedProject && selectedProject.dataset_mode === 'batch' && (selectedProject.enabled_batch_count ?? 0) === 0
        ? 'collect'
        : 'overview';
  const go = useCallback(
    (path: string) => {
      if (onNavigate) onNavigate(path);
    },
    [onNavigate],
  );
  const overviewQuery = useProjectOverviewQuery(selectedProject?.id, selectedProject?.revision);
  const overview = overviewQuery.data;

  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [windowEnd, setWindowEnd] = useState(() => Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000);
  const windowFrom = new Date(windowEnd - rangeDays * 86_400_000).toISOString();
  const windowTo = new Date(windowEnd).toISOString();
  const [threadAwareOverride, setThreadAware] = useState<boolean>();
  const threadAware = threadAwareOverride ?? selectedProject?.thread_aware ?? true;
  const [filterPlatforms, setFilterPlatforms] = useState<Set<Platform>>(
    () => new Set<Platform>(['reddit', 'x', 'bluesky', 'web']),
  );
  const [filterSignal, setFilterSignal] = useState<'all' | 'pain' | 'discussion'>('all');
  const [filterKind, setFilterKind] = useState<'all' | ContentKind>('all');

  const togglePlatform = (platform: Platform) => {
    setFilterPlatforms(previous => {
      const next = new Set(previous);
      if (!next.has(platform)) next.add(platform);
      else if (next.size > 1) next.delete(platform);
      return next;
    });
  };

  const contentQuery = useContentListQuery({
    limit: 100, threadAware, from: windowFrom, to: windowTo,
    kind: filterKind === 'all' ? undefined : filterKind,
    deliveryMode: selectedProject?.dataset_mode === 'source_filter' && !selectedProject.include_push_in_trends
      ? 'pull' : undefined,
  }, selectedProject?.id, activeView === 'overview' && Boolean(selectedProject?.id));
  const rawItems = useMemo(() => contentQuery.data?.items ?? [], [contentQuery.data?.items]);

  const [openFilterPop, setOpenFilterPop] = useState<'platforms' | 'signal' | 'kind' | 'share' | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
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

  useEffect(() => {
    if (!activeSection) return;
    const idMap: Record<string, string> = {
      radar: 'card-scatter-radar',
      platform: 'card-platform',
      attribution: 'card-attribution',
    };
    const el = document.getElementById(idMap[activeSection]);
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }, [activeSection, overview]);

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

  // Filtered view of scoped content for High-Signal table & Radar scatter
  const filteredContent = useMemo(() => {
    return rawItems.filter((item) => {
      if (!filterPlatforms.has(item.platform)) return false;
      if (filterKind !== 'all' && item.kind !== filterKind) return false;
      if (filterSignal === 'pain' && !PAIN_RE.test(`${item.title || ''} ${item.text || ''}`)) return false;
      if (filterSignal === 'discussion') {
        const m = item.observations[item.observations.length - 1]?.metrics || {};
        const c = Number(m['reddit.num_comments'] ?? m['x.replies'] ?? m['bluesky.replies'] ?? 0);
        if (c < 10) return false;
      }
      return true;
    });
  }, [rawItems, filterPlatforms, filterKind, filterSignal]);

  const dayBuckets = useMemo(
    () =>
      (overview?.facets || [])
        .filter((f) => f.day_group === 0 && f.day !== null)
        .sort((a, b) => (a.day || '').localeCompare(b.day || '')),
    [overview?.facets],
  );
  const daySeriesValues = useMemo(() => dayBuckets.map((d) => d.count), [dayBuckets]);
  const utcRangeText = useMemo(() => {
    const first = windowFrom.slice(0, 10);
    const last = new Date(windowEnd - 86_400_000).toISOString().slice(0, 10);
    return first === last ? `${first} UTC` : `${first} – ${last} UTC`;
  }, [windowFrom, windowEnd]);
  const hasBoundPushSource = useMemo(
    () =>
      Boolean(
        selectedProject?.source_ids.some(
          (sid) => sources.find((s) => s.id === sid)?.deliveryMode === 'push',
        ),
      ),
    [selectedProject?.source_ids, sources],
  );

  const unknownRow = overview?.facets.find((f) => f.day_group === 0 && f.day === null);
  const painCount = useMemo(
    () => filteredContent.filter((i) => PAIN_RE.test(`${i.title || ''} ${i.text || ''}`)).length,
    [filteredContent],
  );

  const painRatio = useMemo(
    () => (filteredContent.length > 0 ? Math.round((painCount / filteredContent.length) * 100) : 0),
    [filteredContent.length, painCount],
  );

  const shareUrl = selectedProject ? new URL(
    `/projects?view=overview&projectId=${encodeURIComponent(selectedProject.id)}`, window.location.origin,
  ).href : '';
  const handleExportCsv = () => {
    const csvCell = (raw: unknown): string => {
      const str = String(raw ?? '').replace(/[\r\n]+/g, ' ');
      const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const headers = ['id,platform,kind,title,score,publishedAt,providers'];
    const lines = filteredContent.map((c) => {
      const m = c.observations[c.observations.length - 1]?.metrics || {};
      const sc = m['reddit.score'] ?? m['x.likes'] ?? m['bluesky.likes'] ?? '';
      const provs = [...new Set(c.observations.map((o) => o.provider))].join('|');
      const title = (c.title || c.text || '').slice(0, 120);
      return [c.id, c.platform, c.kind, title, sc, c.publishedAt || 'null', provs]
        .map(csvCell)
        .join(',');
    });
    const blob = new Blob([headers.concat(lines).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `siftline-${selectedProject?.id.slice(0, 8) || 'overview'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="ds-page">
      {/* Breadcrumb */}
      <div className="crumb">
        <button type="button" onClick={() => go('/projects?view=list')}>
          {t('Research Workspace', '研究工作区')}
        </button>
        <span>/</span>
        {activeView === 'list' ? (
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
                    : t('Project Overview', '项目总览')}
            </b>
          </>
        )}
      </div>

      {/* DeepSeek Page Header */}
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{selectedProject ? selectedProject.name : t('Monitoring Overview', '监测总览')}</h1>
            {selectedProject && <Badge variant="secondary">
              {selectedProject.dataset_mode === 'batch' ? t('Batch project', '批次型项目') : t('Source-filter project', '来源型项目')}
            </Badge>}
          </div>
          {selectedProject && <p className="page-desc">
            {selectedProject.dataset_mode === 'batch'
              ? t(`${selectedProject.enabled_batch_count ?? '—'} enabled batches`, `${selectedProject.enabled_batch_count ?? '—'} 个启用批次`)
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

          {activeView === 'overview' && <button type="button" className="ds-btn ds-btn--ghost" onClick={handleExportCsv}
            disabled={!contentQuery.isSuccess || filteredContent.length === 0}>
            <Download size={13} />
            <span>{t('Export evidence samples (CSV)', '导出证据样本（CSV）')}</span>
          </button>}

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
      </div>

      {selectedProject && !canWrite && (
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

      {activeView === 'list' ? (
        <ProjectListView
          projects={projects}
          activeProjectId={selectedProject?.id}
          maxProjects={quotasSummaryQuery.data?.effectivePolicy.maxProjects}
          isViewer={!isAdmin}
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
          onNavigate={go}
        />
      ) : activeView === 'jobs' && selectedProject ? (
        <ProjectJobsView key={selectedProject.id} project={selectedProject} jobId={searchParams.get('jobId') ?? undefined} onNavigate={go} />
      ) : activeView === 'batches' && selectedProject ? (
        <ProjectBatchesView key={selectedProject.id} project={selectedProject} batchId={searchParams.get('batchId') ?? undefined} allProjects={projects} onNavigate={go} />
      ) : (
        <>
          {selectedProject && (
            <div style={{ marginBottom: 16 }}>
              <CrossPlatformAnalyticsPanel
                project={selectedProject}
                items={rawItems}
                rangeDays={rangeDays}
                setRangeDays={setRangeDays}
                from={windowFrom}
                to={windowTo}
                threadAware={threadAware}
                setThreadAware={setThreadAware}
                kind={filterKind === 'all' ? undefined : filterKind}
                platforms={filterPlatforms}
                togglePlatform={togglePlatform}
                providers={overview?.providers ?? []}
                onDrilldown={onDrilldown}
                onOpenContentDetail={onOpenContentDetail}
              />
            </div>
          )}

          {/* Legacy Overview Details & Evidence */}
          <div className="filterbar" data-ov-pop>
        <div className="seg ink">
          {([7, 30, 90] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={rangeDays === r ? 'on' : ''}
              aria-pressed={rangeDays === r}
              onClick={() => setRangeDays(r)}
            >
              {t(`Last ${r}d`, `近 ${r} 天`)}
            </button>
          ))}
        </div>

        {/* Platform Filter Popover */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="fb-item"
            onClick={() => setOpenFilterPop(openFilterPop === 'platforms' ? null : 'platforms')}
          >
            <Globe size={12} color="var(--faint)" />
            <span>{t('Platform', '平台')}</span>
            <b>{filterPlatforms.size === 4 ? t('All 4', '全部 4') : `${filterPlatforms.size}`}</b>
          </button>
          {openFilterPop === 'platforms' && (
            <div className="ds-pop" style={{ top: 'calc(100% + 6px)', left: 0, width: 220 }}>
              <div className="pop-hd"><span>{t('Platforms', '选择平台')}</span><span>{t('Multi', '多选')}</span></div>
              {(['reddit', 'x', 'bluesky', 'web'] as Platform[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`pop-opt ${filterPlatforms.has(p) ? 'on' : ''}`}
                  aria-pressed={filterPlatforms.has(p)}
                  onClick={() => togglePlatform(p)}
                >
                  <span style={{ flex: 1, textTransform: p === 'x' ? 'uppercase' : 'capitalize' }}>{p}</span>
                  {filterPlatforms.has(p) && <Check size={13} color="var(--wb-purple)" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Signal Filter Popover */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="fb-item"
            onClick={() => setOpenFilterPop(openFilterPop === 'signal' ? null : 'signal')}
          >
            <Zap size={12} color="var(--faint)" />
            <span>{t('Signal', '信号')}</span>
            <b>
              {filterSignal === 'all'
                ? t('All', '全部')
                : filterSignal === 'pain'
                  ? t('Pain', '痛点')
                  : t('Discussion', '高讨论')}
            </b>
          </button>
          {openFilterPop === 'signal' && (
            <div className="ds-pop" style={{ top: 'calc(100% + 6px)', left: 0, width: 210 }}>
              <div className="pop-hd"><span>{t('Signal Type', '信号类型')}</span></div>
              {([
                ['all', t('All Signals', '全部信号')],
                ['pain', t('Pain Signals', '痛点信号')],
                ['discussion', t('High-Reply Discussions', '高互动讨论')],
              ] as const).map(([val, lab]) => (
                <button
                  key={val}
                  type="button"
                  className={`pop-opt ${filterSignal === val ? 'on' : ''}`}
                  onClick={() => {
                    setFilterSignal(val);
                    setOpenFilterPop(null);
                  }}
                >
                  <span style={{ flex: 1 }}>{lab}</span>
                  {filterSignal === val && <Check size={13} color="var(--wb-purple)" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content Kind Filter Popover */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="fb-item"
            onClick={() => setOpenFilterPop(openFilterPop === 'kind' ? null : 'kind')}
          >
            <Layers size={12} color="var(--faint)" />
            <span>{t('Kind', '内容')}</span>
            <b>{filterKind === 'all' ? t('All', '全部类型') : filterKind}</b>
          </button>
          {openFilterPop === 'kind' && (
            <div className="ds-pop" style={{ top: 'calc(100% + 6px)', left: 0, width: 190 }}>
              <div className="pop-hd"><span>{t('Content Kind', '内容形态')}</span></div>
              {([
                ['all', t('All Kinds', '全部类型')],
                ['post', t('Posts', '帖文')],
                ['comment', t('Comments', '评论')],
                ['article', t('Articles', '文章')],
              ] as const).map(([val, lab]) => (
                <button
                  key={val}
                  type="button"
                  className={`pop-opt ${filterKind === val ? 'on' : ''}`}
                  onClick={() => {
                    setFilterKind(val);
                    setOpenFilterPop(null);
                  }}
                >
                  <span style={{ flex: 1 }}>{lab}</span>
                  {filterKind === val && <Check size={13} color="var(--wb-purple)" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="fb-item">
          <Calendar size={12} color="var(--faint)" />
          <span>{utcRangeText}</span>
        </span>

        <span className="fb-spacer" />

        <button
          type="button"
          className="icon-square"
          style={{ width: 30, height: 30 }}
          onClick={() => {
            setRefreshSpin(true);
            setWindowEnd(Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000);
            overviewQuery.refetch();
            contentQuery.refetch();
            setTimeout(() => setRefreshSpin(false), 620);
          }}
          title={t('Refresh overview', '重新加载聚合数据')}
        >
          <RefreshCw
            size={13}
            style={{
              transition: 'transform 0.6s ease',
              transform: refreshSpin ? 'rotate(360deg)' : 'none',
            }}
          />
        </button>
      </div>

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

      {selectedProject && overviewQuery.isPending && (
        <Skeleton className="project-overview-skeleton" role="status" aria-label={t('Loading project totals', '正在加载项目汇总')} />
      )}
      {overviewQuery.isError && (
        <Alert variant="destructive" role="alert">
          {formatApiError(overviewQuery.error)} <button type="button" onClick={() => void overviewQuery.refetch()}>{t('Retry', '重试')}</button>
        </Alert>
      )}
      {contentQuery.isError && (
        <Alert variant="destructive" role="alert">
          {formatApiError(contentQuery.error)} <button type="button" onClick={() => void contentQuery.refetch()}>{t('Retry samples', '重试加载样本')}</button>
        </Alert>
      )}

      {/* Main Dashboard Bento Grid */}
      {selectedProject && overview && (
        <div className="ds-grid">
          {/* 1. Four-Cell KPI Strip with ECharts Mini Sparklines */}
          <div className="c12">
            <div className="kpi-strip">
              <KpiCard label={<><MessageSquare size={12} />{overview.threadAware ? t('Deduplicated threads', '去重讨论根数') : t('Content anchors', '内容锚点')}</>}
                value={overview.contentCount.toLocaleString()}
                badge={<Badge variant="secondary">{overview.coverage}</Badge>}
                detail={overview.threadAware ? t('Project scope · deduplicated by root', '项目全范围 · 按讨论根去重') : t('Project scope · visible rows', '项目全范围 · 可见记录')}
                trend={<KpiSparkChart values={daySeriesValues} color={colors.purple} />} />
              <KpiCard label={<><Target size={12} />{t('Matched nodes', '命中内容')}</>}
                value={overview.matchedContentCount.toLocaleString()}
                detail={t('Project scope · nodes before root deduplication', '项目全范围 · 去重前节点')}
                trend={<KpiSparkChart values={dayBuckets.map(day => day.matchedContentCount)} color={colors.teal} />} />
              <KpiCard label={<><Zap size={12} />{t('Pain signals in loaded sample', '已加载样本中的痛点')}</>}
                value={!contentQuery.isSuccess || filteredContent.length === 0 ? '—' : painCount.toLocaleString()}
                detail={filteredContent.length > 0
                  ? t(`${painRatio}% of ${filteredContent.length} loaded, filtered samples`, `占 ${filteredContent.length} 条已加载筛选样本的 ${painRatio}%`)
                  : t('No visible samples for this filter', '当前筛选暂无可用样本')} />
              <KpiCard label={<><Database size={12} />{selectedProject.dataset_mode === 'batch' ? t('Enabled batches', '启用批次') : t('Bound sources', '绑定来源')}</>}
                value={selectedProject.dataset_mode === 'batch' ? (selectedProject.enabled_batch_count ?? '—') : selectedProject.source_ids.length}
                detail={t(`${overview.providers.length} observed providers`, `${overview.providers.length} 个已观测渠道`)} />
            </div>
          </div>

          {/* 2. Real UTC Daily Trend Chart (c12) — zero fabricated composite score */}
          <div className="c12" id="card-trend">
            <Card className="ds-card" style={{ height: '100%' }}>
              <DailyTrendChart
                facets={overview.facets.filter(facet => facet.day === null || facet.day >= windowFrom.slice(0, 10) && facet.day < windowTo.slice(0, 10))}
                dayPlatformFacets={overview.dayPlatformFacets?.filter(facet => facet.day >= windowFrom.slice(0, 10) && facet.day < windowTo.slice(0, 10))}
                rangeDays={rangeDays}
                threadAware={overview.threadAware}
                includePushInTrends={selectedProject.include_push_in_trends}
                onSelectDayPlatform={(dayIso, platform) => {
                  const qs = new URLSearchParams();
                  qs.set('from', `${dayIso}T00:00:00Z`);
                  qs.set('to', new Date(Date.parse(`${dayIso}T00:00:00Z`) + 86_400_000).toISOString());
                  qs.set('threadAware', String(overview.threadAware));
                  if (platform) qs.set('platform', platform);
                  onDrilldown(selectedProject.id, qs.toString());
                }}
              />
            </Card>
          </div>

          {/* 3. Platform (c5) + Kind (c4) + Attribution (c3) — Real Backend Facets */}
          <DistributionCards
            facets={overview.facets}
            providers={overview.providers}
            contentItems={filteredContent}
            onDrillPlatform={(plat) => onDrilldown(selectedProject.id, `platform=${plat}`)}
          />

          {/* 5. High-Signal Discussions Table (c8) + Onboarding Guide & Tutorial Card (c4) */}
          <div className="c8" id="card-table">
            <div className="ds-card">
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title">
                    <MessageSquare size={14} color="var(--faint)" />
                    <span>{t('High-Signal Discussions', '高信号讨论')}</span>
                  </div>
                  <div className="ds-card-sub">
                    {t('Sorted by interaction & pain signal density; click any row to inspect threads', '按互动热度与痛点信号排序 · 点击行直接在抽屉中查看观测快照与评论树')}
                  </div>
                </div>
                <div className="ds-card-tools">
                  <button
                    type="button"
                    className="ds-btn ds-btn--quiet"
                    onClick={() => onDrilldown(selectedProject.id)}
                  >
                    <span>{t('Explore All', '全部检索')}</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>

              <div className="ds-card-bd" style={{ padding: '6px 12px 8px', overflowX: 'auto' }}>
                <Table className="tbl">
                  <colgroup>
                    <col style={{ width: '50%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '10%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>{t('Discussion', '讨论主题')}</th>
                      <th>{t('Platform', '平台')}</th>
                      <th>{t('Signal', '信号')}</th>
                      <th className="num">{t('Score / Replies', '互动 / 评论')}</th>
                      <th className="num">{t('UTC Day', '日期')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContent.slice(0, 6).map((item) => {
                      const latest = item.observations[item.observations.length - 1];
                      const m = latest?.metrics || {};
                      const score = Number(m['reddit.score'] ?? m['x.likes'] ?? m['bluesky.likes'] ?? 0);
                      const comments = Number(m['reddit.num_comments'] ?? m['x.replies'] ?? m['bluesky.replies'] ?? 0);
                      const isPain = PAIN_RE.test(`${item.title || ''} ${item.text || ''}`);
                      const isDisc = comments >= 10;

                      return (
                        <tr key={item.id} onClick={() => onOpenContentDetail(item.id)}>
                          <td>
                            <span className="t-title">{item.title || item.text?.slice(0, 72) || item.externalId}</span>
                            <span className="t-meta">
                              {formatContentAuthor(item.author)} · {[...new Set(item.observations.map((o) => o.provider))].join(', ')}
                            </span>
                          </td>
                          <td>
                            <span className="tag tag--line" style={{ height: 20, fontSize: 10, textTransform: item.platform === 'x' ? 'uppercase' : 'capitalize' }}>
                              {item.platform}
                            </span>
                          </td>
                          <td>
                            <span className={`sig ${isPain ? 'pain' : isDisc ? 'disc' : 'neutral'}`}>
                              {isPain ? t('Pain', '痛点') : isDisc ? t('Thread', '讨论') : t('Neutral', '中性')}
                            </span>
                          </td>
                          <td className="num">
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
                              {score.toLocaleString()}
                            </span>
                            <span className="t-meta">{comments} {t('replies', '评论')}</span>
                          </td>
                          <td className="num">
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: item.publishedAt ? 'var(--faint)' : '#a8762c' }}>
                              {item.publishedAt ? item.publishedAt.slice(5, 10) : 'null'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>

              <div className="ds-card-ft">
                <span>
                  {t('Showing up to 6 of', '最多展示 6 /')} {filteredContent.length} {t('items in stored_sample', '条命中样本')}
                </span>
                <button type="button" onClick={() => onDrilldown(selectedProject.id)}>
                  {t('Open Content Explorer →', '进入内容检索台 →')}
                </button>
              </div>
            </div>
          </div>

          <div className="c4 stack-gap">
            <Card className="ds-card">
              <div className="ds-card-hd">
                <div className="ds-card-title">{t('Explore project evidence', '探索项目证据')}</div>
              </div>
              <div className="ds-card-bd collection-toolbar">
                <button type="button" className="ds-btn ds-btn--ghost"
                  onClick={() => onDrilldown(selectedProject.id, 'signal=pain')}>
                  <Zap size={13} />{t('Find pain signals', '在内容库筛选痛点')}
                </button>
                {selectedProject.dataset_mode === 'batch' && (
                  <button type="button" className="ds-btn ds-btn--ghost"
                    onClick={() => go(`/projects?view=batches&projectId=${encodeURIComponent(selectedProject.id)}`)}>
                    <Database size={13} />{t('View data batches', '查看数据批次')}
                  </button>
                )}
              </div>
            </Card>

            {/* Tutorial Playbook Card */}
            <button type="button" className="tutorial-card" onClick={() => setTutorialOpen(true)}>
              <span className="tut-thumb">
                <img src="/assets/img/cover-field.jpg" alt="" />
              </span>
              <span className="tut-txt">
                <b>{t('Reading Multi-Level Thread Trees', '用三视图讨论树读完一段争论')}</b>
                <span>{t('Playbook · 8 min guide · 3 examples', '教程 · 8 分钟 · 含孤儿节点识别')}</span>
              </span>
              <ArrowUpRight size={15} color="var(--faint)" />
            </button>
          </div>

          {/* 6. Signal of the Week Insight Banner (Exact DeepSeek match) */}
          <div className="c12">
            <div className="insight-banner">
              <span className="ib-icon">
                <Sparkles size={18} />
              </span>
              <div className="ib-txt">
                <div className="ib-kicker">{t('Project Signal Summary', '当前项目信号摘要')}</div>
                <h4>
                  {t(
                    `${painCount} heuristic pain signals among ${filteredContent.length} loaded samples`,
                    `已加载的 ${filteredContent.length} 条筛选样本中，有 ${painCount} 条命中启发式痛点规则`,
                  )}
                </h4>
                <p>
                  {t(
                    `Coverage stays strictly within stored_sample across ${overview.providers.length} observed providers.`,
                    `统计严格遵循 stored_sample 口径，覆盖 ${overview.providers.length} 个实际观测渠道；点击右侧可钻取对应痛点原文与评论树。`,
                  )}
                </p>
              </div>
              <div className="ib-stats">
                <div>
                  <span>{t('Project anchors', '项目锚点')}</span>
                  <b>{overview.contentCount}</b>
                </div>
                <div>
                  <span>{t('Sample pain-signal rate', '样本痛点比例')}</span>
                  <b>{filteredContent.length > 0 ? painRatio + '%' : '—'}</b>
                </div>
                <div>
                  <span>{t('Undated anchors', '未记录发布日期的锚点')}</span>
                  <b>{unknownRow?.count ?? '—'}</b>
                </div>
              </div>
              <div className="ib-act">
                <button
                  type="button"
                  className="ds-btn"
                  onClick={() => onDrilldown(selectedProject.id, 'signal=pain')}
                >
                  <span>{t('Inspect Cohort', '查看这组讨论')}</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Statistical Guardrail Footnote */}
      <p style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 14, lineHeight: 1.65 }}>
        {t(
          'Methodology (§4): Trend charts cover stored_sample online pull nodes unless include_push_in_trends=true; items with publishedAt=null stay out of UTC day buckets; daily deduplicated thread_aware anchor counts are non-additive across days.',
          '口径说明（§4）：本页趋势基于 stored_sample 口径；day=null 的发布时间未知内容（如部分推流导入或孤儿评论）不计入 UTC 日时间轴；thread_aware=true 模式下各日去重锚点数不可直接相加作为期间去重总和。',
        )}
      </p>
        </>
      )}

      {/* Tutorial Modal */}
      {tutorialOpen && (
        <div className="sr-modal-backdrop" onClick={() => setTutorialOpen(false)}>
          <div className="sr-modal" style={{ width: 'min(520px, 100%)', padding: '22px 24px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 650 }}>
                  {t('Reading Multi-Level Thread Trees', '用讨论树读完一段争论')}
                </h3>
                <p style={{ fontSize: 11.5, color: 'var(--faint)' }}>{t('Playbook · top / matches / op views', '实战指南 · 3 视图与父链缺失标注')}</p>
              </div>
              <button type="button" className="sr-btn sr-btn--subtle sr-btn--xs" onClick={() => setTutorialOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <div style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)', marginBottom: 12 }}>
              <img src="/assets/img/cover-field.jpg" alt="" style={{ width: '100%', height: 180, objectFit: 'cover' }} />
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.7 }}>
              {t(
                'Start with Top view to grasp consensus replies, toggle Matches view to isolate nodes hitting project rules, and check OP replies for follow-up clarifications. Missing parent chains (>32 hops or deleted roots) stay flagged explicitly instead of silently flattening.',
                '先从「热评 top」看清主干争论结构，再切换到「仅命中 matches」聚焦痛点词命中节点，最后用「楼主 OP」确认原帖补充说明。遇到父链超过 32 跳或孤儿评论时，系统会显式标记「父链缺失」，绝不静默丢弃或错配。',
              )}
            </p>
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="ds-btn"
                onClick={() => {
                  setTutorialOpen(false);
                  if (selectedProject) onDrilldown(selectedProject.id, 'view=threads');
                }}
              >
                {t('Open Live Thread Tree', '去内容检索试看讨论树')}
              </button>
            </div>
          </div>
        </div>
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
    </div>
  );
}
