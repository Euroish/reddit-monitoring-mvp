import { useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { formatApiError, useRecentJobsQuery } from '../api/hooks';
import type { Actor, CollectionSource, RecentJobDto } from '../contracts/api';
import { useI18n } from '../i18n/translations';

const statuses = {
  queued: ['Queued', '排队中'],
  running: ['Running', '执行中'],
  retrying: ['Retrying', '等待重试'],
  succeeded: ['Succeeded', '已完成'],
  completed: ['Completed', '已完成'],
  failed: ['Failed', '失败'],
  cancelled: ['Cancelled', '已取消'],
} as const;

const phases = {
  idle: ['Waiting', '等待执行'],
  starting: ['Starting', '启动渠道'],
  running: ['Running upstream', '上游执行'],
  reading: ['Reading results', '读取结果'],
  unknown: ['Outcome unknown', '结果待确认'],
  done: ['Finished', '阶段完成'],
  failed: ['Stage failed', '阶段失败'],
} as const;

function collectionJobStatus(status: RecentJobDto['status']): readonly [string, string] {
  return statuses[status] ?? [status, status];
}

export function CollectionJobsView({ actor, sources, initialSourceId, onInspect, onOpenSource }: {
  actor: Actor;
  sources: CollectionSource[];
  initialSourceId: string;
  onInspect: (id: string) => void;
  onOpenSource: (id: string) => void;
}) {
  const { lang, t } = useI18n();
  const isAdmin = actor.clientKind === 'browser' && actor.role !== 'viewer';
  const [status, setStatus] = useState('');
  const [sourceId, setSourceId] = useState(initialSourceId);
  const jobsQuery = useRecentJobsQuery({ status: status || undefined, sourceId: sourceId || undefined, limit: 50 });
  const jobs = jobsQuery.data?.jobs ?? [];
  const number = new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en');
  const utc = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-GB', {
    timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });

  function requester(job: RecentJobDto) {
    if (!isAdmin) return t('You', '本人');
    if (job.requestedByClientKind === 'machine') return [t('Machine key', '机器密钥'), job.requesterEmail].filter(Boolean).join(' · ');
    if (job.requestedByClientKind === 'browser') return job.requesterEmail ?? t('Browser session', '浏览器会话');
    return job.purpose === 'scheduled' ? t('Scheduler', '系统调度') : t('Requester unavailable', '未记录发起者');
  }

  function kind(job: RecentJobDto) {
    switch (job.purpose) {
      case 'scheduled': return t('Scheduled run', '定时采集');
      case 'ingest': return t('Push ingest', '推流导入');
      case 'refresh': return t('Refresh posts', '刷新帖子');
      case 'hydrate': return t('Fetch comments', '补采评论');
      default: return t('Manual run', '手动采集');
    }
  }

  return (
    <section className="ds-card collection-panel" aria-labelledby="collection-jobs-title">
      <header className="ds-card-hd collection-panel-header">
        <div>
          <h2 className="ds-card-title" id="collection-jobs-title"><History size={16} />{isAdmin ? t('Recent runs', '近期任务') : t('My recent runs', '我的近期任务')}</h2>
          <p className="ds-card-sub">{t('Latest 50 matching jobs. Timestamps use UTC.', '最多展示最近 50 条匹配任务，时间为 UTC。')}</p>
        </div>
        <div className="collection-toolbar">
          <select className="wb-select" aria-label={t('Filter by job status', '按任务状态筛选')} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t('All statuses', '全部状态')}</option>
            {Object.entries(statuses).filter(([value]) => value !== 'completed').map(([value, label]) => <option key={value} value={value}>{t(label[0], label[1])}</option>)}
          </select>
          <select className="wb-select" aria-label={t('Filter by source', '按来源筛选')} value={sourceId} onChange={e => setSourceId(e.target.value)}>
            <option value="">{t('All sources', '全部来源')}</option>
            {sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
          <button type="button" className="ds-btn ds-btn--ghost" disabled={jobsQuery.isFetching} onClick={() => { void jobsQuery.refetch(); }}>
            <RefreshCw size={14} />{t('Refresh', '刷新')}
          </button>
        </div>
      </header>
      {jobsQuery.error && <p className="wb-alert wb-alert--error collection-panel-notice" role="alert">{formatApiError(jobsQuery.error)}</p>}
      {jobs.length > 0 ? (
        <div className="collection-table-scroll" role="region" aria-label={t('Collection jobs table', '采集任务表')} tabIndex={0}>
          <table className="collection-table collection-jobs-table">
            <thead><tr>
              <th scope="col">{t('Source / channel', '来源与渠道')}</th>
              <th scope="col">{t('Trigger', '触发方式')}</th>
              <th scope="col">{t('Status / stage', '状态与阶段')}</th>
              <th scope="col">{t('Storage result', '处理与入库')}</th>
              <th scope="col">{t('Provider requests', '渠道请求')}</th>
              <th scope="col">{t('Created (UTC)', '创建时间（UTC）')}</th>
              <th scope="col">{t('Action', '操作')}</th>
            </tr></thead>
            <tbody>{jobs.map(job => (
              <tr key={job.id}>
                <td>
                  <button type="button" className="collection-text-button" onClick={() => onOpenSource(job.sourceId)}>{job.sourceLabel}</button>
                  <small>{job.provider} · <code title={job.id}>{job.id.slice(0, 8)}</code></small>
                </td>
                <td><span>{kind(job)}</span><small>{requester(job)}</small></td>
                <td>
                  <span className={'collection-status ' + (job.status === 'failed' ? 'collection-status--error' : ['completed', 'succeeded'].includes(job.status) ? 'collection-status--ok' : '')}>
                    {t(...collectionJobStatus(job.status))}
                  </span>
                  {job.phase && phases[job.phase] && <small>{t(phases[job.phase][0], phases[job.phase][1])}</small>}
                  {job.error && <small className="collection-job-error">{job.error}</small>}
                </td>
                <td><strong>{number.format(job.recordsProcessed)}</strong> {t('processed', '已处理')}
                  <small>{t('New', '新增')} {number.format(job.recordsInserted)} · {t('Updated', '更新')} {number.format(job.recordsUpdated)}</small>
                </td>
                <td>{number.format(job.requestCount)} {t('requests', '次')}
                  {job.requestDurationMs > 0 && <small>{number.format(job.requestDurationMs)} ms</small>}
                </td>
                <td><time dateTime={job.createdAt} title={job.createdAt}>{utc.format(new Date(job.createdAt))}</time></td>
                <td><button type="button" className="ds-btn ds-btn--ghost" onClick={() => onInspect(job.id)}>{t('Details', '详情')}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : !jobsQuery.error && <p className="collection-empty" role="status">{jobsQuery.isPending ? t('Loading jobs…', '正在加载任务…') : t('No jobs match the filters.', '没有符合筛选条件的任务。')}</p>}
    </section>
  );
}
