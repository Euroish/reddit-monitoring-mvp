import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Check,
  FolderPlus,
  Layers,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  formatApiError,
  useAttachProjectBatchMutation,
  useBatchesQuery,
  useDiscardBatchMutation,
  useMoveProjectBatchMutation,
  useProjectBatchesQuery,
  useRecentJobsQuery,
  useUpdateProjectBatchStatusMutation,
} from '../api/hooks';
import { Badge } from './ui/badge';
import { Table } from './ui/table';
import { MonitorSchedulePanel } from './MonitorSchedulePanel';
import type {
  Actor,
  CollectionBatchDto,
  IntelMonitorDto,
  Project,
  ProjectBatchDto,
  QuotasSummaryResponse,
  RecentJobDto,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function ProjectListView({
  projects,
  activeProjectId,
  maxProjects,
  isViewer,
  monitors = [],
  onSelect,
  onCreate,
}: {
  projects: Project[];
  activeProjectId?: string;
  maxProjects?: number;
  isViewer: boolean;
  monitors?: IntelMonitorDto[];
  onSelect: (project: Project) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const mine = projects.filter((p) => !p.is_shared);
  const shared = projects.filter((p) => p.is_shared);
  const atLimit = isViewer && maxProjects !== undefined && mine.length >= maxProjects;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="ds-card">
        <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="ds-card-title">{t('All Research Projects', '全部研究项目')}</div>
            <div className="ds-card-sub">
              {isViewer && maxProjects !== undefined
                ? t(`My projects: ${mine.length} / ${maxProjects} (plan limit)`, `我的私有项目：${mine.length} / ${maxProjects}（当前套餐上限）`)
                : t(`${projects.length} accessible projects`, `共 ${projects.length} 个可访问项目`)}
            </div>
          </div>
          <button type="button" className="ds-btn" disabled={atLimit} onClick={onCreate}>
            <Plus size={14} />
            <span>{atLimit ? t('Project limit reached', '已达项目数上限') : t('Create Research Project', '新建研究项目')}</span>
          </button>
        </div>
        <div className="ds-card-bd" style={{ display: 'grid', gap: 16 }}>
          {mine.length > 0 && (
            <section style={{ display: 'grid', gap: 8 }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{t('My Projects', '我的项目')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {mine.map((p) => {
                  const boundMon = monitors.find((m) => m.projectId === p.id || p.linked_monitor_id === m.id);
                  const ds = p.data_summary;
                  return (
                  <button
                    key={p.id}
                    type="button"
                    className="ds-card"
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderColor: p.id === activeProjectId ? 'var(--wb-purple)' : undefined,
                    }}
                    onClick={() => onSelect(p)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 13 }}>{p.name}</b>
                      <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                        <span className="tag" style={{ fontSize: 10 }}>{t('Private', '私有')}</span>
                        {boundMon && (
                          <span className={`tag ${boundMon.enabled ? 'tag--mint' : 'tag--line'}`} style={{ fontSize: 10 }}>
                            {boundMon.enabled ? `Auto · ${boundMon.scheduleIntervalHours}h` : t('Paused', '已暂停')}
                          </span>
                        )}
                        <span className="tag tag--lilac" style={{ fontSize: 10 }}>
                          {p.dataset_mode === 'batch'
                            ? `${ds?.item_count ?? 0} ${t('items', '条')} · ${p.enabled_batch_count ?? 0} ${t('batches', '批次')}`
                            : `${p.source_ids.length} ${t('sources', '来源')}`}
                        </span>
                      </div>
                    </div>
                    {p.description && <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>{p.description}</p>}
                    {(ds?.platforms.length || ds?.source_labels.length) ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {ds.platforms.map((plat) => (
                          <span key={plat} className="tag tag--mint" style={{ fontSize: 10 }}>{plat.toUpperCase()}</span>
                        ))}
                        {ds.source_labels.slice(0, 3).map((label) => (
                          <span key={label} className="tag" style={{ fontSize: 10 }}>{label}</span>
                        ))}
                        {ds.source_labels.length > 3 && (
                          <span className="tag" style={{ fontSize: 10 }}>+{ds.source_labels.length - 3}</span>
                        )}
                      </div>
                    ) : null}
                  </button>
                  );
                })}
              </div>
            </section>
          )}
          {shared.length > 0 && (
            <section style={{ display: 'grid', gap: 8 }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{t('Shared Team Projects', '共享研究项目')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {shared.map((p) => {
                  const ds = p.data_summary;
                  return (
                  <button
                    key={p.id}
                    type="button"
                    className="ds-card"
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderColor: p.id === activeProjectId ? 'var(--wb-purple)' : undefined,
                    }}
                    onClick={() => onSelect(p)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 13 }}>{p.name}</b>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <span className="tag" style={{ fontSize: 10 }}>
                          {p.can_edit ? t('Shared', '共享') : t('Read-only', '只读')}
                        </span>
                        <span className="tag tag--lilac" style={{ fontSize: 10 }}>
                          {p.dataset_mode === 'batch'
                            ? `${ds?.item_count ?? 0} ${t('items', '条')} · ${p.enabled_batch_count ?? 0} ${t('batches', '批次')}`
                            : `${p.source_ids.length} ${t('sources', '来源')}`}
                        </span>
                      </div>
                    </div>
                    {p.description && <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>{p.description}</p>}
                    {(ds?.platforms.length || ds?.source_labels.length) ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {ds.platforms.map((plat) => (
                          <span key={plat} className="tag tag--mint" style={{ fontSize: 10 }}>{plat.toUpperCase()}</span>
                        ))}
                        {ds.source_labels.slice(0, 3).map((label) => (
                          <span key={label} className="tag" style={{ fontSize: 10 }}>{label}</span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                  );
                })}
              </div>
            </section>
          )}
          {projects.length === 0 && (
            <p className="collection-hint">{t('No research projects yet. Create your first empty project to begin.', '还没有研究项目。点击右上角「新建研究项目」开始你的第一项研究。')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectJobsView({
  actor,
  project,
  quota,
  monitors = [],
  jobId,
  onNavigate,
  onOpenAnalytics,
}: {
  actor?: Actor;
  project: Project;
  quota?: QuotasSummaryResponse;
  monitors?: IntelMonitorDto[];
  jobId?: string;
  onNavigate: (path: string) => void;
  onOpenAnalytics?: (monitorId: string) => void;
}) {
  const { t } = useI18n();
  const jobsQuery = useRecentJobsQuery({ projectId: project.id, jobId, limit: jobId ? 1 : 50 }, true);
  const queryClient = useQueryClient();
  const completedBatchId = jobsQuery.data?.jobs.find(job => job.id === jobId &&
    ['succeeded', 'completed', 'failed'].includes(job.status))?.batchId;
  useEffect(() => {
    if (!completedBatchId) return;
    void queryClient.invalidateQueries({ queryKey: ['projectBatches', project.id] });
    void queryClient.invalidateQueries({ queryKey: ['overview', project.id] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['content'] });
    void queryClient.invalidateQueries({ queryKey: ['batches'] });
  }, [queryClient, project.id, completedBatchId]);
  const jobs = jobsQuery.data?.jobs ?? [];
  const scheduledJobs = jobs.filter((j) => j.purpose === 'scheduled');
  const oneOffJobs = jobs.filter((j) => j.purpose !== 'scheduled');
  const projectPath = `&projectId=${encodeURIComponent(project.id)}`;
  const statusLabels: Record<string, string> = {
    queued: t('Queued', '已排队'), running: t('Running', '采集中'), retrying: t('Waiting to retry', '等待重试'),
    succeeded: t('Succeeded', '已成功'), completed: t('Completed', '已完成'), failed: t('Failed', '失败'),
    cancelled: t('Cancelled', '已取消'), blocked: t('Blocked', '已阻断'),
  };

  const renderJobList = (list: RecentJobDto[], emptyText: string, badgeLabel: string) => {
    if (jobsQuery.isPending) {
      return <p className="collection-hint">{t('Loading project jobs…', '正在加载项目任务…')}</p>;
    }
    if (jobsQuery.isError) {
      return <p role="alert">{formatApiError(jobsQuery.error)}</p>;
    }
    if (list.length === 0) {
      return <p className="collection-hint">{emptyText}</p>;
    }
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {list.map((job) => (
          <div key={job.id} className="job-row intake-job-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 12 }}>
                  [{job.platform.toUpperCase()}] {job.sourceLabel}
                </b>
                <span className="tag" style={{ fontSize: 10 }}>
                  {badgeLabel}
                </span>
              </div>

              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {job.createdAt.slice(0, 16).replace('T', ' ')} UTC · {t('Processed / Inserted / Updated', '处理/新增/更新')}: {job.recordsProcessed} / +{job.recordsInserted} / ~{job.recordsUpdated}
              </div>
              {job.status === 'queued' && <p role="status">{t('Waiting for a collection worker. This page updates automatically.', '等待开始采集。此处会自动更新。')}</p>}
              {job.status === 'running' && <p role="status">{t('Collecting and saving available results.', '正在采集并保存可用结果。')}</p>}
              {job.status === 'retrying' && <p role="status">{t('Waiting for an automatic retry.', '正在等待系统重试。')}</p>}
              {job.status === 'failed' && <p className="collection-hint">{job.phase === 'unknown' || job.phase === 'starting'
                ? t('The service charge is unresolved. Ask an administrator to review it before starting another collection.', '服务额度消耗待核实。开始下一次采集前，请联系管理员核对。')
                : t('This collection did not finish. Review the details before starting again.', '此次采集未完成。请先查看详情，再决定是否重新采集。')}</p>}
              {jobId && (job.error || job.finishedAt) && <details className="source-detail-disclosure">
                <summary>{t('Collection details', '采集详情')}</summary>
                <p><code>{job.id}</code></p>{job.error && <p>{job.error}</p>}
              </details>}
            </div>
            <Badge className={`chip-state ${job.status === 'succeeded' ? 'active' : job.status === 'running' ? 'paused' : 'archived'}`}>
              {statusLabels[job.status] ?? t('Status unavailable', '状态暂不可用')}
            </Badge>
            {job.batchId && (job.status === 'succeeded' || job.status === 'completed' || job.status === 'failed') && (
              <button
                type="button"
                className="ds-btn ds-btn--ghost"
                style={{ height: 26, fontSize: 11 }}
                onClick={() => onNavigate('/projects?view=batches' + projectPath + '&batchId=' + encodeURIComponent(job.batchId!))}
              >
                <Layers size={12} />
                <span>{t('Manage Batch', '查看批次')}</span>
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  if (jobId) {
    const pinnedIsScheduled = jobs[0]?.purpose === 'scheduled';
    return (
      <div className="ds-card">
        <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <div className="ds-card-title">{t('Collection progress', '本次采集进度')}</div>
            <div className="ds-card-sub">{t('Execution status, errors, and ingested counts for this job.', '仅展示当前任务的采集进度、错误与入库结果。')}</div>
          </div>
          <div className="collection-toolbar">
            <button type="button" className="ds-btn ds-btn--ghost" onClick={() => jobsQuery.refetch()}>
              <RefreshCw size={13} />
              <span>{t('Refresh', '刷新')}</span>
            </button>
            <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate('/projects?view=jobs' + projectPath)}>
              {t('All project jobs', '查看项目全部任务')}
            </button>
          </div>
        </div>
        <div className="ds-card-bd">
          {renderJobList(
            jobs,
            t('This collection is no longer visible to this account.', '当前账号无法查看此采集记录，可返回项目任务。'),
            pinnedIsScheduled ? t('Scheduled Monitor', '持续监测') : t('One-off', '单次采集'),
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Card 1: Continuous Monitoring Schedule & Recurring Collection Jobs */}
      <div className="ds-card">
        <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="ds-card-title">{t(`Continuous Monitoring & Scheduled Jobs · ${project.name}`, `持续监测与自动采集调度 · ${project.name}`)}</div>
            <div className="ds-card-sub">{t('Manage recurring schedules and review jobs triggered automatically by monitors.', '统一管理周期性连续自动监测调度，并单独追踪由持续监测定时触发的采集记录。')}</div>
          </div>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => jobsQuery.refetch()}>
            <RefreshCw size={13} />
            <span>{t('Refresh', '刷新')}</span>
          </button>
        </div>
        <div className="ds-card-bd" style={{ display: 'grid', gap: 14 }}>
          {actor && (
            <MonitorSchedulePanel
              actor={actor}
              project={project}
              quota={quota}
              monitors={monitors}
              onOpenAnalytics={onOpenAnalytics}
            />
          )}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>
              {t('Scheduled Monitoring Runs', '持续监测采集任务记录')} ({scheduledJobs.length})
            </div>
            {renderJobList(
              scheduledJobs,
              t('No scheduled monitoring runs recorded for this project yet.', '当前项目还没有由持续监测自动触发的采集任务记录。'),
              t('Scheduled Monitor', '持续监测'),
            )}
          </div>
        </div>
      </div>

      {/* Card 2: One-off Manual / On-demand Collection Jobs */}
      <div className="ds-card">
        <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="ds-card-title">{t('One-off Collection Jobs', '单次采集任务')} ({oneOffJobs.length})</div>
            <div className="ds-card-sub">{t('Manual and on-demand batch collections or thread hydrations initiated from Data Ingestion.', '由「数据接入」或评论补采手动发起的一次性采集任务记录。')}</div>
          </div>
          <div className="collection-toolbar">
            <button type="button" className="ds-btn ds-btn--ghost" onClick={() => jobsQuery.refetch()}>
              <RefreshCw size={13} />
              <span>{t('Refresh', '刷新')}</span>
            </button>
            {project.can_edit && project.dataset_mode === 'batch' && (
              <button type="button" className="ds-btn" onClick={() => onNavigate('/projects?view=collect' + projectPath)}>
                <Plus size={13} />
                <span>{t('New Collection', '发起新采集')}</span>
              </button>
            )}
          </div>
        </div>
        <div className="ds-card-bd">
          {renderJobList(
            oneOffJobs,
            t('No one-off collection jobs recorded for this project yet.', '当前项目还没有单次采集任务记录。'),
            t('One-off', '单次采集'),
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectBatchesView({
  project,
  batchId,
  allProjects,
  onNavigate,
}: {
  project: Project;
  batchId?: string;
  allProjects: Project[];
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const batchesQuery = useProjectBatchesQuery(project.id, true);
  const canImportIntoProject = Boolean(project.can_edit && project.dataset_mode === 'batch');
  const availableQuery = useBatchesQuery({ forProjectId: project.id, limit: 100 }, canImportIntoProject);
  const updateStatusMut = useUpdateProjectBatchStatusMutation();
  const attachMut = useAttachProjectBatchMutation();
  const moveMut = useMoveProjectBatchMutation();
  const discardMut = useDiscardBatchMutation();
  const [reuseTargetByBatch, setReuseTargetByBatch] = useState<Record<string, string>>({});
  const [poolSearch, setPoolSearch] = useState('');
  const [notice, setNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  const batches = batchesQuery.data?.batches ?? [];
  const sharedBatches = batches.filter((b) => b.visibility !== 'private');
  const privateBatches = batches.filter((b) => b.visibility === 'private');
  const reuseProjects = allProjects.filter((p) => p.id !== project.id && p.can_edit && p.dataset_mode === 'batch');
  const showActions = project.can_edit || (reuseProjects.length > 0 && sharedBatches.length > 0);
  const busy = updateStatusMut.isPending || attachMut.isPending || moveMut.isPending || discardMut.isPending;

  const poolNeedle = poolSearch.trim().toLocaleLowerCase();
  const availableBatches = (availableQuery.data?.batches ?? []).filter(
    (b) =>
      !poolNeedle ||
      `${b.label} ${b.sourceLabel} ${b.platform}`.toLocaleLowerCase().includes(poolNeedle),
  );
  const availableShared = availableBatches.filter((b) => b.visibility === 'shared');
  const availablePrivate = availableBatches.filter((b) => b.visibility === 'private');

  const renderSection = (title: string, sectionBatches: ProjectBatchDto[]) => (
    <div style={{ marginTop: 10 }}>
      <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
        {title} ({sectionBatches.length})
      </h4>
      <div className="collection-table-scroll">
        <Table className="collection-table">
          <thead>
            <tr>
              <th>{t('Batch / Source', '批次与来源')}</th>
              <th>{t('Visibility', '授权范围')}</th>
              <th>{t('Items', '样本数')}</th>
              <th>{t('Collected / Added (UTC)', '采集 / 纳入时间')}</th>
              <th>{t('Status', '项目状态')}</th>
              {showActions && <th className="num">{t('Actions', '操作')}</th>}
            </tr>
          </thead>
          <tbody>
            {sectionBatches.map((b) => {
              const isEnabled = b.status === 'enabled';
              const target = reuseProjects.find((p) => p.id === reuseTargetByBatch[b.batchId]) ?? reuseProjects[0];
              return (
                <tr key={b.batchId} aria-current={b.batchId === batchId ? 'true' : undefined}>
                  <td>
                    <b style={{ display: 'block', fontSize: 12 }}>{b.label}</b>
                    <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                      [{b.platform.toUpperCase()}] {b.sourceLabel}
                    </span>
                  </td>
                  <td>
                    <span className="tag" style={{ fontSize: 10 }}>
                      {b.visibility === 'private' ? t('Private', '私有') : t('Shared', '共享')}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{b.itemCount}</td>
                  <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                    <div>{t('Col', '采')}: {b.createdAt.slice(0, 16).replace('T', ' ')}</div>
                    <div>{t('Add', '入')}: {b.addedAt.slice(0, 16).replace('T', ' ')}</div>
                  </td>
                  <td>
                    <span className={`chip-state ${isEnabled ? 'active' : 'paused'}`}>
                      {isEnabled ? t('Enabled', '已启用') : t('Disabled', '已禁用')}
                    </span>
                  </td>
                  {showActions && (
                    <td className="num">
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {project.can_edit && (
                          <>
                            <button
                              type="button"
                              className="ds-btn ds-btn--ghost"
                              style={{ height: 26, fontSize: 11 }}
                              disabled={busy}
                              onClick={async () => {
                                setNotice(null);
                                try {
                                  await updateStatusMut.mutateAsync({
                                    projectId: project.id,
                                    batchId: b.batchId,
                                    status: isEnabled ? 'disabled' : 'enabled',
                                  });
                                  setNotice({
                                    text: isEnabled
                                      ? t('Batch disabled for this project.', '已在本项目中禁用该批次。')
                                      : t('Batch re-enabled for this project.', '已重新启用该批次。'),
                                  });
                                } catch (err) {
                                  setNotice({ text: formatApiError(err), isError: true });
                                }
                              }}
                            >
                              <Check size={11} />
                              <span>{isEnabled ? t('Disable', '禁用') : t('Enable', '启用')}</span>
                            </button>
                            <button
                              type="button"
                              className="ds-btn ds-btn--ghost"
                              style={{ height: 26, fontSize: 11 }}
                              disabled={busy}
                              onClick={async () => {
                                if (!window.confirm(t(`Unlink batch "${b.label}" from "${project.name}"?`, `确定从项目『${project.name}』移除批次“${b.label}”？`))) return;
                                setNotice(null);
                                try {
                                  await updateStatusMut.mutateAsync({ projectId: project.id, batchId: b.batchId, status: 'removed' });
                                  setNotice({ text: t('Batch unlinked from this project.', '已从本项目移除该批次。') });
                                } catch (err) {
                                  setNotice({ text: formatApiError(err), isError: true });
                                }
                              }}
                            >
                              <span>{t('Unlink', '移除关联')}</span>
                            </button>
                            {b.visibility === 'private' && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--danger"
                                style={{ height: 26, fontSize: 11 }}
                                disabled={busy}
                                onClick={async () => {
                                  if (!window.confirm(t(`Soft-discard private batch "${b.label}" from your projects and batch list?`, `确定彻底弃用私有批次“${b.label}”？（将从您的项目与个人批次池中移除）`))) return;
                                  setNotice(null);
                                  try {
                                    await discardMut.mutateAsync(b.batchId);
                                    setNotice({ text: t('Private batch soft-discarded.', '已弃用该私有数据批次。') });
                                  } catch (err) {
                                    setNotice({ text: formatApiError(err), isError: true });
                                  }
                                }}
                              >
                                <Trash2 size={11} />
                                <span>{t('Discard Private', '弃用私有批次')}</span>
                              </button>
                            )}
                          </>
                        )}
                        {target && (project.can_edit || b.visibility === 'shared') && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <select
                              className="wb-select"
                              aria-label={t('Target project for batch reuse', '选择要复用到的目标项目')}
                              style={{
                                height: 28,
                                minHeight: 28,
                                width: 'auto',
                                minWidth: 116,
                                maxWidth: 220,
                                padding: '0 26px 0 8px',
                                fontSize: 11.5,
                                lineHeight: '26px',
                              }}
                              value={target.id}
                              onChange={(e) => setReuseTargetByBatch((prev) => ({ ...prev, [b.batchId]: e.target.value }))}
                            >
                              {reuseProjects.map((op) => (
                                <option key={op.id} value={op.id}>{op.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="ds-btn ds-btn--ghost"
                              style={{ height: 26, fontSize: 11 }}
                              disabled={busy}
                              onClick={async () => {
                                setNotice(null);
                                try {
                                  await attachMut.mutateAsync({ projectId: target.id, batchId: b.batchId });
                                  setNotice({ text: t(`Batch reused in "${target.name}" (0 API cost).`, `已将该批次复用到项目『${target.name}』（零外部 API 消耗）。`) });
                                } catch (err) {
                                  setNotice({ text: formatApiError(err), isError: true });
                                }
                              }}
                            >
                              <FolderPlus size={11} />
                              <span>{project.can_edit ? t('Reuse', '复用') : t('Add to project', '引入到项目')}</span>
                            </button>
                            {project.can_edit && (
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost"
                                style={{ height: 26, fontSize: 11 }}
                                disabled={busy}
                                onClick={async () => {
                                  setNotice(null);
                                  try {
                                    await moveMut.mutateAsync({ sourceProjectId: project.id, batchId: b.batchId, targetProjectId: target.id });
                                    setNotice({ text: t(`Batch moved to "${target.name}".`, `已将该批次移动至『${target.name}』。`) });
                                  } catch (err) {
                                    setNotice({ text: formatApiError(err), isError: true });
                                  }
                                }}
                              >
                                <ArrowRightLeft size={11} />
                                <span>{t('Move', '移动到')}</span>
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </div>
  );

  const renderImportSection = (
    title: string,
    subtitle: string,
    list: CollectionBatchDto[],
    badgeText: string,
  ) => (
    <div style={{ display: 'grid', gap: 8 }}>
      <div>
        <h4 style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-2, var(--ink))', margin: 0 }}>
          {title} ({list.length})
        </h4>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{subtitle}</div>
      </div>
      <div className="collection-table-scroll">
        <Table className="collection-table">
          <thead>
            <tr>
              <th>{t('Batch / Source', '批次与来源')}</th>
              <th>{t('Scope', '来源类型')}</th>
              <th>{t('Items', '样本数')}</th>
              <th>{t('Collected (UTC)', '采集时间')}</th>
              <th className="num">{t('Action', '操作')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td>
                  <b style={{ display: 'block', fontSize: 12 }}>{b.label}</b>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                    [{b.platform.toUpperCase()}] {b.sourceLabel}
                  </span>
                </td>
                <td>
                  <span className={`tag ${b.visibility === 'shared' ? 'tag--mint' : ''}`} style={{ fontSize: 10 }}>
                    {badgeText}
                  </span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{b.itemCount}</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {b.createdAt.slice(0, 16).replace('T', ' ')}
                </td>
                <td className="num">
                  <button
                    type="button"
                    className="ds-btn"
                    style={{ height: 28, fontSize: 11 }}
                    disabled={busy}
                    onClick={async () => {
                      setNotice(null);
                      try {
                        await attachMut.mutateAsync({ projectId: project.id, batchId: b.id });
                        setNotice({
                          text: t(
                            `Added batch "${b.label}" to "${project.name}" (0 API cost).`,
                            `已将批次“${b.label}”引入本项目『${project.name}』（零外部 API 消耗）。`,
                          ),
                        });
                      } catch (err) {
                        setNotice({ text: formatApiError(err), isError: true });
                      }
                    }}
                  >
                    <FolderPlus size={12} />
                    <span>{t('Add to project', '添加到本项目')}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="ds-card">
        <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="ds-card-title">{t(`Data Batches · ${project.name}`, `数据批次管理 · ${project.name}`)}</div>
            <div className="ds-card-sub">
              {project.can_edit
                ? t(
                    'Manage batches attached to this project, move/reuse private batches between projects, or discard unused private batches.',
                    '管理当前项目已纳入的数据批次（启用/禁用、移除、软弃用），以及在多个研究项目之间复用或迁移数据。',
                  )
                : t('You can add shared batches from this project to any project you can edit.', '可以将此共享项目的数据批次引入你有编辑权限的研究项目。')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {project.can_edit && (
              <button type="button" className="ds-btn" onClick={() => onNavigate(`/projects?view=collect&projectId=${encodeURIComponent(project.id)}`)}>
                <Plus size={13} />
                <span>{t('Collect New Data', '自主采集新数据')}</span>
              </button>
            )}
          </div>
        </div>
        <div className="ds-card-bd">
          {notice && (
            <div role={notice.isError ? 'alert' : 'status'} className={`wb-alert ${notice.isError ? 'wb-alert--error' : 'wb-alert--success'}`} style={{ marginBottom: 12 }}>
              {notice.text}
            </div>
          )}
          {batchesQuery.isPending ? (
            <p className="collection-hint">{t('Loading project batches…', '正在加载项目批次…')}</p>
          ) : batchesQuery.isError ? <p role="alert">{formatApiError(batchesQuery.error)}</p> : batches.length === 0 ? (
            <p className="collection-hint">
              {project.can_edit
                ? t(
                    'No batches attached to this project yet. Add shared/existing batches below, or go to Data Ingestion to collect fresh data.',
                    '当前项目尚未纳入任何数据批次。你可以直接在下方引入全员共享数据 / 历史私有批次，或点击右上角「自主采集新数据」。',
                  )
                : t('This project has no batches available to reuse.', '此项目暂无可引入的批次。')}
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {privateBatches.length > 0 && renderSection(t('My Collected / Private Batches', '我的私有采集数据'), privateBatches)}
              {sharedBatches.length > 0 && renderSection(t('Global Shared / Ops Batches', '全员共享 / 运维采集数据'), sharedBatches)}
            </div>
          )}
        </div>
      </div>

      {canImportIntoProject && (
        <div className="ds-card">
          <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="ds-card-title">{t('Available Shared & Reusable Data Pool', '可引入数据资源池（全员共享与历史批次）')}</div>
              <div className="ds-card-sub">
                {t(
                  'Attach admin/ops global shared data or reuse your own batches from other projects at 0 external API cost.',
                  '在此将运维面板采集的全员共享数据、或你在其他项目中采集的历史私有批次引入当前项目（零外部 API 消耗）。',
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="search"
                className="wb-input"
                style={{ width: 220, height: 32, fontSize: 12 }}
                placeholder={t('Filter batches by name or platform…', '按批次名、来源或平台筛选…')}
                value={poolSearch}
                onChange={(e) => setPoolSearch(e.target.value)}
              />
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void availableQuery.refetch()}>
                <RefreshCw size={13} />
                <span>{t('Refresh', '刷新')}</span>
              </button>
            </div>
          </div>
          <div className="ds-card-bd">
            {availableQuery.isPending ? (
              <p className="collection-hint">{t('Checking available shared & personal batches…', '正在加载可引入的共享数据与历史批次…')}</p>
            ) : availableQuery.isError ? (
              <p role="alert">{formatApiError(availableQuery.error)}</p>
            ) : availableBatches.length === 0 ? (
              <p className="collection-hint">
                {poolNeedle
                  ? t('No matching batches found.', '没有符合筛选条件的可引入批次。')
                  : t('All currently authorized shared and personal batches are already attached to this project (or none exist yet).', '暂无未纳入本项目的全员共享数据或其他私有批次。')}
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {availableShared.length > 0 &&
                  renderImportSection(
                    t('Global Shared Data (Ops & Team)', '全员共享数据（管理员运维采集 / 共享数据）'),
                    t('Shared datasets collected globally in Ops or published by administrators.', '由管理员在运维面板全局采集或全员共享的数据批次，所有研究成员均可引入分析。'),
                    availableShared,
                    t('Global Shared', '全员共享'),
                  )}
                {availablePrivate.length > 0 &&
                  renderImportSection(
                    t('My Private Batches from Other Runs', '我的其他私有采集批次'),
                    t('Private batches you collected earlier that are not yet attached to this project.', '你此前自主采集过、但尚未加入当前项目的私有批次。'),
                    availablePrivate,
                    t('My Private', '我的私有'),
                  )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ViewerPersonalJobsView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useI18n();
  const jobsQuery = useRecentJobsQuery({ limit: 30 }, true);
  const jobs = jobsQuery.data?.jobs ?? [];
  return (
    <div className="ds-card">
      <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <h2 className="ds-card-title">{t('My Collection Jobs', '我的采集任务记录')}</h2>
          <div className="ds-card-sub">{t('Only personal collection jobs initiated by your browser session.', '仅显示当前账号在工作台发起的个人采集任务。')}</div>
        </div>
        <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void jobsQuery.refetch()}>
          <RefreshCw size={13} />
          <span>{t('Refresh', '刷新')}</span>
        </button>
      </div>
      <div className="ds-card-bd">
        {jobsQuery.isPending ? (
          <p className="collection-hint">{t('Loading personal jobs…', '正在加载个人任务…')}</p>
        ) : jobsQuery.isError ? <p role="alert">{formatApiError(jobsQuery.error)}</p> : jobs.length === 0 ? (
          <p className="collection-hint">{t('No personal collection jobs recorded yet.', '当前还没有发起过个人采集任务。')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {jobs.map((job) => (
              <div key={job.id} className="job-row intake-job-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 12 }}>[{job.platform.toUpperCase()}] {job.sourceLabel}</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {job.createdAt.slice(0, 16).replace('T', ' ')} UTC · {t('Processed / Inserted', '处理 / 新增')}: {job.recordsProcessed} / +{job.recordsInserted}
                  </div>
                </div>
                <Badge className={`chip-state ${job.status === 'succeeded' ? 'active' : job.status === 'running' ? 'paused' : 'archived'}`}>
                  {job.status}
                </Badge>
                {job.projectId && (
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    style={{ height: 26, fontSize: 11 }}
                    onClick={() => onNavigate(`/projects?view=batches&projectId=${encodeURIComponent(job.projectId!)}`)}
                  >
                    <span>{t('Open Project', '查看所属项目')}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
