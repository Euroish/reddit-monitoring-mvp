import React, { useMemo, useRef, useState } from 'react';
import { providerResourceReservation, viewerCollectionDemand } from '../../../../packages/contracts/src/collection-budget';
import '../styles/collection.css';
import {
  AlertTriangle,
  Database,
  Play,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import {
  formatApiError,
  useBudgetsQuery,
  useCollectSourceMutation,
  useIngestSourceMutation,
  useJobActionMutation,
  useJobDetailQuery,
  useQuotasSummaryQuery,
  useRefreshSourceMutation,
  useSourceJobsQuery,
  useSourcesQuery,
  useUnblockSourceMutation,
  useUpdateSourceMutation,
} from '../api/hooks';
import { ProviderBudgetEditor } from '../components/ProviderBudgetEditor';
import { CollectionJobsView } from '../components/CollectionJobsView';
import { ProviderCredentialsTab } from '../components/ProviderCredentialsTab';
import { QuotasManagementView } from '../components/QuotasManagementView';
import { R4ArchivePanel } from '../components/R4ArchivePanel';
import { SourceEditor } from '../components/SourceEditor';
import { SourceImportDialog } from '../components/SourceImportDialog';
import { collectionLimits, isRedditArchiveSource } from '../lib/collectionLimits';
import {
  type Actor,
  type ProviderBudget,
  type SourceJob,
  formatSourceTarget,
  generateUuidV4,
  isValidUuid,
  utf8ByteLength,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { toSafeUtcIso } from '../lib/sourceLabels';

export function SourcesPage({
  actor,
  initialQueryString = '',
  onNavigate,
}: {
  actor: Actor;
  initialQueryString?: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const canWrite = actor.clientKind === 'browser' && actor.role !== 'viewer';

  const sp = new URLSearchParams(initialQueryString);
  const urlTab = sp.get('tab');
  const openNewFromUrl = sp.get('new') === '1';

  const sourcesQuery = useSourcesQuery(true);
  const budgetsQuery = useBudgetsQuery(canWrite);
  const quotasSummaryQuery = useQuotasSummaryQuery(true);
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const capabilities = sourcesQuery.isError ? [] : sourcesQuery.data?.capabilities ?? [];
  const budgets = budgetsQuery.data?.budgets || [];

  const tab = urlTab === 'budgets' || urlTab === 'jobs' ? urlTab : 'sources';
  const pageTitle = tab === 'jobs' ? t('Collection jobs', '采集任务') : tab === 'budgets'
    ? (canWrite ? t('Channel quotas', '渠道配额') : t('My collection quota', '我的采集配额'))
    : t('Sources', '来源列表');
  const pageDescription = tab === 'jobs' ? t('Track collection requests, storage results and failures.', '查看采集状态、入库结果和失败原因。')
    : tab === 'budgets' ? t('Review request and resource limits, usage and collection permissions.', '分别查看请求与资源额度、用量及采集权限。')
    : t('Choose a source to check its health, collect content or review recent jobs.', '选择一个来源，检查运行状态、提交采集或查看历史任务。');
  const [channelsOpen, setChannelsOpen] = useState(false);

  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'paused' | 'archived'>('all');
  const [groupFilter, setGroupFilter] = useState('');
  const routeSourceId = sp.get('sourceId');
  const [selection, setSelection] = useState<{ routeSourceId: string | null; id: string }>();
  const selectedSourceId = selection && selection.routeSourceId === routeSourceId ? selection.id : routeSourceId;
  const visibleSources = sources.filter(source => (stateFilter === 'all' || source.state === stateFilter) &&
    (!groupFilter || source.sourceGroup === groupFilter));
  const selectedSource = visibleSources.find(source => source.id === selectedSourceId) ?? visibleSources[0];
  const jobsQuery = useSourceJobsQuery(tab === 'sources' ? selectedSource?.id ?? null : null);
  const [sourceEditor, setSourceEditor] = useState<'create' | 'edit' | null>(() => openNewFromUrl && canWrite ? 'create' : null);
  const [importOpen, setImportOpen] = useState(false);

  // Lifecycle & Operations
  const updateSourceMut = useUpdateSourceMutation();
  const unblockMut = useUnblockSourceMutation();
  const [ackUnblockCharge, setAckUnblockCharge] = useState(false);
  const [opsMsg, setOpsMsg] = useState<{ text: string; isError?: boolean; jobId?: string } | null>(null);

  // Default to the last 24 hours in UTC.
  const [collectFrom, setCollectFrom] = useState(() =>
    new Date(Date.now() - 86_400_000).toISOString().slice(0, 16),
  );
  const [collectTo, setCollectTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [draftLimit, setDraftLimit] = useState<number | null>(null);
  const [includeComments, setIncludeComments] = useState(false);
  const [maxComments, setMaxComments] = useState(20);
  const [useFallback, setUseFallback] = useState(false);
  const collectMut = useCollectSourceMutation();
  const collectIdemRef = useRef<{ sig: string; key: string }>({ sig: '', key: generateUuidV4() });

  const fallbackCap = capabilities.find(cap => cap.provider === selectedSource?.fallbackProvider);
  const fallbackSelected = useFallback && Boolean(selectedSource?.fallbackProvider);
  const selectedSourceCap = fallbackSelected ? fallbackCap :
    capabilities.find(cap => cap.provider === selectedSource?.primaryProvider);
  const limits = collectionLimits(selectedSource, selectedSourceCap, quotasSummaryQuery.data, canWrite, includeComments, maxComments);
  const { maxLimit: maxAllowedLimit, optionalComments: canIncludeComments } = limits;
  const collectLimit = draftLimit ?? Math.min(50, Math.max(1, maxAllowedLimit));
  function providerBudgetDisabled(provider: string | undefined) {
    return budgets.some(budget => budget.provider === provider &&
      (!budget.enabled || Math.min(budget.daily_requests, budget.monthly_requests, budget.daily_resources, budget.monthly_resources) < 1)) ||
      (quotasSummaryQuery.data?.providerAvailability?.some(item => item.provider === provider && item.budgetEnabled === false) ?? false);
  }
  const budgetDisabled = providerBudgetDisabled(selectedSourceCap?.provider);
  const canDispatch = selectedSource?.state === 'active' && !selectedSource.automaticCollectionBlocked &&
    !budgetDisabled && maxAllowedLimit > 0;

  function setCollectWindow(days: number) {
    const end = Date.now();
    setCollectFrom(new Date(end - days * 86_400_000).toISOString().slice(0, 16));
    setCollectTo(new Date(end).toISOString().slice(0, 16));
  }

  const collectOptions = { includeComments: limits.comments !== undefined, maxCommentsPerPost: limits.comments };
  const collectionQuote = selectedSourceCap && selectedSource && collectLimit > 0 && collectLimit <= maxAllowedLimit
    ? {
      system: providerResourceReservation({
        ...collectOptions, provider: selectedSourceCap.provider, targetType: selectedSource.target.type,
        pageSize: collectLimit, requestResourceUpperBound: selectedSourceCap.requestResourceUpperBound,
      }),
      personal: viewerCollectionDemand(selectedSourceCap.provider, selectedSource.target.type, collectLimit, collectOptions).resources,
    } : null;

  const handleCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource || !canDispatch) return;
    setOpsMsg(null);
    const fromIso = toSafeUtcIso(collectFrom);
    const toIso = toSafeUtcIso(collectTo);
    if (!fromIso || !toIso) {
      setOpsMsg({ text: t('Please enter valid UTC start and end dates.', '请输入合法的 UTC 起止时间。'), isError: true });
      return;
    }
    if (Date.parse(fromIso) >= Date.parse(toIso)) {
      setOpsMsg({ text: t('from must be strictly earlier than to.', '开始时间必须早于结束时间。'), isError: true });
      return;
    }
    if (!Number.isInteger(collectLimit) || collectLimit < 1 || collectLimit > maxAllowedLimit) {
      setOpsMsg({ text: t('Enter a limit within the current allowance.', '请输入当前额度范围内的批量上限。'), isError: true });
      return;
    }
    const payload = {
      from: fromIso,
      to: toIso,
      limit: collectLimit,
      ...collectOptions,
      useFallback: fallbackSelected,
    };

    const sig = JSON.stringify({ sourceId: selectedSource.id, payload });
    if (collectIdemRef.current.sig !== sig) collectIdemRef.current = { sig, key: generateUuidV4() };
    try {
      const res = await collectMut.mutateAsync({
        sourceId: selectedSource.id,
        payload,
        idempotencyKey: collectIdemRef.current.key,
      });
      collectIdemRef.current = { sig: '', key: generateUuidV4() };
      setOpsMsg({ text: t(`Dispatched collect job ${res.jobId}`, `已入队采集任务 ${res.jobId}`), jobId: res.jobId });
    } catch (err) {
      setOpsMsg({ text: formatApiError(err), isError: true });
    }
  };

  // Batch Refresh IDs
  const [refreshIdsRaw, setRefreshIdsRaw] = useState('');
  const refreshMut = useRefreshSourceMutation();
  const refreshIdemRef = useRef<{ sig: string; key: string }>({ sig: '', key: generateUuidV4() });

  const refreshCap = capabilities.find(cap => cap.enabled && cap.refreshByIds &&
    (cap.provider === selectedSource?.primaryProvider || cap.provider === selectedSource?.fallbackProvider));
  const refreshPolicy = canWrite ? undefined : quotasSummaryQuery.data?.effectivePolicy;
  const refreshUsage = quotasSummaryQuery.data?.myUsage;
  const maxRefreshIds = Math.max(0, refreshPolicy ? Math.min(
    20, refreshPolicy.maxBatchLimit,
    refreshPolicy.dailyResources === null ? Infinity : refreshPolicy.dailyResources - (refreshUsage?.resourcesReserved ?? 0),
  ) : 20);
  const supportsRefresh = Boolean(refreshCap && selectedSource && (canWrite ||
    (refreshPolicy?.manualCollectEnabled && refreshPolicy.allowedProviders.includes(refreshCap.provider) &&
      (refreshPolicy.allowedSourceIds === null || refreshPolicy.allowedSourceIds.includes(selectedSource.id)) &&
      (refreshPolicy.dailyRequests === null || (refreshUsage?.requestsReserved ?? 0) < refreshPolicy.dailyRequests))));
  const canRefresh = supportsRefresh && maxRefreshIds > 0 && selectedSource?.state === 'active' &&
    !selectedSource.automaticCollectionBlocked && !providerBudgetDisabled(refreshCap?.provider);

  const handleRefreshIds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource || !canRefresh) return;
    setOpsMsg(null);
    const ids = [...new Set(refreshIdsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
    if (ids.length < 1 || ids.length > maxRefreshIds || ids.some((id) => !isValidUuid(id))) {
      setOpsMsg({ text: t('Enter valid v4 UUIDs within your refresh allowance.', '请输入当前刷新额度内有效的 UUID v4 格式帖子 ID。'), isError: true });
      return;
    }
    const sig = JSON.stringify({ sourceId: selectedSource.id, ids });
    if (refreshIdemRef.current.sig !== sig) refreshIdemRef.current = { sig, key: generateUuidV4() };
    try {
      const res = await refreshMut.mutateAsync({ sourceId: selectedSource.id, contentIds: ids, idempotencyKey: refreshIdemRef.current.key });
      refreshIdemRef.current = { sig: '', key: generateUuidV4() };
      setOpsMsg({ text: t(`Queued refresh job ${res.jobId}`, `已入队批量刷新任务 ${res.jobId}`), jobId: res.jobId });
    } catch (err) {
      setOpsMsg({ text: formatApiError(err), isError: true });
    }
  };

  // Push Ingest
  const [ingestDraft, setIngestDraft] = useState<{ sourceId: string; text: string }>();
  const ingestJson = ingestDraft?.sourceId === selectedSource?.id ? (ingestDraft?.text ?? '') : '';
  const ingestMut = useIngestSourceMutation();
  const ingestIdemRef = useRef<{ sig: string; key: string }>({ sig: '', key: generateUuidV4() });

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource || selectedSource.state !== 'active' || ingestMut.isPending) return;
    setOpsMsg(null);
    if (utf8ByteLength(ingestJson) > 1048576) {
      setOpsMsg({ text: t('413 Pre-flight: JSON payload exceeds 1 MiB limit.', '预检拦截：负载超过 1 MiB 上限。'), isError: true });
      return;
    }
    if (ingestIdemRef.current.sig !== `${selectedSource.id}:${ingestJson}`) {
      ingestIdemRef.current = { sig: `${selectedSource.id}:${ingestJson}`, key: generateUuidV4() };
    }
    try {
      const res = await ingestMut.mutateAsync({ sourceId: selectedSource.id, rawJson: ingestJson, idempotencyKey: ingestIdemRef.current.key });
      ingestIdemRef.current = { sig: '', key: generateUuidV4() };
      setOpsMsg({ text: t(`Ingested ${res.accepted} items (added ${res.added}, updated ${res.updated}). Job ${res.jobId}`, `推流成功：接收 ${res.accepted} 条（新增 ${res.added}，更新 ${res.updated}），任务 ${res.jobId}`), jobId: res.jobId });
    } catch (err) {
      setOpsMsg({ text: formatApiError(err), isError: true });
    }
  };

  const importIngestFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || selectedSource?.state !== 'active' || ingestMut.isPending) return;
    if (file.size > 1048576) {
      setOpsMsg({
        text: t('413 Pre-flight: JSON file exceeds 1 MiB limit.', '预检拦截：文件超过 1 MiB 上限，未发送请求。'),
        isError: true,
      });
      return;
    }
    try {
      const raw = await file.text();
      if (utf8ByteLength(raw) > 1048576) {
        setOpsMsg({
          text: t('413 Pre-flight: JSON payload exceeds 1 MiB limit.', '预检拦截：负载超过 1 MiB 上限，未发送请求。'),
          isError: true,
        });
        return;
      }
      JSON.parse(raw);
      setIngestDraft({ sourceId: selectedSource.id, text: raw });
      setOpsMsg(null);
    } catch (err) {
      setOpsMsg({
        text: err instanceof SyntaxError
          ? t('Invalid JSON syntax in selected file.', '所选文件不是合法的 JSON 格式，未发送请求。')
          : formatApiError(err),
        isError: true,
      });
    }
  };

  // Job Action & Budget Modal
  const jobActionMut = useJobActionMutation();
  const [inspectJobId, setInspectJobId] = useState<string | null>(() => sp.get('jobId'));
  const [jobActionError, setJobActionError] = useState('');
  const [jobNotice, setJobNotice] = useState('');
  const jobDetailQuery = useJobDetailQuery(inspectJobId);
  const [ackJobCharge, setAckJobCharge] = useState(false);

  const [editBudget, setEditBudget] = useState<ProviderBudget | null>(null);
  const blockedCount = sources.filter((s) => s.automaticCollectionBlocked).length;

  return (
    <div className="ds-page collection-page">
      <div className="crumb">
        <span>{t('Workbench', '工作台')}</span>
        <span>/</span>
        <span>{t('Collection Ops', '数据接入')}</span>
        <span>/</span>
        <b>{pageTitle}</b>
      </div>

      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{pageTitle}</h1>
            {tab === 'sources' && <span className="state-chip">{sources.length} {t('sources', '个来源')}</span>}
          </div>
          <p className="page-desc">{pageDescription}</p>
        </div>

        <div className="page-actions">
          {canWrite && tab === 'sources' && (
            <>
              <button type="button" className="ds-btn" onClick={() => setSourceEditor('create')}>
                <Plus size={14} />
                <span>{t('Add Source', '新建来源')}</span>
              </button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setImportOpen(true)}>
                <Upload size={13} /> {t('Import sources', '批量导入来源')}
              </button>
            </>
          )}
        </div>
      </div>

      {tab === 'sources' && blockedCount > 0 && (
        <div className="wb-alert wb-alert--warn" role="status">
          <AlertTriangle size={16} /> {blockedCount} {t('sources paused by unresolved provider requests.', '个来源因渠道请求未决而被阻断。')}
        </div>
      )}

      {tab === 'jobs' && jobNotice && <p className="wb-alert wb-alert--success" role="status">{jobNotice}</p>}
      {tab === 'jobs' ? (
        <CollectionJobsView key={routeSourceId ?? ''} actor={actor} sources={sources} initialSourceId={routeSourceId ?? ''}
          onOpenSource={id => onNavigate('/sources?sourceId=' + id)} onInspect={id => { setJobActionError(''); setAckJobCharge(false); setInspectJobId(id); }} />
      ) : tab === 'budgets' ? (
        <QuotasManagementView actor={actor} budgets={budgets} budgetError={budgetsQuery.error} budgetsPending={budgetsQuery.isPending} providers={capabilities} sources={sources} onEditBudget={setEditBudget} />
      ) : (
        <div className="collection-stack">
          {canWrite && (
            <div className="ds-card collection-panel">
              <div className="ds-card-hd collection-panel-header">
                <div>
                  <div className="ds-card-title">
                    <Shield size={14} color="var(--wb-teal)" />
                    <span>{t('Channel Onboarding & Vendor Credentials', '渠道接入与第三方服务商凭证')}</span>
                  </div>
                  <div className="ds-card-sub">
                    {t('Unified Apify (kaix + red_crawler), TwitterAPIs & ScrapeBadger keys · encrypted at rest', '按服务商聚合 Apify (kaix + red_crawler)、TwitterAPIs 与 ScrapeBadger 密钥，静态加密热生效')}
                  </div>
                </div>
                <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 28, fontSize: 11.5 }} onClick={() => setChannelsOpen((v) => !v)}>
                  {channelsOpen ? t('Collapse', '收起') : t('Manage Credentials', '管理服务商密钥')}
                </button>
              </div>
              {channelsOpen && (
                <div className="ds-card-bd">
                  <div className="source-health">
                    <strong>{t('Registered collection providers', '已注册采集渠道')}</strong>
                    {capabilities.length === 0 && <span>{t('No provider readiness data available.', '暂无渠道就绪信息。')}</span>}
                    {capabilities.map(capability => (
                      <span key={capability.provider}>
                        {capability.provider} · {capability.enabled ? t('Ready', '就绪') : t('Not ready', '未就绪')}
                        {providerBudgetDisabled(capability.provider) ? ' · ' + t('Budget disabled', '预算停用') : ''}
                      </span>
                    ))}
                    <p>{t('Web and Bluesky require source networking. Feed previews also respect any configured URL allowlist.', 'Web 和 Bluesky 需要开启采集联网。Feed 预览还会检查当前配置的 URL 白名单。')}</p>
                  </div>
                  <ProviderCredentialsTab canManage={canWrite} />
                </div>
              )}
            </div>
          )}
          <div className="ds-grid collection-source-grid">
          {/* Left Source List (c5) */}
          <div className="c5">
            <div className="ds-card collection-panel">
              <div className="ds-card-hd collection-panel-header">
                <div>
                  <div className="ds-card-title">
                    <Database size={14} color="var(--wb-purple)" />
                    <span>{t('Configured Sources', '来源列表')}</span>
                  </div>
                  <div className="ds-card-sub">{t('Filter sources by status or group.', '按状态或分类筛选来源。')}</div>
                </div>
                <div className="seg collection-segment">
                  {(['all', 'active', 'paused', 'archived'] as const).map((st) => (
                    <button key={st} type="button" className={stateFilter === st ? 'on' : ''} aria-pressed={stateFilter === st} onClick={() => setStateFilter(st)}>
                      {st === 'all' ? t('All', '全部') : st === 'active' ? t('Active', '运行中') : st === 'paused' ? t('Paused', '暂停') : t('Archived', '归档')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ds-card-bd" style={{ paddingTop: 10 }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <label className="wb-field">{t('Filter by source group', '按分类筛选')}
                    <select className="wb-select" value={groupFilter} onChange={event => setGroupFilter(event.target.value)}>
                      <option value="">{t('All groups', '全部分类')}</option>
                      {[...new Set(sources.map(source => source.sourceGroup).filter(Boolean))].sort().map(group => <option key={group}>{group}</option>)}
                    </select>
                  </label>
                  {sourcesQuery.isError && <div role="alert" className="wb-alert wb-alert--error">{formatApiError(sourcesQuery.error)}</div>}
                  {sourcesQuery.isPending && <div role="status">{t('Loading sources…', '正在加载来源…')}</div>}
                  {sourcesQuery.isSuccess && visibleSources.length === 0 && <div>{t('No sources match these filters.', '没有符合筛选条件的来源。')}</div>}
                  {visibleSources.map((s) => {
                    const active = s.id === selectedSource?.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelection({ routeSourceId, id: s.id });
                          setOpsMsg(null);
                          setAckUnblockCharge(false);
                          setDraftLimit(null);
                          setUseFallback(false);
                          setIncludeComments(false);
                          setRefreshIdsRaw('');
                          setIngestDraft(undefined);
                        }}
                        className={'collection-source-row' + (active ? ' is-selected' : '')}
                        aria-pressed={active}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <b>{s.label}</b>
                          <span className={'collection-status ' + (s.state === 'active' ? 'collection-status--ok' : '')}>{s.state === 'active' ? t('Active', '运行中') : s.state === 'paused' ? t('Paused', '暂停') : t('Archived', '已归档')}</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          <span className="tag" style={{ height: 19, fontSize: 9.5 }}>{s.platform}</span>
                          <span className="tag tag--lilac" style={{ height: 19, fontSize: 9.5 }}>{s.primaryProvider}</span>
                          {s.fallbackProvider && <span className="tag tag--mint" style={{ height: 19, fontSize: 9.5 }}>fb: {s.fallbackProvider}</span>}
                          <span className="tag tag--line" style={{ height: 19, fontSize: 9.5 }}>{s.deliveryMode}</span>
                          {s.automaticCollectionBlocked && (
                            <span className="tag" style={{ height: 19, fontSize: 9.5, background: '#fdf0ec', color: '#8f3f2a' }}>
                              <ShieldAlert size={10} /> BLOCKED
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Right Selected Source Detail & Jobs Monitor (c7) */}
          <div className="c7 stack-gap">
            {selectedSource && (
              <>
                <div className="ds-card collection-panel">
                  <div className="ds-card-hd collection-panel-header">
                    <div>
                      <div className="ds-card-title">{selectedSource.label}</div>
                      <div className="ds-card-sub">
                        <span>{t('Target', '目标')} · </span><code>{selectedSource.target.type}</code> = <code>{formatSourceTarget(selectedSource.target) || '—'}</code>
                        {' · '}{t('Revision', '版本')} {selectedSource.revision}
                      </div>
                    </div>
                    {canWrite && (
                      <div className="collection-toolbar">
                        <button className="ds-btn ds-btn--ghost" type="button" onClick={() => setSourceEditor('edit')}>{t('Edit source', '编辑来源')}</button>
                        <div className="seg collection-segment" role="group" aria-label={t('Source status', '来源状态')}>
                        {(['active', 'paused', 'archived'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            className={selectedSource.state === st ? 'on' : ''}
                            disabled={updateSourceMut.isPending || selectedSource.state === st}
                            onClick={async () => {
                              setOpsMsg(null);
                              try {
                                await updateSourceMut.mutateAsync({
                                  id: selectedSource.id,
                                  input: { state: st, revision: selectedSource.revision },
                                });
                                setOpsMsg({ text: t(`Source state set to ${st}.`, `来源状态已切换为 ${st}。`) });
                              } catch (err) {
                                setOpsMsg({ text: formatApiError(err), isError: true });
                              }
                            }}
                          >
                            {st === 'active' ? t('Activate', '启用') : st === 'paused' ? t('Pause', '暂停') : t('Archive', '归档')}
                          </button>
                        ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="ds-card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <dl className="collection-source-facts">
                      <div><dt>{t('Group and tier', '分类与等级')}</dt><dd>{selectedSource.sourceGroup ?? '—'} · {selectedSource.tier}{selectedSource.locale ? ' · ' + selectedSource.locale : ''}</dd></div>
                      <div><dt>{t('Schedule', '调度')}</dt><dd>{selectedSource.deliveryMode === 'push' ? t('External push', '外部推流') : selectedSource.schedule?.enabled ? t('Enabled', '已启用') : t('Disabled', '已停用')}</dd></div>
                      <div><dt>{t('Next run (UTC)', '下次计划（UTC）')}</dt><dd>{selectedSource.nextDueAt?.slice(0, 16).replace('T', ' ') ?? '—'}</dd></div>
                      <div><dt>{t('Last checked (UTC)', '最近检查（UTC）')}</dt><dd>{selectedSource.lastCheckedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</dd></div>
                      <div><dt>{t('Last success (UTC)', '最近成功（UTC）')}</dt><dd>{selectedSource.lastSuccessAt?.slice(0, 16).replace('T', ' ') ?? '—'}</dd></div>
                      <div><dt>{t('Fetched / inserted', '最近抓取 / 入库')}</dt><dd>{selectedSource.health.lastFetchedCount ?? '—'} / {selectedSource.health.lastInsertedCount ?? '—'}</dd></div>
                    </dl>
                    {selectedSource.target.type === 'feed' && selectedSource.target.list && (
                      <details className="collection-disclosure"><summary>{t('List parsing fields', '列表解析字段')}</summary>
                        {Object.entries(selectedSource.target.list).map(([name, value]) => <div key={name}>{name} · <code>{value}</code></div>)}
                      </details>
                    )}
                    <div className="collection-source-links">
                      <a href={'/content?sourceId=' + selectedSource.id}>{t('Stored content', '查看已入库内容')}</a>
                      <button type="button" className="collection-text-button" onClick={() => onNavigate('/sources?tab=jobs&sourceId=' + selectedSource.id)}>{t('All jobs for this source', '查看此来源的任务')}</button>
                    </div>
                    <p className="collection-hint">
                      {selectedSource.tags.length > 0 && <>{t('Tags', '标签')} · {selectedSource.tags.join(', ')} · </>}
                      {t('Last run', '最近运行')} · {selectedSource.health.lastStatus ?? '—'} · {t('Consecutive failures', '连续失败')} {selectedSource.health.consecutiveFailures ?? '—'}
                    </p>
                    {selectedSource.health.lastError && <div className="wb-alert wb-alert--warn">{selectedSource.health.lastError}</div>}
                    {selectedSource.automaticCollectionBlocked && (
                      <div className="wb-alert wb-alert--error" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 650 }}>
                          <AlertTriangle size={14} />
                          {t(
                            'Automatic collection BLOCKED (starting/unknown phase task risk).',
                            '已封锁自动采集（存在计费未确认的 starting / unknown 任务）。',
                          )}
                        </div>
                        {canWrite && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 10, flexWrap: 'wrap' }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                              <input type="checkbox" checked={ackUnblockCharge} onChange={(e) => setAckUnblockCharge(e.target.checked)} />
                              <span>{t('I verified the unresolved request and accept possible duplicate charges.', '我已核对未决请求，并了解再次执行可能产生重复费用。')}</span>
                            </label>
                            <button
                              type="button"
                              className="ds-btn"
                              style={{ height: 28, fontSize: 11 }}
                              disabled={!ackUnblockCharge || unblockMut.isPending}
                              onClick={async () => {
                                setOpsMsg(null);
                                try {
                                  await unblockMut.mutateAsync({ sourceId: selectedSource.id, acknowledgePotentialCharge: ackUnblockCharge });
                                  setOpsMsg({ text: t('Source unblocked.', '来源封锁已解除。') });
                                } catch (err) {
                                  setOpsMsg({ text: formatApiError(err), isError: true });
                                }
                              }}
                            >
                              <Unlock size={12} /> {t('Unblock Source', '确认并解除封锁')}
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {opsMsg && <div role={opsMsg.isError ? 'alert' : 'status'} className={`wb-alert ${opsMsg.isError ? 'wb-alert--error' : 'wb-alert--success'}`}>{opsMsg.text}{opsMsg.jobId && <button className="ds-btn ds-btn--ghost" type="button" onClick={() => {
                      setJobActionError('');
                      setAckJobCharge(false);
                      setInspectJobId(opsMsg.jobId ?? null);
                    }}>{t('Job details', '任务详情')}</button>}</div>}

                    {selectedSource.deliveryMode === 'pull' && actor.clientKind === 'browser' && (
                      <form onSubmit={handleCollect} className="collection-form collection-operation">
                        <div>
                          <h3><Play size={15} />{t('Run manual collection', '手动采集')}</h3>
                          <p className="collection-hint">{t('Choose a UTC time window and an item limit. The job enters the queue after submission.', '选择 UTC 时间范围和条数上限。提交后任务进入队列。')}</p>
                        </div>
                        {!canDispatch && <p className="wb-alert wb-alert--warn">
                          {selectedSource.state !== 'active' ? t('Activate this source before submitting.', '请先启用来源。')
                            : selectedSource.automaticCollectionBlocked ? t('Resolve the blocked provider request above.', '请先处理上方的未决请求。')
                            : !selectedSourceCap?.enabled ? t('Check service networking and credentials for this provider.', '渠道未就绪，请检查服务联网和凭证。')
                            : budgetDisabled ? t('Enable the provider budget and set positive caps.', '渠道预算已停用或上限为零，请检查渠道配额。')
                            : maxAllowedLimit === 0 ? t('Check the source target, account policy and remaining quota.', '请检查目标类型、账号策略和剩余额度。') : null}
                        </p>}
                        <div className="collection-toolbar">
                          <button className="ds-btn ds-btn--ghost" type="button" onClick={() => setCollectWindow(1)}>{t('Last 24 hours', '最近 24 小时')}</button>
                          <button className="ds-btn ds-btn--ghost" type="button" onClick={() => setCollectWindow(7)}>{t('Last 7 days', '最近 7 天')}</button>
                        </div>
                        <div className="wb-grid-2 collection-form-grid">
                          <label className="wb-field">{t('Start (UTC)', '开始时间（UTC）')}
                            <input type="datetime-local" className="wb-input" value={collectFrom} onChange={e => setCollectFrom(e.target.value)} required />
                          </label>
                          <label className="wb-field">{t('End (UTC)', '结束时间（UTC）')}
                            <input type="datetime-local" className="wb-input" value={collectTo} onChange={e => setCollectTo(e.target.value)} required />
                          </label>
                          <label className="wb-field">{t('Item limit', '采集上限')}
                            <input type="number" className="wb-input" required min={1} max={Math.max(1, maxAllowedLimit)} value={collectLimit}
                              aria-describedby="collection-limit-hint" onChange={e => setDraftLimit(Number(e.target.value) || 0)} />
                            <small className="collection-hint" id="collection-limit-hint">{t('Allowed for this request', '当前请求可用上限')} · {maxAllowedLimit} {t('items', '条')}
                              {selectedSource.target.type === 'post' && ['kaix', 'red_crawler'].includes(selectedSourceCap?.provider ?? '') && t(' of comments', '评论')}</small>
                          </label>
                          {selectedSource.fallbackProvider && <label className="wb-field">{t('Provider to use', '执行渠道')}
                            <select className="wb-select" value={fallbackSelected ? 'fallback' : 'primary'} onChange={e => setUseFallback(e.target.value === 'fallback')}>
                              <option value="primary">{selectedSource.primaryProvider} · {t('Primary', '主渠道')}</option>
                              <option value="fallback" disabled={!fallbackSelected && !fallbackCap?.enabled}>{selectedSource.fallbackProvider} · {t('Fallback', '备援')}</option>
                            </select>
                          </label>}
                        </div>
                        {canIncludeComments && <label className="collection-checkbox">
                          <input type="checkbox" checked={includeComments} onChange={e => setIncludeComments(e.target.checked)} /> {t('Also fetch comments', '同时采集评论')}
                        </label>}
                        {canIncludeComments && includeComments && <label className="wb-field">{t('Comments per post', '每帖评论上限')}
                          <input type="number" className="wb-input" required min={1} max={limits.maxComments} value={limits.comments ?? maxComments}
                            onChange={e => setMaxComments(Math.max(1, Number(e.target.value) || 1))} />
                        </label>}
                        {selectedSourceCap?.limitations.length ? <details className="collection-disclosure">
                          <summary>{t('Provider limits', '查看渠道限制')}</summary>
                          <ul>{selectedSourceCap.limitations.map(note => <li key={note}>{note}</li>)}</ul>
                        </details> : null}
                        <div className="collection-operation-footer">
                          {collectionQuote && <div className="collection-hint">
                            <span>{t('First provider execution', '首次渠道执行')} · {t('1 request', '1 次请求')} / {collectionQuote.system} {t('reserved resource units', '单位预留资源')}</span>
                            {!canWrite && <span>{t('Personal reservation at submission', '提交时个人预留')} · {t('1 request', '1 次请求')} / {collectionQuote.personal} {t('resource units', '单位资源')}</span>}
                            {selectedSourceCap?.automaticRequestReplay === false && <span>{t('This provider may charge for usage.', '该渠道可能产生费用。')}</span>}
                          </div>}
                          <button type="submit" className="ds-btn" disabled={!canDispatch || collectLimit < 1 || collectLimit > maxAllowedLimit || collectMut.isPending}>
                            {collectMut.isPending ? t('Submitting…', '正在提交…') : t('Submit Collect Job', '提交采集任务')}
                          </button>
                        </div>
                      </form>
                    )}

                    {actor.clientKind === 'browser' && selectedSource.deliveryMode === 'pull' && supportsRefresh && (
                      <form onSubmit={handleRefreshIds} className="collection-form collection-operation">
                        <h3>{t('Refresh stored posts', '刷新已入库帖子')}</h3>
                        <p className="collection-hint">{t('Paste internal post IDs from this source, separated by commas or spaces.', '请粘贴当前来源已入库帖子的内部 ID，用逗号或空格分隔。')} {t('Max IDs', '最多 ID')} {maxRefreshIds} · {refreshCap?.provider}</p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input aria-label={t('Stored post IDs', '已入库主帖 ID')} className="wb-input" style={{ flex: 1 }} value={refreshIdsRaw} onChange={(e) => setRefreshIdsRaw(e.target.value)} placeholder="33333333-3333-4333-8333-333333333301" />
                          <button type="submit" className="ds-btn ds-btn--ghost" disabled={!canRefresh || refreshMut.isPending}>
                            {t('Refresh IDs', '刷新 ID')}
                          </button>
                        </div>
                      </form>
                    )}

                    {canWrite && selectedSource.deliveryMode === 'push' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <form onSubmit={handleIngest} className="collection-form collection-operation">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <h3><Upload size={15} />{t('Import an ingest batch', '推流导入')}</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label className="ds-btn ds-btn--ghost collection-file-picker">
                                <span>{t('Load JSON File', '载入 JSON 文件')}</span>
                                <input
                                  type="file"
                                  accept=".json,application/json"
                                  aria-label={t('Import canonical JSON file', '导入规范 JSON 文件')}
                                  className="collection-file-input"
                                  disabled={selectedSource.state !== 'active' || ingestMut.isPending}
                                  onChange={importIngestFile}
                                />
                              </label>
                            </div>
                          </div>
                          <p className="collection-hint">{t('Paste a JSON object with an items array or load a file. Each batch accepts up to 100 items and 1 MiB.', '粘贴包含 items 数组的 JSON 对象，或选择本地文件。单批最多 100 条、1 MiB。')}</p>
                          {selectedSource.state !== 'active' && <p className="muted">{t('Activate this source before pushing content.', '请启用当前来源后再推流。')}</p>}
                          <textarea aria-label={t('Push batch JSON', '推流批次 JSON')} className="wb-textarea" rows={5} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} value={ingestJson} onChange={(e) => setIngestDraft({ sourceId: selectedSource.id, text: e.target.value })} placeholder='{"items": [...]}' />
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                              {(utf8ByteLength(ingestJson) / 1024).toFixed(1)} KiB / 1024 KiB
                            </span>
                            <button type="submit" className="ds-btn ds-btn--brand" disabled={selectedSource.state !== 'active' || !ingestJson.trim() || ingestMut.isPending}>
                              {t('Upload Push Batch', '提交推流批次')}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recent Jobs List */}
                <div className="ds-card collection-panel">
                  <div className="ds-card-hd collection-panel-header">
                    <div>
                      <div className="ds-card-title">{t('Collection Jobs (Last 50)', '来源采集任务监控')}</div>
                      <div className="ds-card-sub">{t('Inspect phase telemetry or cancel/retry/continue jobs', '支持取消排队 / 重试 / 断点续跑控制')}</div>
                    </div>
                    <button type="button" className="icon-square" style={{ width: 28, height: 28 }} aria-label={t('Refresh source and jobs', '刷新来源与任务')} onClick={() => { void jobsQuery.refetch(); void sourcesQuery.refetch(); }}>
                      <RefreshCw size={12} />
                    </button>
                  </div>
                  <div className="ds-card-bd" style={{ paddingTop: 6 }}>
                    {jobsQuery.error ? <div role="alert" className="wb-alert wb-alert--error">{formatApiError(jobsQuery.error)}</div> :
                    jobsQuery.isPending ? <div role="status">{t('Loading jobs…', '正在加载任务…')}</div> :
                    (jobsQuery.data?.jobs || []).length === 0 ? (
                      <div style={{ padding: 22, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                        {t('No jobs recorded for this source yet.', '该来源暂无采集任务记录。')}
                      </div>
                    ) : (
                      (jobsQuery.data?.jobs || []).map((job: SourceJob) => {
                        const phase = job.provider_state.phase ?? '—';
                        const isDone = job.status === 'succeeded' || job.status === 'completed';
                        return (
                          <div key={job.id} className="job-row">
                            <span className="wc-ico" style={{ background: job.status === 'failed' ? '#fdf0ec' : job.status === 'running' ? '#eaf6f1' : '#f4f6f0' }}>
                              <RefreshCw size={13} color={job.status === 'failed' ? '#a8462f' : job.status === 'running' ? '#1c6f5c' : 'var(--ink-3)'} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <b style={{ display: 'block', fontSize: 11.5 }}>{job.operation} · {job.provider}</b>
                              <span style={{ display: 'block', fontSize: 10, color: 'var(--faint)' }}>
                                {job.created_at.slice(0, 16).replace('T', ' ')} · {job.records_processed} {t('processed', '已处理')} · +{job.records_inserted ?? '—'} / ~{job.records_updated ?? '—'} · phase: {phase}
                              </span>
                              {job.error && <span style={{ display: 'block', fontSize: 10, color: '#a8462f' }}>{job.error}</span>}
                            </div>
                            <span className={`chip-state ${isDone ? 'active' : job.status === 'running' ? 'paused' : 'archived'}`}>
                              {job.status}
                            </span>
                            <button
                              type="button"
                              className="ds-btn ds-btn--ghost"
                              style={{ height: 26, padding: '0 10px', fontSize: 10.5 }}
                              onClick={() => {
                                setInspectJobId(job.id);
                                setJobActionError('');
                                setAckJobCharge(false);
                              }}
                            >
                              {t('Control', '控制')}
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        {canWrite && selectedSource && isRedditArchiveSource(selectedSource) && (
          <div className="ds-card collection-panel">
            <div className="ds-card-hd collection-panel-header">
              <div>
                <div className="ds-card-title">{t('Admin-Only Offline Archive Plugin (R4)', '管理员专用离线归档外挂工具 (R4)')}</div>
                <div className="ds-card-sub">{t('Isolated external Python/DuckDB command generator · never runs inside main server', '独立仓外插件命令生成器，严格遵循主线隔离与推流契约')}</div>
              </div>
            </div>
            <div className="ds-card-bd">
              <a className="ds-btn ds-btn--ghost" href={'/settings?tab=keys&archiveSource=' + selectedSource.id}>{t('Set up a scoped archive key', '配置归档专用密钥')}</a>
              <R4ArchivePanel key={selectedSource.id} sourceId={selectedSource.id} active={selectedSource.state === 'active'} />
            </div>
          </div>
        )}
        </div>
      )}

      {sourceEditor && canWrite && (sourceEditor === 'create' || selectedSource) && (
        <SourceEditor
          capabilities={capabilities}
          source={sourceEditor === 'edit' ? selectedSource : undefined}
          onClose={() => setSourceEditor(null)}
          onSaved={id => {
            onNavigate('/sources?sourceId=' + id);
            setStateFilter('all');
            setGroupFilter('');
            setOpsMsg({ text: t('Source saved.', '来源已保存。') });
            setSourceEditor(null);
          }}
        />
      )}
      {importOpen && canWrite && <SourceImportDialog onClose={() => setImportOpen(false)} />}

      {/* Job Detail & Control Modal */}
      {inspectJobId && (
        !jobDetailQuery.data?.job ? <div role={jobDetailQuery.error ? 'alert' : 'status'} className="wb-alert">
          {jobDetailQuery.error ? formatApiError(jobDetailQuery.error) : t('Loading job details…', '正在加载任务详情…')}
          <button className="ds-btn ds-btn--ghost" type="button" onClick={() => setInspectJobId(null)}>{t('Close', '关闭')}</button>
        </div> : (
        <div className="sr-modal-backdrop" onClick={() => setInspectJobId(null)}>
          <div className="sr-modal collection-dialog" style={{ width: 'min(560px, 100%)', padding: '22px 26px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 650 }}>
                {t('Job details', '任务详情')} · {jobDetailQuery.data.job.id.slice(0, 8)}
              </h3>
              <button type="button" className="sr-btn sr-btn--subtle sr-btn--xs" aria-label={t('Close job details', '关闭任务详情')} onClick={() => setInspectJobId(null)}>
                <X size={14} />
              </button>
            </div>
            {(() => {
              const job = jobDetailQuery.data!.job;
              const risky = job.provider_state.phase === 'starting' || job.provider_state.phase === 'unknown';
              const source = sources.find(item => item.id === job.source_id);
              const actionLabels = { cancel: t('Cancel job', '取消任务'), retry: t('Retry job', '重试任务'), continue: t('Resume provider run', '续跑渠道任务') };
              return (
                <div className="collection-form">
                  <div className="collection-toolbar">
                    <span className="collection-status">{t('Status', '状态')} · {job.status}</span>
                    <span className="collection-status">{t('Provider phase', '渠道阶段')} · {job.provider_state.phase ?? '—'}</span>
                    <span className="collection-status">{job.provider}</span>
                  </div>
                  <code>{job.id}</code>
                  <span>{t('Processed / inserted / updated', '处理 / 新增 / 更新')} · {job.records_processed} / {job.records_inserted ?? '—'} / {job.records_updated ?? '—'}</span>
                  {job.provider_state.runId && <span>Provider run · {job.provider_state.runId}</span>}
                  {job.error && <div role="alert" className="wb-alert wb-alert--error">{job.error}</div>}
                  {jobActionError && <div role="alert" className="wb-alert wb-alert--error">{jobActionError}</div>}
                  {job.source_id && <a href={'/content?sourceId=' + job.source_id}>{t('View stored content for this source', '查询该来源的已入库内容')}</a>}
                  {job.result_summary?.creditsUsed !== undefined &&
                    <span>{t('Credits reported by the provider', '渠道报告的积分用量')} · {job.result_summary.creditsUsed}</span>}
                  {job.result_summary?.warning && <div className="wb-alert wb-alert--warn">{job.result_summary.warning}</div>}
                  {job.request_json && <details className="collection-disclosure">
                    <summary>{t('Request parameters', '查看请求参数')}</summary>
                    <pre className="collection-code">{JSON.stringify(job.request_json, null, 2)}</pre>
                  </details>}
                  {job.purpose !== 'ingest' && source && source.state !== 'active' && <p className="collection-hint">
                    {t('Activate this source before managing its jobs.', '启用该来源后才能管理任务。')}
                  </p>}
                  {source?.state === 'active' && job.purpose !== 'ingest' && ['queued', 'running', 'retrying', 'failed', 'cancelled'].includes(job.status) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                      {risky && ['failed', 'cancelled'].includes(job.status) && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8f3f2a', fontWeight: 600 }}>
                          <input type="checkbox" checked={ackJobCharge} onChange={(e) => setAckJobCharge(e.target.checked)} />
                          <span>{t('I accept possible duplicate provider charges.', '我了解重试可能产生重复渠道费用。')}</span>
                        </label>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(['failed', 'cancelled'].includes(job.status)
                          ? (job.provider_state.phase === 'running' || job.provider_state.phase === 'reading' ? (['continue'] as const) : (['retry'] as const))
                          : (['cancel'] as const)).map((act) => (
                          <button
                            key={act}
                            type="button"
                            className={`ds-btn ${act === 'cancel' ? 'ds-btn--danger' : ''}`}
                            disabled={jobActionMut.isPending || (act !== 'cancel' && risky && !ackJobCharge)}
                            onClick={async () => {
                              try {
                                await jobActionMut.mutateAsync({ jobId: job.id, sourceId: job.source_id, action: act, acknowledgePotentialCharge: ackJobCharge });
                                const message = t('Job action submitted.', '任务操作已提交。') + ' · ' + job.id.slice(0, 8);
                                if (tab === 'jobs') setJobNotice(message);
                                else setOpsMsg({ text: message });
                                setInspectJobId(null);
                              } catch (err) {
                                setJobActionError(formatApiError(err));
                              }
                            }}
                          >
                            {actionLabels[act]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      ))}

      {editBudget && <ProviderBudgetEditor budget={editBudget} onClose={() => setEditBudget(null)} />}
    </div>
  );
}
