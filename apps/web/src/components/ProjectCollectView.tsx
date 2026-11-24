import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Database, History } from 'lucide-react';
import { useAttachProjectBatchMutation, useBatchesQuery, useCollectResearchPlanMutation, useCollectSourceMutation, usePreviewResearchPlanMutation, useQuotasSummaryQuery, useRecentJobsQuery } from '../api/hooks';
import { generateUuidV4, type Actor, type CollectionSource, type Project, type ResearchPlanPreviewRequest, type ResearchPlanPreviewResponse } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { getRangeLimits, useIntakeError } from '../lib/researchIntake';
import { isResearchSource } from '../lib/collectionLimits';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { ExistingIntakeData, IntakeRestriction, IntakeReviewStep, IntakeScopeStep, IntakeTargetStep,
  type CollectionEstimate, type CollectionRange, type IntakeTarget, type ManualTarget } from './CollectionIntakeSteps';

const planLifetimeMs = 5 * 60_000;
const dayMs = 86_400_000;
const activeJobStates = ['queued', 'running', 'retrying'];
const initialRange: CollectionRange = { days: 7, limit: 20, comments: false, commentLimit: 15, fallback: false, queryHints: {} };

type Flow =
  | { step: 'landing' | 'target' | 'existing' }
  | { step: 'scope'; target: ResearchPlanPreviewResponse }
  | { step: 'review'; target: ResearchPlanPreviewResponse; estimate: CollectionEstimate };

function readDraft(params: string): ManualTarget {
  const sp = new URLSearchParams(params);
  const raw = sp.get('resumePlatform');
  const platform = raw === 'x' || raw === 'bluesky' ? raw : 'reddit';
  const type = sp.get('resumeType');
  const targetType = type === 'search' || type === 'account' || type === 'community' ? type : 'community';
  return { platform, targetType, targetValue: sp.get('resumeTarget')?.slice(0, 512) ?? '' };
}

function buildAdminRegistrationPath(
  isAdmin: boolean,
  restriction: ResearchPlanPreviewResponse | undefined,
  projectId: string,
  draft: ReturnType<typeof readDraft>,
): string | undefined {
  if (!isAdmin || restriction?.resolutionStatus !== 'needs_admin_source') return undefined;
  const val = draft.targetValue.trim();
  if (!val) return undefined;
  return '/sources?' + new URLSearchParams({
    tab: 'sources', domain: 'research', new: '1', returnProjectId: projectId,
    targetPlatform: draft.platform, targetType: draft.targetType, targetValue: val,
  });
}

function buildScopePreviewRequest(
  projectId: string,
  target: ResearchPlanPreviewResponse,
  draft: ReturnType<typeof readDraft>,
  range: CollectionRange,
  now: number,
): ResearchPlanPreviewRequest {
  const hints = Object.keys(range.queryHints).length ? range.queryHints : undefined;
  const common = {
    projectId,
    from: new Date(now - range.days * dayMs).toISOString(),
    to: new Date(now).toISOString(),
    limit: range.limit,
    includeComments: range.comments,
    maxCommentsPerPost: range.comments ? range.commentLimit : undefined,
    queryHints: hints,
  };
  return target.matchedSource
    ? { ...common, sourceId: target.matchedSource.id, useFallback: range.fallback }
    : { ...common, platform: draft.platform, targetType: draft.targetType, targetValue: draft.targetValue.trim() };
}

