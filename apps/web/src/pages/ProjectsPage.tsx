import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  Check,
  Database,
  Download,
  Edit3,
  Globe,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
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
  useSourcesQuery,
  useUpdateProjectMutation,
} from '../api/hooks';
import { DailyTrendChart } from '../components/charts/DailyTrendChart';
import { DistributionCards } from '../components/charts/DistributionCharts';
import { KpiSparkChart } from '../components/charts/KpiSparkChart';
import { useChartColors } from '../components/charts/chartUtils';
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
  onDrilldown,
  onOpenContentDetail,
}: ProjectsPageProps) {
  const { t } = useI18n();
  const colors = useChartColors();
  const canWrite = actor.role === 'owner' || actor.role === 'admin';

  const projectsQuery = useProjectsQuery(true);
  const sourcesQuery = useSourcesQuery(true);
  const projects = useMemo(() => projectsQuery.data?.projects ?? [], [projectsQuery.data?.projects]);
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.id === selectedProjectId)) {
      onSelectProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId, onSelectProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || projects[0];
  const overviewQuery = useProjectOverviewQuery(selectedProject?.id, selectedProject?.revision);
  const overview = overviewQuery.data;

  const contentQuery = useContentListQuery(
    { limit: 100, threadAware: selectedProject?.thread_aware ?? true },
    selectedProject?.id,
    Boolean(selectedProject?.id),
  );
  const rawItems = useMemo(() => contentQuery.data?.items ?? [], [contentQuery.data?.items]);

  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [filterPlatforms, setFilterPlatforms] = useState<Set<Platform>>(
    () => new Set<Platform>(['reddit', 'x', 'bluesky', 'web']),
  );
  const [filterSignal, setFilterSignal] = useState<'all' | 'pain' | 'discussion'>('all');
  const [filterKind, setFilterKind] = useState<'all' | ContentKind>('all');
  const [openFilterPop, setOpenFilterPop] = useState<'platforms' | 'signal' | 'kind' | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [pageBanner, setPageBanner] = useState<string | null>(null);

  const searchParams = new URLSearchParams(initialSearchString);
  const activeSection = searchParams.get('section') || '';
  const openNewFromUrl = searchParams.get('new') === '1';

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [formName, setFormName] = useState('');
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

  const openCreate = useCallback(() => {
    setModalMode('create');
    setFormName('');
    setFormSourceIds(sources.slice(0, 2).map((s) => s.id));
    setFormAnyTerms('');
    setFormAllTerms('');
    setFormExclusions('');
    setFormScope('title_text');
    setFormSignal('');
    setFormPlatform('');
    setFormKind('');
    setFormThreadAware(true);
    setFormIncludePush(false);
    setFormRevision(1);
    setFormError(null);
    setConflict409(false);
  }, [sources]);

  useEffect(() => {
    if (!activeSection) return;
    const idMap: Record<string, string> = {
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
    if (openNewFromUrl && canWrite && sources.length > 0 && !didHandleUrlNew.current) {
      didHandleUrlNew.current = true;
      const timer = setTimeout(() => openCreate(), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [openNewFromUrl, canWrite, sources.length, openCreate]);

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
    if (formSourceIds.length < 1) {
      setFormError(t('Select at least 1 bound source (minItems: 1).', '至少须绑定 1 个采集来源。'));
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
      sourceIds: formSourceIds,
      filter,
      threadAware: formThreadAware,
      includePushInTrends: formIncludePush,
    };

    try {
      if (modalMode === 'create') {
        const created = await createMut.mutateAsync(payload);
        onSelectProjectId(created.id);
        setModalMode(null);
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
    if (dayBuckets.length === 0) return t('No UTC day buckets yet', '暂无 UTC 日分桶');
    const first = dayBuckets[0].day!.slice(0, 10);
    const last = dayBuckets[dayBuckets.length - 1].day!.slice(0, 10);
    return first === last ? `${first} UTC` : `${first} – ${last} UTC`;
  }, [dayBuckets, t]);

  const hasBoundPushSource = useMemo(
    () =>
      Boolean(
        selectedProject?.source_ids.some(
          (sid) => sources.find((s) => s.id === sid)?.delivery_mode === 'push',
        ),
      ),
    [selectedProject?.source_ids, sources],
  );

  const unknownRow = overview?.facets.find((f) => f.day_group === 0 && f.day === null);
  const painCount = useMemo(
    () => filteredContent.filter((i) => PAIN_RE.test(`${i.title || ''} ${i.text || ''}`)).length,
    [filteredContent],
  );
  const painRatio = filteredContent.length > 0 ? Math.round((painCount / filteredContent.length) * 100) : 0;

  const handleExportCsv = () => {
    const escapeCell = (raw: unknown): string => {
      const str = String(raw ?? '');
      const neutralized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      return `"${neutralized.replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`;
    };
    const headers = ['id,platform,kind,title,score,publishedAt,providers'];
    const lines = filteredContent.map((c) => {
      const m = c.observations[c.observations.length - 1]?.metrics || {};
      const sc = m['reddit.score'] ?? m['x.likes'] ?? m['bluesky.likes'] ?? 0;
      const provs = [...new Set(c.observations.map((o) => o.provider))].join('|');
      const title = (c.title || c.text || '').slice(0, 80);
      return [
        escapeCell(c.id),
        escapeCell(c.platform),
        escapeCell(c.kind),
        escapeCell(title),
        escapeCell(sc),
        escapeCell(c.publishedAt || 'null'),
        escapeCell(provs),
      ].join(',');
    });
    const blob = new Blob([headers.concat(lines).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `siftline-${selectedProject?.id.slice(0, 8) || 'overview'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ds-page">
      <div className="crumb">
        <button type="button" onClick={() => onDrilldown('')}>
          {t('Workbench', '工作台')}
        </button>
        <span>/</span>
        <span>{t('Monitoring Projects', '专题监测')}</span>
        <span>/</span>
        <b>{selectedProject?.name || 'SIFTLINE'}</b>
      </div>

      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{selectedProject ? selectedProject.name : t('Monitoring Overview', '专题监测')}</h1>
            <span className="state-chip">
              <i className="dot" />
              {t('Active', '运行中')}
            </span>
          </div>
          <p className="page-desc">
            {selectedProject?.source_ids.length ?? 0} {t('bound sources', '个绑定来源')} · rev{' '}
            {selectedProject?.revision ?? 1} · {t('Coverage:', '口径：')}{' '}
            <b style={{ color: 'var(--ink-3)' }}>{overview?.coverage || 'stored_sample'}</b> ·{' '}
            {selectedProject?.include_push_in_trends
              ? t('Includes push samples in trends', '包含导入样本')
              : hasBoundPushSource
                ? t('Push samples excluded from trends', '推流/导入默认不计入趋势')
                : t('Resolved OR:', '固化词组：')}{' '}
            {!hasBoundPushSource && ((overview?.resolvedFilter.anyTerms || []).join(', ') || t('All tokens', '全量词池'))}
          </p>
        </div>

        <div className="page-actions" data-ov-pop>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={handleExportCsv}>
            <Download size={13} />
            <span>{t('Export CSV', '导出 CSV')}</span>
          </button>

          {canWrite && selectedProject && (
            <>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => openEdit(selectedProject)}>
                <Edit3 size={13} />
                <span>{t('Edit Project', '编辑项目')}</span>
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
          {canWrite && (
            <button type="button" className="ds-btn" onClick={openCreate}>
              <Plus size={14} />
              <span>{t('Create Project', '创建项目')}</span>
            </button>
          )}
        </div>
      </div>

      {!canWrite && (
        <div className="wb-alert wb-alert--info" style={{ marginBottom: 14 }}>
          <span>
            {t(
              'Viewer role active: project creation/edits are locked; analytics drilldown and personal workspace stay writable.',
              '当前为 viewer 只读权限：项目增改删已锁定，但可正常钻取分析、导出并在个人工作区写查询与批注。',
            )}
          </span>
        </div>
      )}

      {pageBanner && <div className="wb-alert wb-alert--error" style={{ marginBottom: 14 }}>{pageBanner}</div>}

      {/* Filter Bar */}
      <div className="filterbar" data-ov-pop>
        <div className="seg ink">
          {([7, 30, 90] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={rangeDays === r ? 'on' : ''}
              onClick={() => setRangeDays(r)}
            >
              {t(`Last ${r}d`, `近 ${r} 天`)}
            </button>
          ))}
        </div>

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
                  onClick={() => {
                    setFilterPlatforms((prev) => {
                      const next = new Set(prev);
                      if (next.has(p)) {
                        if (next.size > 1) next.delete(p);
                      } else {
                        next.add(p);
                      }
                      return next;
                    });
                  }}
                >
                  <span style={{ flex: 1, textTransform: p === 'x' ? 'uppercase' : 'capitalize' }}>{p}</span>
                  {filterPlatforms.has(p) && <Check size={13} color="var(--wb-purple)" />}
                </button>
              ))}
            </div>
          )}
        </div>

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

        <span className="fb-note">
          <i className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: colors.teal, display: 'inline-block' }} />
          {t('UTC Grouping Sets · stored_sample', 'UTC 聚合口径 · stored_sample')}
        </span>

        <button
          type="button"
          className="icon-square"
          style={{ width: 30, height: 30 }}
          onClick={() => {
            setRefreshSpin(true);
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
            <button type="button" className="ds-btn" onClick={openCreate}>
              <Plus size={14} />
              <span>{t('Create First Project', '创建首个监测项目')}</span>
            </button>
          )}
        </div>
      )}

      {selectedProject && overview && (
        <div className="ds-grid">
          {/* 1. Four-Cell KPI Strip with pure-SVG Sparklines */}
          <div className="c12">
            <div className="kpi-strip">
              <div className="kpi">
                <div className="kpi-top">
                  <span className="kpi-label">
                    <MessageSquare size={12} />
                    {overview.threadAware ? t('Deduplicated Threads', '已存命中内容') : t('Content Anchors', '内容锚点')}
                  </span>
                  <span className="tag tag--lilac" style={{ height: 18, fontSize: 9, padding: '0 6px' }}>
                    {overview.coverage}
                  </span>
                </div>
                <div className="kpi-val tabular-nums">{overview.contentCount.toLocaleString()}</div>
                <div className="kpi-foot">
                  <span className="kpi-sub">
                    {overview.threadAware ? t('Root-deduplicated', '已按讨论根去重') : t('All visible rows', '全量可见记录')}
                  </span>
                  <KpiSparkChart values={daySeriesValues} color={colors.purple} />
                </div>
              </div>

              <div className="kpi">
                <div className="kpi-top">
                  <span className="kpi-label">
                    <Target size={12} />
                    {t('Matched Nodes', '命中节点')}
                  </span>
                </div>
                <div className="kpi-val tabular-nums">{overview.matchedContentCount.toLocaleString()}</div>
                <div className="kpi-foot">
                  <span className="kpi-sub">
                    {t('Thread-aware:', '树感知：')} {String(overview.threadAware)}
                  </span>
                  <KpiSparkChart values={daySeriesValues} color={colors.teal} />
                </div>
              </div>

              <div className="kpi">
                <div className="kpi-top">
                  <span className="kpi-label">
                    <Zap size={12} />
                    {t('Pain Signals', '痛点讨论')}
                  </span>
                  {unknownRow && (
                    <span className="tag tag--apricot" style={{ height: 18, fontSize: 9, padding: '0 6px' }}>
                      day=null: {unknownRow.count}
                    </span>
                  )}
                </div>
                <div className="kpi-val tabular-nums">{painCount.toLocaleString()}</div>
                <div className="kpi-foot">
                  <span className="kpi-sub">
                    {painRatio}% {t('of loaded sample', '占已加载样本')}
                  </span>
                  <KpiSparkChart values={daySeriesValues} color={colors.apricot} />
                </div>
              </div>

              <div className="kpi">
                <div className="kpi-top">
                  <span className="kpi-label">
                    <Database size={12} />
                    {t('Active Sources', '绑定来源')}
                  </span>
                </div>
                <div className="kpi-val tabular-nums">
                  {selectedProject.source_ids.length}
                  <small>/ {sources.length}</small>
                </div>
                <div className="kpi-foot">
                  <span className="tag tag--mint" style={{ height: 20, fontSize: 9.5 }}>
                    <ShieldCheck size={11} />
                    {overview.providers.length} {t('providers', '个渠道')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Daily Volume Trend (c8) + Project Scope Summary (c4) */}
          <div className="c8" id="card-trend">
            <div className="ds-card" style={{ height: '100%' }}>
              <DailyTrendChart
                facets={overview.facets}
                dayPlatformFacets={overview.dayPlatformFacets}
                rangeDays={rangeDays}
                threadAware={overview.threadAware}
                includePushInTrends={selectedProject.include_push_in_trends}
                onSelectDayPlatform={(dayIso, plat) => {
                  const from = `${dayIso}T00:00:00.000Z`;
                  const fromMs = Date.parse(from);
                  if (!Number.isFinite(fromMs)) return;
                  const to = new Date(fromMs + 86_400_000).toISOString();
                  const qs = new URLSearchParams({ from, to });
                  if (plat) qs.set('platform', plat);
                  onDrilldown(selectedProject.id, qs.toString());
                }}
              />
            </div>
          </div>

          <div className="c4" id="card-scope">
            <div className="ds-card" style={{ height: '100%' }}>
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title">
                    <ShieldCheck size={14} color={colors.purple} />
                    <span>{t('Project Filter & Scope', '项目固化口径与来源')}</span>
                  </div>
                  <div className="ds-card-sub">{t('Read-only rules evaluated on stored_sample', '仅作用于已存样本聚合与钻取')}</div>
                </div>
              </div>
              <div className="ds-card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5 }}>
                <div className="toggle-line" style={{ borderBottom: '1px solid #f4f6ef' }}>
                  <span>{t('Thread Folding', '讨论树去重')}</span>
                  <span className="tag tag--line">{String(selectedProject.thread_aware)}</span>
                </div>
                <div className="toggle-line" style={{ borderBottom: '1px solid #f4f6ef' }}>
                  <span>{t('Include Push in Trends', '趋势纳入导入样本')}</span>
                  <span className={`tag ${selectedProject.include_push_in_trends ? 'tag--mint' : 'tag--line'}`}>
                    {String(selectedProject.include_push_in_trends)}
                  </span>
                </div>
                <div className="toggle-line" style={{ borderBottom: '1px solid #f4f6ef' }}>
                  <span>{t('Match Scope', '匹配范围')}</span>
                  <span className="tag tag--line">{selectedProject.filter.searchScope || 'title_text'}</span>
                </div>
                {overview.resolvedFilter.anyTerms && overview.resolvedFilter.anyTerms.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10.5, color: 'var(--faint)', marginBottom: 4 }}>OR (anyTerms)</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {overview.resolvedFilter.anyTerms.map((term) => (
                        <span key={term} className="tag tag--lilac">{term}</span>
                      ))}
                    </div>
                  </div>
                )}
                {overview.resolvedFilter.allTerms && overview.resolvedFilter.allTerms.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10.5, color: 'var(--faint)', marginBottom: 4 }}>AND (allTerms)</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {overview.resolvedFilter.allTerms.map((term) => (
                        <span key={term} className="tag tag--mint">{term}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="ds-card-ft">
                <span>rev {selectedProject.revision}</span>
                <button type="button" onClick={() => onDrilldown(selectedProject.id)}>
                  {t('Inspect in Explorer →', '在内容库钻取 →')}
                </button>
              </div>
            </div>
          </div>

          {/* 3. Platform (c5) + Kind (c4) + Attribution (c3) */}
          <DistributionCards
            facets={overview.facets}
            providers={overview.providers}
            contentItems={filteredContent}
            onDrillPlatform={(plat) => onDrilldown(selectedProject.id, `platform=${plat}`)}
          />

          {/* 4. High-Signal Discussions Table (c12) */}
          <div className="c12" id="card-table">
            <div className="ds-card">
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title">
                    <MessageSquare size={14} color="var(--faint)" />
                    <span>{t('Matched Discussions', '命中讨论样本')}</span>
                  </div>
                  <div className="ds-card-sub">
                    {t('Click any row to open observation snapshots and thread hierarchy in Content Library', '点击行即可在内容库抽屉中查看观测快照与评论树')}
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
                <table className="tbl">
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
                    {filteredContent.slice(0, 8).map((item) => {
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
                          <td className="num tabular-nums">
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
                              {score.toLocaleString()}
                            </span>
                            <span className="t-meta">{comments} {t('replies', '评论')}</span>
                          </td>
                          <td className="num tabular-nums">
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: item.publishedAt ? 'var(--faint)' : '#a8762c' }}>
                              {item.publishedAt ? item.publishedAt.slice(5, 10) : 'null'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="ds-card-ft">
                <span>
                  {t('Showing up to 8 of', '展示前 8 /')} {filteredContent.length} {t('items in stored_sample', '条命中样本')}
                </span>
                <button type="button" onClick={() => onDrilldown(selectedProject.id)}>
                  {t('Open Content Library →', '进入内容库 →')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 14, lineHeight: 1.65 }}>
        {t(
          'Methodology: Trend charts cover stored_sample online pull nodes unless include_push_in_trends=true; items with publishedAt=null stay out of UTC day buckets; daily deduplicated thread_aware anchor counts are non-additive across days.',
          '口径说明：本页趋势基于 stored_sample 口径；day=null 的发布时间未知内容不计入 UTC 日时间轴；thread_aware=true 模式下各日去重锚点数不可直接相加作为期间去重总和。',
        )}
      </p>

      {/* Create / Edit Project Modal */}
      {modalMode && (
        <div className="sr-modal-backdrop" onClick={() => setModalMode(null)}>
          <div className="sr-modal" style={{ width: 'min(640px, 100%)', padding: '22px 26px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 650 }}>
                {modalMode === 'create' ? t('Create Monitoring Project', '新建监测项目') : t('Edit Project', '编辑监测项目')}
              </h3>
              <button type="button" className="sr-btn sr-btn--subtle sr-btn--xs" onClick={() => setModalMode(null)}>
                <X size={15} />
              </button>
            </div>

            <div className="wb-alert wb-alert--info" style={{ marginBottom: 14 }}>
              {t(
                'Project rules govern analytics & drilldown only — never rewrites source crawl targets or triggers paid runs.',
                '项目固化过滤条件仅作用于已存数据统计聚合与钻取，不会改写来源采集词，也不会主动触发付费抓取。',
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
                <label htmlFor="proj-name">{t('Project Name (1..100 chars)', '研究主题')}</label>
                <input id="proj-name" className="wb-input" value={formName} onChange={(e) => setFormName(e.target.value)} maxLength={100} required />
              </div>

              <div className="wb-field">
                <label>{t('Bound Sources (min 1)', '绑定监测来源（至少 1 个）')}</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, maxHeight: 130, overflowY: 'auto', padding: 8, border: '1px solid var(--line)', borderRadius: 6 }}>
                  {sources.map((s) => {
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
                        <span>{s.label} ({s.delivery_mode})</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="wb-grid-2">
                <div className="wb-field">
                  <label htmlFor="proj-any">{t('anyTerms (OR, comma separated)', '任一提及')}</label>
                  <input id="proj-any" className="wb-input" value={formAnyTerms} onChange={(e) => setFormAnyTerms(e.target.value)} placeholder="pricing, 算力, o3" />
                </div>
                <div className="wb-field">
                  <label htmlFor="proj-all">{t('allTerms (AND, comma separated)', '全部命中 AND')}</label>
                  <input id="proj-all" className="wb-input" value={formAllTerms} onChange={(e) => setFormAllTerms(e.target.value)} placeholder="kubernetes" />
                </div>
              </div>

              <div className="wb-grid-2">
                <div className="wb-field">
                  <label htmlFor="proj-not">{t('exclusions (NOT)', '排除词')}</label>
                  <input id="proj-not" className="wb-input" value={formExclusions} onChange={(e) => setFormExclusions(e.target.value)} placeholder="hiring, sponsorship" />
                </div>
                <div className="wb-field">
                  <label htmlFor="proj-scope">{t('Search Scope', '词项匹配范围')}</label>
                  <select id="proj-scope" className="wb-select" value={formScope} onChange={(e) => setFormScope(e.target.value as SearchScope)}>
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
                    <option value="web">web</option>
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
                  <span>{t('Include push samples in trends (include_push_in_trends)', '统计纳入导入样本')}</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>
                  {modalMode === 'edit' ? `Optimistic lock rev ${formRevision}` : t('Supports CJK bigrams and short model codes', '支持中英文短词与代码词检索')}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setModalMode(null)}>
                    {t('Cancel', '取消')}
                  </button>
                  <button type="submit" className="ds-btn">
                    {modalMode === 'create' ? t('Save Project', '保存项目') : t('Save Project', '保存项目')}
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
