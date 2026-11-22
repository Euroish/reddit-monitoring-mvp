import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Database,
  Play,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sliders,
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
  useUpdateBudgetMutation,
  useUpdateSourceMutation,
} from '../api/hooks';
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
}: {
  actor: Actor;
  initialQueryString?: string;
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

  type SourcesTab = 'sources' | 'jobs' | 'budgets';
  const defaultTab: SourcesTab = urlTab === 'budgets' ? 'budgets' : urlTab === 'jobs' ? 'jobs' : 'sources';
  const [tabState, setTabState] = useState<{ key: string; val: SourcesTab } | null>(null);
  const tab = tabState?.key === `${urlTab}:${canWrite}` ? tabState.val : defaultTab;
  const setTab = (val: SourcesTab) => setTabState({ key: `${urlTab}:${canWrite}`, val });
  const [channelsOpen, setChannelsOpen] = useState(false);

  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'paused' | 'archived'>('all');
  const [groupFilter, setGroupFilter] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState(() => sp.get('sourceId') ?? '');
  const visibleSources = sources.filter(source => (stateFilter === 'all' || source.state === stateFilter) &&
    (!groupFilter || source.sourceGroup === groupFilter));
  const selectedSource = visibleSources.find(source => source.id === selectedSourceId) ?? visibleSources[0];
  const jobsQuery = useSourceJobsQuery(selectedSource?.id ?? null);
  const [sourceEditor, setSourceEditor] = useState<'create' | 'edit' | null>(() => openNewFromUrl && canWrite ? 'create' : null);
  const [importOpen, setImportOpen] = useState(false);

  // Lifecycle & Operations
  const updateSourceMut = useUpdateSourceMutation();
  const unblockMut = useUnblockSourceMutation();
  const [ackUnblockCharge, setAckUnblockCharge] = useState(false);
  const [opsMsg, setOpsMsg] = useState<{ text: string; isError?: boolean; jobId?: string } | null>(null);

  // Pull Collect (default last 7 days to now in UTC)
  const [collectFrom, setCollectFrom] = useState(() =>
    new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 16),
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
      includeComments: limits.comments !== undefined,
      useFallback: fallbackSelected,
      ...(limits.comments !== undefined ? { maxCommentsPerPost: limits.comments } : {}),
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
  const jobDetailQuery = useJobDetailQuery(inspectJobId);
  const [ackJobCharge, setAckJobCharge] = useState(false);

  const [editBudget, setEditBudget] = useState<ProviderBudget | null>(null);
  const [bEnabled, setBEnabled] = useState(true);
  const [bDailyReq, setBDailyReq] = useState(100);
  const [bMonthlyReq, setBMonthlyReq] = useState(3000);
  const [bDailyRes, setBDailyRes] = useState(5000);
  const [bMonthlyRes, setBMonthlyRes] = useState(120000);
  const [bInterval, setBInterval] = useState(2000);
  const [bRev, setBRev] = useState(1);
  const [bErr, setBErr] = useState<string | null>(null);
  const updateBudgetMut = useUpdateBudgetMutation();

  const openBudgetModal = (b: ProviderBudget) => {
    setEditBudget(b);
    setBEnabled(b.enabled);
    setBDailyReq(b.daily_requests);
    setBMonthlyReq(b.monthly_requests);
    setBDailyRes(b.daily_resources);
    setBMonthlyRes(b.monthly_resources);
    setBInterval(b.minimum_interval_ms);
    setBRev(b.revision);
    setBErr(null);
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editBudget) return;
    setBErr(null);
    try {
      await updateBudgetMut.mutateAsync({
        provider: editBudget.provider,
        payload: {
          enabled: bEnabled,
          dailyRequests: bDailyReq,
          monthlyRequests: bMonthlyReq,
          dailyResources: bDailyRes,
          monthlyResources: bMonthlyRes,
          minimumIntervalMs: bInterval,
          revision: bRev,
        },
      });
      setEditBudget(null);
    } catch (err) {
      setBErr(formatApiError(err));
    }
  };

  const blockedCount = sources.filter((s) => s.automaticCollectionBlocked).length;

  return (
    <div className="ds-page">
      <div className="crumb">
        <span>{t('Workbench', '工作台')}</span>
        <span>/</span>
        <span>{t('Collection Ops', '数据接入')}</span>
        <span>/</span>
        <b>{t('Sources, Jobs & Quotas', '来源与采集')}</b>
      </div>

      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{t('Sources, Jobs & Provider Quotas', '来源与采集调度')}</h1>
            <span className="state-chip">
              <i className="dot" />
              {sources.length} {t('sources', '个来源')}
            </span>
          </div>
          <p className="page-desc">
            {t(
              'Capability-constrained source setup, idempotent job dispatch, phase=unknown block protection, and conservative dual-quota governance.',
              '受 capabilities 能力矩阵严格约束的建源、幂等拉取 / 批量刷新 / 1 MiB 推流导入与渠道日/月预算护栏。',
            )}
          </p>
        </div>

        <div className="page-actions">
          {canWrite && (
            <>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setTab('budgets')}>
                <Sliders size={13} />
                <span>{t('Quota Governance', '配额治理')}</span>
              </button>
              <button type="button" className="ds-btn" onClick={() => setSourceEditor('create')}>
                <Plus size={14} />
                <span>{t('Add Source', '新建来源')}</span>
              </button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setImportOpen(true)}>
                <Upload size={13} /> {t('Import sources', '批量导入来源')}
              </button>
              <a className="ds-btn ds-btn--ghost" href="/admin/queue">{t('AI operations', 'AI 情报运维')}</a>
            </>
          )}
        </div>
      </div>

      {/* DeepSeek Guardrail Filter Strip */}
      <div className="filterbar">
        <button type="button" className="fb-item accent" onClick={() => canWrite && setTab('budgets')}>
          <Shield size={12} />
          <span>{t('Guardrails Active:', '采集护栏已开启')}</span>
          <b>{t('Daily / Monthly Dual Caps', '日 / 月双额度')}</b>
        </button>
        {blockedCount > 0 && (
          <span className="fb-item" style={{ borderColor: '#f0d0c5', background: '#fdf0ec', color: '#8f3f2a' }}>
            <AlertTriangle size={12} />
            <b>{blockedCount} {t('blocked source', '个来源触发防重封锁')}</b>
          </span>
        )}
        <span className="fb-spacer" />
        <span className="fb-note">
          <i className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--wb-teal)', display: 'inline-block' }} />
          {t('Quotas reset 00:00 UTC', '配额按 UTC 日零点重置')}
        </span>
      </div>

      <div style={{ borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
        <div className="tabs">
          <button type="button" aria-selected={tab === 'sources'} onClick={() => setTab('sources')}>
            {t('Sources Center', '来源中心')} ({sources.length})
          </button>
          <button type="button" aria-selected={tab === 'jobs'} onClick={() => setTab('jobs')}>
            {t('Collection Jobs', '采集任务')}
          </button>
          <button type="button" aria-selected={tab === 'budgets'} onClick={() => setTab('budgets')}>
            {canWrite ? t('Channel Quotas & Policies', '渠道配额与策略') : t('My Quotas', '我的配额')}
          </button>
        </div>
      </div>

      {tab === 'jobs' ? (
        <CollectionJobsView actor={actor} sources={sources} onInspect={id => { setJobActionError(''); setAckJobCharge(false); setInspectJobId(id); }} />
      ) : tab === 'budgets' ? (
        <QuotasManagementView actor={actor} budgets={budgets} budgetError={budgetsQuery.error} providers={capabilities} sources={sources} onEditBudget={openBudgetModal} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {canWrite && (
            <div className="ds-card">
              <div className="ds-card-hd">
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
          <div className="ds-grid">
          {/* Left Source List (c5) */}
          <div className="c5">
            <div className="ds-card">
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title">
                    <Database size={14} color="var(--wb-purple)" />
                    <span>{t('Configured Sources', '来源列表')}</span>
                  </div>
                  <div className="ds-card-sub">{t('Pull & Push channels · optimistic lock revision', '状态、主备渠道与推流区分')}</div>
                </div>
                <div className="seg">
                  {(['all', 'active', 'paused', 'archived'] as const).map((st) => (
                    <button key={st} type="button" className={stateFilter === st ? 'on' : ''} onClick={() => setStateFilter(st)}>
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
                          setSelectedSourceId(s.id);
                          setOpsMsg(null);
                          setAckUnblockCharge(false);
                          setDraftLimit(null);
                          setUseFallback(false);
                          setIncludeComments(false);
                          setRefreshIdsRaw('');
                          setIngestDraft(undefined);
                        }}
                        style={{
                          textAlign: 'left',
                          padding: 11,
                          borderRadius: 6,
                          border: `1px solid ${active ? 'var(--wb-purple)' : 'var(--line)'}`,
                          background: active ? 'var(--wb-tint, #f7f4fe)' : '#ffffff',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <b style={{ fontSize: 12.5, color: 'var(--ink)' }}>{s.label}</b>
                          <span className={`chip-state ${s.state}`}>{s.state}</span>
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
                <div className="ds-card">
                  <div className="ds-card-hd">
                    <div>
                      <div className="ds-card-title">{selectedSource.label}</div>
                      <div className="ds-card-sub">
                        target: <code>{selectedSource.target.type}</code> = <code>{formatSourceTarget(selectedSource.target) || 'default'}</code> · rev {selectedSource.revision}
                      </div>
                    </div>
                    {canWrite && (
                      <div className="seg">
                        <button type="button" onClick={() => setSourceEditor('edit')}>{t('Edit source', '编辑来源')}</button>
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
                            {st}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="ds-card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="source-health">
                      <span>{t('Classification', '分类')} · {selectedSource.sourceGroup ?? '—'} · {selectedSource.tier}{selectedSource.locale ? ' · ' + selectedSource.locale : ''}</span>
                      <span>{t('Schedule', '调度')} · {selectedSource.deliveryMode === 'push' ? t('External', '外部推流') : selectedSource.schedule?.enabled ? t('Enabled', '已启用') : t('Disabled', '已停用')}</span>
                      {selectedSource.target.type === 'feed' && selectedSource.target.list &&
                        <details><summary>{t('List mapping', '列表解析映射')}</summary>
                          {Object.entries(selectedSource.target.list).map(([name, value]) => <div key={name}>{name} · <code>{value}</code></div>)}
                        </details>}
                      {selectedSource.tags.length > 0 && <span>{t('Tags', '标签')} · {selectedSource.tags.join(', ')}</span>}
                      <span>{t('Next due (UTC)', '下次到期（UTC）')} · {selectedSource.nextDueAt ?? '—'}</span>
                      <span>{t('Last checked (UTC)', '最近检查（UTC）')} · {selectedSource.lastCheckedAt ?? '—'}</span>
                      <span>{t('Last success (UTC)', '最近成功（UTC）')} · {selectedSource.lastSuccessAt ?? '—'}</span>
                      <span>{t('Health', '健康状态')} · {selectedSource.health.lastStatus ?? '—'} · {t('Consecutive failures', '连续失败')} {selectedSource.health.consecutiveFailures ?? '—'}</span>
                      <span>{t('Fetched / inserted', '最近抓取 / 入库')} · {selectedSource.health.lastFetchedCount ?? '—'} / {selectedSource.health.lastInsertedCount ?? '—'}</span>
                      <a href={'/content?sourceId=' + selectedSource.id}>{t('View stored content for this source', '查询该来源的已入库内容')}</a>
                    </div>
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
                              <span>acknowledgePotentialCharge: true</span>
                            </label>
                            <button
                              type="button"
                              className="ds-btn"
                              style={{ height: 28, fontSize: 11 }}
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
                      <form onSubmit={handleCollect} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
                          <Play size={13} color="var(--wb-purple)" />
                          <span>{canWrite ? t('Dispatch Pull Collect Job', '下发主动采集任务') : t('Personal Manual Collection (Subject to Plan Quota)', '个人手动采集（受套餐策略与个人额度限制）')}</span>
                          <span className="tag tag--line" style={{ height: 18, fontSize: 9 }}>Idempotency-Key auto</span>
                        </div>
                        <p className="muted">
                          {!selectedSourceCap?.enabled
                            ? t('Provider not ready. Check network settings and credentials.', '渠道未就绪，请检查联网设置及凭证。')
                            : !selectedSourceCap.targetTypes.includes(selectedSource.target.type) || !selectedSourceCap.contentKinds.includes(selectedSource.contentKind)
                              ? t('This source target or content type is outside the provider capability.', '该来源的目标或内容类型超出渠道能力范围。')
                            : budgetDisabled ? t('Provider budget is disabled or has a zero cap.', '该渠道预算已停用或上限为零。')
                            : maxAllowedLimit === 0 ? t('Manual collection is unavailable under your effective policy or remaining quota.', '有效策略或剩余额度不允许手动采集。')
                            : selectedSourceCap.automaticRequestReplay === false ? t('This provider can incur usage charges.', '该渠道可能产生使用费用。')
                            : null}
                        </p>
                        {selectedSourceCap?.limitations.map(note => <small key={note}>{note}</small>)}
                        {selectedSource.target.type === 'post' && (selectedSourceCap?.provider === 'kaix' || selectedSourceCap?.provider === 'red_crawler') &&
                          <small>{t('Post collection uses the limit as the maximum number of comments.', '按主帖采集时，limit 表示最多采集的评论数。')}</small>}
                        <div className="wb-grid-2">
                          <div className="wb-field">
                            <label htmlFor="collect-from">from (UTC)</label>
                            <input id="collect-from" type="datetime-local" className="wb-input" value={collectFrom} onChange={(e) => setCollectFrom(e.target.value)} required />
                          </div>
                          <div className="wb-field">
                            <label htmlFor="collect-to">to (UTC)</label>
                            <input id="collect-to" type="datetime-local" className="wb-input" value={collectTo} onChange={(e) => setCollectTo(e.target.value)} required />
                          </div>
                        </div>
                        <div className="wb-grid-2">
                          <div className="wb-field">
                            <label htmlFor="collect-limit">limit (max {maxAllowedLimit})</label>
                            <input id="collect-limit" type="number" className="wb-input" min={1} max={maxAllowedLimit} value={collectLimit} onChange={(e) => setDraftLimit(Number(e.target.value) || 0)} />
                          </div>
                          <div className="wb-field">
                            <label>{t('Options', '调度选项')}</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, paddingTop: 4 }}>
                              {selectedSource.fallbackProvider && (
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                  <input type="checkbox" checked={fallbackSelected} disabled={!fallbackSelected && !fallbackCap?.enabled} onChange={(e) => setUseFallback(e.target.checked)} />
                                  <span>{t('Use fallback', '使用备援')} ({selectedSource.fallbackProvider}{fallbackCap?.enabled ? '' : ' · ' + t('not ready', '未就绪')})</span>
                                </label>
                              )}
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: canIncludeComments ? 1 : 0.5 }}>
                                <input type="checkbox" disabled={!canIncludeComments} checked={canIncludeComments && includeComments} onChange={(e) => setIncludeComments(e.target.checked)} />
                                <span>includeComments</span>
                              </label>
                            </div>
                          </div>
                        </div>
                        {canIncludeComments && includeComments && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5 }}>
                            <label htmlFor="collect-comments">maxCommentsPerPost (1–{limits.maxComments})</label>
                            <input id="collect-comments" type="number" className="wb-input" style={{ width: 70 }} min={1} max={limits.maxComments} value={limits.comments ?? maxComments} onChange={(e) => setMaxComments(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
                          </div>
                        )}
                        <div>
                          <button type="submit" className="ds-btn" disabled={!canDispatch || collectLimit < 1 || collectLimit > maxAllowedLimit || collectMut.isPending}>
                            {t('Submit Collect Job', '提交采集任务')}
                          </button>
                        </div>
                      </form>
                    )}

                    {actor.clientKind === 'browser' && selectedSource.deliveryMode === 'pull' && supportsRefresh && (
                      <form onSubmit={handleRefreshIds} style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 650 }}>{t('Batch refresh by stored post ID', '按已入库主帖 ID 批量刷新')} · {t('Max IDs', '最多 ID')} {maxRefreshIds} · {refreshCap?.provider}</div>
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
                        <form onSubmit={handleIngest} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
                              <Upload size={13} color="var(--wb-purple)" />
                              {t('Push Ingest Batch (1 MiB / 100 items max)', '手工单批推流导入 (external_ingest)')}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label className="ds-btn ds-btn--ghost" style={{ height: 28, fontSize: 11, cursor: 'pointer' }}>
                                <span>{t('Load JSON File', '载入 JSON 文件')}</span>
                                <input
                                  type="file"
                                  accept=".json,application/json"
                                  aria-label={t('Import canonical JSON file', '导入规范 JSON 文件')}
                                  style={{ display: 'none' }}
                                  disabled={selectedSource.state !== 'active' || ingestMut.isPending}
                                  onChange={importIngestFile}
                                />
                              </label>
                            </div>
                          </div>
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
                <div className="ds-card">
                  <div className="ds-card-hd">
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
          <div className="ds-card">
            <div className="ds-card-hd">
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
            setTab('sources');
            setSelectedSourceId(id);
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
          <div className="sr-modal" style={{ width: 'min(560px, 100%)', padding: '22px 26px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 650 }}>
                Job Control · {jobDetailQuery.data.job.id.slice(0, 8)}
              </h3>
              <button type="button" className="sr-btn sr-btn--subtle sr-btn--xs" onClick={() => setInspectJobId(null)}>
                <X size={14} />
              </button>
            </div>
            {(() => {
              const job = jobDetailQuery.data!.job;
              const risky = job.provider_state.phase === 'starting' || job.provider_state.phase === 'unknown';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12.5 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="tag tag--lilac">status: {job.status}</span>
                    <span className="tag tag--apricot">phase: {job.provider_state.phase ?? '—'}</span>
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
                  {job.request_json && (
                    <pre style={{ background: '#fbfcf7', border: '1px solid var(--line)', padding: 10, borderRadius: 6, fontSize: 11, margin: 0, overflow: 'auto' }}>
                      {JSON.stringify(job.request_json, null, 2)}
                    </pre>
                  )}
                  {job.purpose !== 'ingest' && ['queued', 'running', 'retrying', 'failed', 'cancelled'].includes(job.status) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                      {risky && ['failed', 'cancelled'].includes(job.status) && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8f3f2a', fontWeight: 600 }}>
                          <input type="checkbox" checked={ackJobCharge} onChange={(e) => setAckJobCharge(e.target.checked)} />
                          <span>acknowledgePotentialCharge: true</span>
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
                            style={{ height: 30, fontSize: 11 }}
                            disabled={jobActionMut.isPending || (act !== 'cancel' && risky && !ackJobCharge)}
                            onClick={async () => {
                              try {
                                await jobActionMut.mutateAsync({ jobId: job.id, sourceId: job.source_id, action: act, acknowledgePotentialCharge: ackJobCharge });
                                setOpsMsg({ text: `Executed ${act} on job ${job.id.slice(0, 8)}` });
                                setInspectJobId(null);
                              } catch (err) {
                                setJobActionError(formatApiError(err));
                              }
                            }}
                          >
                            {act}
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

      {/* Edit Budget Modal */}
      {editBudget && (
        <div className="sr-modal-backdrop" onClick={() => setEditBudget(null)}>
          <div className="sr-modal" style={{ width: 'min(480px, 100%)', padding: '22px 26px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 650 }}>
                Edit Quota · {editBudget.provider} (rev {bRev})
              </h3>
              <button type="button" className="sr-btn sr-btn--subtle sr-btn--xs" onClick={() => setEditBudget(null)}><X size={14} /></button>
            </div>
            {bErr && <div className="wb-alert wb-alert--error" style={{ marginBottom: 12 }}>{bErr}</div>}
            <form onSubmit={handleSaveBudget} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={bEnabled} onChange={(e) => setBEnabled(e.target.checked)} />
                <span>Provider enabled</span>
              </label>
              <div className="wb-grid-2">
                <div className="wb-field"><label htmlFor="budget-dailyRequests">dailyRequests</label><input id="budget-dailyRequests" type="number" className="wb-input" min={0} max={1000000} value={bDailyReq} onChange={(e) => setBDailyReq(Number(e.target.value))} /></div>
                <div className="wb-field"><label htmlFor="budget-monthlyRequests">monthlyRequests</label><input id="budget-monthlyRequests" type="number" className="wb-input" min={0} max={10000000} value={bMonthlyReq} onChange={(e) => setBMonthlyReq(Number(e.target.value))} /></div>
                <div className="wb-field"><label htmlFor="budget-dailyResources">dailyResources</label><input id="budget-dailyResources" type="number" className="wb-input" min={0} max={100000000} value={bDailyRes} onChange={(e) => setBDailyRes(Number(e.target.value))} /></div>
                <div className="wb-field"><label htmlFor="budget-monthlyResources">monthlyResources</label><input id="budget-monthlyResources" type="number" className="wb-input" min={0} max={1000000000} value={bMonthlyRes} onChange={(e) => setBMonthlyRes(Number(e.target.value))} /></div>
              </div>
              <div className="wb-field"><label htmlFor="budget-minimumIntervalMs">minimumIntervalMs</label><input id="budget-minimumIntervalMs" type="number" className="wb-input" min={0} max={3600000} value={bInterval} onChange={(e) => setBInterval(Number(e.target.value))} /></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setEditBudget(null)}>{t('Cancel', '取消')}</button>
                <button type="submit" className="ds-btn" disabled={updateBudgetMut.isPending}>{t('Save Budget', '更新配额')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