export function ProjectCollectView({ actor, project, sources, initialSearch = '', onNavigate }: {
  actor: Actor;
  project: Project;
  sources: CollectionSource[];
  initialSearch?: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const readableError = useIntakeError();
  const [draft, setDraft] = useState(() => readDraft(initialSearch));
  const [sourceId, setSourceId] = useState(() => new URLSearchParams(initialSearch).get('sourceId') ?? undefined);
  const [flow, setFlow] = useState<Flow>(() => ({
    step: new URLSearchParams(initialSearch).has('sourceId') || draft.targetValue ? 'target' : 'landing',
  }));
  const [range, setRange] = useState<CollectionRange>(initialRange);
  const [restriction, setRestriction] = useState<ResearchPlanPreviewResponse>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const heading = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  const isAdmin = actor.clientKind === 'browser' && actor.role !== 'viewer';
  const writable = actor.clientKind === 'browser' && Boolean(project.can_edit ?? isAdmin);
  const batchProject = project.dataset_mode === 'batch';
  const canModify = writable && batchProject;
  const quotas = useQuotasSummaryQuery(canModify);
  const preview = usePreviewResearchPlanMutation();
  const collect = useCollectSourceMutation();
  const collectPlan = useCollectResearchPlanMutation();
  const attach = useAttachProjectBatchMutation();
  const existing = useBatchesQuery({ forProjectId: project.id, limit: 100 }, canModify);
  const jobs = useRecentJobsQuery({ projectId: project.id, limit: 20 }, canModify && flow.step === 'landing');
  const policy = quotas.data?.effectivePolicy;
  const canStart = isAdmin || policy?.manualCollectEnabled === true;
  // Let preflight explain service and budget blocks for otherwise permitted targets.
  const eligible = sources.filter(source => isResearchSource(source) && source.state === 'active' &&
    source.deliveryMode === 'pull' && !source.automaticCollectionBlocked &&
    (isAdmin || policy?.allowedProviders.includes(source.primaryProvider) &&
      (policy.allowedSourceIds === null || policy.allowedSourceIds.includes(source.id))));
  const batches = existing.data?.batches ?? [];
  const projectParams = new URLSearchParams({ projectId: project.id });
  const path = (view: string) => `/projects?view=${view}&${projectParams}`;
  const activeJobs = jobs.data?.jobs.filter(job => activeJobStates.includes(job.status)) ?? [];
  const history = jobs.data?.jobs.filter(job => !activeJobStates.includes(job.status));
  const hasData = (project.enabled_batch_count ?? 0) > 0;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (flow.step !== 'landing') heading.current?.focus();
  }, [flow.step]);

  function move(step: 'landing' | 'target' | 'existing') {
    setError('');
    setRestriction(undefined);
    setConfirmed(false);
    collect.reset();
    setFlow({ step });
  }

  async function checkTarget(target: IntakeTarget) {
    if (!canModify || !canStart || preview.isPending) return;
    setError('');
    setRestriction(undefined);
    const now = Date.now();
    try {
      const result = await preview.mutateAsync({ projectId: project.id, ...target,
        from: new Date(now - dayMs).toISOString(), to: new Date(now).toISOString(), limit: 1 });
      if (!mounted.current) return;
      if (!result.executable || (!result.matchedSource && result.resolutionStatus !== 'on_demand_available')) {
        setRestriction(result);
        return;
      }
      setSourceId(result.matchedSource?.id);
      const limits = getRangeLimits(result);
      setRange(current => ({ ...current, days: Math.min(current.days, limits.maxDays),
        limit: Math.min(current.limit, limits.maxItems), comments: current.comments && limits.maxComments > 0,
        commentLimit: Math.min(current.commentLimit, Math.max(1, limits.maxComments)), fallback: false }));
      setFlow({ step: 'scope', target: result });
    } catch (err) { setError(readableError(err)); }
  }

  async function estimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canModify || flow.step !== 'scope' || preview.isPending) return;
    if (!flow.target.matchedSource && flow.target.resolutionStatus !== 'on_demand_available') return;
    setError('');
    setRestriction(undefined);
    const now = Date.now();
    const request = buildScopePreviewRequest(project.id, flow.target, draft, range, now);
    try {
      const result = await preview.mutateAsync(request);
      if (!mounted.current) return;
      if (!result.executable || (!result.matchedSource && result.resolutionStatus !== 'on_demand_available')) {
        setRestriction(result);
        return;
      }
      collect.reset();
      collectPlan.reset();
      setConfirmed(false);
      setFlow({ step: 'review', target: flow.target,
        estimate: { request, result, key: generateUuidV4(), expiresAt: now + planLifetimeMs } });
    } catch (err) { setError(readableError(err)); }
  }

  async function confirm() {
    if (!canModify || flow.step !== 'review' || !confirmed || submitting.current) return;
    const { estimate: prepared, target } = flow;
    if (Date.now() >= prepared.expiresAt && !collect.isError && !collectPlan.isError) {
      setFlow({ step: 'scope', target });
      setError(t('The estimate expired. Check the estimated usage again.', '估算已过期，请重新查看预计消耗。'));
      setConfirmed(false);
      return;
    }
    const { from, to, limit, includeComments, maxCommentsPerPost, useFallback, projectId, queryHints } = prepared.request;
    submitting.current = true;
    setError('');
    try {
      const result = prepared.request.sourceId
        ? await collect.mutateAsync({
            sourceId: prepared.request.sourceId,
            idempotencyKey: prepared.key,
            payload: { from, to, limit, includeComments, maxCommentsPerPost, useFallback, projectId, queryHints },
          })
        : await collectPlan.mutateAsync({
            payload: { ...prepared.request, projectId: project.id },
            idempotencyKey: prepared.key,
          });
      if (mounted.current) onNavigate(path('jobs') + '&jobId=' + encodeURIComponent(result.jobId));
    } catch (err) { setError(readableError(err, true)); }
    finally { submitting.current = false; }
  }

  async function addExisting(batchId: string) {
    if (!canModify || submitting.current || !batches.some(batch => batch.id === batchId)) return;
    submitting.current = true;
    setError('');
    try {
      await attach.mutateAsync({ projectId: project.id, batchId });
      if (mounted.current) onNavigate(path('batches') + '&batchId=' + encodeURIComponent(batchId));
    } catch (err) { setError(readableError(err)); }
    finally { submitting.current = false; }
  }

  const registrationPath = buildAdminRegistrationPath(isAdmin, restriction, project.id, draft);

  return <div className="research-intake">
    <header className="research-intake-heading">
      <h1>{t('Add research data to your project', '为项目添加研究数据')}</h1>
      <p><strong>{project.name}</strong>{batchProject && <> · {hasData
        ? t(`${project.enabled_batch_count} collection records in use`, `已启用 ${project.enabled_batch_count} 次采集数据`)
        : (project.enabled_batch_count === 0 && t('No research data yet', '尚未接入数据'))}</>}</p>
    </header>
    <section ref={heading} tabIndex={-1} className="research-intake-panel" aria-label={t('Project data intake', '项目数据接入')}>
      {!canModify ? <>
        <h2>{writable ? t('Data comes from the linked sources', '按关联来源汇集数据') : t('Read-only project', '只读项目')}</h2>
        <p>{writable ? t('This project collects data from its linked sources. Use a new research project to add individual collections.', '此项目按关联来源持续汇集。需要添加单次采集的数据时，可以新建研究项目。')
          : t('You can view this project’s data. Create your own project to add data.', '你可以查看此项目的数据。需要添加数据时，请新建自己的研究项目。')}</p>
        <div className="intake-actions">
          <Button type="button" className="intake-primary" onClick={() => onNavigate(path('overview'))}>{t('View project overview', '查看项目总览')}</Button>
          {actor.clientKind === 'browser' && <Button type="button" variant="outline" onClick={() => onNavigate('/projects?new=1')}>{t('Create a research project', '新建研究项目')}</Button>}
        </div>
      </> : <>
        {flow.step !== 'landing' && flow.step !== 'existing' && <ol className="intake-steps" aria-label={t('Collection steps', '采集步骤')}>
          {[['target', t('Choose target', '选择对象')], ['scope', t('Set scope', '设置范围')], ['review', t('Confirm usage', '确认消耗')]].map(([step, title], index) =>
            <li key={step} aria-current={flow.step === step ? 'step' : undefined}><span>{index + 1}</span>{title}</li>)}
        </ol>}
        {error && <Alert variant="destructive" role="alert">{error}</Alert>}
        {flow.step === 'landing' && <>
          <h2>{t('Start collecting data', '开始采集研究数据')}</h2>
          <p>{t('Choose what to research and a time range. You’ll see the estimated usage before confirming, and available results will appear here.', '选择研究对象和时间范围，确认预计消耗后开始采集。采集结果会自动加入本项目。')}</p>
          {!canStart && quotas.isPending && <Skeleton role="status" aria-label={t('Checking account permissions', '正在检查采集权限')} className="intake-loading" />}
          {!canStart && quotas.isError && <Alert role="alert">{readableError(quotas.error)} <Button type="button" variant="outline" onClick={() => void quotas.refetch()}>{t('Retry', '重试')}</Button></Alert>}
          {!canStart && policy && <Alert role="status">{t('Your plan cannot start new collections. You may still add existing authorized data when available.', '当前套餐无法发起采集。有可添加的数据时，仍可使用已有数据。')}</Alert>}
          {existing.isPending && <p role="status" className="collection-hint">{t('Checking for existing data…', '正在检查可添加的已有数据…')}</p>}
          {existing.isError && <p role="alert">{t('Could not check for existing data.', '暂时无法检查已有数据。')} <button className="intake-link" type="button" onClick={() => void existing.refetch()}>{t('Retry', '重试')}</button></p>}
          {existing.isSuccess && !batches.length && <p className="collection-hint">{t('No existing research data is available to add.', '目前没有可添加的已有研究数据。')}</p>}
          <div className="intake-actions">
            {canStart && <Button type="button" className="intake-primary" onClick={() => move('target')}>{t('Start collection', '开始采集')}<ArrowRight size={16} /></Button>}
            {batches.length > 0 && <Button type="button" variant="outline" onClick={() => move('existing')}><Database size={16} />{t('Use existing data', '使用已有数据')}</Button>}
          </div>
          {jobs.isSuccess && ((history?.length ?? 0) > 0 || activeJobs.length > 0) && <div className="intake-recent">
            <History size={17} aria-hidden="true" />
            <span>{activeJobs.length > 0
              ? t(`${activeJobs.length} active collection(s)`, `${activeJobs.length} 个任务正在进行`)
              : t(`${history?.length} recent completed or closed collection(s)`, `近期有 ${history?.length} 条已结束的采集记录`)}</span>
            <a href={path('jobs')}>{t('View collection tasks', '查看采集任务')}</a>
          </div>}
        </>}
        {flow.step === 'target' && <IntakeTargetStep sources={eligible} draft={draft} setDraft={value => {
          setDraft(value); setRestriction(undefined); setError('');
        }} selected={sourceId} pending={preview.isPending} onSelect={target => void checkTarget(target)} />}
        {flow.step === 'scope' && !restriction && <IntakeScopeStep result={flow.target} source={sources.find(source => source.id === sourceId)}
          range={range} setRange={setRange} isAdmin={isAdmin} pending={preview.isPending}
          onContinue={estimate} onBack={() => move('target')} />}
        {restriction && <IntakeRestriction result={restriction} registrationPath={registrationPath} isAdmin={isAdmin}
          onBack={() => { setRestriction(undefined); setError(''); }} />}
        {flow.step === 'review' && <IntakeReviewStep estimate={flow.estimate} isAdmin={isAdmin} confirmed={confirmed} setConfirmed={setConfirmed}
          pending={collect.isPending || collectPlan.isPending} onConfirm={() => void confirm()} onBack={() => {
            if (collect.isPending || collectPlan.isPending) return;
            setError(''); setConfirmed(false); setFlow({ step: 'scope', target: flow.target });
          }} onReuse={batches.length ? () => move('existing') : undefined} />}
        {flow.step === 'existing' && <>
          <ExistingIntakeData batches={batches} pending={attach.isPending} onAttach={id => void addExisting(id)} />
          {!batches.length && <p>{t('No existing data is currently available to add.', '当前没有可添加的已有数据。')}</p>}
          <Button type="button" variant="ghost" disabled={attach.isPending} onClick={() => move('landing')}>{t('Back to adding data', '返回添加数据')}</Button>
        </>}
        {flow.step === 'target' && <Button type="button" variant="ghost" disabled={preview.isPending} onClick={() => move('landing')}>{t('Back to adding data', '返回添加数据')}</Button>}
      </>}
    </section>
  </div>;
}
