import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  formatApiError, useAttachProjectBatchMutation, useBatchesQuery, useCollectSourceMutation,
  usePreviewResearchPlanMutation, useQuotasSummaryQuery,
} from '../api/hooks';
import {
  formatSourceTarget, generateUuidV4, type Actor, type CollectionSource, type Project,
  type ResearchPlanPreviewRequest, type ResearchPlanPreviewResponse,
} from '../contracts/api';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { useI18n } from '../i18n/translations';
import { isResearchSource } from '../lib/collectionLimits';

type Platform = NonNullable<ResearchPlanPreviewRequest['platform']>;
type TargetType = NonNullable<ResearchPlanPreviewRequest['targetType']>;
type Phase = 'choice' | 'target' | 'review' | 'reuse';
const targetTypes: Record<Platform, TargetType[]> = {
  reddit: ['community', 'account', 'search'],
  x: ['account', 'search'],
  bluesky: ['account'],
};
const targetValidation = {
  community: /^(?:r\/)?[a-zA-Z0-9_]{1,100}$/i,
  account: /^@?[^\s/@]{1,253}$/,
  search: /^.{1,512}$/,
};
const planLifetimeMs = 5 * 60_000;

function collectionWindow(days: number) {
  const now = Date.now();
  return { from: new Date(now - days * 86_400_000).toISOString(), to: new Date(now).toISOString(), expiresAt: now + planLifetimeMs };
}

type Plan = {
  request: ResearchPlanPreviewRequest;
  result: ResearchPlanPreviewResponse;
  idempotencyKey: string;
  expiresAt: number;
};

