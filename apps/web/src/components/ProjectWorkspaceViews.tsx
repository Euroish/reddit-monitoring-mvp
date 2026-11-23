import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
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
  useProjectBatchesQuery,
  useRecentJobsQuery,
  useUpdateProjectBatchStatusMutation,
} from '../api/hooks';
import { Badge } from './ui/badge';
import { Table } from './ui/table';
import type { Project } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function ProjectListView({
  projects,
  activeProjectId,
  maxProjects,
  isViewer,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  activeProjectId?: string;
  maxProjects?: number;
  isViewer: boolean;
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
                {mine.map((p) => (
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 13 }}>{p.name}</b>
                      <span className="tag tag--lilac" style={{ fontSize: 10 }}>
                        {p.dataset_mode === 'batch' ? `${p.enabled_batch_count ?? 0} ${t('batches', '批次')}` : `${p.source_ids.length} ${t('sources', '来源')}`}
                      </span>
                    </div>
                    {p.description && <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>{p.description}</p>}
                  </button>
                ))}
              </div>
            </section>
          )}
          {shared.length > 0 && (
            <section style={{ display: 'grid', gap: 8 }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{t('Shared Team Projects', '共享研究项目')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {shared.map((p) => (
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 13 }}>{p.name}</b>
                      <span className="tag" style={{ fontSize: 10 }}>
                        {p.can_edit ? t('Shared', '共享') : t('Read-only', '只读')}
                      </span>
                    </div>
                    {p.description && <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>{p.description}</p>}
                  </button>
                ))}
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
  project,
  jobId,
  onNavigate,
}: {
  project: Project;
  jobId?: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const jobsQuery = useRecentJobsQuery({ projectId: project.id, jobId, limit: jobId ? 1 : 30 }, true);
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
  const projectPath = `&projectId=${encodeURIComponent(project.id)}`;
  const statusLabels: Record<string, string> = {
    queued: t('Queued', '已排队'), running: t('Running', '采集中'), retrying: t('Waiting to retry', '等待重试'),
    succeeded: t('Succeeded', '已成功'), completed: t('Completed', '已完成'), failed: t('Failed', '失败'),
    cancelled: t('Cancelled', '已取消'), blocked: t('Blocked', '已阻断'),
  };

  return (
    <div className="ds-card">
      <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <div className="ds-card-title">{jobId ? t('Collection progress', '本次采集进度') : t(`Collection Jobs · ${project.name}`, `采集任务 · ${project.name}`)}</div>
          <div className="ds-card-sub">{t('Execution status, errors, and ingested counts for this project.', '仅展示归属当前项目的采集任务进度、错误与入库结果。')}</div>
        </div>
        <div className="collection-toolbar">
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => jobsQuery.refetch()}>
            <RefreshCw size={13} />
            <span>{t('Refresh', '刷新')}</span>
          </button>
          {jobId && <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate('/projects?view=jobs' + projectPath)}>{t('All project jobs', '查看项目全部任务')}</button>}
          {project.can_edit && project.dataset_mode === 'batch' && <button type="button" className="ds-btn" onClick={() => onNavigate('/projects?view=collect' + projectPath)}>
            <Plus size={13} />
            <span>{t('New Collection', '发起新采集')}</span>
          </button>}
        </div>
      </div>
      <div className="ds-card-bd">
        {jobsQuery.isPending ? (
          <p className="collection-hint">{t('Loading project jobs…', '正在加载项目任务…')}</p>
        ) : jobsQuery.isError ? <p role="alert">{formatApiError(jobsQuery.error)}</p> : jobs.length === 0 ? (
          <p className="collection-hint">{jobId ? t('This collection is no longer visible to this account.', '当前账号无法查看此采集记录，可返回项目任务。') : t('No collection jobs recorded for this project yet.', '当前项目还没有采集任务记录。')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {jobs.map((job) => (
              <div key={job.id} className="job-row intake-job-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 12 }}>
                    [{job.platform.toUpperCase()}] {job.sourceLabel}
                  </b>

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
        )}
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
  const updateStatusMut = useUpdateProjectBatchStatusMutation();
  const attachMut = useAttachProjectBatchMutation();
  const [reuseTargetByBatch, setReuseTargetByBatch] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  const batches = batchesQuery.data?.batches ?? [];
  const otherWritableProjects = allProjects.filter((p) => p.id !== project.id && p.can_edit);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="ds-card">
        <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="ds-card-title">{t(`Data Batches · ${project.name}`, `数据批次管理 · ${project.name}`)}</div>
            <div className="ds-card-sub">
              {t('Enable/disable updates this project immediately; removing only unlinks this project without deleting shared content.', '启用或禁用实时刷新本项目分析；移除仅解除与本项目的关联，不删除共享底层内容，也不影响其他项目。')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate(`/projects?view=overview&projectId=${encodeURIComponent(project.id)}`)}>
              <span>{t('Go to Overview', '查看项目分析')}</span>
            </button>
            {project.can_edit && (
              <button type="button" className="ds-btn" onClick={() => onNavigate(`/projects?view=collect&projectId=${encodeURIComponent(project.id)}`)}>
                <Plus size={13} />
                <span>{t('Add Data', '补充数据')}</span>
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
              {t('No batches attached to this project yet. Go to Data Ingestion to collect or reuse a batch.', '当前项目还没有关联任何数据批次。前往「数据接入」发起采集或复用已有授权批次。')}
            </p>
          ) : (
            <div className="collection-table-scroll">
              <Table className="collection-table">
                <thead>
                  <tr>
                    <th>{t('Batch / Source', '批次与来源')}</th>
                    <th>{t('Visibility', '授权范围')}</th>
                    <th>{t('Items', '样本数')}</th>
                    <th>{t('Collected / Added (UTC)', '采集 / 纳入时间')}</th>
                    <th>{t('Status', '项目状态')}</th>
                    {project.can_edit && <th className="num">{t('Actions', '操作')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
                    const isEnabled = b.status === 'enabled';
                    const targetId = reuseTargetByBatch[b.batchId] ?? otherWritableProjects[0]?.id ?? '';
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
                        {project.can_edit && (
                          <td className="num">
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost"
                                style={{ height: 26, fontSize: 11 }}
                                disabled={updateStatusMut.isPending}
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
                                className="ds-btn ds-btn--danger"
                                style={{ height: 26, fontSize: 11 }}
                                disabled={updateStatusMut.isPending}
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      t(
                                        `Remove batch "${b.label}" from "${project.name}"? Underlying shared content and other projects will NOT be affected.`,
                                        `确定从项目『${project.name}』移除批次“${b.label}”？（不会删除底层原始内容，也不影响其他项目）`,
                                      ),
                                    )
                                  ) {
                                    return;
                                  }
                                  setNotice(null);
                                  try {
                                    await updateStatusMut.mutateAsync({
                                      projectId: project.id,
                                      batchId: b.batchId,
                                      status: 'removed',
                                    });
                                    setNotice({ text: t('Batch removed from this project.', '已从本项目移除该批次。') });
                                  } catch (err) {
                                    setNotice({ text: formatApiError(err), isError: true });
                                  }
                                }}
                              >
                                <Trash2 size={11} />
                                <span>{t('Remove', '移除')}</span>
                              </button>
                              {otherWritableProjects.length > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <select
                                    className="wb-select"
                                    aria-label={t('Target project for batch reuse', '选择要复用到的目标项目')}
                                    style={{ height: 26, fontSize: 11, maxWidth: 120 }}
                                    value={targetId}
                                    onChange={(e) => setReuseTargetByBatch((prev) => ({ ...prev, [b.batchId]: e.target.value }))}
                                  >
                                    {otherWritableProjects.map((op) => (
                                      <option key={op.id} value={op.id}>{op.name}</option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="ds-btn ds-btn--ghost"
                                    style={{ height: 26, fontSize: 11 }}
                                    disabled={!targetId || attachMut.isPending}
                                    onClick={async () => {
                                      if (!targetId) return;
                                      setNotice(null);
                                      try {
                                        await attachMut.mutateAsync({ projectId: targetId, batchId: b.batchId });
                                        const targetName = otherWritableProjects.find((p) => p.id === targetId)?.name ?? '';
                                        setNotice({
                                          text: t(`Batch added to "${targetName}" (0 API cost).`, `已将该批次复用到项目『${targetName}』（零外部 API 消耗）。`),
                                        });
                                      } catch (err) {
                                        setNotice({ text: formatApiError(err), isError: true });
                                      }
                                    }}
                                  >
                                    <FolderPlus size={11} />
                                    <span>{t('Reuse', '复用')}</span>
                                  </button>
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
          )}
        </div>
      </div>
    </div>
  );
}
