import { useEffect, useRef, useState, type FormEvent } from 'react';
import { History, Layers } from 'lucide-react';
import {
  useCollectResearchPlanMutation,
  useCollectSourceMutation,
  usePreviewResearchPlanMutation,
  useQuotasSummaryQuery,
  useRecentJobsQuery,
} from '../api/hooks';
import {
  generateUuidV4,
  type Actor,
  type CollectionSource,
  type Project,
  type ResearchPlanPreviewRequest,
  type ResearchPlanPreviewResponse,
} from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { getRangeLimits, useIntakeError } from '../lib/researchIntake';
import { isResearchSource } from '../lib/collectionLimits';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import {
  IntakeRestriction,
  IntakeReviewStep,
  IntakeScopeStep,
  IntakeTargetStep,
  type CollectionEstimate,
  type CollectionRange,
  type IntakeTarget,
  type ManualTarget,
  type ResolvedIntakeTarget,
} from './CollectionIntakeSteps';

const planLifetimeMs = 5 * 60_000;
const dayMs = 86_400_000;
const activeJobStates = ['queued', 'running', 'retrying'];
const initialRange: CollectionRange = { days: 7, limit: 20, comments: false, commentLimit: 15, fallback: false, queryHints: {} };

type Flow =
  | { step: 'target' }
  | { step: 'scope'; targets: ResolvedIntakeTarget[] }
  | { step: 'review'; targets: ResolvedIntakeTarget[]; estimates: CollectionEstimate[] };

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
  draft: ManualTarget,
): string | undefined {
  if (!isAdmin || restriction?.resolutionStatus !== 'needs_admin_source') return undefined;
  const rawTokens = draft.targetValue.split(/[\n,，]+/).map((part) => part.trim()).filter(Boolean);
  const resolved = restriction.resolvedTarget?.value;
  const matchedRaw = resolved
    ? rawTokens.find((token) => token.replace(/^(?:r\/|@)/i, '').toLowerCase() === resolved.toLowerCase())
    : undefined;
  const val = matchedRaw ?? (rawTokens.length === 1 ? rawTokens[0] : resolved) ?? draft.targetValue.trim();
  if (!val) return undefined;
  return (
    '/sources?' +
    new URLSearchParams({
      tab: 'sources',
      domain: 'research',
      new: '1',
      returnProjectId: projectId,
      targetPlatform: restriction.resolvedTarget?.platform ?? draft.platform,
      targetType: restriction.resolvedTarget?.type ?? draft.targetType,
      targetValue: val,
    })
  );
}

function buildScopePreviewRequest(
  projectId: string,
  target: ResolvedIntakeTarget,
  range: CollectionRange,
  allowFallback: boolean,
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
  if (target.result.matchedSource) {
    return { ...common, sourceId: target.result.matchedSource.id, useFallback: allowFallback ? range.fallback : false };
  }
  if ('sourceId' in target.input) {
    return { ...common, sourceId: target.input.sourceId, useFallback: allowFallback ? range.fallback : false };
  }
  return {
    ...common,
    platform: target.input.platform,
    targetType: target.input.targetType,
    targetValue: target.input.targetValue.trim(),
  };
}