export function ProjectCollectView({ actor, project, sources, onNavigate }: {
  actor: Actor;
  project: Project;
  sources: CollectionSource[];
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('choice');
  const [mode, setMode] = useState<'target' | 'source'>('target');
  const [platform, setPlatform] = useState<Platform>('reddit');
  const [targetType, setTargetType] = useState<TargetType>('community');
  const [targetValue, setTargetValue] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState(20);
  const [comments, setComments] = useState(false);
  const [commentLimit, setCommentLimit] = useState(15);
  const [fallback, setFallback] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const intake = useRef<HTMLElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const isAdmin = actor.clientKind === 'browser' && (actor.role === 'owner' || actor.role === 'admin');
  const writable = actor.clientKind === 'browser' && Boolean(project.can_edit ?? isAdmin);
  const batchProject = project.dataset_mode === 'batch';
  const quotas = useQuotasSummaryQuery(writable && batchProject);
  const preview = usePreviewResearchPlanMutation();
  const collect = useCollectSourceMutation();
  const attach = useAttachProjectBatchMutation();
  const batches = useBatchesQuery({ limit: 100 }, writable && batchProject && phase === 'reuse');
  const policy = quotas.data?.effectivePolicy;
  const maxDays = isAdmin ? 365 : policy?.maxLookbackDays ?? 0;
  const maxItems = isAdmin ? 300 : policy?.maxBatchLimit ?? 0;
  const maxComments = isAdmin ? 50 : policy?.maxCommentsPerPost ?? 0;
  const eligible = sources.filter(source => isResearchSource(source) && source.state === 'active' &&
    source.deliveryMode === 'pull' && (isAdmin || (policy &&
      (policy.allowedSourceIds === null || policy.allowedSourceIds.includes(source.id)) &&
      (policy.allowedProviders.includes(source.primaryProvider) ||
        (policy.allowProviderChoice && source.fallbackProvider && policy.allowedProviders.includes(source.fallbackProvider))))));
  const selectedSource = eligible.find(source => source.id === sourceId) ?? eligible[0];
  const canSelectFallback = Boolean(selectedSource?.fallbackProvider && (isAdmin ||
    (policy?.allowProviderChoice && policy.allowedProviders.includes(selectedSource.fallbackProvider))));
  const actualFallback = mode === 'source' && canSelectFallback && Boolean(selectedSource?.fallbackProvider) && fallback;
  const sourceProvider = actualFallback ? selectedSource?.fallbackProvider : selectedSource?.primaryProvider;
  const providerLimit = mode === 'target'
    ? platform === 'x' ? 20 : platform === 'bluesky' ? 100 : 300
    : sourceProvider === 'twitterapis' ? 20
      : sourceProvider === 'kaix' && selectedSource?.target.type !== 'post' ? 300
        : selectedSource?.target.type === 'post' ? Math.min(50, maxComments) : 100;
  const supportsComments = maxComments > 0 && (mode === 'source'
    ? sourceProvider === 'kaix' && selectedSource?.target.type !== 'post' : platform === 'reddit');
  const actualComments = supportsComments && comments;
  const commentMax = Math.max(1, Math.min(commentLimit, maxComments));
  const actualMaxItems = Math.min(maxItems, providerLimit, actualComments ? Math.floor(2000 / (commentMax + 1)) : 300);
  const projectPath = (view: string) => `/projects?view=${view}&projectId=${encodeURIComponent(project.id)}`;

  useEffect(() => { if (phase !== 'choice') intake.current?.focus(); }, [phase]);

  function move(next: Phase) {
    collect.reset();
    setError('');
    setPlan(null);
    setCostConfirmed(false);
    setPhase(next);
  }

  function chooseRegisteredSource() {
    setMode('source');
    setComments(false);
    setFallback(false);
    move('target');
  }

  async function runPreflight(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || !batchProject || preview.isPending || actualMaxItems < 1 || maxDays < 1) return;
    const value = targetValue.trim();
    if (mode === 'target' && !targetValidation[targetType].test(value)) {
      setError(t('Check the target format and try again.', '请按示例填写有效的研究目标。'));
      return;
    }
    if (mode === 'source' && !selectedSource) return;
    const { from, to, expiresAt } = collectionWindow(Math.min(days, maxDays));
    const request: ResearchPlanPreviewRequest = {
      projectId: project.id,
      ...(mode === 'source' ? { sourceId: selectedSource!.id } : { platform, targetType, targetValue: value }),
      from,
      to,
      limit: Math.min(limit, actualMaxItems),
      includeComments: actualComments,
      maxCommentsPerPost: actualComments ? commentMax : undefined,
      useFallback: actualFallback,
    };
    setError('');
    try {
      const result = await preview.mutateAsync(request);
      if (!mounted.current) return;
      setPlan({ request, result, expiresAt, idempotencyKey: generateUuidV4() });
      setCostConfirmed(false);
      setPhase('review');
    } catch (err) {
      setError(formatApiError(err));
    }
  }

  async function confirm() {
    if (!writable || !plan?.result.executable || !plan.result.matchedSource || !costConfirmed || collect.isPending || attach.isPending) return;
    if (Date.now() >= plan.expiresAt && !collect.isError) {
      move('target');
      setError(t('The estimate expired. Run preflight again.', '预检估算已过期，请重新预检。'));
      return;
    }
    const { from, to, limit, includeComments, maxCommentsPerPost, useFallback, projectId } = plan.request;
    setError('');
    try {
      const result = await collect.mutateAsync({
        sourceId: plan.result.matchedSource.id, idempotencyKey: plan.idempotencyKey,
        payload: { from, to, limit, includeComments, maxCommentsPerPost, useFallback, projectId },
      });
      if (mounted.current) onNavigate(projectPath('jobs') + '&jobId=' + encodeURIComponent(result.jobId));
    } catch (err) {
      const message = formatApiError(err);
      setError(message.includes('System channel budget is disabled or zero')
        ? t(message, '系统渠道预算已停用或上限为零，可稍后重试或改用授权批次。')
        : message);
    }
  }

  async function attachBatch(id: string) {
    if (!writable || attach.isPending || collect.isPending) return;
    setError('');
    try {
      await attach.mutateAsync({ projectId: project.id, batchId: id });
      if (mounted.current) onNavigate(projectPath('batches') + '&batchId=' + encodeURIComponent(id));
    } catch (err) {
      setError(formatApiError(err));
    }
  }

  if (!writable || !batchProject) return <section className="ds-card intake-panel">
    <h2>{writable ? t('Source-based research', '来源型研究') : t('Read-only project', '只读项目')}</h2>
    <p>{writable ? t('This project draws samples from its configured sources. Use a batch project to attach individual collections.', '此项目按配置的来源汇集样本。需要纳入单次采集批次时，可新建批次型项目。')
      : t('Open the project overview to analyze its data, or create a private project to collect data.', '可在项目总览分析已有数据，或新建私有项目接入数据。')}</p>
    <div className="collection-toolbar">
      <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate(projectPath('overview'))}>{t('Project overview', '项目总览')}</button>
      <button type="button" className="ds-btn" onClick={() => onNavigate('/projects?new=1')}>{t('Create private project', '新建私有项目')}</button>
    </div>
  </section>;

  const visibleBatches = batches.data?.batches.filter(batch => batch.usageDomain
    ? batch.usageDomain === 'research' : batch.platform !== 'web');
  const notice = error && <Alert variant="destructive" className="wb-alert wb-alert--error">{error}</Alert>;
  const remaining = (cap: number | null, used: number) => cap === null ? t('Unlimited', '不设上限') : Math.max(0, cap - used);
  return <section ref={intake} tabIndex={-1} className="ds-card intake-panel" aria-label={t('Project data ingestion', '项目数据接入')}>
    {(phase === 'target' || phase === 'review') && <ol className="source-wizard-steps" aria-label={t('Collection steps', '采集步骤')}>
      <li aria-current={phase === 'target' ? 'step' : undefined}>1. {t('Research target', '研究目标')}</li>
      <li aria-current={phase === 'review' ? 'step' : undefined}>2. {t('Preflight and confirmation', '预检与确认')}</li>
      <li>3. {t('Job and batch', '任务与批次')}</li>
    </ol>}
    {phase === 'choice' && <>
      <h2>{t('How do you want to add data?', '选择数据接入方式')}</h2>
      <p>{project.name} · {project.enabled_batch_count ?? 0} {t('enabled batches', '个已启用批次')}</p>
      <div className="intake-choices">
        <button type="button" className="intake-choice" onClick={() => move('target')}>
          <strong>{t('Start a new collection', '新采集')}</strong>
          <span>{t('Enter a research target and check expected usage before running.', '填写研究目标，先预检渠道与预计用量。')}</span>
        </button>
        <button type="button" className="intake-choice" onClick={() => move('reuse')}>
          <strong>{t('Reuse an authorized batch', '复用已授权批次')}</strong>
          <span>{t('Attach existing samples without an upstream request.', '直接纳入已有样本，无外部采集请求。')}</span>
        </button>
      </div>
    </>}
    {phase === 'target' && <>
      <h2>{t('Define the research target', '填写研究目标')}</h2>
      <p>{isAdmin ? t('Administrator collection limits', '管理员采集上限') : policy
        ? t(`${policy.planTier.toUpperCase()} plan · ${maxDays} days · ${maxItems} items · ${maxComments} comments per post`,
          `${policy.planTier.toUpperCase()} 套餐 · ${maxDays} 天 · ${maxItems} 条 · 每帖 ${maxComments} 条评论`)
        : t('Loading your collection policy…', '正在读取你的采集权限…')}</p>
      {!isAdmin && policy && quotas.data && <p className="collection-hint">
        {t('Remaining today', '今日剩余')} · {t('Requests', '请求')} {remaining(policy.dailyRequests, quotas.data.myUsage.requestsReserved)}
        {' · '}{t('Resource units', '资源单位')} {remaining(policy.dailyResources, quotas.data.myUsage.resourcesReserved)}
      </p>}
      {!isAdmin && quotas.isError && <p role="alert">{formatApiError(quotas.error)}</p>}
      {!isAdmin && policy?.manualCollectEnabled === false && <p role="status">{t('Manual collection is unavailable for your plan. You can reuse an authorized batch.', '当前套餐未开放手动采集，可复用授权批次。')}</p>}
      <form className="collection-form" onSubmit={runPreflight}>
        <fieldset className="intake-fields" disabled={preview.isPending}>
          <div className="collection-toolbar" role="group" aria-label={t('Target input mode', '目标填写方式')}>
            <button type="button" className="ds-btn ds-btn--ghost" aria-pressed={mode === 'target'} onClick={() => { setMode('target'); setComments(false); setFallback(false); }}>{t('Describe a target', '输入研究目标')}</button>
            <button type="button" className="ds-btn ds-btn--ghost" aria-pressed={mode === 'source'} onClick={chooseRegisteredSource}>{t('Choose registered source', '选择已登记研究源')}</button>
          </div>
          {mode === 'target' ? <>
            <div className="wb-grid-2">
              <label className="wb-field">{t('Platform', '目标平台')}<select className="wb-select" value={platform} onChange={event => {
                const next = event.target.value as Platform;
                setPlatform(next); setTargetType(targetTypes[next][0]); setTargetValue(''); setComments(false);
              }}><option value="reddit">Reddit</option><option value="x">X</option><option value="bluesky">Bluesky</option></select></label>
              <label className="wb-field">{t('Target type', '目标类型')}<select className="wb-select" value={targetType} onChange={event => {
                setTargetType(event.target.value as TargetType); setTargetValue('');
              }}>{targetTypes[platform].map(type => <option key={type} value={type}>
                {type === 'community' ? t('Community', '社区') : type === 'account' ? t('Account', '账号') : t('Keywords', '关键词')}
              </option>)}</select></label>
            </div>
            <label className="wb-field">{t('Target value', '目标内容')}<input className="wb-input" required maxLength={512} value={targetValue}
              onChange={event => setTargetValue(event.target.value)}
              placeholder={targetType === 'community' ? 'r/LocalLLaMA' : targetType === 'search' ? 'OpenAI OR ChatGPT' : platform === 'bluesky' ? '@example.bsky.social' : '@openai'} /></label>
          </> : <label className="wb-field">{t('Registered research source', '已登记的研究来源')}
            <select className="wb-select" value={selectedSource?.id ?? ''} onChange={event => { setSourceId(event.target.value); setComments(false); setFallback(false); }}>
              {eligible.length === 0 && <option value="">{t('No eligible research source', '暂无可选研究源')}</option>}
              {eligible.map(source => <option key={source.id} value={source.id}>{source.label} · {formatSourceTarget(source.target)}</option>)}
            </select>
          </label>}
          <div className="wb-grid-2">
            <label className="wb-field">{t('Lookback days (UTC)', '回溯天数（UTC）')}
              <input className="wb-input" type="number" required min={1} max={Math.max(1, maxDays)} value={Math.min(days, Math.max(1, maxDays))} onChange={event => setDays(Number(event.target.value) || 1)} />
            </label>
            <label className="wb-field">{t('Maximum items', '本次条数上限')}
              <input className="wb-input" type="number" required min={1} max={Math.max(1, actualMaxItems)} value={Math.min(limit, Math.max(1, actualMaxItems))} onChange={event => setLimit(Number(event.target.value) || 1)} />
            </label>
          </div>
          {supportsComments && <label className="collection-checkbox"><input type="checkbox" checked={comments} onChange={event => setComments(event.target.checked)} />{t('Include comments', '同时采集评论')}</label>}
          {actualComments && <label className="wb-field">{t('Maximum comments per post', '每帖评论上限')}
            <input className="wb-input" type="number" required min={1} max={maxComments} value={commentMax} onChange={event => setCommentLimit(Number(event.target.value) || 1)} />
          </label>}
          {mode === 'source' && selectedSource?.fallbackProvider && canSelectFallback && <details className="collection-disclosure">
            <summary>{t('Advanced execution settings', '高级执行设置')}</summary>
            <label className="collection-checkbox"><input type="checkbox" checked={fallback} onChange={event => { setFallback(event.target.checked); setComments(false); }} />
              {t('Use backup provider', '使用备用渠道')} · {selectedSource.fallbackProvider}
            </label>
          </details>}
        </fieldset>
        {notice}
        <div className="collection-toolbar">
          <button type="button" className="ds-btn ds-btn--ghost" disabled={preview.isPending} onClick={() => move('choice')}>{t('Back', '返回')}</button>
          <button type="submit" className="ds-btn" disabled={preview.isPending || actualMaxItems === 0 || (mode === 'source' && !selectedSource)}>
            {preview.isPending ? t('Checking…', '正在预检…') : t('Run server preflight', '生成服务端预检计划')}
          </button>
        </div>
      </form>
    </>}
    {phase === 'review' && plan && <>
      <h2>{t('Preflight and confirmation', '预检结果与成本确认')}</h2>
      <PlanResult plan={plan} isAdmin={isAdmin} />
      {plan.result.executable && <label className="collection-checkbox">
        <input type="checkbox" checked={costConfirmed} disabled={collect.isPending} onChange={event => setCostConfirmed(event.target.checked)} />
        {t('I reviewed the estimated usage and confirm this collection.', '我已核对预计用量并确认本次采集。')}
      </label>}
      {notice}
      <div className="collection-toolbar">
        <button type="button" className="ds-btn ds-btn--ghost" disabled={collect.isPending || attach.isPending} onClick={() => move('target')}>{t('Edit target and scope', '修改目标与范围')}</button>
        {plan.result.resolutionStatus === 'needs_admin_source' && <button type="button" className="ds-btn ds-btn--ghost" onClick={chooseRegisteredSource}>{t('Choose registered source', '选择已登记研究源')}</button>}
        {isAdmin && !plan.result.executable && <a className="ds-btn ds-btn--ghost" href="/sources?tab=sources&domain=research">{t('Manage research sources', '管理研究来源')}</a>}
        {plan.result.executable && <Button type="button" className="ds-btn" disabled={!costConfirmed || collect.isPending || attach.isPending} onClick={() => void confirm()}>
          {collect.isPending ? t('Submitting…', '正在提交…') : t('Confirm and start collection', '确认并发起采集')}
        </Button>}
      </div>
      {plan.result.reusableBatches.length > 0 && <section className="intake-batches">
        <h3>{t('Authorized batches for this source', '该来源的授权批次')}</h3>
        {plan.result.reusableBatches.map(batch => <BatchChoice key={batch.id} batch={batch} busy={attach.isPending || collect.isPending} onAttach={attachBatch} />)}
      </section>}
    </>}
    {phase === 'reuse' && <>
      <h2>{t('Reuse authorized batches', '复用已授权批次')}</h2>
      <p>{t('Existing batches attach directly to this project. Reuse consumes no external requests.', '将已有样本纳入本项目，复用消耗 0 次外部请求。')}</p>
      {batches.isPending && <p role="status">{t('Loading batches…', '正在加载批次…')}</p>}
      {batches.isError && <p role="alert">{formatApiError(batches.error)}</p>}
      {visibleBatches?.length === 0 && <p>{t('No authorized research batches are available.', '暂无可复用的授权研究批次。')}</p>}
      <div className="intake-batches">{visibleBatches?.map(batch => <BatchChoice key={batch.id} batch={batch} busy={attach.isPending} onAttach={attachBatch} />)}</div>
      {notice}
      <div className="collection-toolbar">
        <button type="button" className="ds-btn ds-btn--ghost" disabled={attach.isPending} onClick={() => move('choice')}>{t('Back', '返回')}</button>
        {visibleBatches?.length === 0 && <button type="button" className="ds-btn" onClick={() => move('target')}>{t('Start new collection', '新采集')}</button>}
      </div>
    </>}
  </section>;
}

