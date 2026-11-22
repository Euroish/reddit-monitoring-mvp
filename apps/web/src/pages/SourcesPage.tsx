import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { providerResourceReservation, viewerCollectionDemand } from '../../../../packages/contracts/src/collection-budget';
import '../styles/collection.css';
import {
  AlertTriangle,
  Database,
  Play,
  Plus,
  RefreshCw,
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
  useProviderCredentialsQuery,
  useQuotasSummaryQuery,
  useRefreshSourceMutation,
  useSourcesQuery,
  useUnblockSourceMutation,
  useUpdateSourceMutation,
} from '../api/hooks';
import { ProviderBudgetEditor } from '../components/ProviderBudgetEditor';
import { CollectionJobsView } from '../components/CollectionJobsView';
import { ProviderCredentialsTab } from '../components/ProviderCredentialsTab';
import { QuotasManagementView } from '../components/QuotasManagementView';
import { R4ArchivePanel } from '../components/R4ArchivePanel';
import { FeedSourcePreview, ResearchSourceProjects, SourceDomainSummary, SourceJobHistory } from '../components/SourceDomainOverview';
import { SourceEditor } from '../components/SourceEditor';
import { SourceImportDialog } from '../components/SourceImportDialog';
import { collectionLimits, isRedditArchiveSource, isResearchSource, sourceNeedsAttention } from '../lib/collectionLimits';
import {
  type Actor,
  type ProviderBudget,
  formatSourceTarget,
  generateUuidV4,
  isValidUuid,
  utf8ByteLength,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { toSafeUtcIso } from '../lib/sourceLabels';

const sourceSections = ['overview', 'plan', 'jobs', 'technical'] as const;
type SourceSection = typeof sourceSections[number];

const channelNames: Record<string, string> = {
  feed: 'Web / Feed', newsnow: 'Web / NewsNow', kaix: 'Reddit / Apify Kaix', red_crawler: 'Reddit / Apify red_crawler',
  twitterapis: 'X / TwitterAPIs', scrapebadger: 'X / ScrapeBadger', bluesky_appview: 'Bluesky / AppView', external_ingest: 'External Push',
};

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
  const queryClient = useQueryClient();
  const canWrite = actor.clientKind === 'browser' && actor.role !== 'viewer';

  const sp = new URLSearchParams(initialQueryString);
  const urlTab = sp.get('tab');
  const openNewFromUrl = sp.get('new') === '1';

  const denied = !canWrite && (actor.clientKind !== 'browser' || (urlTab !== 'budgets' && urlTab !== 'jobs'));
  const sourcesQuery = useSourcesQuery(!denied);
  const budgetsQuery = useBudgetsQuery(canWrite);
  const quotasSummaryQuery = useQuotasSummaryQuery(!denied);
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const capabilities = sourcesQuery.isError ? [] : sourcesQuery.data?.capabilities ?? [];
  const budgets = budgetsQuery.data?.budgets || [];

  const routeDomain = sp.get('domain');
  const domainFilter: 'all' | 'research' | 'feed' =
    routeDomain === 'research' || routeDomain === 'feed' ? routeDomain : 'all';
  const tab =
    urlTab === 'budgets' || urlTab === 'jobs' || (urlTab === 'providers' && canWrite)
      ? urlTab
      : 'sources';
  const credentialsQuery = useProviderCredentialsQuery(canWrite && (tab === 'sources' || tab === 'providers'));
  const networkOff = credentialsQuery.data?.networkEnabled === false;
  const pageTitle =
    tab === 'jobs'
      ? t('Global Collection Jobs', '全站采集任务')
      : tab === 'budgets'
        ? (canWrite ? t('Quotas & Plan Policies', '渠道配额与套餐策略') : t('My Collection Quota', '我的采集配额'))
        : tab === 'providers'
          ? t('Provider API Keys', '第三方采集密钥')
          : domainFilter === 'feed'
            ? t('Feed Sources', '资讯信息流源')
            : domainFilter === 'research'
              ? t('Research Sources', '研究采集源')
              : t('Sources', '来源列表');
  const pageDescription =
    tab === 'jobs'
      ? t('Track collection requests, storage results and failures.', '查看全站采集状态、入库结果和失败原因。')
      : tab === 'budgets'
        ? t('Review request and resource limits, usage and collection permissions.', '分别查看渠道请求与资源额度、用量及 Free/Pro 套餐策略。')
        : tab === 'providers'
          ? t('Manage encrypted upstream provider credentials (Apify, TwitterAPIs, ScrapeBadger) for pull collection.', '集中管理第三方采集服务商凭证（Apify、TwitterAPIs、ScrapeBadger 等），配置后即可用于研究或资讯拉取。')
          : domainFilter === 'research'
            ? t('Register research targets, run a trial and manage the schedules that supply research projects.', '登记研究目标、试运行，管理为研究项目提供数据的定时采集。')
            : domainFilter === 'feed'
              ? t('Manage RSS, web feeds and NewsNow channels. Check stored stories and automatic updates.', '管理 RSS、网页信息流和 NewsNow 频道，查看最近入库内容和自动更新状态。')
              : t('Choose a source to check its health, schedule auto-collection, or jump to its jobs.', '选择一个来源，检查运行状态、管理自动爬取调度或跳转至任务记录。');
  const feedDomain = domainFilter === 'feed';
  const domainView = domainFilter !== 'all';
  const requestedSection = sp.get('section');
  const section = sourceSections.find(item => item === requestedSection) ?? 'overview';

  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'paused' | 'archived'>('all');
  const [healthFilter, setHealthFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [createChannel, setCreateChannel] = useState<string>();
  const [createPreset, setCreatePreset] = useState<'push' | 'reddit_archive'>();
  const [launchSourceId, setLaunchSourceId] = useState<string>();
  const operationForm = useRef<HTMLFormElement>(null);
  const routeSourceId = sp.get('sourceId');
  const domainCapabilities = capabilities.filter(cap => !domainView || (cap.platform === 'web') === feedDomain);
  const effectivePlatform = feedDomain ? '' : platformFilter;
  const filterCapability = domainCapabilities.find(capability => capability.provider === providerFilter);
  const domainSources = sources.filter(source =>
    domainFilter === 'all' ? true : domainFilter === 'feed' ? !isResearchSource(source) : isResearchSource(source),
  );
  const channelIds = [...new Set([...domainCapabilities.map(capability => capability.provider), 'external_ingest', ...domainSources.map(source => source.primaryProvider)])];
  const visibleSources = domainSources.filter(source => (stateFilter === 'all' || source.state === stateFilter) &&
    (!effectivePlatform || source.platform === effectivePlatform) &&
    (healthFilter !== 'scheduled' || (source.state === 'active' && source.schedule?.enabled && !source.automaticCollectionBlocked)) &&
    (healthFilter !== 'attention' || sourceNeedsAttention(source)) &&
    (!groupFilter || source.sourceGroup === groupFilter) && (!providerFilter || source.primaryProvider === providerFilter || source.fallbackProvider === providerFilter) &&
    (!sourceSearch.trim() || `${source.label} ${formatSourceTarget(source.target)} ${source.platform} ${source.sourceGroup ?? ''}`.toLocaleLowerCase().includes(sourceSearch.trim().toLocaleLowerCase())));
  const selectedSource = visibleSources.find(source => source.id === routeSourceId) ?? visibleSources[0];
  useEffect(() => {
    if (!launchSourceId || launchSourceId !== selectedSource?.id) return;
    const frame = requestAnimationFrame(() => {
      operationForm.current?.focus();
      setLaunchSourceId(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [launchSourceId, selectedSource?.id]);
  const [editorMode, setSourceEditor] = useState<'create' | 'edit' | 'preview' | null>(null);
  const sourceEditor = tab === 'sources' ? editorMode ?? (openNewFromUrl ? 'create' : null) : null;
  const [importOpen, setImportOpen] = useState(false);
  const channelsPath = '/sources?tab=providers';
  const sourcePath = (id: string, nextSection?: SourceSection) => {
    const params = new URLSearchParams({ sourceId: id });
    if (domainView) {
      params.set('tab', 'sources');
      params.set('domain', domainFilter);
      if (nextSection) params.set('section', nextSection);
    }
    return '/sources?' + params.toString();
  };

  function closeSourceEditor() {
    setCreateChannel(undefined);
    setCreatePreset(undefined);
    setSourceEditor(null);
    if (openNewFromUrl) {
      sp.delete('new');
      onNavigate('/sources' + (sp.size ? '?' + sp.toString() : ''));
    }
  }

  function resetSourceDraft() {
    setOpsMsg(null);
    setAckUnblockCharge(false);
    setDraftLimit(null);
    setUseFallback(false);
    setIncludeComments(false);
    setRefreshIdsRaw('');
    setIngestDraft(undefined);
  }

  function selectSource(id: string, launch = false) {
    if (id !== selectedSource?.id) resetSourceDraft();
    if (id !== routeSourceId || launch || section !== 'overview') onNavigate(sourcePath(id, launch ? 'plan' : undefined));
    if (launch) {
      if (providerFilter) setUseFallback(providerFilter === sources.find(source => source.id === id)?.fallbackProvider);
      setLaunchSourceId(id);
    }
  }

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
  const selectedBudget = budgets.find(budget => budget.provider === selectedSourceCap?.provider);
  const resourceCap = selectedBudget ? Math.min(selectedBudget.daily_resources, selectedBudget.monthly_resources) : undefined;
  const exceedsBudget = !budgetDisabled && collectionQuote !== null && resourceCap !== undefined && collectionQuote.system > resourceCap;
  const canDispatch = selectedSource?.state === 'active' && !selectedSource.automaticCollectionBlocked &&
    !networkOff && !budgetDisabled && !exceedsBudget && maxAllowedLimit > 0;

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
      setJobActionError('');
      setAckJobCharge(false);
      setInspectJobId(res.jobId);
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
  const inspectedJob = jobDetailQuery.data?.job;
  const completedSourceId = inspectedJob?.status === 'succeeded' || inspectedJob?.status === 'completed' ? inspectedJob.source_id : null;
  useEffect(() => {
    if (!completedSourceId) return;
    for (const queryKey of [['sources'], ['jobs', completedSourceId], ['recentJobs'], ['budgets'], ['quotasSummary'], ['content'], ['overview'], ['contentFacets']]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient, completedSourceId, inspectedJob?.id]);
  const [ackJobCharge, setAckJobCharge] = useState(false);

  const [editBudget, setEditBudget] = useState<ProviderBudget | null>(null);
  const blockedCount = domainSources.filter((s) => s.automaticCollectionBlocked).length;

  if (denied) return <div className="ds-page collection-page">
    <h1 className="page-title">{t('Operations Admin', '运维管理')}</h1>
    <p role="alert" className="wb-alert wb-alert--warn">{t('Only owners and administrators can manage sources and provider credentials.', '仅所有者和管理员可以管理来源及服务商密钥。')}</p>
    <a href="/projects">{t('Go to research projects', '前往研究项目')}</a>
  </div>;

  return (
    <div className="ds-page collection-page">
      <div className="crumb">
        <button type="button" onClick={() => onNavigate('/sources?tab=sources&domain=research')}>
          {t('Operations Admin', '运维管理')}
        </button>
        <span>/</span>
        <b>{pageTitle}</b>
      </div>

      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{pageTitle}</h1>
            {tab === 'sources' && <span className="state-chip">{domainSources.length} {t('sources', '个来源')}</span>}
          </div>
          <p className="page-desc">{pageDescription}</p>
        </div>

        <div className="page-actions">
          {canWrite && tab === 'sources' && (
            <>
              <button type="button" className="ds-btn" onClick={() => { setCreateChannel(undefined); setCreatePreset(undefined); setSourceEditor('create'); }}>
                <Plus size={14} />
                <span>{feedDomain ? t('Add feed source', '添加资讯源') : domainView ? t('Add research source', '新建研究源') : t('Add Source', '新建来源')}</span>
              </button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setImportOpen(true)}>
                <Upload size={13} /> {feedDomain ? t('Import OPML', '导入 OPML') : t('Import sources', '批量导入来源')}
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
          onOpenSource={id => {
            setStateFilter('all');
            setGroupFilter('');
            setProviderFilter('');
            setSourceSearch('');
            resetSourceDraft();
            const source = sources.find(item => item.id === id);
            const domain = source && isResearchSource(source) ? 'research' : 'feed';
            onNavigate('/sources?tab=sources&domain=' + domain + '&sourceId=' + id);
          }} onInspect={id => { setJobActionError(''); setAckJobCharge(false); setInspectJobId(id); }} />
      ) : tab === 'budgets' ? (
        <QuotasManagementView actor={actor} budgets={budgets} budgetError={budgetsQuery.error} budgetsPending={budgetsQuery.isPending} providers={capabilities} sources={sources} onEditBudget={setEditBudget} />
      ) : tab === 'providers' ? (
        <div className="collection-stack">
          {networkOff && <div role="status" className="wb-alert wb-alert--warn collection-panel-notice">
            {t('Server collection networking is off. Set SOURCE_NETWORK_ENABLED=true in the deployment environment and recreate the app container to enable pull collection.', '服务端采集联网已关闭。在部署环境设置 SOURCE_NETWORK_ENABLED=true 并重建应用容器后，才能拉取。')}
          </div>}
          <ProviderCredentialsTab canManage={canWrite} />
        </div>
      ) : (
        <div className="collection-stack">
          {domainView && sourcesQuery.isSuccess && <SourceDomainSummary sources={domainSources} domain={domainFilter} />}
          {canWrite && <section className="source-channel-summary" aria-label={t('Channel readiness', '渠道健康')}>
            <div>
              <strong>{t('Channel readiness', '渠道健康')}</strong>
              {networkOff ? <span>{t('Collection networking is off.', '服务端采集联网已关闭。')}</span>
                : domainCapabilities.length > 0 && budgetsQuery.isSuccess ? <span>
                  {domainCapabilities.filter(cap => cap.enabled && !providerBudgetDisabled(cap.provider)).length} / {domainCapabilities.length} {t('channels ready with budgets enabled', '个渠道就绪且预算启用')}
                </span> : <span>{t('Readiness unavailable', '暂无就绪信息')}</span>}
            </div>
            <div className="collection-toolbar">
              <a className="ds-btn ds-btn--ghost" href={channelsPath}>{t('Manage Credentials', '管理服务商密钥')}</a>
              <a className="ds-btn ds-btn--ghost" href="/sources?tab=budgets">{t('Provider budgets', '渠道预算')}</a>
            </div>
          </section>}
          <div className="ds-grid collection-source-grid">
          {/* Left Source List (c5) */}
          <div className="c5">
            <div className="ds-card collection-panel">
              <div className="ds-card-hd collection-panel-header">
                <div>
                  <div className="ds-card-title">
                    <Database size={14} color="var(--wb-purple)" />
                    <span>{feedDomain ? t('Feed channels', '频道与订阅目录') : domainView ? t('Research target directory', '研究目标目录') : t('Select a collection source', '选择采集来源')}</span>
                  </div>
                  <div className="ds-card-sub">{feedDomain ? t('Select a channel to inspect its latest stories.', '选择频道，查看最近入库资讯。') : t('Search by target, platform or name.', '可按目标、平台或来源名称查找。')}</div>
                </div>
                <div className="seg collection-segment">
                  {(['all', 'active', 'paused', 'archived'] as const).map((st) => (
                    <button key={st} type="button" className={stateFilter === st ? 'on' : ''} aria-pressed={stateFilter === st} onClick={() => { setStateFilter(st); resetSourceDraft(); }}>
                      {st === 'all' ? t('All', '全部') : st === 'active' ? t('Active', '已启用') : st === 'paused' ? t('Paused', '暂停') : t('Archived', '归档')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ds-card-bd" style={{ paddingTop: 10 }}>
                <div className="source-directory-filters">
                  <label className="wb-field">{t('Find a source', '查找来源')}
                    <input type="search" className="wb-input" value={sourceSearch} onChange={event => { setSourceSearch(event.target.value); resetSourceDraft(); }} placeholder={feedDomain ? t('Channel name or URL', '频道名称或地址') : t('Name or target', '来源名称或采集目标')} />
                  </label>
                  {domainView && <div className="source-directory-filter-pair">
                    {!feedDomain && <label className="wb-field">{t('Platform', '平台')}
                      <select className="wb-select" value={effectivePlatform} onChange={event => { setPlatformFilter(event.target.value); resetSourceDraft(); }}>
                        <option value="">{t('All platforms', '全部平台')}</option>
                        {[...new Set(domainSources.map(source => source.platform))].sort().map(platform => <option key={platform}>{platform}</option>)}
                      </select>
                    </label>}
                    <label className="wb-field">{t('Update health', '更新状态')}
                      <select className="wb-select" value={healthFilter} onChange={event => { setHealthFilter(event.target.value); resetSourceDraft(); }}>
                        <option value="">{t('All update states', '全部更新状态')}</option>
                        <option value="scheduled">{t('Scheduled', '定时更新已开启')}</option>
                        <option value="attention">{t('Needs attention', '需处理')}</option>
                      </select>
                    </label>
                  </div>}
                  <label className="wb-field">{t('Collection channel', '采集渠道')}
                    <select className="wb-select" aria-label={t('Collection channel', '采集渠道')} value={providerFilter} onChange={event => { setProviderFilter(event.target.value); resetSourceDraft(); }}>
                      <option value="">{t('All channels', '全部渠道')}</option>
                      {channelIds.map(channel => <option key={channel} value={channel}>{channelNames[channel] ?? channel} · {domainSources.filter(source => source.primaryProvider === channel || source.fallbackProvider === channel).length}</option>)}
                    </select>
                  </label>
                  {filterCapability && <div className="collection-toolbar">
                    <span className="collection-status">{filterCapability.enabled ? t('Channel ready', '渠道就绪') : t('Channel unavailable', '渠道未就绪')}</span>
                    {canWrite && filterCapability.enabled && <button type="button" className="ds-btn ds-btn--ghost" onClick={() => {
                      setCreatePreset(undefined);
                      setCreateChannel(filterCapability.provider);
                      setSourceEditor('create');
                    }}>{t('Add a source for this channel', '新建此渠道来源')}</button>}
                    {canWrite && !filterCapability.enabled && <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate(channelsPath)}>{t('Check channel settings', '检查渠道设置')}</button>}
                  </div>}
                  {!filterCapability && providerFilter === 'external_ingest' && <div className="collection-toolbar">
                    <span className="collection-status collection-status--ok">{t('Push / R4 archive ready', '推流与离线归档就绪')}</span>
                    {canWrite && !feedDomain && <button type="button" className="ds-btn ds-btn--ghost" onClick={() => {
                      setCreateChannel(undefined);
                      setCreatePreset('reddit_archive');
                      setSourceEditor('create');
                    }}>{t('Add R4 offline archive source', '新建 R4 离线归档源')}</button>}
                    {canWrite && <button type="button" className="ds-btn ds-btn--ghost" onClick={() => {
                      setCreateChannel(undefined);
                      setCreatePreset('push');
                      setSourceEditor('create');
                    }}>{t('Add push source', '新建普通推流源')}</button>}
                  </div>}
                  <label className="wb-field">{t('Filter by source group', '按分类筛选')}
                    <select className="wb-select" value={groupFilter} onChange={event => { setGroupFilter(event.target.value); resetSourceDraft(); }}>
                      <option value="">{t('All groups', '全部分类')}</option>
                      {[...new Set(domainSources.map(source => source.sourceGroup).filter(Boolean))].sort().map(group => <option key={group}>{group}</option>)}
                    </select>
                  </label>
                  {sourcesQuery.isError && <div role="alert" className="wb-alert wb-alert--error">{formatApiError(sourcesQuery.error)}</div>}
                  {sourcesQuery.isPending && <div role="status">{t('Loading sources…', '正在加载来源…')}</div>}
                  {sourcesQuery.isSuccess && visibleSources.length === 0 && <p className="collection-hint">{providerFilter && !domainSources.some(source => source.primaryProvider === providerFilter || source.fallbackProvider === providerFilter)
                    ? t('This channel has no configured sources yet.', '此渠道还没有已配置的来源。')
                    : t('No sources match these filters.', '没有符合筛选条件的来源。')}</p>}
                  <div className="source-directory-results">
                  {visibleSources.map((s) => {
                    const active = s.id === selectedSource?.id;
                    return (
                      <div key={s.id} className={'collection-source-row' + (active ? ' is-selected' : '')}>
                      <button
                        type="button"
                        onClick={() => selectSource(s.id)}
                        className="collection-source-select"
                        aria-pressed={active}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <b>{s.label}</b>
                          <span className={'collection-status ' + (s.state === 'active' ? 'collection-status--ok' : '')}>{s.state === 'active' ? t('Active', '已启用') : s.state === 'paused' ? t('Paused', '暂停') : t('Archived', '已归档')}</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          <span className="tag" style={{ height: 19, fontSize: 9.5 }}>{s.platform}</span>
                          <span className="tag tag--lilac" style={{ height: 19, fontSize: 9.5 }}>{s.primaryProvider}</span>
                          {s.fallbackProvider && <span className="tag tag--mint" style={{ height: 19, fontSize: 9.5 }}>fb: {s.fallbackProvider}</span>}
                          <span className="tag tag--line">{s.deliveryMode === 'pull' ? t('Pull', '主动拉取') : t('Push', '外部推流')}</span>
                          {s.schedule?.enabled && <span className="tag tag--mint">{t('Scheduled', '已设定时')}</span>}
                          {sourceNeedsAttention(s) && !s.automaticCollectionBlocked && <span className="tag tag--line">{t('Needs attention', '需处理')}</span>}
                          {s.automaticCollectionBlocked && (
                            <span className="tag" style={{ height: 19, fontSize: 9.5, background: '#fdf0ec', color: '#8f3f2a' }}>
                              <ShieldAlert size={10} /> {t('Blocked', '已阻断')}
                            </span>
                          )}
                        </div>
                        <small>{formatSourceTarget(s.target)}</small>
                      </button>
                      {s.state === 'active' && !s.automaticCollectionBlocked && actor.clientKind === 'browser' && (s.deliveryMode === 'pull' || canWrite) &&
                        <button type="button" className="ds-btn ds-btn--ghost collection-source-launch" onClick={() => selectSource(s.id, true)}
                          aria-label={(s.deliveryMode === 'pull' ? t('Start collection', '发起采集') : t('Open push ingest', '查看推流')) + ' · ' + s.label}>
                          {s.deliveryMode === 'pull' ? t('Start collection', '发起采集') : t('Open push ingest', '查看推流')}
                        </button>}
                      </div>
                    );
                  })}
                  </div>
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

                  {domainView && <div className="source-detail-nav" role="group" aria-label={t('Source detail sections', '来源详情分区')}>
                    {sourceSections.map(item => <button key={item} type="button" className="ds-btn ds-btn--ghost"
                      aria-pressed={section === item} onClick={() => onNavigate(sourcePath(selectedSource.id, item))}>
                      {item === 'overview' ? (feedDomain ? t('Story preview', '内容预览') : t('Overview', '概览'))
                        : item === 'plan' ? (feedDomain ? t('Fetch & update', '抓取与更新') : t('Collection plan', '采集计划'))
                          : item === 'jobs' ? t('Job history', '任务记录') : t('Diagnostics', '技术诊断')}
                    </button>)}
                  </div>}
                  <div className="ds-card-bd source-detail-body">
                    {feedDomain && section === 'overview' && <FeedSourcePreview sourceId={selectedSource.id} />}
                    {domainView && section === 'jobs' && <SourceJobHistory sourceId={selectedSource.id} onInspect={id => {
                      setJobActionError('');
                      setAckJobCharge(false);
                      setInspectJobId(id);
                    }} />}
                    <dl hidden={domainView && (section === 'jobs' || section === 'technical')} className="collection-source-facts">
                      <div><dt>{t('Source state', '来源管理状态')}</dt><dd>{selectedSource.state === 'active' ? t('Active', '已启用') : selectedSource.state === 'paused' ? t('Paused', '已暂停') : t('Archived', '已归档')}</dd></div>
                      <div><dt>{t('Last result', '最近任务结果')}</dt><dd>{selectedSource.health.lastStatus ?? t('No run yet', '尚无运行记录')}</dd></div>
                      <div><dt>{t('Group and tier', '分类与等级')}</dt><dd>{selectedSource.sourceGroup ?? '—'} · {selectedSource.tier}{selectedSource.locale ? ' · ' + selectedSource.locale : ''}</dd></div>
                      <div>
                        <dt>{feedDomain ? t('Automatic updates', '自动更新') : t('Schedule', '自动采集')}</dt>
                        <dd style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span>{selectedSource.deliveryMode === 'push' ? t('External push', '外部推流') : selectedSource.schedule?.enabled ? t('Enabled', '已启用') : t('Disabled', '已停用')}</span>
                          {canWrite && selectedSource.deliveryMode === 'pull' && (
                            <button
                              type="button"
                              className="ds-btn ds-btn--ghost"
                              style={{ height: 22, fontSize: 10.5, padding: '0 8px' }}
                              disabled={updateSourceMut.isPending || Boolean(selectedSource.automaticCollectionBlocked && !selectedSource.schedule?.enabled)}
                              onClick={async () => {
                                setOpsMsg(null);
                                try {
                                  const nextEnabled = !selectedSource.schedule?.enabled;
                                  await updateSourceMut.mutateAsync({
                                    id: selectedSource.id,
                                    input: {
                                      schedule: { ...selectedSource.schedule, enabled: nextEnabled },
                                      revision: selectedSource.revision,
                                    },
                                  });
                                  setOpsMsg({
                                    text: nextEnabled
                                      ? t('Automatic scheduling enabled.', '已开启后台自动爬取调度。')
                                      : t('Automatic scheduling paused.', '已暂停后台自动爬取调度。'),
                                  });
                                } catch (err) {
                                  setOpsMsg({ text: formatApiError(err), isError: true });
                                }
                              }}
                            >
                              {selectedSource.schedule?.enabled ? t('Pause schedule', '暂停定时') : t('Enable schedule', '开启定时')}
                            </button>
                          )}
                        </dd>
                      </div>
                      <div><dt>{t('Next run (UTC)', '下次计划（UTC）')}</dt><dd>{selectedSource.nextDueAt?.slice(0, 16).replace('T', ' ') ?? '—'}</dd></div>
                      <div><dt>{t('Last checked (UTC)', '最近检查（UTC）')}</dt><dd>{selectedSource.lastCheckedAt?.slice(0, 16).replace('T', ' ') ?? '—'}</dd></div>
                      <div><dt>{t('Last success (UTC)', '最近成功（UTC）')}</dt><dd>{selectedSource.lastSuccessAt?.slice(0, 16).replace('T', ' ') ?? '—'}</dd></div>
                      <div><dt>{t('Fetched / inserted', '最近抓取 / 入库')}</dt><dd>{selectedSource.health.lastFetchedCount ?? '—'} / {selectedSource.health.lastInsertedCount ?? '—'}</dd></div>
                    </dl>
                    {(() => {
                      const target = selectedSource.target;
                      if (!feedDomain || section !== 'plan' || !['feed', 'newsnow'].includes(selectedSource.primaryProvider)) return null;
                      return <section className="source-domain-section">
                        <h3>{t('Parsing configuration', '解析配置')}</h3>
                        <p>{target.type !== 'feed' ? t('NewsNow board snapshot', 'NewsNow 榜单快照')
                          : target.list?.format === 'web_list' ? t('HTML list', 'HTML 列表')
                            : target.list?.format === 'json_list' ? t('JSON list', 'JSON 列表') : t('RSS / Atom or feed discovery', 'RSS / Atom 或订阅发现')}</p>
                        <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setSourceEditor('preview')}>{t('Preview fetch', '预览抓取')}</button>
                      </section>;
                    })()}
                    {domainFilter === 'research' && section === 'overview' && <ResearchSourceProjects sourceId={selectedSource.id} />}
                    {(!domainView || section === 'technical' || section === 'plan') && selectedSource.target.type === 'feed' && selectedSource.target.list && (
                      <details className="collection-disclosure"><summary>{t('List parsing fields', '列表解析字段')}</summary>
                        {Object.entries(selectedSource.target.list).map(([name, value]) => <div key={name}>{name} · <code>{value}</code></div>)}
                      </details>
                    )}
                    <div className="collection-source-links" hidden={domainView && section !== 'overview'}>
                      <a href={'/content?sourceId=' + selectedSource.id}>{t('Stored content', '查看已入库内容')}</a>
                      <button type="button" className="collection-text-button" onClick={() => onNavigate('/sources?tab=jobs&sourceId=' + selectedSource.id)}>{t('All jobs for this source', '查看此来源的任务')}</button>
                      {canWrite && !domainView && <a href={'/projects?new=1&sourceId=' + selectedSource.id}>{t('Create a monitoring project', '新建此来源的监测项目')}</a>}
                      {canWrite && isRedditArchiveSource(selectedSource) && <a href={domainView ? sourcePath(selectedSource.id, 'technical') + '#r4-archive-console' : '#r4-archive-console'}>{t('Open R4 archive console', '跳转 R4 离线归档控制台')}</a>}
                    </div>
                    <p className="collection-hint" hidden={domainView && section !== 'technical'}>
                      {selectedSource.tags.length > 0 && <>{t('Tags', '标签')} · {selectedSource.tags.join(', ')} · </>}
                      {t('Last run', '最近运行')} · {selectedSource.health.lastStatus ?? '—'} · {t('Consecutive failures', '连续失败')} {selectedSource.health.consecutiveFailures ?? '—'}
                    </p>
                    {selectedSource.health.lastError && <details className="collection-disclosure">
                      <summary>{t('Recent run failed · diagnostic details', '最近一次运行失败 · 查看诊断详情')}</summary>
                      <p className="collection-hint">{selectedSource.health.lastError}</p>
                    </details>}
                    {selectedSource.automaticCollectionBlocked && (
                      <div className="wb-alert wb-alert--error" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 650 }}>
                          <AlertTriangle size={14} />
                          {t(
                            'Collection blocked while a provider charge is unresolved.',
                            '渠道计费结果待核实，已阻断采集。',
                          )}
                        </div>
                        <p>{t('Check the task and provider billing before resuming collection.', '请先查看任务并核对渠道计费记录，再恢复采集。')}</p>
                        <div className="collection-toolbar">
                          <a href={'/sources?tab=jobs&sourceId=' + selectedSource.id}>{t('Review jobs', '查看任务')}</a>
                          {canWrite && <><a href={channelsPath}>{t('Check credentials', '检查渠道密钥')}</a><a href="/sources?tab=budgets">{t('Check budgets', '检查渠道预算')}</a></>}
                        </div>
                        {canWrite && (
                          <div className="collection-toolbar">
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
                                  setAckUnblockCharge(false);
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

                    {domainView && section === 'technical' && <dl className="collection-source-facts">
                      <div><dt>{t('Primary provider', '主渠道')}</dt><dd>{selectedSource.primaryProvider}</dd></div>
                      <div><dt>{t('Fallback provider', '备用渠道')}</dt><dd>{selectedSource.fallbackProvider ?? '—'}</dd></div>
                      <div><dt>{t('Delivery mode', '接入方式')}</dt><dd>{selectedSource.deliveryMode}</dd></div>
                    </dl>}
                    {(!domainView || section === 'plan') && selectedSource.deliveryMode === 'pull' && actor.clientKind === 'browser' && (
                      <form ref={operationForm} tabIndex={-1} onSubmit={handleCollect} className="collection-form collection-operation">
                        <div>
                          <h3><Play size={15} />{t('Run manual collection', '手动采集')}</h3>
                          <p className="collection-hint">{t('Choose a UTC time window and an item limit. After submitting, follow the job through to storage and open the stored content from its details.', '选择 UTC 时间范围和条数上限。提交后可在任务详情跟踪入库，并打开已入库内容。')}</p>
                          {selectedSourceCap?.provider === 'newsnow' && <small>{t('NewsNow reads the current board snapshot.', 'NewsNow 获取当前榜单快照。')}</small>}
                        </div>
                        {!canDispatch && <div className="wb-alert wb-alert--warn collection-readiness">
                          {selectedSource.state !== 'active' && <span>{t('Activate this source before submitting.', '请先启用来源。')}</span>}
                          {selectedSource.automaticCollectionBlocked && <span>{t('Resolve the blocked provider request above.', '请先处理上方的未决请求。')}</span>}
                          {(networkOff || !selectedSourceCap?.enabled) && <span>{networkOff
                            ? t('Pull collection is blocked by the server networking setting above.', '采集联网已关闭，请按上方说明启用。')
                            : t('This provider is unavailable. Check its credential or select a ready fallback.', '当前渠道未就绪，请检查密钥或选择可用的备援渠道。')}</span>}
                          {budgetDisabled && <span>{t('Enable this provider budget and set all four request and resource caps above zero.', '请启用当前渠道预算，并将日/月请求和资源四项上限都设为大于 0。')}</span>}
                          {exceedsBudget && <span>{t(`This run reserves ${collectionQuote.system} units, above the daily or monthly cap of ${resourceCap}. Reduce the item limit or raise the resource cap.`, `本次执行需预留 ${collectionQuote.system} 单位，超出日或月资源上限 ${resourceCap}。请减少采集条数或提高资源上限。`)}</span>}
                          {selectedSourceCap?.enabled && maxAllowedLimit === 0 && <span>{t('Check the source target, account policy and remaining quota.', '请核对来源目标、账号采集权限和剩余额度。')}</span>}
                          <div className="collection-toolbar">
                            {canWrite && !networkOff && !selectedSourceCap?.enabled && <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate(channelsPath)}>{t('Open provider credentials', '检查服务商密钥')}</button>}
                            {canWrite && selectedBudget && (budgetDisabled || exceedsBudget) && <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setEditBudget(selectedBudget)}>{t('Edit this provider budget', '调整此渠道预算')}</button>}
                          </div>
                        </div>}
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

                    {(!domainView || section === 'technical') && actor.clientKind === 'browser' && selectedSource.deliveryMode === 'pull' && supportsRefresh && (
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

                    {(!domainView || section === 'plan') && canWrite && selectedSource.deliveryMode === 'push' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <form ref={operationForm} tabIndex={-1} onSubmit={handleIngest} className="collection-form collection-operation">
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

                {!domainView && <div className="ds-card collection-panel">
                  <div className="ds-card-hd collection-panel-header">
                    <div>
                      <div className="ds-card-title">{t('Collection Execution & Jobs', '采集任务与执行日志')}</div>
                      <div className="ds-card-sub">{t('Source directory stays focused on configuration & health; inspect runs, retries, and errors in the standalone Jobs view.', '来源列表专注配置、健康与发起；任务进度、错误与重试请前往独立「采集任务」视图查看。')}</div>
                    </div>
                    <button
                      type="button"
                      className="ds-btn ds-btn--ghost"
                      onClick={() => onNavigate('/sources?tab=jobs&sourceId=' + selectedSource.id)}
                    >
                      <RefreshCw size={12} />
                      <span>{t('Open Jobs for this Source', '查看该来源任务')}</span>
                    </button>
                  </div>
                </div>}
              </>
            )}
          </div>
        </div>
        {canWrite && (!domainView || section === 'technical') && selectedSource && isRedditArchiveSource(selectedSource) && (
          <div id="r4-archive-console" className="ds-card collection-panel">
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
          key={sourceEditor + ':' + (sourceEditor === 'create' ? domainFilter : selectedSource?.id)}
          domain={domainFilter}
          previewOnly={sourceEditor === 'preview'}
          preferredChannel={sourceEditor === 'create' ? capabilities.find(capability => capability.provider === createChannel) : undefined}
          preferredPreset={sourceEditor === 'create' ? createPreset : undefined}
          capabilities={capabilities}
          source={sourceEditor !== 'create' ? selectedSource : undefined}
          onClose={closeSourceEditor}
          onSaved={id => {
            onNavigate(sourcePath(id, section));
            setSourceSearch('');
            setStateFilter('all');
            setGroupFilter('');
            setHealthFilter('');
            setPlatformFilter('');
            if (!createChannel && !createPreset) setProviderFilter('');
            resetSourceDraft();
            setCreateChannel(undefined);
            setCreatePreset(undefined);
            setStateFilter('all');
            setGroupFilter('');
            setOpsMsg({ text: t('Source saved.', '来源已保存。') });
            setSourceEditor(null);
          }}
        />
      )}
      {importOpen && canWrite && <SourceImportDialog defaultFormat={domainFilter === 'research' ? 'json' : 'opml'} onClose={() => setImportOpen(false)} />}

      {/* Job Detail & Control Modal */}
      {inspectJobId && (
        !jobDetailQuery.data?.job ? <div role={jobDetailQuery.error ? 'alert' : 'status'} className="wb-alert">
          {jobDetailQuery.error ? formatApiError(jobDetailQuery.error) : t('Loading job details…', '正在加载任务详情…')}
          <button className="ds-btn ds-btn--ghost" type="button" onClick={() => setInspectJobId(null)}>{t('Close', '关闭')}</button>
        </div> : (
        <div className="sr-modal-backdrop" onClick={() => setInspectJobId(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="collection-job-title" className="sr-modal collection-dialog" style={{ width: 'min(560px, 100%)', padding: '22px 26px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 id="collection-job-title" style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 650 }}>
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
              const waiting = job.status === 'queued' || job.status === 'retrying';
              const waitingForBudget = waiting && job.error === 'Waiting for provider budget';
              const finished = job.status === 'succeeded' || job.status === 'completed';
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
                  {waiting && <p role="status" className="collection-hint">{waitingForBudget
                    ? t('Waiting for the channel budget or minimum execution interval.', '等待渠道预算或最短执行间隔。')
                    : t('Waiting for the collection worker.', '等待采集 Worker 执行。')} {job.next_run_at && Number.isFinite(Date.parse(job.next_run_at)) &&
                    <time dateTime={job.next_run_at}>{t('Earliest attempt (UTC)', '最早尝试时间（UTC）')} · {job.next_run_at.slice(0, 19).replace('T', ' ')}</time>}</p>}
                  {job.error && !waitingForBudget && <div role="alert" className="wb-alert wb-alert--error">{job.error}</div>}
                  {jobActionError && <div role="alert" className="wb-alert wb-alert--error">{jobActionError}</div>}
                  {job.source_id && <a href={'/content?sourceId=' + job.source_id}>{t('View stored content for this source', '查询该来源的已入库内容')}</a>}
                  {finished && job.source_id && canWrite && <a href={'/projects?new=1&sourceId=' + job.source_id}>{t('Monitor this source', '将此来源纳入监测')}</a>}
                  {finished && job.records_processed === 0 && <p className="collection-hint">{t('This run returned no items. Check the target and time window before submitting again.', '此次执行未返回内容。再次提交前请核对来源目标和时间范围。')}</p>}
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
