import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../../api/client';
import { Button, Select } from '../../components/ui';
import type { CollectionSource, SourceCollectionJob, SourceJobResponse, SourceJobsResponse } from '../../../../../packages/contracts/src/http';

export function SourceTasks({ sources, canEdit, zh, onJob }: {
  sources: CollectionSource[]; canEdit: boolean; zh: boolean; onJob: (id: string) => void;
}) {
  const copy = (en: string, cn: string) => zh ? cn : en;
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [status, setStatus] = useState('');
  const params = new URLSearchParams({ limit: '50' });
  if (sourceId) params.set('sourceId', sourceId);
  if (status) params.set('status', status);
  const jobs = useQuery({ queryKey: ['sourceJobs', sourceId, status], enabled: open, retry: false,
    queryFn: () => fetchApi<SourceJobsResponse>(`/v1/source-jobs?${params}`),
    refetchInterval: query => open && query.state.data?.jobs.some(job => ['queued', 'running', 'retrying'].includes(job.status)) ? 5000 : false });
  const action = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'retry' | 'continue' }) =>
    fetchApi<SourceJobResponse>(`/v1/source-jobs/${id}/${action}`, { method: 'POST', body: '{}' }),
    onSuccess: data => { onJob(data.job.id); void client.invalidateQueries({ queryKey: ['sourceJobs'] }); void client.invalidateQueries({ queryKey: ['sourceContentJob'] }); void client.invalidateQueries({ queryKey: ['sourceOps'] }); void client.invalidateQueries({ queryKey: ['contentSources'] }); } });
  const statuses: SourceCollectionJob['status'][] = ['queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled'];
  const label = (status: SourceCollectionJob['status']) => ({ queued: copy('Queued', '排队'), running: copy('Running', '运行中'), retrying: copy('Retrying', '等待重试'), succeeded: copy('Finished', '已结束'), failed: copy('Failed', '失败'), cancelled: copy('Cancelled', '已取消') })[status];
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{copy('Collection task history', '采集任务历史')}</summary>
    <div className="content-fields">
      <label>{copy('Task source', '任务来源')}<Select aria-label={copy('Task source', '任务来源')} value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">{copy('All sources', '全部来源')}</option>{sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</Select></label>
      <label>{copy('Task status', '任务状态')}<Select aria-label={copy('Task status', '任务状态')} value={status} onChange={event => setStatus(event.target.value)}><option value="">{copy('All statuses', '全部状态')}</option>{statuses.map(value => <option key={value} value={value}>{label(value)}</option>)}</Select></label>
      <Button type="button" onClick={() => void jobs.refetch()}>{copy('Refresh tasks', '刷新任务')}</Button>
    </div>
    {(jobs.error || action.error) && <p role="alert" className="content-error">{(jobs.error ?? action.error)?.message}</p>}
    {jobs.isLoading && <p role="status">{copy('Loading tasks…', '正在加载任务…')}</p>}
    {jobs.data?.jobs.length === 0 && <p>{copy('No tasks match this filter.', '没有符合筛选条件的任务。')}</p>}
    <ul style={{ listStyle: 'none', padding: 0 }}>{jobs.data?.jobs.map(job => {
      const source = sources.find(source => source.id === job.sourceId);
      const active = ['queued', 'running', 'retrying'].includes(job.status);
      return <li key={job.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--border-primary)', overflowWrap: 'anywhere' }}>
        <strong>{source?.label ?? job.sourceId} · {label(job.status)}</strong>
        <p className="content-muted">{copy('Purpose', '用途')}: {job.purpose} · {copy('Pages', '页数')} {job.pagesCommitted}/{job.maxPages} · {copy('Processed', '处理')} {job.recordsProcessed} · {copy('Inserted', '新增')} {job.recordsInserted} · {copy('Existing identities updated', '已有内容更新')} {job.recordsUpdated}<br />{new Date(job.from).toLocaleString()} → {new Date(job.to).toLocaleString()} · {job.id}</p>
        <p className="content-muted">{copy('Registered requests', '已登记请求')} {job.requestCount ?? '—'} · {copy('Cumulative fetch/parse time (ms)', '累计取页耗时(ms)')} {job.requestDurationMs ?? '—'}</p>
        {job.error && <p className="content-error">{job.error}</p>}
        {job.status === 'failed' && job.failureKind === 'permanent' && <p role="note" className="content-error">{copy('Automatic collection is blocked. Correct the provider configuration, then retry this failed task to resume collection.', '自动采集已阻塞。修正数据渠道配置后，重试此失败任务以恢复采集。')}</p>}
        {job.status === 'succeeded' && !job.exhausted && <p role="note" className="content-muted">{copy('This task ended with partial coverage. The collection window is not complete; inspect its warning and checkpoint before continuing.', '此任务已结束，但覆盖仍不完整。采集窗口尚未耗尽，请检查提示和检查点后再决定如何继续。')}</p>}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button type="button" onClick={() => onJob(job.id)}>{copy('Inspect task', '查看任务')}</Button>
          {canEdit && active && <Button type="button" disabled={action.isPending} onClick={() => action.mutate({ id: job.id, action: 'cancel' })}>{copy('Cancel task', '取消任务')}</Button>}
          {canEdit && source?.state === 'active' && job.status === 'failed' && <Button type="button" disabled={action.isPending} onClick={() => action.mutate({ id: job.id, action: 'retry' })}>{copy('Retry task', '重试任务')}</Button>}
          {canEdit && source?.state === 'active' && job.status === 'succeeded' && job.checkpoint !== null && <Button type="button" disabled={action.isPending} onClick={() => action.mutate({ id: job.id, action: 'continue' })}>{copy('Continue task', '继续任务')}</Button>}
        </div>
      </li>;
    })}</ul>
    <p className="content-muted">{copy('Shows the latest 50 matching tasks. Cancel keeps pages already committed; it prevents another page from committing.', '显示最近 50 个匹配任务。取消会保留已经提交的数据页，并阻止后续页提交。')}</p>
    <p className="content-muted">{copy('Cancelled requests or lost worker leases may not be successfully registered. These counters are not a provider bill; budget reservations are tracked separately.', '取消请求或丢失 worker 租约时，记录可能未成功登记。这些计数不能作为数据商账单；预算预留另行统计。')}</p>
  </details>;
}