function PlanResult({ plan, isAdmin }: { plan: Plan; isAdmin: boolean }) {
  const { t } = useI18n();
  const { request, result } = plan;
  const title = result.resolutionStatus === 'matched_source' ? t('Ready to submit', '预检通过，可确认提交')
    : result.resolutionStatus === 'needs_admin_source' ? t('Target needs administrator registration', '目标待管理员登记')
      : t('Collection is blocked', '当前无法提交采集');
  const blockerMessage = (reason: string) => {
    if (reason.includes('unresolved paid request')) return t(reason, '渠道有未决计费请求，请等待管理员核实。');
    if (reason.includes('credentials/networking')) return t(reason, '采集渠道未就绪，请联系管理员检查服务配置。');
    if (reason.includes('paused or archived')) return t(reason, '来源已暂停或归档，请改选来源或联系管理员。');
    if (reason.includes('budget')) return t(reason, '系统渠道预算已停用或上限为零，请联系管理员。');
    if (reason.includes('Manual collection is disabled')) return t(reason, '当前套餐未开放手动采集，可复用授权批次。');
    if (reason.includes('request quota reached')) return t(reason, '今日采集请求额度不足，可复用授权批次。');
    if (reason.includes('resource quota reached')) return t(reason, '今日采集资源额度不足，可缩小范围、减少条数或复用授权批次。');
    if (reason.includes('not enabled for')) return t(reason, '当前套餐未授权使用此渠道，请改选来源。');
    if (reason.includes('allowed collection scope')) return t(reason, '当前账号未获此来源的采集权限，请改选来源。');
    return reason;
  };
  return <div className="intake-plan">
    <strong role="status">{title}</strong>
    {result.resolutionStatus === 'needs_admin_source' && <p>{t('Ask an administrator to register this target, or choose a registered source.', '请联系管理员登记此目标，或改选一个已登记研究源。')}</p>}
    {result.matchedSource && <dl className="collection-source-facts">
      <div><dt>{t('Execution source', '执行来源')}</dt><dd>{result.matchedSource.label} · {formatSourceTarget(result.matchedSource.target)}</dd></div>
      {(isAdmin || result.fieldPolicy.canChooseProvider) && <div><dt>{t('Provider', '执行渠道')}</dt><dd>{result.matchedSource.provider}</dd></div>}
      <div><dt>{t('Request scope', '本次范围')}</dt><dd>{request.from.slice(0, 16).replace('T', ' ')} – {request.to.slice(0, 16).replace('T', ' ')} UTC · {request.limit} {t('items', '条')}
        {request.includeComments && ` · ${t('up to', '每帖最多')} ${request.maxCommentsPerPost} ${t('comments', '条评论')}`}</dd></div>
      <div><dt>{t('Visible stored samples', '此范围内可见存量')}</dt><dd>{result.coverage.existingItemCount} {t('items', '条')} · {
        result.coverage.status === 'unknown' ? t('Coverage unverified', '覆盖范围待核实') : t('No visible stored samples', '暂无可见样本')}</dd></div>
      <div><dt>{t('Estimated usage', '预计用量')}</dt><dd>{result.estimate.requests} {t('upstream requests', '次外部请求')} · {
        isAdmin ? result.estimate.systemResources : result.estimate.personalResources} {t('resource units', '资源单位')}</dd></div>
    </dl>}
    {result.matchedSource && <p className="collection-hint">{t('These estimates apply to the first execution. Availability and quotas are checked again during submission and execution.', '估算基于首次执行。提交和运行时会重新检查权限、渠道与额度。')}</p>}
    {result.blockers.some(reason => !reason.includes('Target is not registered')) && <ul>
      {result.blockers.filter(reason => !reason.includes('Target is not registered')).map(reason => <li key={reason}>{blockerMessage(reason)}</li>)}
    </ul>}
  </div>;
}

function BatchChoice({ batch, busy, onAttach }: {
  batch: { id: string; label: string; itemCount: number; createdAt: string; visibility?: 'private' | 'shared' };
  busy: boolean;
  onAttach: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  return <div className="job-row intake-batch-row">
    <div><strong>{batch.label}</strong><p>{batch.itemCount} {t('samples', '条样本')} · {batch.createdAt.slice(0, 10)} · {
      batch.visibility === 'private' ? t('Private', '私有') : t('Shared', '共享')}</p></div>
    <button type="button" className="ds-btn ds-btn--ghost" disabled={busy} onClick={() => void onAttach(batch.id)}>{t('Attach to project', '纳入本项目')}</button>
  </div>;
}
