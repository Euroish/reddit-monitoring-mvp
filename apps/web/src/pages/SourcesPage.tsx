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
  useCreateSourceMutation,
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
import {
  type Actor,
  type ContentKind,
  DEFAULT_CAPABILITIES,
  type DeliveryMode,
  type FallbackProviderName,
  type Platform,
  type ProviderBudget,
  type ProviderName,
  type SourceJob,
  type TargetType,
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
  const canWrite = actor.role === 'owner' || actor.role === 'admin';

  const sp = new URLSearchParams(initialQueryString);
  const urlTab = sp.get('tab');
  const openNewFromUrl = sp.get('new') === '1';

  const sourcesQuery = useSourcesQuery(true);
  const budgetsQuery = useBudgetsQuery(canWrite);
  const quotasSummaryQuery = useQuotasSummaryQuery(true);
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const capabilities = sourcesQuery.data?.capabilities || DEFAULT_CAPABILITIES;
  const budgets = budgetsQuery.data?.budgets || [];

  type SourcesTab = 'sources' | 'jobs' | 'budgets';
  const defaultTab: SourcesTab = urlTab === 'budgets' ? 'budgets' : urlTab === 'jobs' ? 'jobs' : 'sources';
  const [tabState, setTabState] = useState<{ key: string; val: SourcesTab } | null>(null);
  const tab = tabState?.key === `${urlTab}:${canWrite}` ? tabState.val : defaultTab;
  const setTab = (val: SourcesTab) => setTabState({ key: `${urlTab}:${canWrite}`, val });
  const [channelsOpen, setChannelsOpen] = useState(false);

  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');

  const selectedSource = sources.find((s) => s.id === selectedSourceId) || sources[0];
  const jobsQuery = useSourceJobsQuery(selectedSource?.id || null);

  // Create Source Modal
  const [createOpen, setCreateOpen] = useState(() => openNewFromUrl && canWrite);
  const [cMode, setCMode] = useState<DeliveryMode>('pull');
  const [cPlatform, setCPlatform] = useState<Platform>('reddit');
  const [cProvider, setCProvider] = useState<ProviderName>('kaix');
  const [cFallback, setCFallback] = useState<'' | FallbackProviderName>('');
  const [cLabel, setCLabel] = useState('');
  const [cTargetType, setCTargetType] = useState<TargetType>('community');
  const [cTargetValue, setCTargetValue] = useState('');
  const [cKind, setCKind] = useState<ContentKind>('post');
  const [cError, setCError] = useState<string | null>(null);
  const createSourceMut = useCreateSourceMutation();

  const matchingCapsForPlatform = useMemo(
    () => capabilities.filter((c) => c.platform === cPlatform),
    [capabilities, cPlatform],
  );
  const activeCap = useMemo(
    () => capabilities.find((c) => c.provider === cProvider),
    [capabilities, cProvider],
  );

  const handleModeChange = (nextMode: DeliveryMode) => {
    setCMode(nextMode);
    if (nextMode === 'push') {
      setCProvider('external_ingest');
      setCFallback('');
      setCTargetType('search');
      setCKind('post');
      return;
    }
    const first = capabilities.find((c) => c.platform === cPlatform);
    if (first) {
      setCProvider(first.provider);
      setCTargetType(first.targetTypes[0]);
      setCKind(first.contentKinds[0]);
      setCFallback('');
    }
  };

  const handlePlatformChange = (nextPlat: Platform) => {
    setCPlatform(nextPlat);
    if (cMode === 'push') return;
    const first = capabilities.find((c) => c.platform === nextPlat);
    if (first) {
      setCProvider(first.provider);
      setCTargetType(first.targetTypes[0]);
      setCKind(first.contentKinds[0]);
      setCFallback('');
    }
  };

  const handleProviderChange = (nextProv: ProviderName) => {
    setCProvider(nextProv);
    const cap = capabilities.find((c) => c.provider === nextProv);
    if (!cap) return;
    if (!cap.targetTypes.includes(cTargetType)) setCTargetType(cap.targetTypes[0]);
    if (!cap.contentKinds.includes(cKind)) setCKind(cap.contentKinds[0]);
    if (cFallback && !cap.fallbackAllowed.includes(cFallback)) setCFallback('');
  };

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setCError(null);
    try {
      const val = cTargetValue.trim() || (cMode === 'push' ? 'r4-archive-import' : 'default');
      const targetPayload: Record<string, string> =
        cTargetType === 'community'
          ? { type: 'community', community: val }
          : cTargetType === 'account'
            ? { type: 'account', account: val }
            : cTargetType === 'post'
              ? { type: 'post', postId: val }
              : cTargetType === 'feed'
                ? { type: 'feed', url: val }
                : { type: 'search', query: val };
      const res = await createSourceMut.mutateAsync({
        platform: cPlatform,
        primaryProvider: cMode === 'push' ? 'external_ingest' : cProvider,
        ...(cMode === 'pull' && cFallback ? { fallbackProvider: cFallback } : {}),
        label: cLabel.trim(),
        target: targetPayload,
        contentKind: cKind,
        deliveryMode: cMode,
      });
      setSelectedSourceId(res.source.id);
      setCreateOpen(false);
      setCLabel('');
      setCTargetValue('');
    } catch (err) {
      setCError(formatApiError(err));
    }
  };

  // Lifecycle & Operations
  const updateSourceMut = useUpdateSourceMutation();
  const unblockMut = useUnblockSourceMutation();
  const [ackUnblockCharge, setAckUnblockCharge] = useState(false);
  const [opsMsg, setOpsMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // Pull Collect
  const [collectFrom, setCollectFrom] = useState(() =>
    new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 16),
  );
  const [collectTo, setCollectTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [collectLimit, setCollectLimit] = useState(50);
  const [includeComments, setIncludeComments] = useState(false);
  const [maxComments, setMaxComments] = useState(20);
  const [useFallback, setUseFallback] = useState(false);
  const collectMut = useCollectSourceMutation();
  const collectIdemRef = useRef<{ sig: string; key: string }>({ sig: '', key: generateUuidV4() });

  const selectedSourceCap = useMemo(() => {
    if (!selectedSource) return undefined;
    const activeProv = useFallback && selectedSource.fallback_provider ? selectedSource.fallback_provider : selectedSource.primary_provider;
    return capabilities.find((c) => c.provider === activeProv);
  }, [selectedSource, useFallback, capabilities]);

  const maxAllowedLimit = useMemo(() => {
    if (!selectedSourceCap) return 100;
    if (selectedSourceCap.provider === 'red_crawler' && selectedSource?.target.type !== 'post') return 100;
    if (selectedSourceCap.provider === 'kaix' && includeComments) return Math.max(1, Math.floor(2000 / (maxComments + 1)));
    return selectedSourceCap.maxLimit;
  }, [selectedSourceCap, selectedSource, includeComments, maxComments]);

  const canIncludeComments = useMemo(() => {
    if (!selectedSourceCap || !selectedSourceCap.supportsComments) return false;
    if (selectedSourceCap.postOnlyComments && selectedSource?.target.type !== 'post') return false;
    return true;
  }, [selectedSourceCap, selectedSource]);

  const handleCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource) return;
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
    const payload = {
      from: fromIso,
      to: toIso,
      limit: Math.min(collectLimit, maxAllowedLimit),
      includeComments: canIncludeComments ? includeComments : false,
      useFallback,
      ...(canIncludeComments && includeComments ? { maxCommentsPerPost: maxComments } : {}),
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
      setOpsMsg({ text: t(`Dispatched collect job ${res.jobId}`, `已入队采集任务 ${res.jobId}`) });
    } catch (err) {
      setOpsMsg({ text: formatApiError(err), isError: true });
    }
  };

  // Batch Refresh IDs
  const [refreshIdsRaw, setRefreshIdsRaw] = useState('');
  const refreshMut = useRefreshSourceMutation();
  const refreshIdemRef = useRef<{ sig: string; key: string }>({ sig: '', key: generateUuidV4() });

  const supportsRefresh = useMemo(() => {
    if (!selectedSource) return false;
    const p1 = capabilities.find((c) => c.provider === selectedSource.primary_provider)?.refreshByIds;
    const p2 = selectedSource.fallback_provider ? capabilities.find((c) => c.provider === selectedSource.fallback_provider)?.refreshByIds : false;
    return Boolean(p1 || p2);
  }, [selectedSource, capabilities]);

  const handleRefreshIds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource) return;
    setOpsMsg(null);
    const ids = [...new Set(refreshIdsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
    if (ids.length < 1 || ids.length > 20 || ids.some((id) => !isValidUuid(id))) {
      setOpsMsg({ text: t('Provide 1..20 valid UUID v4 content IDs.', '请输入 1~20 个合法 UUID v4 格式的帖子 ID。'), isError: true });
      return;
    }
    const sig = JSON.stringify({ sourceId: selectedSource.id, ids });
    if (refreshIdemRef.current.sig !== sig) refreshIdemRef.current = { sig, key: generateUuidV4() };
    try {
      const res = await refreshMut.mutateAsync({ sourceId: selectedSource.id, contentIds: ids, idempotencyKey: refreshIdemRef.current.key });
      refreshIdemRef.current = { sig: '', key: generateUuidV4() };
      setOpsMsg({ text: t(`Queued refresh job ${res.jobId}`, `已入队批量刷新任务 ${res.jobId}`) });
    } catch (err) {
      setOpsMsg({ text: formatApiError(err), isError: true });
    }
  };

  // Push Ingest
  const [ingestJson, setIngestJson] = useState('');
  const ingestMut = useIngestSourceMutation();
  const ingestIdemRef = useRef<{ sig: string; key: string }>({ sig: '', key: generateUuidV4() });

  const fillSampleIngest = () => {
    if (!selectedSource) return;
    const now = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 7);
    const plat = selectedSource.platform;
    const isComment = selectedSource.content_kind === 'comment';
    const externalId =
      plat === 'reddit' ? `${isComment ? 't1' : 't3'}_demo${rand}` : `ext_${rand}`;
    const platformDetails =
      plat === 'reddit'
        ? { platform: 'reddit', community: 'localllama', flair: null, nsfw: false }
        : plat === 'x'
          ? { platform: 'x', conversationId: null, isReply: false, isRepost: false, isQuote: false, sensitive: false }
          : plat === 'web'
            ? { platform: 'web', publisher: 'archive', canonicalUrl: null, feedUrl: null }
            : { platform: 'bluesky', cid: null };
    setIngestJson(
      JSON.stringify(
        {
          items: [
            {
              platform: plat,
              kind: selectedSource.content_kind,
              externalId,
              title: isComment ? null : 'Sample pushed insight: pricing & latency pain',
              text: 'Manually verified push sample complying with TypeBox Ingest contract.',
              url:
                plat === 'reddit'
                  ? `https://www.reddit.com/r/localllama/comments/demo${rand}/`
                  : `https://example.org/items/${externalId}`,
              language: 'en',
              author: { externalId: 'manual_sample_1', handle: null, displayName: 'Archive Sample', url: null },
              publishedAt: now,
              fetchedAt: now,
              availability: 'available',
              references: [],
              media: [],
              platformDetails,
              observation: {
                sourceId: selectedSource.id,
                provider: 'external_ingest',
                sourceObservedAt: null,
                fetchedAt: now,
                timeBasis: 'archive_initial',
                maturity: 'initial',
                metrics: plat === 'reddit' ? { 'reddit.score': 12 } : {},
                evidenceKey: `ui-sample-${externalId}-${rand}`,
              },
            },
          ],
        },
        null,
        2,
      ),
    );
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSource) return;
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
      setOpsMsg({ text: t(`Ingested ${res.accepted} items (added ${res.added}, updated ${res.updated}). Job ${res.jobId}`, `推流成功：接收 ${res.accepted} 条（新增 ${res.added}，更新 ${res.updated}），任务 ${res.jobId}`) });
    } catch (err) {
      setOpsMsg({ text: formatApiError(err), isError: true });
    }
  };

  // Job Action & Budget Modal
  const jobActionMut = useJobActionMutation();
  const [inspectJobId, setInspectJobId] = useState<string | null>(null);
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

  const visibleSources = sources.filter((s) => (stateFilter === 'all' ? true : s.state === stateFilter));
  const blockedCount = sources.filter((s) => s.automatic_collection_blocked).length;

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
              <button type="button" className="ds-btn" onClick={() => setCreateOpen(true)}>
                <Plus size={14} />
                <span>{t('Add Source', '新建来源')}</span>
              </button>
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
        <CollectionJobsView actor={actor} sources={sources} />
      ) : tab === 'budgets' ? (
        <QuotasManagementView actor={actor} budgets={budgets} providers={capabilities} onEditBudget={openBudgetModal} />
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
                  {(['all', 'active', 'paused'] as const).map((st) => (
                    <button key={st} type="button" className={stateFilter === st ? 'on' : ''} onClick={() => setStateFilter(st)}>
                      {st === 'all' ? t('All', '全部') : st === 'active' ? t('Active', '运行中') : t('Paused', '暂停')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ds-card-bd" style={{ paddingTop: 10 }}>
                <div style={{ display: 'grid', gap: 8 }}>
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
                          <span className="tag tag--lilac" style={{ height: 19, fontSize: 9.5 }}>{s.primary_provider}</span>
                          {s.fallback_provider && <span className="tag tag--mint" style={{ height: 19, fontSize: 9.5 }}>fb: {s.fallback_provider}</span>}
                          <span className="tag tag--line" style={{ height: 19, fontSize: 9.5 }}>{s.delivery_mode}</span>
                          {s.automatic_collection_blocked && (
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
                        {(['active', 'paused', 'archived'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            className={selectedSource.state === st ? 'on' : ''}
                            disabled={updateSourceMut.isPending}
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
                    {selectedSource.automatic_collection_blocked && (
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

                    {opsMsg && <div className={`wb-alert ${opsMsg.isError ? 'wb-alert--error' : 'wb-alert--success'}`}>{opsMsg.text}</div>}

                    {selectedSource.delivery_mode === 'pull' && (canWrite || quotasSummaryQuery.data?.effectivePolicy.manualCollectEnabled) && (
                      <form onSubmit={handleCollect} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
                          <Play size={13} color="var(--wb-purple)" />
                          <span>{canWrite ? t('Dispatch Pull Collect Job', '下发主动采集任务') : t('Personal Manual Collection (Subject to Plan Quota)', '个人手动采集（受套餐策略与个人额度限制）')}</span>
                          <span className="tag tag--line" style={{ height: 18, fontSize: 9 }}>Idempotency-Key auto</span>
                        </div>
                        <div className="wb-grid-2">
                          <div className="wb-field">
                            <label>from (UTC)</label>
                            <input type="datetime-local" className="wb-input" value={collectFrom} onChange={(e) => setCollectFrom(e.target.value)} required />
                          </div>
                          <div className="wb-field">
                            <label>to (UTC)</label>
                            <input type="datetime-local" className="wb-input" value={collectTo} onChange={(e) => setCollectTo(e.target.value)} required />
                          </div>
                        </div>
                        <div className="wb-grid-2">
                          <div className="wb-field">
                            <label>limit (max {maxAllowedLimit})</label>
                            <input type="number" className="wb-input" min={1} max={maxAllowedLimit} value={collectLimit} onChange={(e) => setCollectLimit(Number(e.target.value) || 1)} />
                          </div>
                          <div className="wb-field">
                            <label>{t('Options', '调度选项')}</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, paddingTop: 4 }}>
                              {selectedSource.fallback_provider && (
                                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                  <input type="checkbox" checked={useFallback} onChange={(e) => setUseFallback(e.target.checked)} />
                                  <span>useFallback ({selectedSource.fallback_provider})</span>
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
                            <span>maxCommentsPerPost (1..50):</span>
                            <input type="number" className="wb-input" style={{ width: 70 }} min={1} max={50} value={maxComments} onChange={(e) => setMaxComments(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
                          </div>
                        )}
                        <div>
                          <button type="submit" className="ds-btn" disabled={selectedSource.state !== 'active' || selectedSource.automatic_collection_blocked || collectMut.isPending}>
                            {t('Submit Collect Job', '提交采集任务')}
                          </button>
                        </div>
                      </form>
                    )}

                    {canWrite && selectedSource.delivery_mode === 'pull' && supportsRefresh && (
                      <form onSubmit={handleRefreshIds} style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 650 }}>{t('Batch Refresh by Content IDs (1..20 UUIDs)', '显式批量 ID 刷新 (POST /refresh)')}</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input className="wb-input" style={{ flex: 1 }} value={refreshIdsRaw} onChange={(e) => setRefreshIdsRaw(e.target.value)} placeholder="33333333-3333-4333-8333-333333333301" />
                          <button type="submit" className="ds-btn ds-btn--ghost" disabled={refreshMut.isPending}>
                            {t('Refresh IDs', '刷新 ID')}
                          </button>
                        </div>
                      </form>
                    )}

                    {canWrite && selectedSource.delivery_mode === 'push' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <form onSubmit={handleIngest} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
                              <Upload size={13} color="var(--wb-purple)" />
                              {t('Push Ingest Batch (1 MiB / 100 items max)', '手工单批推流导入 (external_ingest)')}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label className="ds-btn ds-btn--ghost" style={{ height: 28, fontSize: 11, cursor: 'pointer' }}>
                                <span>{t('Import JSON File', '导入规范 JSON 文件')}</span>
                                <input
                                  type="file"
                                  accept=".json,application/json"
                                  aria-label={t('Import canonical JSON file', '导入规范 JSON 文件')}
                                  style={{ display: 'none' }}
                                  onChange={async (ev) => {
                                    const file = ev.target.files?.[0];
                                    ev.target.value = '';
                                    if (!file || !selectedSource) return;
                                    const raw = await file.text();
                                    setIngestJson(raw);
                                    setOpsMsg(null);
                                    if (utf8ByteLength(raw) > 1048576) {
                                      setOpsMsg({ text: t('413 Pre-flight: JSON payload exceeds 1 MiB limit.', '预检拦截：负载超过 1 MiB 上限。'), isError: true });
                                      return;
                                    }
                                    try {
                                      const res = await ingestMut.mutateAsync({
                                        sourceId: selectedSource.id,
                                        rawJson: raw,
                                        idempotencyKey: generateUuidV4(),
                                      });
                                      setOpsMsg({
                                        text: t(
                                          `Ingested ${res.accepted} items (added ${res.added}, updated ${res.updated}).`,
                                          `导入成功：${res.accepted} 条（新增 ${res.added}，更新 ${res.updated}）`,
                                        ),
                                      });
                                    } catch (err) {
                                      setOpsMsg({ text: formatApiError(err), isError: true });
                                    }
                                  }}
                                />
                              </label>
                              <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 28, fontSize: 11 }} onClick={fillSampleIngest}>
                                {t('Load Sample JSON', '填充合法样例')}
                              </button>
                            </div>
                          </div>
                          <textarea className="wb-textarea" rows={5} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} value={ingestJson} onChange={(e) => setIngestJson(e.target.value)} placeholder='{"items": [...]}' />
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                              {(utf8ByteLength(ingestJson) / 1024).toFixed(1)} KiB / 1024 KiB
                            </span>
                            <button type="submit" className="ds-btn ds-btn--brand" disabled={!ingestJson.trim() || ingestMut.isPending}>
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
                    <button type="button" className="icon-square" style={{ width: 28, height: 28 }} onClick={() => jobsQuery.refetch()}>
                      <RefreshCw size={12} />
                    </button>
                  </div>
                  <div className="ds-card-bd" style={{ paddingTop: 6 }}>
                    {(jobsQuery.data?.jobs || []).length === 0 ? (
                      <div style={{ padding: 22, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                        {t('No jobs recorded for this source yet.', '该来源暂无采集任务记录。')}
                      </div>
                    ) : (
                      (jobsQuery.data?.jobs || []).map((job: SourceJob) => {
                        const phase = job.provider_state?.phase ?? 'done';
                        const isDone = job.status === 'succeeded' || job.status === 'completed';
                        return (
                          <div key={job.id} className="job-row">
                            <span className="wc-ico" style={{ background: job.status === 'failed' ? '#fdf0ec' : job.status === 'running' ? '#eaf6f1' : '#f4f6f0' }}>
                              <RefreshCw size={13} color={job.status === 'failed' ? '#a8462f' : job.status === 'running' ? '#1c6f5c' : 'var(--ink-3)'} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <b style={{ display: 'block', fontSize: 11.5 }}>{job.operation} · {job.provider}</b>
                              <span style={{ display: 'block', fontSize: 10, color: 'var(--faint)' }}>
                                {job.created_at.slice(0, 16).replace('T', ' ')} · {job.records_processed} {t('records', '条')} · phase: {phase}
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
        </div>
      )}

      {/* Create Source Modal */}
      {createOpen && (
        <div className="sr-modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="sr-modal" style={{ width: 'min(540px, 100%)', padding: '22px 26px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 650 }}>
                {t('Create Collection Source', '新建采集来源（能力约束表单）')}
              </h3>
              <button type="button" className="sr-btn sr-btn--subtle sr-btn--xs" onClick={() => setCreateOpen(false)}>
                <X size={15} />
              </button>
            </div>
            {cError && <div className="wb-alert wb-alert--error" style={{ marginBottom: 12 }}>{cError}</div>}

            <form onSubmit={handleCreateSource} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="wb-grid-2">
                <div className="wb-field">
                  <label>deliveryMode</label>
                  <select className="wb-select" value={cMode} onChange={(e) => handleModeChange(e.target.value as DeliveryMode)}>
                    <option value="pull">pull</option>
                    <option value="push">push (external_ingest)</option>
                  </select>
                </div>
                <div className="wb-field">
                  <label>platform</label>
                  <select className="wb-select" value={cPlatform} onChange={(e) => handlePlatformChange(e.target.value as Platform)}>
                    <option value="reddit">reddit</option>
                    <option value="x">x</option>
                    <option value="bluesky">bluesky</option>
                    <option value="web">web</option>
                  </select>
                </div>
              </div>
              <div className="wb-grid-2">
                <div className="wb-field">
                  <label>primaryProvider</label>
                  {cMode === 'push' ? (
                    <input className="wb-input" value="external_ingest" disabled />
                  ) : (
                    <select className="wb-select" value={cProvider} onChange={(e) => handleProviderChange(e.target.value as ProviderName)}>
                      {matchingCapsForPlatform.map((cap) => (
                        <option key={cap.provider} value={cap.provider}>{cap.provider} {cap.enabled ? '' : '(disabled)'}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="wb-field">
                  <label>fallbackProvider</label>
                  <select className="wb-select" disabled={cMode === 'push' || !activeCap || activeCap.fallbackAllowed.length === 0} value={cFallback} onChange={(e) => setCFallback(e.target.value as '' | FallbackProviderName)}>
                    <option value="">None</option>
                    {(activeCap?.fallbackAllowed || []).map((fb) => <option key={fb} value={fb}>{fb}</option>)}
                  </select>
                </div>
              </div>
              <div className="wb-field">
                <label>label (1..100 chars)</label>
                <input className="wb-input" value={cLabel} onChange={(e) => setCLabel(e.target.value)} required maxLength={100} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="wb-field">
                  <label>target.type</label>
                  <select className="wb-select" value={cTargetType} onChange={(e) => setCTargetType(e.target.value as TargetType)}>
                    {(cMode === 'push' ? (['search', 'community', 'post', 'account', 'feed'] as TargetType[]) : activeCap?.targetTypes || ['search']).map((tt) => (
                      <option key={tt} value={tt}>{tt}</option>
                    ))}
                  </select>
                </div>
                <div className="wb-field">
                  <label>contentKind</label>
                  <select className="wb-select" value={cKind} onChange={(e) => setCKind(e.target.value as ContentKind)}>
                    {(cMode === 'push' ? (['post', 'comment', 'article'] as ContentKind[]) : activeCap?.contentKinds || ['post']).map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
                <div className="wb-field">
                  <label>target value</label>
                  <input className="wb-input" value={cTargetValue} onChange={(e) => setCTargetValue(e.target.value)} placeholder="SaaS" required />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setCreateOpen(false)}>{t('Cancel', '取消')}</button>
                <button type="submit" className="ds-btn" disabled={createSourceMut.isPending}>{t('Create Source', '创建来源')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Job Detail & Control Modal */}
      {inspectJobId && jobDetailQuery.data?.job && (
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
                    <span className="tag tag--apricot">phase: {job.provider_state.phase}</span>
                  </div>
                  {job.result_summary?.warning && <div className="wb-alert wb-alert--warn">{job.result_summary.warning}</div>}
                  {job.request_json && (
                    <pre style={{ background: '#fbfcf7', border: '1px solid var(--line)', padding: 10, borderRadius: 6, fontSize: 11, margin: 0, overflow: 'auto' }}>
                      {JSON.stringify(job.request_json, null, 2)}
                    </pre>
                  )}
                  {canWrite && (job.status === 'queued' || job.status === 'running' || job.status === 'failed') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                      {risky && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8f3f2a', fontWeight: 600 }}>
                          <input type="checkbox" checked={ackJobCharge} onChange={(e) => setAckJobCharge(e.target.checked)} />
                          <span>acknowledgePotentialCharge: true</span>
                        </label>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {(['cancel', 'retry', 'continue'] as const).map((act) => (
                          <button
                            key={act}
                            type="button"
                            className={`ds-btn ${act === 'cancel' ? 'ds-btn--danger' : ''}`}
                            style={{ height: 30, fontSize: 11 }}
                            disabled={jobActionMut.isPending}
                            onClick={async () => {
                              try {
                                await jobActionMut.mutateAsync({ jobId: job.id, sourceId: job.source_id, action: act, acknowledgePotentialCharge: ackJobCharge });
                                setOpsMsg({ text: `Executed ${act} on job ${job.id.slice(0, 8)}` });
                                setInspectJobId(null);
                              } catch (err) {
                                setOpsMsg({ text: formatApiError(err), isError: true });
                                setInspectJobId(null);
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
      )}

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
                <div className="wb-field"><label>dailyRequests</label><input type="number" className="wb-input" min={0} max={1000000} value={bDailyReq} onChange={(e) => setBDailyReq(Number(e.target.value))} /></div>
                <div className="wb-field"><label>monthlyRequests</label><input type="number" className="wb-input" min={0} max={10000000} value={bMonthlyReq} onChange={(e) => setBMonthlyReq(Number(e.target.value))} /></div>
                <div className="wb-field"><label>dailyResources</label><input type="number" className="wb-input" min={0} max={100000000} value={bDailyRes} onChange={(e) => setBDailyRes(Number(e.target.value))} /></div>
                <div className="wb-field"><label>monthlyResources</label><input type="number" className="wb-input" min={0} max={1000000000} value={bMonthlyRes} onChange={(e) => setBMonthlyRes(Number(e.target.value))} /></div>
              </div>
              <div className="wb-field"><label>minimumIntervalMs</label><input type="number" className="wb-input" min={0} max={3600000} value={bInterval} onChange={(e) => setBInterval(Number(e.target.value))} /></div>
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