export function ProjectCollectView({
  actor,
  project,
  sources,
  initialSearch = '',
  onNavigate,
}: {
  actor: Actor;
  project: Project;
  sources: CollectionSource[];
  initialSearch?: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  const readableError = useIntakeError();
  const [draft, setDraft] = useState(() => readDraft(initialSearch));
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() => {
    const id = new URLSearchParams(initialSearch).get('sourceId');
    return id ? [id] : [];
  });
  const [flow, setFlow] = useState<Flow>({ step: 'target' });
  const [range, setRange] = useState<CollectionRange>(initialRange);
  const [restriction, setRestriction] = useState<ResearchPlanPreviewResponse>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const heading = useRef<HTMLElement>(null);
  const submitting = useRef(false);
  const submittedJobIds = useRef(new Map<string, string>());

  const isAdmin = actor.clientKind === 'browser' && actor.role !== 'viewer';
  const writable = actor.clientKind === 'browser' && Boolean(project.can_edit ?? isAdmin);
  const batchProject = project.dataset_mode === 'batch';
  const canModify = writable && batchProject;

  const quotas = useQuotasSummaryQuery(canModify);
  const preview = usePreviewResearchPlanMutation();
  const collect = useCollectSourceMutation();
  const collectPlan = useCollectResearchPlanMutation();
  const jobs = useRecentJobsQuery({ projectId: project.id, limit: 20 }, canModify && flow.step === 'target');

  const policy = quotas.data?.effectivePolicy;
  const canStart = isAdmin || policy?.manualCollectEnabled === true;

  // Only show Ops source whitelist when Ops policy explicitly locked this account to specific allowedSourceIds.
  const hasStrictWhitelist = !isAdmin && policy?.allowedSourceIds !== null && policy?.allowedSourceIds !== undefined;
  const restrictedSources = hasStrictWhitelist
    ? sources.filter(
        (source) =>
          isResearchSource(source) &&
          source.state === 'active' &&
          source.deliveryMode === 'pull' &&
          !source.automaticCollectionBlocked &&
          policy.allowedProviders.includes(source.primaryProvider) &&
          policy.allowedSourceIds!.includes(source.id),
      )
    : undefined;

  const projectParams = new URLSearchParams({ projectId: project.id });
  const path = (view: string) => `/projects?view=${view}&${projectParams}`;
  const activeJobs = jobs.data?.jobs.filter((job) => activeJobStates.includes(job.status)) ?? [];
  const history = jobs.data?.jobs.filter((job) => !activeJobStates.includes(job.status));
  const hasData = (project.enabled_batch_count ?? 0) > 0;
  const sampleCount = project.data_summary?.item_count;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function backToTarget() {
    setError('');
    setRestriction(undefined);
    setConfirmed(false);
    collect.reset();
    collectPlan.reset();
    submittedJobIds.current.clear();
    setFlow({ step: 'target' });
    heading.current?.focus();
  }

  async function checkTargets(targets: IntakeTarget[]) {
    if (!canModify || !canStart || preview.isPending || !targets.length) return;
    setError('');
    setRestriction(undefined);
    const now = Date.now();
    try {
      const results = await Promise.all(
        targets.map((target) =>
          preview.mutateAsync({
            projectId: project.id,
            ...target,
            from: new Date(now - dayMs).toISOString(),
            to: new Date(now).toISOString(),
            limit: 1,
          }),
        ),
      );
      if (!mounted.current) return;
      const blocked = results.find(
        (result) => !result.executable || (!result.matchedSource && result.resolutionStatus !== 'on_demand_available'),
      );
      if (blocked) {
        setRestriction(blocked);
        return;
      }
      const resolved: ResolvedIntakeTarget[] = targets.map((input, index) => ({ input, result: results[index]! }));
      setSelectedSourceIds(resolved.flatMap((item) => (item.result.matchedSource ? [item.result.matchedSource.id] : [])));
      const allLimits = resolved.map((item) => getRangeLimits(item.result));
      const maxDays = Math.min(...allLimits.map((item) => item.maxDays));
      const maxItems = Math.min(...allLimits.map((item) => item.maxItems));
      const maxComments = Math.min(...allLimits.map((item) => item.maxComments));
      setRange((current) => ({
        ...current,
        days: Math.min(current.days, maxDays),
        limit: Math.min(current.limit, maxItems),
        comments: current.comments && maxComments > 0,
        commentLimit: Math.min(current.commentLimit, Math.max(1, maxComments)),
        fallback: false,
      }));
      setFlow({ step: 'scope', targets: resolved });
    } catch (err) {
      setError(readableError(err));
    }
  }

  async function estimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canModify || flow.step !== 'scope' || preview.isPending || !flow.targets.length) return;
    setError('');
    setRestriction(undefined);
    const now = Date.now();
    const allowFallback = flow.targets.length === 1;
    const requests = flow.targets.map((target) => buildScopePreviewRequest(project.id, target, range, allowFallback, now));
    try {
      const results = await Promise.all(requests.map((request) => preview.mutateAsync(request)));
      if (!mounted.current) return;
      const blocked = results.find(
        (result) => !result.executable || (!result.matchedSource && result.resolutionStatus !== 'on_demand_available'),
      );
      if (blocked) {
        setRestriction(blocked);
        return;
      }
      collect.reset();
      collectPlan.reset();
      submittedJobIds.current.clear();
      setConfirmed(false);
      const estimates: CollectionEstimate[] = requests.map((request, index) => ({
        request,
        result: results[index]!,
        key: generateUuidV4(),
        expiresAt: now + planLifetimeMs,
      }));
      setFlow({ step: 'review', targets: flow.targets, estimates });
    } catch (err) {
      setError(readableError(err));
    }
  }

  async function confirm() {
    if (!canModify || flow.step !== 'review' || !confirmed || submitting.current) return;
    const { estimates, targets } = flow;
    const firstEstimate = estimates[0];
    if (!firstEstimate) return;
    if (Date.now() >= firstEstimate.expiresAt && !collect.isError && !collectPlan.isError && submittedJobIds.current.size === 0) {
      setFlow({ step: 'scope', targets });
      setError(t('The estimate expired. Check the estimated usage again.', '估算已过期，请重新核对预计消耗。'));
      setConfirmed(false);
      return;
    }
    submitting.current = true;
    setError('');
    try {
      const jobIds: string[] = [];
      for (const prepared of estimates) {
        const existingJobId = submittedJobIds.current.get(prepared.key);
        if (existingJobId) {
          jobIds.push(existingJobId);
          continue;
        }
        const { from, to, limit, includeComments, maxCommentsPerPost, useFallback, projectId, queryHints } = prepared.request;
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
        submittedJobIds.current.set(prepared.key, result.jobId);
        jobIds.push(result.jobId);
      }
      if (mounted.current) {
        const suffix = jobIds.length === 1 ? '&jobId=' + encodeURIComponent(jobIds[0]!) : '';
        onNavigate(path('jobs') + suffix);
      }
    } catch (err) {
      setError(readableError(err, true));
    } finally {
      submitting.current = false;
    }
  }

  const registrationPath = buildAdminRegistrationPath(isAdmin, restriction, project.id, draft);

  return (
    <div className="research-intake">
      <header className="research-intake-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>{t('Collect new data for your project', '为项目自主采集新数据')}</h1>
          <p>
            <strong>{project.name}</strong>
            {batchProject && (
              <>
                {' · '}
                {hasData
                  ? t(
                      `${project.enabled_batch_count} enabled batches (${sampleCount ?? 0} samples)`,
                      `已启用 ${project.enabled_batch_count} 个批次（约 ${sampleCount ?? 0} 条样本）`,
                    )
                  : t('No batches attached yet', '尚未纳入数据批次')}
              </>
            )}
          </p>
        </div>
        {canModify && (
          <Button type="button" variant="outline" onClick={() => onNavigate(path('batches'))}>
            <Layers size={15} />
            <span>{t('Manage / Import Batches', '前往数据批次（复用与共享引入）')}</span>
          </Button>
        )}
      </header>

      <section ref={heading} tabIndex={-1} className="research-intake-panel" aria-label={t('Project data intake', '项目新数据采集')}>
        {!canModify ? (
          <>
            <h2>{writable ? t('Data comes from linked sources', '当前项目按关联来源汇集数据') : t('Read-only shared project', '当前为共享只读项目')}</h2>
            <p>
              {writable
                ? t(
                    'This project collects data from its linked sources. Create a batch research project to run custom on-demand collections.',
                    '此项目为来源型项目，按绑定来源自动汇集。如需发起自定义单次采集，请新建批次型研究项目。',
                  )
                : t(
                    'You can analyze and inspect this shared project, or fork/create your own private project to collect new data.',
                    '你可以完整分析与检索此共享项目；如需自主发起新采集，可前往「全部项目」新建私有研究项目。',
                  )}
            </p>
            <div className="intake-actions">
              <Button type="button" className="intake-primary" onClick={() => onNavigate(path('overview'))}>
                {t('View content research', '进入内容研究')}
              </Button>
              {actor.clientKind === 'browser' && (
                <Button type="button" variant="outline" onClick={() => onNavigate('/projects?new=1')}>
                  {t('Create a research project', '新建研究项目')}
                </Button>
              )}
            </div>
          </>
        ) : !canStart && quotas.isPending ? (
          <Skeleton role="status" aria-label={t('Checking account permissions', '正在检查账号采集权限')} className="intake-loading" />
        ) : !canStart && quotas.isError ? (
          <Alert role="alert">
            {readableError(quotas.error)}{' '}
            <Button type="button" variant="outline" onClick={() => void quotas.refetch()}>
              {t('Retry', '重试')}
            </Button>
          </Alert>
        ) : !canStart && policy ? (
          <>
            <Alert role="status">
              {t(
                'Manual on-demand collection is disabled under your current Ops plan policy. You can still attach shared or previously authorized data batches in "Data Batches".',
                '当前账号的运维配额策略未开放自主发起新采集权限。你仍可前往「数据批次」将团队全员共享数据或已有批次引入本项目分析。',
              )}
            </Alert>
            <div className="intake-actions">
              <Button type="button" className="intake-primary" onClick={() => onNavigate(path('batches'))}>
                <Layers size={16} />
                {t('Open Data Batches', '前往数据批次引入数据')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <ol className="intake-steps" aria-label={t('Collection steps', '采集步骤')}>
              {[
                ['target', t('1. Define target', '定义目标')],
                ['scope', t('2. Set scope & filters', '设置范围与过滤')],
                ['review', t('3. Confirm usage', '核对并启动')],
              ].map(([step, title], index) => (
                <li key={step} aria-current={flow.step === step ? 'step' : undefined}>
                  <span>{index + 1}</span>
                  {title}
                </li>
              ))}
            </ol>

            {error && (
              <Alert variant="destructive" role="alert">
                {error}
              </Alert>
            )}

            {flow.step === 'target' && !restriction && (
              <>
                <IntakeTargetStep
                  allowedProviders={isAdmin ? undefined : policy?.allowedProviders}
                  restrictedSources={restrictedSources}
                  draft={draft}
                  setDraft={(value) => {
                    setDraft(value);
                    setRestriction(undefined);
                    setError('');
                  }}
                  selectedSourceIds={selectedSourceIds}
                  pending={preview.isPending}
                  onSelect={(targets) => void checkTargets(targets)}
                />
                {jobs.isSuccess && ((history?.length ?? 0) > 0 || activeJobs.length > 0) && (
                  <div className="intake-recent">
                    <History size={17} aria-hidden="true" />
                    <span>
                      {activeJobs.length > 0
                        ? t(`${activeJobs.length} active collection(s) running`, `${activeJobs.length} 个采集任务正在进行`)
                        : t(`${history?.length} recent collection job(s) in this project`, `本项目已有 ${history?.length} 条历史采集任务`)}
                    </span>
                    <button type="button" className="intake-link" onClick={() => onNavigate(path('jobs'))}>
                      {t('View collection jobs', '前往采集任务查看进度')}
                    </button>
                  </div>
                )}
              </>
            )}

            {flow.step === 'scope' && !restriction && (
              <IntakeScopeStep
                targets={flow.targets}
                sources={sources}
                range={range}
                setRange={setRange}
                pending={preview.isPending}
                onContinue={estimate}
                onBack={backToTarget}
              />
            )}

            {restriction && (
              <IntakeRestriction
                result={restriction}
                registrationPath={registrationPath}
                isAdmin={isAdmin}
                onBack={() => {
                  setRestriction(undefined);
                  setError('');
                }}
              />
            )}

            {flow.step === 'review' && !restriction && (
              <IntakeReviewStep
                estimates={flow.estimates}
                isAdmin={isAdmin}
                confirmed={confirmed}
                setConfirmed={setConfirmed}
                pending={collect.isPending || collectPlan.isPending}
                onConfirm={() => void confirm()}
                onBack={() => {
                  if (collect.isPending || collectPlan.isPending) return;
                  setError('');
                  setConfirmed(false);
                  setFlow({ step: 'scope', targets: flow.targets });
                }}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
