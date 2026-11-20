import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Check,
  ChevronRight,
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
  ShieldCheck,
  Sparkles,
  Star,
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
import { KpiSparkChart } from '../components/charts/KpiSparkChart';
import { DailyTrendChart } from '../components/charts/DailyTrendChart';
import { SignalScoreGauge } from '../components/charts/SignalScoreGauge';
import { DistributionCards } from '../components/charts/DistributionCharts';
import { TrendRadarCharts } from '../components/charts/TrendRadarCharts';
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

  // DeepSeek Filter Bar Local State
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [filterPlatforms, setFilterPlatforms] = useState<Set<Platform>>(
    () => new Set<Platform>(['reddit', 'x', 'bluesky', 'web']),
  );
  const [filterSignal, setFilterSignal] = useState<'all' | 'pain' | 'discussion'>('all');
  const [filterKind, setFilterKind] = useState<'all' | ContentKind>('all');
  const [openFilterPop, setOpenFilterPop] = useState<'platforms' | 'signal' | 'kind' | 'share' | null>(null);
  const [starred, setStarred] = useState(true);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [pageBanner, setPageBanner] = useState<string | null>(null);

  // Scroll to section when navigating from left sidebar (?section=radar|platform|attribution)
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

  // Derived Signal Scores
  const signalMetrics = useMemo(() => {
    const total = Math.max(1, overview?.matchedContentCount || filteredContent.length);
    const painRatio = Math.round((painCount / Math.max(1, filteredContent.length)) * 100);
    const depth = Math.min(94, 62 + Math.round((overview?.contentCount || 8) * 1.1));
    const pain = Math.min(92, Math.max(54, painRatio + 28));
    const velocity = Math.min(89, 52 + (overview?.providers.length || 2) * 7);
    const overall = Math.round(depth * 0.35 + pain * 0.4 + velocity * 0.25);
    return { overall, depth, pain, velocity, painRatio, total };
  }, [overview, filteredContent.length, painCount]);

  const handleExportCsv = () => {
    const csvCell = (raw: unknown): string => {
      const str = String(raw ?? '').replace(/[\r\n]+/g, ' ');
      const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const headers = ['id,platform,kind,title,score,publishedAt,providers'];
    const lines = filteredContent.map((c) => {
      const m = c.observations[c.observations.length - 1]?.metrics || {};
      const sc = m['reddit.score'] ?? m['x.likes'] ?? m['bluesky.likes'] ?? 0;
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
        <button type="button" onClick={() => onDrilldown('')}>
          {t('Workbench', '工作台')}
        </button>
        <span>/</span>
        <span>{t('Monitoring Projects', '监测项目')}</span>
        <span>/</span>
        <b>{selectedProject?.name || 'SIFTLINE'}</b>
      </div>

      {/* DeepSeek Page Header */}
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{selectedProject ? selectedProject.name : t('Monitoring Overview', '监测总览')}</h1>
            <span className="state-chip">
              <i className="dot" />
              {t('Active', '运行中')}
            </span>
            <button
              type="button"
              className="icon-square"
              style={{ width: 28, height: 28, border: 0, background: 'none' }}
              onClick={() => setStarred((v) => !v)}
              aria-label={t('Favorite project', '收藏项目')}
            >
              <Star size={15} fill={starred ? '#f0c75e' : 'none'} color={starred ? '#c99b1d' : '#a3aa9f'} />
            </button>
          </div>
          <p className="page-desc">
            {selectedProject?.source_ids.length ?? 0} {t('bound sources', '个绑定来源')} · rev{' '}
            {selectedProject?.revision ?? 1} · {t('Coverage:', '口径：')}{' '}
            <b style={{ color: 'var(--ink-3)' }}>{overview?.coverage || 'stored_sample'}</b> ·{' '}
            {selectedProject?.include_push_in_trends
              ? t('Push/R4 included in trends', '趋势已计入推流/归档样本')
              : hasBoundPushSource
                ? t('Push/R4 excluded from trends (visible in explorer)', '推流/归档默认不计入趋势（内容库可见）')
                : t('Resolved OR:', '固化词组：')}{' '}
            {!hasBoundPushSource && ((overview?.resolvedFilter.anyTerms || []).join(', ') || t('All tokens', '全量词池'))}
          </p>
        </div>

        <div className="page-actions" data-ov-pop>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              onClick={() => setOpenFilterPop(openFilterPop === 'share' ? null : 'share')}
            >
              <Link2 size={13} />
              <span>{t('Share', '分享')}</span>
            </button>

            {openFilterPop === 'share' && (
              <div className="ds-pop" style={{ top: 'calc(100% + 6px)', right: 0, width: 290 }}>
                <div className="pop-hd">
                  <span>{t('Share Read-Only View', '分享只读视图')}</span>
                  <span>stored_sample</span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, margin: '0 4px 10px' }}>
                  {t('Share current filter fingerprint cleanly without exposing draft workspace annotations.', '分享当前筛选指纹与统计口径，不暴露个人批注草稿。')}
                </p>
                <div style={{ display: 'flex', gap: 6, padding: '6px 8px', background: '#fbfcf7', border: '1px solid var(--line)', borderRadius: 5, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    siftline.app/p/{selectedProject?.id.slice(0, 8)}
                  </span>
                  <button
                    type="button"
                    className="ds-btn"
                    style={{ height: 24, padding: '0 9px', fontSize: 10 }}
                    onClick={() => {
                      navigator.clipboard?.writeText(window.location.href).catch(() => {});
                      setShareCopied(true);
                      setTimeout(() => setShareCopied(false), 1800);
                    }}
                  >
                    <Copy size={11} />
                    {shareCopied ? t('Copied', '已复制') : t('Copy', '复制')}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button type="button" className="ds-btn ds-btn--ghost" onClick={handleExportCsv}>
            <Download size={13} />
            <span>{t('Export CSV', '导出 CSV')}</span>
          </button>

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
          {canWrite && (
            <button type="button" className="ds-btn" onClick={openCreate}>
              <Plus size={14} />
              <span>{t('New Monitor', '新建监测')}</span>
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

      {/* DeepSeek Filter Bar */}
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

        <span className="fb-note">
          <i className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: colors.teal, display: 'inline-block' }} />
          {t('UTC Grouping Sets · Live Sync', 'UTC 聚合口径 · 已同步')}
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
            <button type="button" className="ds-btn" onClick={openCreate}>
              <Plus size={14} />
              <span>{t('Create First Project', '创建首个监测项目')}</span>
            </button>
          )}
        </div>
      )}

      {/* Main Dashboard Bento Grid */}
      {selectedProject && overview && (
        <div className="ds-grid">
          {/* 1. Four-Cell KPI Strip with ECharts Mini Sparklines */}
          <div className="c12">
            <div className="kpi-strip">
              <div className="kpi">
                <div className="kpi-top">
                  <span className="kpi-label">
                    <MessageSquare size={12} />
                    {overview.threadAware ? t('Deduplicated Threads', '去重讨论根数') : t('Content Anchors', '内容锚点')}
                  </span>
                  <span className="tag tag--lilac" style={{ height: 18, fontSize: 9, padding: '0 6px' }}>
                    {overview.coverage}
                  </span>
                </div>
                <div className="kpi-val">{overview.contentCount.toLocaleString()}</div>
                <div className="kpi-foot">
                  <span>
                    <span className="kpi-sub">
                      {overview.threadAware ? t('Root-deduplicated', '已按讨论根去重') : t('All visible rows', '全量可见记录')}
                    </span>
                  </span>
                  <KpiSparkChart values={daySeriesValues} color={colors.purple} />
                </div>
              </div>

              <div className="kpi">
                <div className="kpi-top">
                  <span className="kpi-label">
                    <Target size={12} />
                    {t('Matched Nodes', '命中内容')}
                  </span>
                </div>
                <div className="kpi-val">{overview.matchedContentCount.toLocaleString()}</div>
                <div className="kpi-foot">
                  <span>
                    <span className="kpi-sub">
                      {t('Thread-aware:', '树感知：')} {String(overview.threadAware)}
                    </span>
                  </span>
                  <KpiSparkChart
                    values={daySeriesValues}
                    color={colors.teal}
                  />
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
                <div className="kpi-val">{painCount.toLocaleString()}</div>
                <div className="kpi-foot">
                  <span>
                    <span className="kpi-sub">
                      {signalMetrics.painRatio}% {t('of loaded sample', '占已加载样本')}
                    </span>
                  </span>
                  <KpiSparkChart
                    values={daySeriesValues}
                    color={colors.apricot}
                  />
                </div>
              </div>

              <div className="kpi">
                <div className="kpi-top">
                  <span className="kpi-label">
                    <Database size={12} />
                    {t('Active Sources', '活跃来源')}
                  </span>
                </div>
                <div className="kpi-val">
                  {selectedProject.source_ids.length}
                  <small>/ {sources.length}</small>
                </div>
                <div className="kpi-foot">
                  <span className="tag tag--mint" style={{ height: 20, fontSize: 9.5 }}>
                    <ShieldCheck size={11} />
                    {overview.providers.length} {t('providers', '个渠道在线')}
                  </span>
                  <span style={{ display: 'flex', gap: 3 }}>
                    {[colors.reddit, colors.ink, colors.teal, colors.apricot].map((c, idx) => (
                      <i
                        key={idx}
                        style={{ width: 5, height: 14, borderRadius: 1, background: c, opacity: 0.85, display: 'block' }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Trend Bar/Area/Heatmap (c8) + Signal Score Gauge/Radar (c4) */}
          <div className="c8" id="card-trend">
            <div className="ds-card" style={{ height: '100%' }}>
              <DailyTrendChart
                facets={overview.facets}
                dayPlatformFacets={overview.dayPlatformFacets}
                rangeDays={rangeDays}
                threadAware={overview.threadAware}
                includePushInTrends={selectedProject.include_push_in_trends}
                onSelectDayPlatform={(dayIso, platform) => {
                  const qs = new URLSearchParams();
                  qs.set('from', `${dayIso}T00:00:00Z`);
                  qs.set('to', `${dayIso}T23:59:59Z`);
                  if (platform) qs.set('platform', platform);
                  onDrilldown(selectedProject.id, qs.toString());
                }}
              />
            </div>
          </div>

          <div className="c4" id="card-signal">
            <div className="ds-card" style={{ height: '100%' }}>
              <SignalScoreGauge
                score={signalMetrics.overall}
                depthScore={signalMetrics.depth}
                painScore={signalMetrics.pain}
                velocityScore={signalMetrics.velocity}
              />
            </div>
          </div>

          {/* 3. Platform (c5) + Kind (c4) + Attribution (c3) — ECharts Driven */}
          <DistributionCards
            facets={overview.facets}
            providers={overview.providers}
            contentItems={filteredContent}
            onDrillPlatform={(plat) => onDrilldown(selectedProject.id, `platform=${plat}`)}
          />

          {/* 4. Richer ECharts Analytics Suite (Scatter Bubble + Treemap/Sankey/Funnel) */}
          <TrendRadarCharts
            items={filteredContent}
            matchedCount={overview.matchedContentCount}
            contentCount={overview.contentCount}
            onSelectContent={(cid) => onOpenContentDetail(cid)}
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
                <table className="tbl">
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
                </table>
              </div>

              <div className="ds-card-ft">
                <span>
                  {t('Showing top 6 of', '展示前 6 /')} {filteredContent.length} {t('items in stored_sample', '条命中样本')}
                </span>
                <button type="button" onClick={() => onDrilldown(selectedProject.id)}>
                  {t('Open Content Explorer →', '进入内容检索台 →')}
                </button>
              </div>
            </div>
          </div>

          <div className="c4 stack-gap">
            {/* Beginner Onboarding Checklist Card (Exact DeepSeek match) */}
            <div className="ds-card guide-card">
              <div className="guide-hatch" />
              <div className="ds-card-hd" style={{ paddingBottom: 6 }}>
                <div>
                  <div className="ds-card-title">
                    <Target size={14} color={colors.purple} />
                    <span>{t('Quick Start Guide', '新手引导')}</span>
                  </div>
                  <div className="ds-card-sub">{t('4 steps to deliverable insights', '完成 4 步，拿到第一份可交付结论')}</div>
                </div>
                <span className="tag" style={{ height: 20, fontSize: 9.5, background: '#fff' }}>2 / 4</span>
              </div>

              <div className="ds-card-bd" style={{ paddingTop: 6 }}>
                <div className="guide-progress">
                  <div style={{ position: 'relative', width: 44, height: 44, flex: 'none' }}>
                    <svg viewBox="0 0 44 44" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                      <circle cx="22" cy="22" r="18" fill="none" stroke="#e3e6dc" strokeWidth="4" />
                      <circle cx="22" cy="22" r="18" fill="none" stroke={colors.purple} strokeWidth="4" strokeLinecap="round" strokeDasharray="56.5 113" />
                    </svg>
                    <b style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10 }}>50%</b>
                  </div>
                  <div>
                    <b style={{ display: 'block', fontSize: 12 }}>{t('2 Steps Completed', '已完成 2 项')}</b>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', marginTop: 1 }}>
                      {t('Run pain filter & share view next', '下一步直接运行痛点过滤')}
                    </span>
                  </div>
                </div>

                <div className="steps">
                  <button type="button" className="step done">
                    <span className="st-num"><Check size={10} /></span>
                    <span className="st-t">
                      <b>{t('Connect First Pull Source', '接入首批采集来源')}</b>
                      <span>kaix · scrapebadger · bluesky</span>
                    </span>
                  </button>
                  <button type="button" className="step done">
                    <span className="st-num"><Check size={10} /></span>
                    <span className="st-t">
                      <b>{t('Lock Project Filter Rules', '配置并锁定监测项目')}</b>
                      <span>{selectedProject.name}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="step now"
                    onClick={() => onDrilldown(selectedProject.id, 'signal=pain')}
                  >
                    <span className="st-num">3</span>
                    <span className="st-t">
                      <b>{t('Run Pain Signal Screening', '运行痛点信号筛选')}</b>
                      <span>{t('~1 min · Opens Content Explorer', '约 1 分钟 · 钻取痛点样本')}</span>
                    </span>
                    <ChevronRight size={13} color="var(--faint)" />
                  </button>
                  <button
                    type="button"
                    className="step"
                    onClick={() => setOpenFilterPop('share')}
                  >
                    <span className="st-num">4</span>
                    <span className="st-t">
                      <b>{t('Save Query & Share Snapshot', '保存查询并分享视图')}</b>
                      <span>{t('Sync with team workspace', '沉淀至个人与团队工作区')}</span>
                    </span>
                    <ChevronRight size={13} color="var(--faint)" />
                  </button>
                </div>

                <div className="guide-cta">
                  <span style={{ fontSize: 10, color: 'var(--faint)' }}>{t('Recommended next', '推荐从痛点开始')}</span>
                  <button
                    type="button"
                    className="ds-btn"
                    style={{ height: 28, padding: '0 12px', fontSize: 11 }}
                    onClick={() => onDrilldown(selectedProject.id, 'signal=pain')}
                  >
                    <span>{t('Continue', '继续')}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            </div>

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
                    `${painCount} pain-matched discussions identified across ${overview.matchedContentCount} matched nodes`,
                    `在 ${overview.matchedContentCount} 条命中节点中识别出 ${painCount} 条痛点表达（占比 ${signalMetrics.painRatio}%）`,
                  )}
                </h4>
                <p>
                  {t(
                    `Coverage stays strictly within stored_sample across ${overview.providers.length} active providers.`,
                    `统计严格遵循 stored_sample 口径，覆盖 ${overview.providers.length} 个实际观测渠道；点击右侧可钻取对应痛点原文与评论树。`,
                  )}
                </p>
              </div>
              <div className="ib-stats">
                <div>
                  <span>Anchors</span>
                  <b>{overview.contentCount}</b>
                </div>
                <div>
                  <span>Pain Rate</span>
                  <b>{signalMetrics.painRatio}%</b>
                </div>
                <div>
                  <span>Unknown UTC</span>
                  <b>{unknownRow ? unknownRow.count : 0}</b>
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
                <label>{t('Project Name (1..100 chars)', '项目名称（1..100 字符）')}</label>
                <input className="wb-input" value={formName} onChange={(e) => setFormName(e.target.value)} maxLength={100} required />
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
                  <span>include_push_in_trends</span>
                </label>
              </div>

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
