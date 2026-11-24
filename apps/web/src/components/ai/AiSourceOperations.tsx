import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AiVendorSourceRoles } from '../../../../../packages/contracts/src/ai-catalog';
import { aiApi, useAiAdminMutations, useAiOpsSummaryQuery, useAiSourcesQuery, type AiRegistrySourceItem, type AiSourceBinding, type AiVendorItem } from '../../api/ai-client';
import { formatApiError, isMfaRequiredError, useSourcesQuery } from '../../api/hooks';
import { useI18n } from '../../i18n/translations';
import { InlineMfaStepUp } from '../InlineMfaStepUp';
import { AiCredentialsPanel } from './AiCredentialsPanel';

export function AiSourceOperations({
  vendors,
  onDiscovery,
  onNavigate,
}: {
  vendors: AiVendorItem[];
  onDiscovery: () => void;
  onNavigate?: (path: string) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const sources = useSourcesQuery(true);
  const status = useAiOpsSummaryQuery();
  const registry = useAiSourcesQuery();
  const runs = useQuery({ queryKey: ['ai', 'syncRuns'], queryFn: aiApi.listSyncRuns });
  const bindings = useQuery({ queryKey: ['ai', 'sourceBindings'], queryFn: aiApi.listSourceBindings });
  const refreshBindings = () => queryClient.invalidateQueries({ queryKey: ['ai', 'sourceBindings'] });
  const bind = useMutation({ mutationFn: aiApi.saveSourceBinding, onSuccess: refreshBindings });
  const unbind = useMutation({ mutationFn: aiApi.removeSourceBinding, onSuccess: refreshBindings });
  const { syncSource, patchSource } = useAiAdminMutations();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [editing, setEditing] = useState<AiSourceBinding | null>(null);
  const [editingRegCode, setEditingRegCode] = useState<string | null>(null);
  const [regCadence, setRegCadence] = useState<number>(3600);
  const [pendingMfa, setPendingMfa] = useState<(() => Promise<void>) | null>(null);
  const webSources = (sources.data?.sources ?? []).filter(source => source.platform === 'web' &&
    source.deliveryMode === 'pull' && source.contentKind === 'article');
  const officialSources = webSources.filter(source => source.sourceGroup === 'ai-firsthand' ||
    bindings.data?.items.some(binding => binding.sourceId === source.id));

  const handleOpError = (err: unknown, retry: () => Promise<void>) => {
    if (isMfaRequiredError(err)) setPendingMfa(() => retry);
    else setNotice({ text: formatApiError(err), error: true });
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const payload: AiSourceBinding = {
      sourceId: String(fields.get('sourceId')),
      vendorId: String(fields.get('vendorId')),
      sourceRole: String(fields.get('role')) as AiSourceBinding['sourceRole'],
      isOfficial: editing?.isOfficial ?? true,
    };
    const execute = async () => {
      setNotice(undefined);
      try {
        await bind.mutateAsync(payload);
        setPendingMfa(null);
        setEditing(null);
        setNotice({ text: t('Vendor binding saved.', '厂商关联已保存。') });
      } catch (err) {
        handleOpError(err, execute);
      }
    };
    await execute();
  }

  async function remove(binding: AiSourceBinding) {
    const execute = async () => {
      setNotice(undefined);
      try {
        await unbind.mutateAsync(binding);
        setPendingMfa(null);
        setEditing(null);
        setNotice({ text: t('Vendor binding removed.', '厂商关联已移除。') });
      } catch (err) {
        handleOpError(err, execute);
      }
    };
    await execute();
  }

  async function sync(code: string, dryRun: boolean) {
    const execute = async () => {
      setNotice(undefined);
      try {
        const result = await syncSource.mutateAsync({ code, dryRun });
        setPendingMfa(null);
        const outcome = result.skippedLocked ? t('Another synchronization is running.', '已有同步任务在运行。') :
          result.skippedUnchanged ? t('Upstream data is unchanged.', '上游数据无变化。') :
          result.snapshotsSaved !== undefined ? t('Snapshots recorded', '已记录快照') + ' ' + result.snapshotsSaved :
          [t('Fetched', '抓取'), result.fetchedCount ?? '—', t('Changed', '变更'), result.changedCount ?? '—',
            t('Candidates', '候选'), result.candidatesCreated ?? '—', result.runId ?? ''].join(' ');
        setNotice({ text: code + ' · ' + outcome });
      } catch (err) {
        handleOpError(err, execute);
        void queryClient.invalidateQueries({ queryKey: ['ai'] });
      }
    };
    await execute();
  }

  async function updateRegistrySource(src: AiRegistrySourceItem, patch: { enabled?: boolean; cadenceSeconds?: number; clearCircuit?: boolean }) {
    const execute = async () => {
      setNotice(undefined);
      try {
        await patchSource.mutateAsync({ code: src.code, body: patch });
        setPendingMfa(null);
        setEditingRegCode(null);
        setNotice({ text: `${src.code} · ${t('Registry settings updated.', '注册表同步设置已更新。')}` });
      } catch (err) {
        handleOpError(err, execute);
      }
    };
    await execute();
  }

  const queryErrors = [sources.error, status.error, registry.error, bindings.error, runs.error].filter(Boolean);
  return (
    <div className="stack-gap">
      {notice && <div role={notice.error ? 'alert' : 'status'} className={'wb-alert ' + (notice.error ? 'wb-alert--error' : 'wb-alert--success')}>{notice.text}</div>}
      {pendingMfa && (
        <InlineMfaStepUp
          onVerified={async () => {
            await pendingMfa();
            setPendingMfa(null);
          }}
          onCancel={() => setPendingMfa(null)}
        />
      )}
      {queryErrors.map((error, index) => <div key={index} role="alert" className="wb-alert wb-alert--error">{formatApiError(error)}</div>)}
      <AiCredentialsPanel />
      <section className="ds-card">
        <header className="ds-card-hd">
          <h2 className="ds-card-title">{t('Official Web sources & vendor ingestion bindings', '官方 Web 来源与厂商采纳绑定')}</h2>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            onClick={() => onNavigate ? onNavigate('/sources?tab=sources&domain=feed&new=1') : undefined}
          >
            {t('Add a Web source', '新建 Web 来源')}
          </button>
        </header>
        <div className="ds-card-bd source-editor-fields">
          <p>{t('Step 1 (Ingestion): Bind official vendor domains to Web sources here (separate from Auto-Publish policy in Automation Ops).', '第 1 步（入库与绑定）：在此配置 Web 来源与厂商关联（与「自动化运维」中的自动发布灰度策略相互独立）。')}</p>
          {status.data && <p>{t('Collection networking', '采集联网')} · {status.data.sourceNetworkingConfigured ? t('configured on', '配置已开启') : t('configured off', '配置已关闭')}</p>}
          {officialSources.map(source => (
            <div key={source.id} className="source-health">
              <button
                type="button"
                className="collection-text-button"
                style={{ justifySelf: 'start', fontWeight: 600 }}
                onClick={() => onNavigate ? onNavigate(`/sources?tab=sources&domain=feed&sourceId=${encodeURIComponent(source.id)}`) : undefined}
              >
                {source.label}
              </button>
              <span>{source.state} · {source.schedule?.enabled ? t('Scheduled', '已启用调度') : t('Schedule disabled', '调度已关闭')} · {t('Last collection success', '最近采集成功')} {source.lastSuccessAt ?? '—'}</span>
              {source.health.lastError && <span>{source.health.lastError}</span>}
            </div>
          ))}
          {sources.isSuccess && bindings.isSuccess && !officialSources.length && <p>{t('No sources are in ai-firsthand or linked to a vendor.', '当前没有 ai-firsthand 分类或已关联厂商的来源。')}</p>}
          {(bindings.data?.items ?? []).map(binding => (
            <div className="source-editor-header" key={binding.sourceId + binding.vendorId}>
              <span>{webSources.find(source => source.id === binding.sourceId)?.label ?? binding.sourceId} · {vendors.find(vendor => vendor.id === binding.vendorId)?.name ?? binding.vendorId} · {binding.sourceRole}</span>
              <div>
                <button className="ds-btn ds-btn--ghost" type="button" onClick={() => setEditing(binding)}>{t('Edit binding', '编辑关联')}</button>
                <button className="ds-btn ds-btn--ghost" type="button" disabled={unbind.isPending || bind.isPending} onClick={() => { void remove(binding); }}>{t('Remove binding', '移除关联')}</button>
              </div>
            </div>
          ))}
          <form className="source-editor-fields" onSubmit={save} key={editing ? editing.sourceId + editing.vendorId : 'new'}>
            <div className="wb-grid-2">
              <label className="wb-field">{t('Web source', 'Web 来源')}
                <select className="wb-select" name="sourceId" aria-label={t('Web source', 'Web 来源')} required defaultValue={editing?.sourceId ?? ''}>
                  <option value="" disabled>{t('Choose a source', '选择来源')}</option>
                  {webSources.filter(source => editing ? source.id === editing.sourceId :
                    !bindings.data?.items.some(binding => binding.sourceId === source.id)).map(source => <option value={source.id} key={source.id}>{source.label}</option>)}
                </select>
              </label>
              <label className="wb-field">{t('Vendor', '厂商')}
                <select className="wb-select" name="vendorId" aria-label={t('Vendor', '厂商')} required defaultValue={editing?.vendorId ?? ''}>
                  <option value="" disabled>{t('Choose a vendor', '选择厂商')}</option>
                  {vendors.filter(vendor => !editing || vendor.id === editing.vendorId).map(vendor => <option value={vendor.id} key={vendor.id}>{vendor.name}</option>)}
                </select>
              </label>
            </div>
            <label className="wb-field">{t('Source role', '来源用途')}
              <select className="wb-select" name="role" defaultValue={editing?.sourceRole ?? 'blog'}>
                {AiVendorSourceRoles.map(role => <option key={role}>{role}</option>)}
              </select>
            </label>
            <div>
              <button className="ds-btn" disabled={bind.isPending || unbind.isPending || !webSources.length || !vendors.length || !bindings.isSuccess}>{t('Save vendor binding', '保存厂商关联')}</button>
              {editing && <button className="ds-btn ds-btn--ghost" type="button" onClick={() => setEditing(null)}>{t('Cancel', '取消')}</button>}
            </div>
          </form>
          <button className="ds-btn ds-btn--ghost" type="button" onClick={onDiscovery}>{t('Open discovery and automation', '打开官方发现与自动化')}</button>
        </div>
      </section>
      <section className="ds-card">
        <header className="ds-card-hd"><h2 className="ds-card-title">{t('Registry synchronization', '注册表同步')}</h2></header>
        <div className="ds-card-bd source-editor-fields">
          <p>{t('Manual sync and dry runs contact registry providers. Dry runs skip catalog updates and may record run or health data.', '手动同步和试跑都会访问注册表上游。试跑跳过目录更新，可能记录运行或健康数据。')}</p>
          {(registry.data?.items ?? []).map(source => (
            <div key={source.id} style={{ display: 'grid', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="source-editor-header">
                <div className="source-health">
                  <b>{source.code} · {source.kind}</b>
                  <span>{source.enabled ? t('Scheduled source enabled', '已启用定时同步') : t('Scheduled source disabled', '已停用定时同步')} · {t('Interval (seconds)', '间隔（秒）')} {source.cadenceSeconds}</span>
                  <span>{t('Last success', '最近成功')} {source.lastSuccessAt ?? '—'}{source.lastError ? ' · ' + source.lastError : ''}</span>
                  {source.circuitOpenUntil && <span>{t('Circuit open until', '熔断截止')} {source.circuitOpenUntil}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="ds-btn ds-btn--ghost"
                    type="button"
                    disabled={patchSource.isPending}
                    onClick={() => { void updateRegistrySource(source, { enabled: !source.enabled }); }}
                  >
                    {source.enabled ? t('Disable', '停用') : t('Enable', '启用')}
                  </button>
                  <button
                    className="ds-btn ds-btn--ghost"
                    type="button"
                    onClick={() => {
                      if (editingRegCode === source.code) setEditingRegCode(null);
                      else {
                        setEditingRegCode(source.code);
                        setRegCadence(source.cadenceSeconds);
                      }
                    }}
                  >
                    {t('Cadence', '调频率')}
                  </button>
                  {(source.consecutiveFailures > 0 || source.circuitOpenUntil || source.lastError) && (
                    <button
                      className="ds-btn ds-btn--ghost"
                      type="button"
                      disabled={patchSource.isPending}
                      onClick={() => { void updateRegistrySource(source, { clearCircuit: true }); }}
                    >
                      {t('Reset circuit', '解除熔断')}
                    </button>
                  )}
                  {source.kind === 'official_feed' ? (
                    <button className="ds-btn ds-btn--ghost" type="button" onClick={onDiscovery}>{t('Open official discovery', '打开官方发现')}</button>
                  ) : (
                    <>
                      <button className="ds-btn ds-btn--ghost" type="button" disabled={syncSource.isPending || (source.kind === 'artificial_analysis' && status.data?.aaKeyConfigured !== true)} onClick={() => { void sync(source.code, true); }}>{t('Dry run', '试跑')}</button>
                      <button className="ds-btn" type="button" disabled={syncSource.isPending || (source.kind === 'artificial_analysis' && status.data?.aaKeyConfigured !== true)} onClick={() => { void sync(source.code, false); }}>{t('Sync now', '立即同步')}</button>
                    </>
                  )}
                </div>
              </div>
              {editingRegCode === source.code && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    className="wb-input"
                    min={60}
                    max={604800}
                    style={{ width: 140 }}
                    value={regCadence}
                    onChange={(e) => setRegCadence(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    className="ds-btn"
                    disabled={patchSource.isPending}
                    onClick={() => { void updateRegistrySource(source, { cadenceSeconds: regCadence }); }}
                  >
                    {t('Save cadence', '保存同步间隔')}
                  </button>
                  <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setEditingRegCode(null)}>
                    {t('Cancel', '取消')}
                  </button>
                </div>
              )}
            </div>
          ))}
          <h3>{t('Recent synchronization runs', '最近同步记录')}</h3>
          {(runs.data?.items ?? []).map(run => (
            <div key={run.id} className="source-health">
              <span>{run.startedAt} · {run.sourceCode} · {run.triggerKind} · {run.status}</span>
              <span>{t('Seen / changed / candidates', '扫描 / 变更 / 候选')} {run.itemsSeen} / {run.itemsChanged} / {run.candidatesCreated}{run.errorMessage ? ' · ' + run.errorMessage : ''}</span>
            </div>
          ))}
          {runs.isSuccess && !runs.data?.items.length && <p>{t('No sync runs recorded.', '暂无同步记录。')}</p>}
        </div>
      </section>
    </div>
  );
}
