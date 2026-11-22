import { useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  Database,
  FolderPlus,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  formatApiError,
  useAttachProjectBatchMutation,
  useBatchesQuery,
  useCollectSourceMutation,
  useContentFacetsQuery,
  useProjectBatchesQuery,
  useQuotasSummaryQuery,
  useRecentJobsQuery,
  useUpdateProjectBatchStatusMutation,
} from '../api/hooks';
import {
  type Actor,
  type CollectionSource,
  type Project,
  type SourceCapability,
  formatSourceTarget,
  generateUuidV4,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { collectionLimits, isResearchSource } from '../lib/collectionLimits';

export function ProjectListView({
  projects,
  activeProjectId,
  maxProjects,
  isViewer,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  activeProjectId?: string;
  maxProjects?: number;
  isViewer: boolean;
  onSelect: (project: Project) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const mine = projects.filter((p) => !p.is_shared);
  const shared = projects.filter((p) => p.is_shared);
  const atLimit = isViewer && maxProjects !== undefined && mine.length >= maxProjects;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="ds-card">
        <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="ds-card-title">{t('All Research Projects', '全部研究项目')}</div>
            <div className="ds-card-sub">
              {isViewer && maxProjects !== undefined
                ? t(`My projects: ${mine.length} / ${maxProjects} (plan limit)`, `我的私有项目：${mine.length} / ${maxProjects}（当前套餐上限）`)
                : t(`${projects.length} accessible projects`, `共 ${projects.length} 个可访问项目`)}
            </div>
          </div>
          <button type="button" className="ds-btn" disabled={atLimit} onClick={onCreate}>
            <Plus size={14} />
            <span>{atLimit ? t('Project limit reached', '已达项目数上限') : t('Create Research Project', '新建研究项目')}</span>
          </button>
        </div>
        <div className="ds-card-bd" style={{ display: 'grid', gap: 16 }}>
          {mine.length > 0 && (
            <section style={{ display: 'grid', gap: 8 }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{t('My Projects', '我的项目')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {mine.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="ds-card"
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderColor: p.id === activeProjectId ? 'var(--wb-purple)' : undefined,
                    }}
                    onClick={() => onSelect(p)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 13 }}>{p.name}</b>
                      <span className="tag tag--lilac" style={{ fontSize: 10 }}>
                        {p.dataset_mode === 'batch' ? `${p.enabled_batch_count ?? 0} ${t('batches', '批次')}` : `${p.source_ids.length} ${t('sources', '来源')}`}
                      </span>
                    </div>
                    {p.description && <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>{p.description}</p>}
                  </button>
                ))}
              </div>
            </section>
          )}
          {shared.length > 0 && (
            <section style={{ display: 'grid', gap: 8 }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{t('Shared Team Projects', '共享研究项目')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {shared.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="ds-card"
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderColor: p.id === activeProjectId ? 'var(--wb-purple)' : undefined,
                    }}
                    onClick={() => onSelect(p)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 13 }}>{p.name}</b>
                      <span className="tag" style={{ fontSize: 10 }}>
                        {p.can_edit ? t('Shared', '共享') : t('Read-only', '只读')}
                      </span>
                    </div>
                    {p.description && <p style={{ fontSize: 11.5, color: 'var(--muted)', margin: '6px 0 0' }}>{p.description}</p>}
                  </button>
                ))}
              </div>
            </section>
          )}
          {projects.length === 0 && (
            <p className="collection-hint">{t('No research projects yet. Create your first empty project to begin.', '还没有研究项目。点击右上角「新建研究项目」开始你的第一项研究。')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectCollectView({
  actor,
  project,
  sources,
  capabilities,
  onNavigate,
}: {
  actor: Actor;
  project: Project;
  sources: CollectionSource[];
  capabilities: SourceCapability[];
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const isAdmin = actor.role === 'owner' || actor.role === 'admin';
  const researchSources = useMemo(() => sources.filter((s) => isResearchSource(s) && s.state === 'active'), [sources]);
  const pullResearchSources = useMemo(() => researchSources.filter((s) => s.deliveryMode === 'pull'), [researchSources]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>(() => pullResearchSources[0]?.id ?? '');
  const activeSourceId = pullResearchSources.some((s) => s.id === selectedSourceId)
    ? selectedSourceId
    : (pullResearchSources[0]?.id ?? '');
  const selectedSource = pullResearchSources.find((s) => s.id === activeSourceId);

  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(20);
  const [includeComments, setIncludeComments] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [msg, setMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const quotasQuery = useQuotasSummaryQuery(true);
  const collectMut = useCollectSourceMutation();
  const batchesQuery = useBatchesQuery({ limit: 30 }, true);
  const attachMut = useAttachProjectBatchMutation();

  const [anchorMs] = useState<number>(() => Math.floor(Date.now() / 60_000) * 60_000);
  const { fromIso, toIso } = useMemo(() => ({
    fromIso: new Date(anchorMs - days * 86_400_000).toISOString(),
    toIso: new Date(anchorMs).toISOString(),
  }), [anchorMs, days]);

  const inventoryQuery = useContentFacetsQuery(
    selectedSource ? { sourceId: selectedSource.id, from: fromIso, to: toIso, bucket: 'day' } : null,
  );

  const cap = capabilities.find((c) => c.provider === (useFallback ? selectedSource?.fallbackProvider : selectedSource?.primaryProvider));
  const limits = collectionLimits(selectedSource, cap, quotasQuery.data, isAdmin, includeComments, 15);
  const effectiveLimit = Math.min(limit, Math.max(1, limits.maxLimit || 20));
  const researchBatches = useMemo(
    () => (batchesQuery.data?.batches ?? []).filter((b) => b.platform !== 'web'),
    [batchesQuery.data?.batches],
  );

  async function handleCollect(e: FormEvent) {
    e.preventDefault();
    if (!selectedSource) return;
    setMsg(null);
    try {
      const res = await collectMut.mutateAsync({
        sourceId: selectedSource.id,
        idempotencyKey: generateUuidV4(),
        payload: {
          from: fromIso,
          to: toIso,
          limit: effectiveLimit,
          includeComments: limits.optionalComments ? includeComments : false,
          useFallback: isAdmin ? useFallback : false,
          projectId: project.id,
        },
      });
      onNavigate(`/projects?view=jobs&projectId=${encodeURIComponent(project.id)}&jobId=${encodeURIComponent(res.jobId)}`);
    } catch (err) {
      setMsg({ text: formatApiError(err), isError: true });
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {(project.enabled_batch_count ?? 0) === 0 && project.dataset_mode === 'batch' && (
        <div className="wb-alert" style={{ background: 'var(--bg-soft, #f6f4ff)', borderColor: 'var(--line)' }}>
          <Database size={15} color="var(--wb-purple)" />
          <div>
            <b>{t(`Add first research data to "${project.name}"`, `为『${project.name}』添加第一批研究数据`)}</b>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              {t('This project currently has 0 samples. Start a collection below or attach an existing authorized batch.', '当前项目有效样本为 0。你可以在下方发起一次新的采集，或直接复用已有授权批次（不消耗外部 API）。')}
            </div>
          </div>
        </div>
      )}

      {!project.can_edit && (
        <div className="wb-alert wb-alert--warn">
          {t('This shared project is read-only for your account. Create your own project to collect or manage custom batches.', '当前共享项目对你为只读权限。如需自定义采集或管理数据批次，请新建你的私有研究项目。')}
        </div>
      )}

      {/* 1. Initiate new collection */}
      <div className="ds-card">
        <div className="ds-card-hd">
          <div className="ds-card-title">{t('Collect New Samples (Research Sources Only)', '发起新采集（仅社媒与归档研究源）')}</div>
          <div className="ds-card-sub">
            {quotasQuery.data && !isAdmin
              ? t(
                  `Remaining today: ${quotasQuery.data.effectivePolicy.dailyRequests === null ? 'Unlimited' : Math.max(0, quotasQuery.data.effectivePolicy.dailyRequests - quotasQuery.data.myUsage.requestsReserved)} requests`,
                  `今日剩余个人配额：${quotasQuery.data.effectivePolicy.dailyRequests === null ? '不限' : Math.max(0, quotasQuery.data.effectivePolicy.dailyRequests - quotasQuery.data.myUsage.requestsReserved)} 次请求`,
                )
              : t('Results will be packaged as a manageable batch and attached to this project automatically.', '采集完成后将自动生成可管理的数据批次，并归属到当前研究项目。')}
          </div>
        </div>
        <div className="ds-card-bd">
          {pullResearchSources.length === 0 ? (
            <p className="collection-hint">
              {t('No active pull research sources available. Ask an administrator to configure Reddit/X/Bluesky sources in Operations.', '暂无可用的主动拉取研究源（资讯信息流源已隔离，不混入研究采集）。请联系管理员在运维管理中配置 Reddit / X / Bluesky 来源。')}
            </p>
          ) : (
            <form className="collection-form" onSubmit={handleCollect}>
              <div className="wb-grid-2">
                <label className="wb-field">
                  {t('Research Source', '选择研究来源')}
                  <select className="wb-select" value={activeSourceId} onChange={(e) => { setSelectedSourceId(e.target.value); setUseFallback(false); }}>
                    {pullResearchSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        [{s.platform.toUpperCase()}] {s.label} ({formatSourceTarget(s.target)})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="wb-field">
                  <label>{t('Time Window (UTC)', '时间范围（UTC）')}</label>
                  <div className="seg">
                    {[1, 7, 30].map((d) => (
                      <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
                        {d === 1 ? t('24h', '近 24 小时') : d === 7 ? t('7 days', '近 7 天') : t('30 days', '近 30 天')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="wb-grid-2">
                <label className="wb-field">
                  {t(`Sample Limit (max ${limits.maxLimit || 20})`, `本次采集条数（上限 ${limits.maxLimit || 20}）`)}
                  <input
                    type="number"
                    className="wb-input"
                    min={1}
                    max={Math.max(1, limits.maxLimit || 20)}
                    value={effectiveLimit}
                    onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
                {limits.optionalComments && (
                  <label className="collection-checkbox" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                    <input type="checkbox" checked={includeComments} onChange={(e) => setIncludeComments(e.target.checked)} />
                    <span>{t('Include top comments', '同步采集精选评论')}</span>
                  </label>
                )}
              </div>

              {/* Pre-collection soft inventory check */}
              {selectedSource && (
                <div className="wb-alert" style={{ fontSize: 11.5 }}>
                  <span>
                    {inventoryQuery.isPending
                      ? t('Checking existing stored samples for this window…', '正在核对库内已有样本…')
                      : t(
                          `Stored inventory check: ${inventoryQuery.data?.count ?? 0} existing items found for this source in the last ${days}d (last success: ${selectedSource.lastSuccessAt?.slice(0, 16).replace('T', ' ') ?? 'never'}). Existing samples do not guarantee full window coverage; you may still collect to refresh or expand.`,
                          `存量预查：当前库中该来源近 ${days} 天已有 ${inventoryQuery.data?.count ?? 0} 条样本（最近成功抓取：${selectedSource.lastSuccessAt?.slice(0, 16).replace('T', ' ') ?? '尚无记录'}）。库内已有样本不代表该时段已全量扫完，可直接复用已有批次或继续补采。`,
                        )}
                  </span>
                </div>
              )}

              {isAdmin && selectedSource?.fallbackProvider && (
                <div>
                  <button type="button" className="collection-text-button" onClick={() => setShowAdvanced((v) => !v)}>
                    {showAdvanced ? t('Hide advanced options', '收起管理员高级参数') : t('Show advanced options', '展开管理员高级参数')}
                  </button>
                  {showAdvanced && (
                    <label className="collection-checkbox" style={{ marginTop: 8 }}>
                      <input type="checkbox" checked={useFallback} onChange={(e) => setUseFallback(e.target.checked)} />
                      <span>{t(`Use fallback provider (${selectedSource.fallbackProvider})`, `改用备用渠道（${selectedSource.fallbackProvider}）`)}</span>
                    </label>
                  )}
                </div>
              )}

              {msg && <div role={msg.isError ? 'alert' : 'status'} className={`wb-alert ${msg.isError ? 'wb-alert--error' : 'wb-alert--success'}`}>{msg.text}</div>}

              <div className="collection-toolbar">
                <button
                  type="submit"
                  className="ds-btn"
                  disabled={!project.can_edit || !selectedSource || limits.maxLimit <= 0 || collectMut.isPending}
                >
                  <Play size={13} />
                  <span>{collectMut.isPending ? t('Submitting…', '正在提交…') : t('Submit Collection Job', '确认并发起采集')}</span>
                </button>
                {limits.maxLimit <= 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {t('Provider not ready, budget disabled, or plan quota exhausted.', '渠道未就绪、预算已停用或当前套餐额度已用尽。')}
                  </span>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      {/* 2. Reuse existing authorized batches without calling external APIs */}
      <div className="ds-card">
        <div className="ds-card-hd">
          <div className="ds-card-title">{t('Attach Existing Authorized Batch (Zero API Cost)', '复用已有授权数据批次（零外部 API 消耗）')}</div>
          <div className="ds-card-sub">{t('Attach historical research or R4 archive batches directly to this project.', '直接把已有社媒或 R4 离线归档批次纳入本项目分析，无需重复拉取。')}</div>
        </div>
        <div className="ds-card-bd">
          {researchBatches.length === 0 ? (
            <p className="collection-hint">{t('No reusable research batches yet.', '暂无可复用的研究数据批次。')}</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {researchBatches.slice(0, 12).map((b) => (
                <div key={b.id} className="job-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 12 }}>{b.label}</b>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      [{b.platform.toUpperCase()}] {b.sourceLabel} · {b.provider} · {b.itemCount} {t('items', '条样本')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    style={{ height: 28, fontSize: 11 }}
                    disabled={!project.can_edit || attachMut.isPending}
                    onClick={async () => {
                      setMsg(null);
                      try {
                        await attachMut.mutateAsync({ projectId: project.id, batchId: b.id });
                        onNavigate(`/projects?view=batches&projectId=${encodeURIComponent(project.id)}`);
                      } catch (err) {
                        setMsg({ text: formatApiError(err), isError: true });
                      }
                    }}
                  >
                    <FolderPlus size={12} />
                    <span>{t('Add to Project', '纳入本项目')}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectJobsView({
  project,
  onNavigate,
}: {
  project: Project;
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const jobsQuery = useRecentJobsQuery({ projectId: project.id, limit: 30 }, true);
  const jobs = jobsQuery.data?.jobs ?? [];

  return (
    <div className="ds-card">
      <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <div className="ds-card-title">{t(`Collection Jobs · ${project.name}`, `采集任务 · ${project.name}`)}</div>
          <div className="ds-card-sub">{t('Execution status, errors, and ingested counts for this project.', '仅展示归属当前项目的采集任务进度、错误与入库结果。')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => jobsQuery.refetch()}>
            <RefreshCw size={13} />
            <span>{t('Refresh', '刷新')}</span>
          </button>
          <button type="button" className="ds-btn" onClick={() => onNavigate(`/projects?view=collect&projectId=${encodeURIComponent(project.id)}`)}>
            <Plus size={13} />
            <span>{t('New Collection', '发起新采集')}</span>
          </button>
        </div>
      </div>
      <div className="ds-card-bd">
        {jobsQuery.isPending ? (
          <p className="collection-hint">{t('Loading project jobs…', '正在加载项目任务…')}</p>
        ) : jobs.length === 0 ? (
          <p className="collection-hint">{t('No collection jobs recorded for this project yet.', '当前项目还没有采集任务记录。')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {jobs.map((job) => (
              <div key={job.id} className="job-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 12 }}>
                    [{job.platform.toUpperCase()}] {job.sourceLabel} · {job.provider}
                  </b>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {job.createdAt.slice(0, 16).replace('T', ' ')} UTC · {t('Processed / Inserted / Updated', '处理/新增/更新')}: {job.recordsProcessed} / +{job.recordsInserted} / ~{job.recordsUpdated}
                  </div>
                  {job.error && <div style={{ fontSize: 11, color: '#a8462f' }}>{job.error}</div>}
                </div>
                <span className={`chip-state ${job.status === 'succeeded' ? 'active' : job.status === 'running' ? 'paused' : 'archived'}`}>
                  {job.status}
                </span>
                {job.batchId && (
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    style={{ height: 26, fontSize: 11 }}
                    onClick={() => onNavigate(`/projects?view=batches&projectId=${encodeURIComponent(project.id)}`)}
                  >
                    <Layers size={12} />
                    <span>{t('Manage Batch', '查看批次')}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectBatchesView({
  project,
  allProjects,
  onNavigate,
}: {
  project: Project;
  allProjects: Project[];
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const batchesQuery = useProjectBatchesQuery(project.id, true);
  const updateStatusMut = useUpdateProjectBatchStatusMutation();
  const attachMut = useAttachProjectBatchMutation();
  const [reuseTargetByBatch, setReuseTargetByBatch] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  const batches = batchesQuery.data?.batches ?? [];
  const otherWritableProjects = allProjects.filter((p) => p.id !== project.id && p.can_edit);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="ds-card">
        <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="ds-card-title">{t(`Data Batches · ${project.name}`, `数据批次管理 · ${project.name}`)}</div>
            <div className="ds-card-sub">
              {t('Enable, disable, soft-remove from this project, or reuse across your other projects without re-calling APIs.', '启用或禁用批次仅影响当前项目统计；从项目移除不会删除共享底层内容，也可零成本复用到你的其他研究项目。')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate(`/projects?view=overview&projectId=${encodeURIComponent(project.id)}`)}>
              <span>{t('Go to Overview', '查看项目分析')}</span>
            </button>
            {project.can_edit && (
              <button type="button" className="ds-btn" onClick={() => onNavigate(`/projects?view=collect&projectId=${encodeURIComponent(project.id)}`)}>
                <Plus size={13} />
                <span>{t('Add Data', '补充数据')}</span>
              </button>
            )}
          </div>
        </div>
        <div className="ds-card-bd">
          {notice && (
            <div role={notice.isError ? 'alert' : 'status'} className={`wb-alert ${notice.isError ? 'wb-alert--error' : 'wb-alert--success'}`} style={{ marginBottom: 12 }}>
              {notice.text}
            </div>
          )}
          {batchesQuery.isPending ? (
            <p className="collection-hint">{t('Loading project batches…', '正在加载项目批次…')}</p>
          ) : batches.length === 0 ? (
            <p className="collection-hint">
              {t('No batches attached to this project yet. Go to Data Ingestion to collect or reuse a batch.', '当前项目还没有关联任何数据批次。前往「数据接入」发起采集或复用已有授权批次。')}
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {batches.map((b) => {
                const isEnabled = b.status === 'enabled';
                const targetId = reuseTargetByBatch[b.batchId] ?? otherWritableProjects[0]?.id ?? '';
                return (
                  <div key={b.batchId} className="job-row" style={{ flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 12.5 }}>{b.label}</b>
                        <span className={`chip-state ${isEnabled ? 'active' : 'paused'}`}>
                          {isEnabled ? t('Enabled', '已启用') : t('Disabled', '已禁用')}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        [{b.platform.toUpperCase()}] {b.sourceLabel} · {b.provider} · {b.itemCount} {t('items', '条样本')} · {b.addedAt.slice(0, 16).replace('T', ' ')} UTC
                      </div>
                    </div>
                    {project.can_edit && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="ds-btn ds-btn--ghost"
                          style={{ height: 28, fontSize: 11 }}
                          disabled={updateStatusMut.isPending}
                          onClick={async () => {
                            setNotice(null);
                            try {
                              await updateStatusMut.mutateAsync({
                                projectId: project.id,
                                batchId: b.batchId,
                                status: isEnabled ? 'disabled' : 'enabled',
                              });
                              setNotice({
                                text: isEnabled
                                  ? t('Batch disabled for this project; overview will recalculate.', '已在本项目中禁用该批次，项目分析口径已更新。')
                                  : t('Batch re-enabled for this project.', '已重新启用该批次。'),
                              });
                            } catch (err) {
                              setNotice({ text: formatApiError(err), isError: true });
                            }
                          }}
                        >
                          <Check size={12} />
                          <span>{isEnabled ? t('Disable', '禁用') : t('Enable', '启用')}</span>
                        </button>
                        <button
                          type="button"
                          className="ds-btn ds-btn--danger"
                          style={{ height: 28, fontSize: 11 }}
                          disabled={updateStatusMut.isPending}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                t(
                                  `Remove batch "${b.label}" from "${project.name}"? Underlying shared content and other projects will NOT be affected.`,
                                  `确定从项目『${project.name}』移除批次“${b.label}”？（不会删除底层原始内容，也不影响其他项目）`,
                                ),
                              )
                            ) {
                              return;
                            }
                            setNotice(null);
                            try {
                              await updateStatusMut.mutateAsync({
                                projectId: project.id,
                                batchId: b.batchId,
                                status: 'removed',
                              });
                              setNotice({ text: t('Batch removed from this project.', '已从本项目移除该批次。') });
                            } catch (err) {
                              setNotice({ text: formatApiError(err), isError: true });
                            }
                          }}
                        >
                          <Trash2 size={12} />
                          <span>{t('Remove from Project', '从本项目移除')}</span>
                        </button>
                        {otherWritableProjects.length > 0 && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <select
                              className="wb-select"
                              aria-label={t('Target project for batch reuse', '选择要复用到的目标项目')}
                              style={{ height: 28, fontSize: 11, minWidth: 130 }}
                              value={targetId}
                              onChange={(e) => setReuseTargetByBatch((prev) => ({ ...prev, [b.batchId]: e.target.value }))}
                            >
                              {otherWritableProjects.map((op) => (
                                <option key={op.id} value={op.id}>{op.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="ds-btn ds-btn--ghost"
                              style={{ height: 28, fontSize: 11 }}
                              disabled={!targetId || attachMut.isPending}
                              onClick={async () => {
                                if (!targetId) return;
                                setNotice(null);
                                try {
                                  await attachMut.mutateAsync({ projectId: targetId, batchId: b.batchId });
                                  const targetName = otherWritableProjects.find((p) => p.id === targetId)?.name ?? '';
                                  setNotice({
                                    text: t(`Batch added to "${targetName}" with zero API cost.`, `已将该批次添加到项目『${targetName}』（零外部 API 消耗）。`),
                                  });
                                } catch (err) {
                                  setNotice({ text: formatApiError(err), isError: true });
                                }
                              }}
                            >
                              <FolderPlus size={12} />
                              <span>{t('Add to Project', '添加到项目')}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
