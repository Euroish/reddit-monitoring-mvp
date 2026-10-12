import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchApi } from '../../api/client';
import { Button, Input } from '../../components/ui';
import type { CollectionSource, CollectionSourceResponse, SourceCapability, UpdateCollectionSourceRequest } from '../../../../../packages/contracts/src/http';

export function SourceSettings({ source, capability, zh, onUpdated }: {
  source: CollectionSource; capability: SourceCapability | undefined; zh: boolean; onUpdated: () => void;
}) {
  const copy = (en: string, cn: string) => zh ? cn : en;
  const snapshot = (value: CollectionSource) => ({ base: value.updatedAt, dirty: false,
    fields: { label: value.label, group: value.group ?? '', schedule: { ...value.schedule, recheckLookbackHours: value.schedule.recheckLookbackHours ?? 12, recheckCadenceSeconds: value.schedule.recheckCadenceSeconds ?? 21600 }, refresh: { ...value.refresh } } });
  const [edit, setEdit] = useState(() => snapshot(source));
  const current = !edit.dirty && edit.base !== source.updatedAt ? snapshot(source) : edit;
  const conflict = edit.dirty && edit.base !== source.updatedAt;
  const canAutomaticallyRefresh = capability?.observationModel === 'archive' && capability.refreshByIds === true;
  const update = useMutation({ mutationFn: (payload: UpdateCollectionSourceRequest) =>
    fetchApi<CollectionSourceResponse>(`/v1/sources/${source.id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: data => { setEdit(snapshot(data.source)); onUpdated(); } });
  const setField = (field: 'label' | 'group', value: string) => {
    update.reset(); setEdit({ ...current, dirty: true, fields: { ...current.fields, [field]: value } });
  };
  const setSetting = (section: 'schedule' | 'refresh', field: string, value: number | boolean) => {
    update.reset(); setEdit({ ...current, dirty: true,
      fields: { ...current.fields, [section]: { ...current.fields[section], [field]: value } } });
  };
  const save = (event: FormEvent) => {
    event.preventDefault(); if (conflict) return;
    update.mutate({ ...current.fields, group: current.fields.group.trim() || null });
  };
  const scheduleFields = [
    ['cadenceSeconds', 'Collection interval (seconds)', '采集间隔（秒）', 60, 86400],
    ['overlapSeconds', 'Window overlap (seconds)', '窗口重叠（秒）', 0, 86400],
    ['initialLookbackHours', 'Initial lookback (hours)', '首次回溯（小时）', 1, 8760],
    ['maxCatchupHours', 'Maximum catch-up window (hours)', '单次追赶窗口（小时）', 1, 168],
    ['pageSize', 'Records per page', '每页条数', 1, 100],
    ['maxPages', 'Pages per job', '每任务页数', 1, 20],
    ['recheckLookbackHours', 'Late-arrival recheck window (hours; 0 disables)', '迟到回查窗口（小时；0 关闭）', 0, 168],
    ['recheckCadenceSeconds', 'Late-arrival recheck interval (seconds)', '迟到回查间隔（秒）', 60, 86400],
  ] as const;
  const refreshFields = [
    ['afterHours', 'Refresh after publication (hours)', '发布后刷新（小时）', 1, 8760],
    ['minIntervalHours', 'Minimum refresh interval (hours)', '最小刷新间隔（小时）', 1, 720],
    ['maxAttempts', 'Maximum refresh attempts', '最多刷新次数', 1, 20],
    ['batchSize', 'Refresh batch size', '刷新批量条数', 1, 100],
  ] as const;
  return <details><summary>{copy('Source settings', '来源设置')}</summary>
    <form onSubmit={save} aria-label={`${copy('Settings for', '来源设置')} ${source.label}`}>
      <div className="content-fields">
        <label>{copy('Source label', '来源名称')}<Input value={current.fields.label} onChange={event => setField('label', event.target.value)} required maxLength={100} /></label>
        <label>{copy('Source group', '来源分组')}<Input value={current.fields.group} onChange={event => setField('group', event.target.value)} maxLength={100} /></label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '16px 0', minWidth: 0 }}>
        <legend>{copy('Periodic collection', '周期采集')}</legend>
        <label style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '12px 0' }}><input type="checkbox" checked={current.fields.schedule.enabled} onChange={event => setSetting('schedule', 'enabled', event.target.checked)} />{copy('Enable periodic collection', '启用周期采集')}</label>
        <div className="content-fields">{scheduleFields.map(([field, en, cn, min, max]) =>
          <label key={field}>{copy(en, cn)}<Input type="number" min={min} max={max} step={1} required value={Number.isFinite(current.fields.schedule[field]) ? current.fields.schedule[field] : ''} onChange={event => setSetting('schedule', field, event.target.value === '' ? Number.NaN : Number(event.target.value))} /></label>)}</div>
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: '16px 0', minWidth: 0 }}>
        <legend>{copy('Metric refresh', '指标刷新')}</legend>
        <label style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: '12px 0' }}><input type="checkbox" checked={current.fields.refresh.enabled} disabled={!canAutomaticallyRefresh && !current.fields.refresh.enabled} onChange={event => setSetting('refresh', 'enabled', event.target.checked)} />{copy('Enable metric refresh by content ID', '启用按内容 ID 刷新指标')}</label>
        {capability?.observationModel === 'snapshot' ? <p className="content-muted">{copy('Automatic mature metric refresh currently applies only to archive providers. Snapshot ID-refresh capability does not enable automatic snapshot scheduling.', '当前自动成熟指标刷新仅适用于归档 provider。快照 provider 的按 ID 刷新能力暂不参与自动调度。')}</p>
          : !capability?.refreshByIds && <p className="content-muted">{copy('This provider cannot refresh content by ID.', '该 provider 不支持按内容 ID 刷新。')}</p>}
        <div className="content-fields">{refreshFields.map(([field, en, cn, min, max]) =>
          <label key={field}>{copy(en, cn)}<Input type="number" min={min} max={max} step={1} required value={Number.isFinite(current.fields.refresh[field]) ? current.fields.refresh[field] : ''} onChange={event => setSetting('refresh', field, event.target.value === '' ? Number.NaN : Number(event.target.value))} /></label>)}</div>
      </fieldset>
      <p className="content-muted">{copy('Scheduling requires a running source worker. Paused and archived sources do not start new collection jobs. Identity stays fixed; add a source to change its target.', '调度需要来源 worker 持续运行。暂停或归档来源不会启动新采集任务；若要改变采集目标，请新增来源。')}</p>
      <p className="content-muted">{copy('Late-arrival checks revisit only the configured recent window and consume the same provider budget. They preserve incremental checkpoints and cannot prove full upstream coverage.', '迟到回查只重查配置的近期窗口，计入同一 provider 预算并保留增量 checkpoint；不能证明上游完整覆盖。')}</p>
      {conflict && <p role="alert" className="content-error">{copy('The source changed while you were editing. Reload its settings before saving.', '编辑期间来源已更新，请重新载入设置再保存。')} <Button type="button" onClick={() => setEdit(snapshot(source))}>{copy('Reload settings', '重新载入设置')}</Button></p>}
      {update.error && <p role="alert" className="content-error">{update.error.message}</p>}
      <Button type="submit" variant="primary" disabled={update.isPending || conflict || !current.dirty}>{update.isPending ? copy('Saving…', '正在保存…') : copy('Save source settings', '保存来源设置')}</Button>
      {update.isSuccess && <span role="status" style={{ marginLeft: '12px' }}>{copy('Settings saved', '设置已保存')}</span>}
    </form>
  </details>;
}
