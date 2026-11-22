import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Database,
  FolderPlus,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  formatApiError,
  useAttachProjectBatchMutation,
  useBatchesQuery,
  useCollectSourceMutation,
  usePreviewResearchPlanMutation,
  useProjectBatchesQuery,
  useQuotasSummaryQuery,
  useRecentJobsQuery,
  useUpdateProjectBatchStatusMutation,
} from '../api/hooks';
import {
  type Actor,
  type CollectionSource,
  type Project,
  type ResearchPlanPreviewResponse,
  formatSourceTarget,
  generateUuidV4,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { isResearchSource } from '../lib/collectionLimits';

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
  onNavigate,
}: {
  actor: Actor;
  project: Project;
  sources: CollectionSource[];
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const isAdmin = actor.role === 'owner' || actor.role === 'admin';
  const pullResearchSources = useMemo(
    () => sources.filter((s) => isResearchSource(s) && s.state === 'active' && s.deliveryMode === 'pull'),
    [sources],
  );

  const [inputMode, setInputMode] = useState<'target' | 'source'>('target');
  const [platform, setPlatform] = useState<'reddit' | 'x' | 'bluesky'>('reddit');
  const [targetType, setTargetType] = useState<'community' | 'account' | 'search'>('search');
  const [targetValue, setTargetValue] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>(() => pullResearchSources[0]?.id ?? '');
  const activeSourceId = pullResearchSources.some((s) => s.id === selectedSourceId)
    ? selectedSourceId
    : (pullResearchSources[0]?.id ?? '');

  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(20);
  const [includeComments, setIncludeComments] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const [preview, setPreview] = useState<ResearchPlanPreviewResponse | null>(null);
  const [msg, setMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [anchorMs, setAnchorMs] = useState<number>(() => Math.floor(Date.now() / 60_000) * 60_000);

  const quotasQuery = useQuotasSummaryQuery(true);
  const previewMut = usePreviewResearchPlanMutation();
  const collectMut = useCollectSourceMutation();
  const batchesQuery = useBatchesQuery({ limit: 30 }, true);
  const attachMut = useAttachProjectBatchMutation();

  const ep = quotasQuery.data?.effectivePolicy;
  const maxLookbackDays = isAdmin ? 90 : (ep?.maxLookbackDays ?? 7);
  const maxBatchLimit = isAdmin ? 300 : (ep?.maxBatchLimit ?? 20);
  const effectiveDays = Math.min(days, maxLookbackDays);
  const effectiveLimit = Math.min(limit, Math.max(1, maxBatchLimit));

  const { fromIso, toIso } = useMemo(() => ({
    fromIso: new Date(anchorMs - effectiveDays * 86_400_000).toISOString(),
    toIso: new Date(anchorMs).toISOString(),
  }), [anchorMs, effectiveDays]);

  const researchBatches = useMemo(
    () => (batchesQuery.data?.batches ?? []).filter((b) => b.usageDomain !== 'feed' && b.platform !== 'web'),
    [batchesQuery.data?.batches],
  );

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const nowRounded = Math.floor(Date.now() / 60_000) * 60_000;
    setAnchorMs(nowRounded);
    const nextFrom = new Date(nowRounded - effectiveDays * 86_400_000).toISOString();
    const nextTo = new Date(nowRounded).toISOString();
    try {
      const res = await previewMut.mutateAsync({
        projectId: project.id,
        ...(inputMode === 'source'
          ? { sourceId: activeSourceId || undefined }
          : { platform, targetType, targetValue: targetValue.trim() || undefined }),
        from: nextFrom,
        to: nextTo,
        limit: effectiveLimit,
        includeComments,
        useFallback: isAdmin ? useFallback : false,
      });
      setPreview(res);
    } catch (err) {
      setMsg({ text: formatApiError(err), isError: true });
    }
  }

  async function handleConfirmCollect() {
    if (!preview?.executable || !preview.matchedSource) return;
    setMsg(null);
    try {
      const res = await collectMut.mutateAsync({
        sourceId: preview.matchedSource.id,
        idempotencyKey: generateUuidV4(),
        payload: {
          from: fromIso,
          to: toIso,
          limit: effectiveLimit,
          includeComments,
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
              {t('This project currently has 0 samples. Enter your research target to run a server preflight check, or attach an authorized batch.', '当前项目有效样本为 0。请先输入研究目标并运行服务端预检，或直接复用已有授权批次（零外部 API 消耗）。')}
            </div>
          </div>
        </div>
      )}

      {!project.can_edit && (
        <div className="wb-alert wb-alert--warn">
          {t('This shared project is read-only for your account. Create your own private project to collect or manage custom batches.', '当前共享项目对你为只读权限。如需自定义采集或管理数据批次，请新建你的私有研究项目。')}
        </div>
      )}

      {/* Two-column Task-Oriented Intake + Server Preflight Plan */}
      <div className="ds-grid">
        <div className="c7">
          <div className="ds-card">
            <div className="ds-card-hd">
              <div className="ds-card-title">{t('Step 1 · Define Research Target & Constraints', '第一步 · 输入研究目标与采集范围')}</div>
              <div className="ds-card-sub">
                {t('Specify a community, account, or keyword expression, or pick an active research source. Information Feed sources are excluded.', '输入你想研究的社区、账号或关键词（或直接选择已登记研究源）。资讯信息流源已隔离，不混入研究采集。')}
              </div>
            </div>
            <div className="ds-card-bd">
              <form className="collection-form" onSubmit={handlePreview}>
                <div className="seg" style={{ alignSelf: 'flex-start' }}>
                  <button type="button" className={inputMode === 'target' ? 'on' : ''} onClick={() => { setInputMode('target'); setPreview(null); }}>
                    {t('Enter Research Target', '输入研究目标')}
                  </button>
                  <button type="button" className={inputMode === 'source' ? 'on' : ''} onClick={() => { setInputMode('source'); setPreview(null); }}>
                    {t('Select Registered Source', '选择已登记研究源')} ({pullResearchSources.length})
                  </button>
                </div>

                {inputMode === 'target' ? (
                  <>
                    <div className="wb-grid-2">
                      <label className="wb-field">
                        {t('Platform', '目标平台')}
                        <select className="wb-select" value={platform} onChange={(e) => { setPlatform(e.target.value as 'reddit' | 'x' | 'bluesky'); setPreview(null); }}>
                          <option value="reddit">Reddit</option>
                          <option value="x">X (Twitter)</option>
                          <option value="bluesky">Bluesky</option>
                        </select>
                      </label>
                      <label className="wb-field">
                        {t('Target Type', '目标类型')}
                        <select className="wb-select" value={targetType} onChange={(e) => { setTargetType(e.target.value as 'community' | 'account' | 'search'); setPreview(null); }}>
                          <option value="search">{t('Keyword / Search Expression', '关键词 / 搜索表达式')}</option>
                          <option value="community">{t('Community / Subreddit', '社区 / 版块 (r/...)')}</option>
                          <option value="account">{t('Account Handle', '账号 (@...)')}</option>
                        </select>
                      </label>
                    </div>
                    <label className="wb-field">
                      {t('Research Target Value', '目标内容')}
                      <input
                        className="wb-input"
                        required
                        value={targetValue}
                        onChange={(e) => { setTargetValue(e.target.value); setPreview(null); }}
                        placeholder={
                          targetType === 'community'
                            ? 'e.g. LocalLLaMA'
                            : targetType === 'account'
                              ? 'e.g. @openai'
                              : 'e.g. (OpenAI OR ChatGPT) lang:en'
                        }
                      />
                    </label>
                  </>
                ) : (
                  <label className="wb-field">
                    {t('Registered Research Source', '已登记的研究来源')}
                    <select className="wb-select" value={activeSourceId} onChange={(e) => { setSelectedSourceId(e.target.value); setPreview(null); }}>
                      {pullResearchSources.length === 0 && <option value="">{t('No active research pull sources', '暂无可用的主动拉取研究源')}</option>}
                      {pullResearchSources.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.platform.toUpperCase()}] {s.label} ({formatSourceTarget(s.target)})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="wb-grid-2">
                  <div className="wb-field">
                    <label>{t(`Time Window (max ${maxLookbackDays}d)`, `时间范围（当前上限 ${maxLookbackDays} 天）`)}</label>
                    <div className="seg">
                      {[1, 7, 30].map((d) => (
                        <button
                          key={d}
                          type="button"
                          disabled={d > maxLookbackDays}
                          className={effectiveDays === d ? 'on' : ''}
                          onClick={() => { setDays(d); setPreview(null); }}
                        >
                          {d === 1 ? '24h' : `${d}d`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="wb-field">
                    {t(`Sample Limit (max ${maxBatchLimit})`, `本次条数上限（最大 ${maxBatchLimit}）`)}
                    <input
                      type="number"
                      className="wb-input"
                      min={1}
                      max={Math.max(1, maxBatchLimit)}
                      value={effectiveLimit}
                      onChange={(e) => { setLimit(Math.max(1, Number(e.target.value) || 1)); setPreview(null); }}
                    />
                  </label>
                </div>

                {(isAdmin || (ep?.maxCommentsPerPost ?? 0) > 0) && (
                  <label className="collection-checkbox">
                    <input type="checkbox" checked={includeComments} onChange={(e) => { setIncludeComments(e.target.checked); setPreview(null); }} />
                    <span>{t(`Include top comments (up to ${isAdmin ? 50 : ep?.maxCommentsPerPost ?? 0}/post)`, `同步抓取精选评论（每帖上限 ${isAdmin ? 50 : ep?.maxCommentsPerPost ?? 0} 条）`)}</span>
                  </label>
                )}

                {isAdmin && (
                  <label className="collection-checkbox">
                    <input type="checkbox" checked={useFallback} onChange={(e) => { setUseFallback(e.target.checked); setPreview(null); }} />
                    <span>{t('Admin: prefer fallback provider if configured', '管理员高级选项：优先使用备用渠道（如已配置）')}</span>
                  </label>
                )}

                {msg && <div role={msg.isError ? 'alert' : 'status'} className={`wb-alert ${msg.isError ? 'wb-alert--error' : 'wb-alert--success'}`}>{msg.text}</div>}

                <div className="collection-toolbar">
                  <button
                    type="submit"
                    className="ds-btn"
                    disabled={previewMut.isPending || (inputMode === 'source' && !activeSourceId)}
                  >
                    <Search size={13} />
                    <span>{previewMut.isPending ? t('Checking plan…', '正在生成预检…') : t('Run Server Preflight Check', '生成服务端预检计划')}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Right Column: Live Preflight Verdict & Effective Policy */}
        <div className="c5">
          <div className="ds-card">
            <div className="ds-card-hd">
              <div className="ds-card-title">{t('Step 2 · Preflight Plan & Cost Confirmation', '第二步 · 预检结果与执行确认')}</div>
              <div className="ds-card-sub">
                {ep
                  ? t(
                      `Plan: ${ep.planTier.toUpperCase()} · Max ${maxLookbackDays}d · Limit ${maxBatchLimit}`,
                      `当前权益：${ep.planTier.toUpperCase()} · 最长回溯 ${maxLookbackDays} 天 · 单次上限 ${maxBatchLimit} 条`,
                    )
                  : t('Authoritative backend verification before any external request', '所有权限、预算与覆盖状态均由后端实时裁决')}
              </div>
            </div>
            <div className="ds-card-bd" style={{ display: 'grid', gap: 12 }}>
              {!preview ? (
                <p className="collection-hint">
                  {t('Click "Run Server Preflight Check" on the left to verify target resolution, channel readiness, existing inventory, and estimated quota before submitting.', '点击左侧「生成服务端预检计划」，核实目标匹配、渠道就绪、已有样本与预计配额后再确认执行。')}
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`chip-state ${preview.executable ? 'active' : 'archived'}`}>
                      {preview.resolutionStatus === 'matched_source'
                        ? t('Ready to Collect', '预检通过 · 可执行')
                        : preview.resolutionStatus === 'needs_admin_source'
                          ? t('Needs Admin Source Registration', '待管理员登记来源')
                          : t('Blocked by Policy / Budget', '策略或预算受阻')}
                    </span>
                    {preview.matchedSource && (
                      <span className="tag tag--lilac" style={{ fontSize: 10.5 }}>
                        {preview.matchedSource.label}
                      </span>
                    )}
                  </div>

                  {/* Honest Coverage Status */}
                  <div className="wb-alert" style={{ fontSize: 11.5 }}>
                    <ShieldCheck size={14} color="var(--wb-teal)" />
                    <div>
                      <b>
                        {t('Coverage', '覆盖状态')}: {preview.coverage.status === 'unknown' ? t('Unknown (Existing samples found)', '未知（库内已有部分样本）') : t('Empty (0 stored)', '无存量（0 条）')}
                      </b>
                      <div style={{ color: 'var(--muted)', marginTop: 2 }}>
                        {t(`Stored in window: ${preview.coverage.existingItemCount} · Last success: ${preview.coverage.lastSuccessAt?.slice(0, 16).replace('T', ' ') ?? 'never'}`, `此时段库内已有 ${preview.coverage.existingItemCount} 条 · 最近成功：${preview.coverage.lastSuccessAt?.slice(0, 16).replace('T', ' ') ?? '无'}`)}
                      </div>
                    </div>
                  </div>

                  {/* Estimated Quota */}
                  <div style={{ fontSize: 12, display: 'grid', gap: 4, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 6 }}>
                    <div>{t('Estimated API Requests', '预计外部请求')}: <b>{preview.estimate.requests}</b></div>
                    <div>{t('Estimated Personal / System Units', '预计个人 / 系统资源单位')}: <b>{preview.estimate.personalResources} / {preview.estimate.systemResources}</b></div>
                  </div>

                  {/* Blockers */}
                  {preview.blockers.length > 0 && (
                    <div className="wb-alert wb-alert--error" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                        <AlertTriangle size={13} />
                        <span>{t('Cannot execute yet', '暂不可直接执行')}</span>
                      </div>
                      {preview.blockers.map((b, i) => (
                        <div key={i} style={{ fontSize: 11.5 }}>• {b}</div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    className="ds-btn"
                    disabled={!project.can_edit || !preview.executable || collectMut.isPending}
                    onClick={handleConfirmCollect}
                  >
                    <Play size={13} />
                    <span>{collectMut.isPending ? t('Submitting…', '正在提交…') : t('Confirm & Start Collection', '确认计划并发起采集')}</span>
                  </button>

                  {preview.reusableBatches.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'grid', gap: 6 }}>
                      <b style={{ fontSize: 11.5 }}>{t('Or reuse an authorized batch (0 API cost)', '或直接复用已授权批次（零 API 消耗）')}</b>
                      {preview.reusableBatches.map((rb) => (
                        <div key={rb.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rb.label} ({rb.itemCount})
                          </span>
                          <button
                            type="button"
                            className="ds-btn ds-btn--ghost"
                            style={{ height: 24, fontSize: 10.5 }}
                            disabled={!project.can_edit || attachMut.isPending}
                            onClick={async () => {
                              await attachMut.mutateAsync({ projectId: project.id, batchId: rb.id });
                              onNavigate(`/projects?view=batches&projectId=${encodeURIComponent(project.id)}`);
                            }}
                          >
                            {t('Attach', '纳入')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reusable Authorized Batches Directory */}
      <div className="ds-card">
        <div className="ds-card-hd">
          <div className="ds-card-title">{t('Authorized Reusable Research Batches (Zero API Cost)', '已有授权研究批次库（零外部 API 消耗）')}</div>
          <div className="ds-card-sub">{t('Only shared batches and your own private batches are visible here.', '仅展示管理员公开共享的批次与你自己的私有批次；其他用户的私有批次严格隔离不可见。')}</div>
        </div>
        <div className="ds-card-bd">
          {researchBatches.length === 0 ? (
            <p className="collection-hint">{t('No reusable research batches yet.', '暂无可复用的授权研究批次。')}</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {researchBatches.slice(0, 12).map((b) => (
                <div key={b.id} className="job-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 12 }}>{b.label}</b>
                      <span className="tag" style={{ fontSize: 10 }}>
                        {b.visibility === 'private' ? t('Private', '私有') : t('Shared', '共享')}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      [{b.platform.toUpperCase()}] {b.sourceLabel} · {b.itemCount} {t('items', '条样本')} · {b.createdAt.slice(0, 16).replace('T', ' ')} UTC
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
                    [{job.platform.toUpperCase()}] {job.sourceLabel}
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
              {t('Enable/disable updates this project immediately; removing only unlinks this project without deleting shared content.', '启用或禁用实时刷新本项目分析；移除仅解除与本项目的关联，不删除共享底层内容，也不影响其他项目。')}
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
            <div style={{ overflowX: 'auto' }}>
              <table className="collection-table">
                <thead>
                  <tr>
                    <th>{t('Batch / Source', '批次与来源')}</th>
                    <th>{t('Visibility', '授权范围')}</th>
                    <th>{t('Items', '样本数')}</th>
                    <th>{t('Collected / Added (UTC)', '采集 / 纳入时间')}</th>
                    <th>{t('Status', '项目状态')}</th>
                    {project.can_edit && <th className="num">{t('Actions', '操作')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => {
                    const isEnabled = b.status === 'enabled';
                    const targetId = reuseTargetByBatch[b.batchId] ?? otherWritableProjects[0]?.id ?? '';
                    return (
                      <tr key={b.batchId}>
                        <td>
                          <b style={{ display: 'block', fontSize: 12 }}>{b.label}</b>
                          <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                            [{b.platform.toUpperCase()}] {b.sourceLabel}
                          </span>
                        </td>
                        <td>
                          <span className="tag" style={{ fontSize: 10 }}>
                            {b.visibility === 'private' ? t('Private', '私有') : t('Shared', '共享')}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{b.itemCount}</td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                          <div>{t('Col', '采')}: {b.createdAt.slice(0, 16).replace('T', ' ')}</div>
                          <div>{t('Add', '入')}: {b.addedAt.slice(0, 16).replace('T', ' ')}</div>
                        </td>
                        <td>
                          <span className={`chip-state ${isEnabled ? 'active' : 'paused'}`}>
                            {isEnabled ? t('Enabled', '已启用') : t('Disabled', '已禁用')}
                          </span>
                        </td>
                        {project.can_edit && (
                          <td className="num">
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="ds-btn ds-btn--ghost"
                                style={{ height: 26, fontSize: 11 }}
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
                                        ? t('Batch disabled for this project.', '已在本项目中禁用该批次。')
                                        : t('Batch re-enabled for this project.', '已重新启用该批次。'),
                                    });
                                  } catch (err) {
                                    setNotice({ text: formatApiError(err), isError: true });
                                  }
                                }}
                              >
                                <Check size={11} />
                                <span>{isEnabled ? t('Disable', '禁用') : t('Enable', '启用')}</span>
                              </button>
                              <button
                                type="button"
                                className="ds-btn ds-btn--danger"
                                style={{ height: 26, fontSize: 11 }}
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
                                <Trash2 size={11} />
                                <span>{t('Remove', '移除')}</span>
                              </button>
                              {otherWritableProjects.length > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <select
                                    className="wb-select"
                                    aria-label={t('Target project for batch reuse', '选择要复用到的目标项目')}
                                    style={{ height: 26, fontSize: 11, maxWidth: 120 }}
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
                                    style={{ height: 26, fontSize: 11 }}
                                    disabled={!targetId || attachMut.isPending}
                                    onClick={async () => {
                                      if (!targetId) return;
                                      setNotice(null);
                                      try {
                                        await attachMut.mutateAsync({ projectId: targetId, batchId: b.batchId });
                                        const targetName = otherWritableProjects.find((p) => p.id === targetId)?.name ?? '';
                                        setNotice({
                                          text: t(`Batch added to "${targetName}" (0 API cost).`, `已将该批次复用到项目『${targetName}』（零外部 API 消耗）。`),
                                        });
                                      } catch (err) {
                                        setNotice({ text: formatApiError(err), isError: true });
                                      }
                                    }}
                                  >
                                    <FolderPlus size={11} />
                                    <span>{t('Reuse', '复用')}</span>
                                  </button>
                                </span>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
