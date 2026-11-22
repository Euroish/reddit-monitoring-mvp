import { useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, StopCircle } from 'lucide-react';
import { formatApiError, useJobActionMutation, useQuotasSummaryQuery, useRecentJobsQuery } from '../api/hooks';
import type { Actor, CollectionSource, RecentJobDto } from '../contracts/api';
import { useI18n } from '../i18n/translations';

function formatDurationMs(job: RecentJobDto): string {
  if (job.requestDurationMs > 0) return `${Math.round(job.requestDurationMs)} ms`;
  if (job.finishedAt && job.createdAt) {
    const ms = Date.parse(job.finishedAt) - Date.parse(job.createdAt);
    if (Number.isFinite(ms) && ms >= 0) return `${(ms / 1000).toFixed(1)} s`;
  }
  return '—';
}

export function CollectionJobsView({
  actor,
  sources,
}: {
  actor: Actor;
  sources: CollectionSource[];
}) {
  const { t } = useI18n();
  const isAdmin = actor.role === 'owner' || actor.role === 'admin';
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [ackJob, setAckJob] = useState<RecentJobDto | null>(null);

  const jobsQuery = useRecentJobsQuery({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(sourceFilter ? { sourceId: sourceFilter } : {}),
    limit: 50,
  });
  const quotasQuery = useQuotasSummaryQuery(!isAdmin);
  const jobActionMut = useJobActionMutation();

  const jobs = jobsQuery.data?.jobs || [];
  const canViewerCollect = quotasQuery.data?.effectivePolicy.manualCollectEnabled ?? false;

  const runAction = async (job: RecentJobDto, action: 'cancel' | 'retry' | 'continue', ack = false) => {
    setActionErr(null);
    if (action !== 'cancel' && (job.phase === 'starting' || job.phase === 'unknown') && !ack) {
      setAckJob(job);
      return;
    }
    try {
      await jobActionMut.mutateAsync({ jobId: job.id, sourceId: job.sourceId, action, acknowledgePotentialCharge: ack || undefined });
      setAckJob(null);
      await jobsQuery.refetch();
    } catch (err) {
      setActionErr(formatApiError(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!isAdmin && (
        <div className="wb-alert wb-alert--info">
          <span>
            {canViewerCollect
              ? t(
                  'Showing only manual collection jobs initiated by your account. System scheduled jobs and other users’ tasks are hidden.',
                  '仅展示您本人发起的手动采集任务；系统自动排期与其他用户的任务不会显示在此处。',
                )
              : t(
                  'Manual collection is currently disabled for your plan tier. Below are any historical jobs initiated by your account.',
                  '当前账户套餐未开放手动采集权限；下方仅展示您本人历史发起的任务记录。',
                )}
          </span>
        </div>
      )}

      {actionErr && <div className="wb-alert wb-alert--error">{actionErr}</div>}

      {ackJob && (
        <div className="wb-alert wb-alert--error" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} />
            {t(
              `Job ${ackJob.id.slice(0, 8)} is in unresolved phase (${ackJob.phase}). Retrying may incur a duplicate provider charge.`,
              `任务 ${ackJob.id.slice(0, 8)} 处于未决阶段 (${ackJob.phase})，重试可能产生重复付费请求。`,
            )}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="ds-btn ds-btn--danger" style={{ height: 26, fontSize: 11 }} onClick={() => runAction(ackJob, 'retry', true)}>
              {t('Confirm Retry', '确认重试')}
            </button>
            <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 26, fontSize: 11 }} onClick={() => setAckJob(null)}>
              {t('Cancel', '取消')}
            </button>
          </div>
        </div>
      )}

      <div className="ds-card">
        <div className="ds-card-hd" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="ds-card-title">
              {isAdmin ? t('Global Collection Job Queue & History', '全局采集任务队列与执行流水') : t('My Collection Jobs', '我的采集任务记录')}
            </div>
            <div className="ds-card-sub">
              {t(
                'Real server-side execution stages, record counts & errors (no fabricated progress percentages)',
                '真实后端任务阶段、入库条数与错误详情（无虚构完成百分比）',
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="wb-select" style={{ height: 30, fontSize: 11.5 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t('All statuses', '全部状态')}</option>
              {['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select className="wb-select" style={{ height: 30, fontSize: 11.5, maxWidth: 180 }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="">{t('All sources', '全部来源')}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 30 }} onClick={() => jobsQuery.refetch()}>
              <RefreshCw size={12} /> {t('Refresh', '刷新')}
            </button>
          </div>
        </div>

        <div className="ds-card-bd" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="ds-table">
            <thead>
              <tr>
                <th>{t('Source / Provider', '来源 / 渠道')}</th>
                <th>{t('Type / Requester', '类型 / 发起者')}</th>
                <th>{t('Status / Phase', '状态 / 阶段')}</th>
                <th>{t('Processed (Ins / Upd)', '处理数 (新增 / 更新)')}</th>
                <th>{t('Timing', '耗时 / 创建时间')}</th>
                <th>{t('Error', '错误信息')}</th>
                <th className="num">{t('Actions', '操作')}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--faint)' }}>
                    {jobsQuery.isLoading ? t('Loading jobs...', '加载任务中...') : t('No matching collection jobs.', '暂无匹配的采集任务记录。')}
                  </td>
                </tr>
              ) : (
                jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{j.sourceLabel}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
                        {j.platform} · {j.provider} · {j.id.slice(0, 8)}
                      </div>
                    </td>
                    <td>
                      <span className="tag tag--line" style={{ fontSize: 10 }}>{j.purpose}/{j.operation}</span>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                        {isAdmin ? (j.requesterEmail ?? t('system scheduler', '系统自动排期')) : t('you', '本人')}
                      </div>
                    </td>
                    <td>
                      <span className={`tag ${j.status === 'succeeded' ? 'tag--mint' : j.status === 'failed' ? 'tag--danger' : 'tag--lilac'}`}>
                        {j.status}
                      </span>
                      <div style={{ fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        phase: {j.phase ?? 'idle'} · reqs: {j.requestCount}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                      <b>{j.recordsProcessed}</b>
                      <span style={{ color: 'var(--faint)', marginLeft: 4 }}>
                        (+{j.recordsInserted} / ~{j.recordsUpdated})
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                      <div>{formatDurationMs(j)}</div>
                      <div style={{ fontSize: 10, color: 'var(--faint)' }}>{j.createdAt.slice(0, 19).replace('T', ' ')}</div>
                    </td>
                    <td style={{ maxWidth: 220, fontSize: 11, color: j.error ? '#b91c1c' : 'var(--faint)' }}>
                      {j.error ?? '—'}
                    </td>
                    <td className="num">
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        {['queued', 'running', 'retrying'].includes(j.status) && (
                          <button type="button" className="ds-btn ds-btn--danger" style={{ height: 24, padding: '0 8px', fontSize: 10.5 }} onClick={() => runAction(j, 'cancel')}>
                            <StopCircle size={11} /> {t('Cancel', '取消')}
                          </button>
                        )}
                        {['failed', 'cancelled'].includes(j.status) && (
                          <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 24, padding: '0 8px', fontSize: 10.5 }} onClick={() => runAction(j, 'retry')}>
                            <RotateCcw size={11} /> {t('Retry', '重试')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
