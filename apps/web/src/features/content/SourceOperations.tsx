import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, fetchApi } from '../../api/client';
import { Button, Input } from '../../components/ui';
import type { SourceOpsResponse, SourceProviderBudget, SourceProviderUsage } from '../../../../../packages/contracts/src/http';

function ProviderBudget({ usage, canEdit, zh }: { usage: SourceProviderUsage; canEdit: boolean; zh: boolean }) {
  const copy = (en: string, cn: string) => zh ? cn : en;
  const client = useQueryClient();
  const base = JSON.stringify(usage.budget);
  const [draft, setDraft] = useState({ base, dirty: false, value: { ...usage.budget } });
  const current = !draft.dirty && draft.base !== base ? { base, dirty: false, value: { ...usage.budget } } : draft;
  const stale = draft.dirty && draft.base !== base;
  const update = useMutation({ mutationFn: (budget: SourceProviderBudget) => {
    const { provider, revision, ...fields } = budget;
    const body = { ...fields, expectedRevision: revision };
    return fetchApi<{ ok: true; budget: SourceProviderBudget }>(`/v1/source-provider-budgets/${provider}`, { method: 'PUT', body: JSON.stringify(body) });
  }, onSuccess: data => {
    client.setQueryData<SourceOpsResponse>(['sourceOps'], previous => previous ? { ...previous, ops: { ...previous.ops, providers: previous.ops.providers.map(item => item.provider === data.budget.provider ? { ...item, budget: data.budget } : item) } } : previous);
    setDraft({ base: JSON.stringify(data.budget), dirty: false, value: data.budget }); void client.invalidateQueries({ queryKey: ['sourceOps'] }); void client.invalidateQueries({ queryKey: ['contentSources'] });
  },
    onError: error => { if (error instanceof ApiError && (error.status === 409 || error.code === 'audit_result_unknown')) void client.invalidateQueries({ queryKey: ['sourceOps'] }); } });
  const conflict = stale || (update.error instanceof ApiError && update.error.status === 409);
  const outcomeUnknown = update.error instanceof ApiError && update.error.code === 'audit_result_unknown';
  const labels = [
    ['dailyRequests', 'Daily request limit', '每日请求上限'], ['monthlyRequests', 'Monthly request limit', '每月请求上限'],
    ['dailyResources', 'Daily resource reservation limit', '每日资源预留上限'], ['monthlyResources', 'Monthly resource reservation limit', '每月资源预留上限'],
  ] as const;
  return <div style={{ padding: '16px 0', borderBottom: '1px solid var(--border-primary)' }}>
    <strong>{usage.provider}{usage.provider.startsWith('demo_') ? ` · ${copy('Synthetic demo', '合成演示')}` : ''}</strong>
    <p className="content-muted">{copy('Requests reserved', '已预留请求')}: {usage.dailyRequests} / {usage.budget.dailyRequests} ({usage.day}) · {usage.monthlyRequests} / {usage.budget.monthlyRequests} ({usage.month})<br />{copy('Resource capacity reserved', '已预留资源容量')}: {usage.dailyResources} / {usage.budget.dailyResources} ({usage.day}) · {usage.monthlyResources} / {usage.budget.monthlyResources} ({usage.month})</p>
    {canEdit && <form aria-label={`${copy('Budget for', '预算设置')} ${usage.provider}`} onSubmit={event => { event.preventDefault(); if (!conflict && !outcomeUnknown) update.mutate(current.value); }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><input type="checkbox" checked={current.value.enabled} onChange={event => { update.reset(); setDraft({ ...current, dirty: true, value: { ...current.value, enabled: event.target.checked } }); }} />{copy('Allow collection requests within this budget', '允许在额度内发起采集请求')}</label>
      <div className="content-fields">{labels.map(([field, en, cn]) => <label key={field}>{copy(en, cn)}<Input type="number" min={0} max={100000000} step={1} required value={Number.isFinite(current.value[field]) ? current.value[field] : ''} onChange={event => { update.reset(); setDraft({ ...current, dirty: true, value: { ...current.value, [field]: event.target.value === '' ? Number.NaN : Number(event.target.value) } }); }} /></label>)}</div>
      <label>{copy('Minimum interval between provider requests (milliseconds)', 'provider 请求最小间隔（毫秒）')}<Input type="number" min={0} max={3600000} step={1} required value={Number.isFinite(current.value.minimumIntervalMs ?? 0) ? current.value.minimumIntervalMs ?? 0 : ''} onChange={event => { update.reset(); setDraft({ ...current, dirty: true, value: { ...current.value, minimumIntervalMs: event.target.value === '' ? Number.NaN : Number(event.target.value) } }); }} /></label>
      {conflict && <p role="alert">{copy('Budget changed while editing. Your draft is retained. Reload before saving.', '编辑期间预算已变更，草稿已保留。请重新载入再保存。')} <Button type="button" onClick={() => { setDraft({ base, dirty: false, value: { ...usage.budget } }); update.reset(); }}>{copy('Reload budget', '重新载入预算')}</Button></p>}
      {update.error && <p role="alert" className="content-error">{update.error.message}</p>}
      <Button type="submit" disabled={!current.dirty || update.isPending || conflict || outcomeUnknown}>{copy('Save provider budget', '保存 provider 预算')}</Button>
      <Button type="button" disabled={!current.dirty || update.isPending} onClick={() => { setDraft({ base, dirty: false, value: { ...usage.budget } }); update.reset(); }}>{copy('Cancel budget edits', '取消预算修改')}</Button>
      {update.isSuccess && <span role="status" style={{ marginLeft: '12px' }}>{copy('Budget saved', '预算已保存')}</span>}
    </form>}
  </div>;
}

export function SourceOperations({ canEdit, zh }: { canEdit: boolean; zh: boolean }) {
  const copy = (en: string, cn: string) => zh ? cn : en;
  const [open, setOpen] = useState(false);
  const ops = useQuery({ queryKey: ['sourceOps'], queryFn: () => fetchApi<SourceOpsResponse>('/v1/source-ops'), enabled: open, retry: false, refetchInterval: open ? 15000 : false });
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{copy('Worker status and provider budgets', 'Worker 状态与 provider 预算')}</summary>
    <Button type="button" onClick={() => void ops.refetch()}>{copy('Refresh worker status', '刷新 worker 状态')}</Button>
    {ops.error && <p role="alert" className="content-error">{ops.error.message}</p>}
    {ops.isLoading && <p role="status">{copy('Loading worker status…', '正在加载 worker 状态…')}</p>}
    {ops.data && <>
      <p className="content-muted">{copy('Checked', '检查时间')} {new Date(ops.data.ops.checkedAt).toLocaleString()} · {copy('Queue', '队列')}: {ops.data.ops.queue.map(item => `${item.status} ${item.count}`).join(' · ') || copy('Empty', '空')}<br />{copy('Oldest queued job', '最早排队任务')}: {ops.data.ops.oldestQueuedAt ? new Date(ops.data.ops.oldestQueuedAt).toLocaleString() : copy('None', '无')}</p>
      {ops.data.ops.workers.length === 0 && <p>{copy('No worker heartbeat recorded. Start the source worker to process queued jobs.', '未记录 worker 心跳，请启动来源 worker 处理排队任务。')}</p>}
      <ul style={{ paddingLeft: '20px', overflowWrap: 'anywhere' }}>{ops.data.ops.workers.map(worker => <li key={worker.id}>{worker.id} · {worker.state} · {worker.stale ? copy('Heartbeat stale', '心跳过期') : copy('Heartbeat recent', '心跳近期有效')} · {new Date(worker.lastHeartbeatAt).toLocaleString()}</li>)}</ul>
      <p className="content-muted">{copy('Recent heartbeats prove worker activity. Publication age and collection age do not prove upstream delivery delay or complete coverage.', '近期心跳只证明 worker 活跃；内容年龄和采集年龄不能证明上游交付延迟或完整覆盖。')}</p>
      {ops.data.ops.providers.map(usage => <ProviderBudget key={usage.provider} usage={usage} canEdit={canEdit} zh={zh} />)}
      <p className="content-muted">{copy('Budgets count conservative request/resource reservations, including retries. They are not returned row counts or a provider bill. A zero limit stops requests in that window.', '预算统计保守预留的请求与资源容量，包含重试；它们不是实际返回条数或 provider 账单。额度为零会停止对应窗口内的请求。')}</p>
    </>}
  </details>;
}
