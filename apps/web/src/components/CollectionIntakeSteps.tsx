import { useState, type FormEvent } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert } from './ui/alert';
import { Checkbox } from './ui/checkbox';
import { formatSourceTarget, type CollectionBatchDto, type CollectionSource, type QueryHintsValue, type ResearchCollectionRestriction, type ResearchPlanPreviewRequest, type ResearchPlanPreviewResponse } from '../contracts/api';
import { getRangeLimits, parseManualTargets, type ManualTarget } from '../lib/researchIntake';
import { useI18n } from '../i18n/translations';

export type { ManualTarget };
export type IntakeTarget = { sourceId: string } | ManualTarget;
export type ResolvedIntakeTarget = { input: IntakeTarget; result: ResearchPlanPreviewResponse };
export type CollectionRange = {
  days: number;
  limit: number;
  comments: boolean;
  commentLimit: number;
  fallback: boolean;
  queryHints: QueryHintsValue;
};
export type CollectionEstimate = { request: ResearchPlanPreviewRequest; result: ResearchPlanPreviewResponse; key: string; expiresAt: number };

const kinds = { reddit: ['community', 'account', 'search'], x: ['account', 'search'], bluesky: ['account'] } as const;
const platformNames = { reddit: 'Reddit', x: 'X', bluesky: 'Bluesky', web: 'Web' } as const;

function formatResolvedTargetLabel(result: ResearchPlanPreviewResponse): string {
  return result.matchedSource?.label
    ?? (result.resolvedTarget ? `${platformNames[result.resolvedTarget.platform as ManualTarget['platform']] ?? result.resolvedTarget.platform}: ${result.resolvedTarget.value}` : '');
}

export function IntakeTargetStep({ sources, draft, setDraft, selected, pending, onSelect }: {
  sources: CollectionSource[];
  draft: ManualTarget;
  setDraft: (value: ManualTarget) => void;
  selected: string[];
  pending: boolean;
  onSelect: (targets: IntakeTarget[]) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState(Boolean(draft.targetValue));
  const [sourceIds, setSourceIds] = useState<string[]>(selected);
  const needle = search.trim().toLocaleLowerCase();
  const visible = sources.filter(source =>
    [source.label, formatSourceTarget(source.target), platformNames[source.platform]].some(value => value.toLocaleLowerCase().includes(needle)));
  const parsedManual = parseManualTargets(draft);
  const validSelectedIds = sourceIds.filter(id => sources.some(source => source.id === id));
  const selectedCount = manual ? parsedManual.targets.length : validSelectedIds.length;
  const toggleSource = (id: string) =>
    setSourceIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  return <>
    <h2>{t('Choose what to research', '选择研究对象')}</h2>
    <p>{t('Select one or more targets to collect into this project, or enter communities, accounts or topics.', '可单选或多选研究对象一并采集到当前项目，也可手动输入多个社区、账号或关键词。')}</p>
    <form className="intake-step-form" onSubmit={event => {
      event.preventDefault();
      if (pending) return;
      if (manual && parsedManual.valid) onSelect(parsedManual.targets);
      if (!manual && validSelectedIds.length > 0) onSelect(validSelectedIds.map(sourceId => ({ sourceId })));
    }}>
      <fieldset className="intake-fields" disabled={pending}>
        {manual ? <>
          <div className="wb-grid-2">
            <label className="wb-field">{t('Platform', '目标平台')}<select className="wb-select" value={draft.platform} onChange={event => {
              const platform = event.target.value as ManualTarget['platform'];
              setDraft({ platform, targetType: kinds[platform][0], targetValue: '' });
            }}>{Object.keys(kinds).map(platform => <option key={platform} value={platform}>{platformNames[platform as ManualTarget['platform']]}</option>)}</select></label>
            <label className="wb-field">{t('What to look for', '目标类型')}<select className="wb-select" value={draft.targetType}
              onChange={event => setDraft({ ...draft, targetType: event.target.value as ManualTarget['targetType'], targetValue: '' })}>
              {kinds[draft.platform].map(kind => <option key={kind} value={kind}>{kind === 'account' ? t('Account', '账号') : kind === 'community' ? t('Community', '社区') : t('Keywords', '关键词')}</option>)}
            </select></label>
          </div>
          <label className="wb-field">{t('Community, account or keywords', '目标内容')}
            <Input value={draft.targetValue} required maxLength={512} onChange={event => setDraft({ ...draft, targetValue: event.target.value })}
              placeholder={draft.targetType === 'community' ? 'r/LocalLLaMA, r/ClaudeAI' : draft.targetType === 'account' ? '@openai, @anthropicai' : 'OpenAI OR ChatGPT'} />
          </label>
          {draft.targetType !== 'search' && (
            <p className="collection-hint">{t('Separate multiple communities or accounts with commas (up to 20 at once).', '支持用逗号分隔输入多个板块或账号（单次最多 20 个），将一并采集到本项目。')}</p>
          )}
        </> : <>
          <label className="wb-field">{t('Find an available target', '搜索可用对象')}<Input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="intake-target-list">
            {visible.length === 0 && <p role="status">{sources.length ? t('No targets match this search.', '没有符合搜索的对象。') : t('No collection targets available for this account.', '当前账号暂无可用的采集对象。')}</p>}
            {visible.map(source => <label key={source.id} className="intake-target-row">
              <input type="checkbox" name="intake-source" value={source.id} checked={sourceIds.includes(source.id)} onChange={() => toggleSource(source.id)} />
              <span><strong>{source.label}</strong><small>{platformNames[source.platform]} · {formatSourceTarget(source.target)}</small></span>
              {source.health.lastStatus === 'failed' && <small>{t('Recent run failed', '最近运行失败')}</small>}
            </label>)}
          </div>
        </>}
      </fieldset>
      <div className="intake-actions">
        <Button type="submit" disabled={pending || selectedCount === 0}
          className="intake-primary">{pending ? t('Checking availability…', '正在检查可用性…')
            : manual
              ? (selectedCount > 1 ? t(`Check availability (${selectedCount})`, `检查这 ${selectedCount} 个目标`) : t('Check availability', '检查这个目标'))
              : (selectedCount > 1 ? t(`Continue to scope (${selectedCount})`, `继续设置范围（已选 ${selectedCount} 个）`) : t('Continue to scope', '继续设置范围'))}<ArrowRight size={16} /></Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setManual(!manual)}>
          {manual ? t('Choose an available target', '返回可用对象') : t('Enter another target', '输入其他研究对象')}
        </Button>
      </div>
    </form>
  </>;
}

function ChannelFilterHintsDetails({
  sf,
  range,
  setHint,
}: {
  sf: ResearchPlanPreviewResponse['fieldPolicy']['supportedFilters'];
  range: CollectionRange;
  setHint: <K extends keyof QueryHintsValue>(k: K, val: QueryHintsValue[K]) => void;
}) {
  const { t } = useI18n();
  if (!sf || !(sf.sortOptions.length > 0 || sf.supportsMinLikes || sf.supportsTimeRange || sf.supportsLanguage)) {
    return null;
  }
  return (
    <details open={Object.keys(range.queryHints).length > 0}>
      <summary>{t('Channel filter options', '平台筛选与排序提示')} ({sf.engagementFilterMode === 'native' ? t('Native upstream query', '上游原生支持') : t('Best-effort / post-filter', '回传后过滤 / 尽力支持')})</summary>
      <div className="wb-grid-2" style={{ marginTop: 8 }}>
        {sf.sortOptions.length > 0 && (
          <label className="wb-field">{t('Sort mode', '排序方式')}
            <select className="wb-select" value={range.queryHints.sort ?? ''} onChange={e => setHint('sort', (e.target.value || undefined) as QueryHintsValue['sort'])}>
              <option value="">{t('Provider default', '渠道默认')}</option>
              {sf.sortOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
        )}
        {sf.supportsTimeRange && (
          <label className="wb-field">{t('Upstream period hint', '上游时段窗口')}
            <select className="wb-select" value={range.queryHints.timeRange ?? ''} onChange={e => setHint('timeRange', (e.target.value || undefined) as QueryHintsValue['timeRange'])}>
              <option value="">{t('Match date window', '按采集起止日')}</option>
              {(['day', 'week', 'month', 'year'] as const).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
        )}
        {sf.supportsMinLikes && (
          <label className="wb-field">{t('Min likes / score', '最低点赞 / 分数')}
            <Input type="number" min={0} max={1000000} value={range.queryHints.minLikes ?? ''} onChange={e => setHint('minLikes', e.target.value === '' ? undefined : Number(e.target.value))} />
          </label>
        )}
        {sf.supportsMinComments && (
          <label className="wb-field">{t('Min replies / comments', '最低回复 / 评论数')}
            <Input type="number" min={0} max={1000000} value={range.queryHints.minComments ?? ''} onChange={e => setHint('minComments', e.target.value === '' ? undefined : Number(e.target.value))} />
          </label>
        )}
        {sf.supportsLanguage && (
          <label className="wb-field">{t('Language code (e.g. en)', '语言代码（如 en / ja）')}
            <Input maxLength={16} value={range.queryHints.language ?? ''} onChange={e => setHint('language', e.target.value.trim() || undefined)} />
          </label>
        )}
      </div>
      {sf.supportsExcludeReposts && (
        <label className="intake-check" style={{ marginTop: 6 }}>
          <Checkbox checked={Boolean(range.queryHints.excludeReposts)} onCheckedChange={v => setHint('excludeReposts', v ? true : undefined)} />
          {t('Exclude reposts / retweets', '排除转发 / 转推内容')}
        </label>
      )}
    </details>
  );
}

export function IntakeScopeStep({ targets, sources, range, setRange, pending, onContinue, onBack }: {
  targets: ResolvedIntakeTarget[];
  sources: CollectionSource[];
  range: CollectionRange;
  setRange: (range: CollectionRange) => void;
  isAdmin?: boolean;
  pending: boolean;
  onContinue: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const primary = targets[0]!.result;
  const primarySource = targets.length === 1 && primary.matchedSource
    ? sources.find(source => source.id === primary.matchedSource!.id)
    : undefined;
  const perTargetLimits = targets.map(item => {
    const matched = item.result.matchedSource ? sources.find(s => s.id === item.result.matchedSource!.id) : undefined;
    return getRangeLimits(item.result, range.fallback ? matched?.fallbackProvider ?? undefined : undefined);
  });
  const limits = {
    maxDays: Math.min(...perTargetLimits.map(l => l.maxDays)),
    maxItems: Math.min(...perTargetLimits.map(l => l.maxItems)),
    maxComments: Math.min(...perTargetLimits.map(l => l.maxComments)),
  };
  const maximum = limits.maxItems;
  const choices = [...new Set([7, 30, 90, limits.maxDays].filter(n => n > 0 && n <= limits.maxDays))];
  const labels = targets.map(item => formatResolvedTargetLabel(item.result));
  const targetDisplay = labels.length === 1
    ? labels[0]
    : t(`${labels.length} targets (${labels.join(', ')})`, `${labels.length} 个对象（${labels.join('、')}）`);
  const sf = primary.fieldPolicy.supportedFilters;
  const setHint = <K extends keyof QueryHintsValue>(k: K, val: QueryHintsValue[K]) => {
    const next = { ...range.queryHints, [k]: val };
    if (val === undefined || val === '' || val === false) delete next[k];
    setRange({ ...range, queryHints: next });
  };
  return <>
    <h2>{t('Set the collection scope', '设置采集范围')}</h2>
    <p>{t('Collect from', '本次采集对象')}{' '}<strong>{targetDisplay}</strong>
      {targets.some(item => item.result.resolutionStatus === 'on_demand_available') && <small className="collection-hint"> · {t('On-demand research target', '按需实时研究对象')}</small>}</p>
    <form onSubmit={onContinue} className="intake-step-form">
      <fieldset className="intake-fields" disabled={pending}>
        <label className="wb-field">{t('Time range', '时间范围')}<select value={range.days} className="wb-select"
          onChange={event => setRange({ ...range, days: Number(event.target.value) })}>
          {choices.map(days => <option key={days} value={days}>{t(`Last ${days} days`, `最近 ${days} 天`)}</option>)}
        </select></label>
        <label className="wb-field">{targets.length > 1 ? t('Maximum items per target', '每个对象本次条数上限') : t('Maximum items', '本次条数上限')}<Input type="number" required min={1} max={maximum}
          value={range.limit} onChange={event => setRange({ ...range, limit: Number(event.target.value) })} /></label>
        <p className="collection-hint">{targets.length > 1
          ? t(`Up to ${maximum} items per target (${targets.length} targets will be queued into this project).`, `每个对象最多请求 ${maximum} 条（共 ${targets.length} 个对象，将一并入队到本项目）。`)
          : t(`You can request up to ${maximum} items for this target.`, `按当前对象和设置，本次最多请求 ${maximum} 条内容。`)}</p>
        {limits.maxComments > 0 && <>
          <label className="intake-check"><Checkbox checked={range.comments} onCheckedChange={comments =>
            setRange({ ...range, comments })} />
            {t('Include comments', '同时采集评论')}</label>
          {range.comments && <label className="wb-field">{t('Comments per post', '每帖评论上限')}
            <Input type="number" required min={1} max={limits.maxComments} value={range.commentLimit}
              onChange={event => setRange({ ...range, commentLimit: Number(event.target.value) })} /></label>}
        </>}
        <ChannelFilterHintsDetails sf={sf} range={range} setHint={setHint} />
        {targets.length === 1 && primary.fieldPolicy.canUseFallback && primarySource?.fallbackProvider && <details>
          <summary>{t('Advanced collection settings', '高级采集设置')}</summary>
          <label className="intake-check"><Checkbox checked={range.fallback} onCheckedChange={fallback => {
            const next = getRangeLimits(primary, fallback ? primarySource.fallbackProvider ?? undefined : undefined);
            setRange({ ...range, fallback, comments: false, limit: Math.min(range.limit, next.maxItems) });
          }} />{t('Use the backup service', '使用备用采集服务')} ({primarySource.fallbackProvider})</label>
        </details>}
      </fieldset>
      <div className="intake-actions">
        <Button type="submit" disabled={pending || range.limit < 1} className="intake-primary">
          {pending ? t('Calculating…', '正在估算…') : t('See estimated usage', '查看预计消耗')}<ArrowRight size={16} />
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onBack}>{t('Change target', '更换研究对象')}</Button>
      </div>
    </form>
  </>;
}

export function IntakeReviewStep({ estimates, confirmed, setConfirmed, pending, isAdmin, onConfirm, onBack, onReuse }: {
  estimates: CollectionEstimate[];
  isAdmin: boolean;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
  onReuse?: () => void;
}) {
  const { t } = useI18n();
  const first = estimates[0]!;
  const { request } = first;
  const totalRequests = estimates.reduce((sum, item) => sum + item.result.estimate.requests, 0);
  const totalUnits = estimates.reduce((sum, item) => sum + (isAdmin ? item.result.estimate.systemResources : item.result.estimate.personalResources), 0);
  const targetLabels = estimates.map(item => formatResolvedTargetLabel(item.result));
  const targetLabel = targetLabels.length === 1
    ? targetLabels[0]
    : t(`${targetLabels.length} targets: ${targetLabels.join(', ')}`, `共 ${targetLabels.length} 个对象：${targetLabels.join('、')}`);
  const totalExisting = estimates.reduce((sum, item) => sum + item.result.coverage.existingItemCount, 0);
  const anyUnknownCoverage = estimates.some(item => item.result.coverage.status === 'unknown');
  return <>
    <h2>{t('Confirm what to collect and the estimated usage', '确认采集内容与预计消耗')}</h2>
    <dl className="intake-facts">
      <div><dt>{t('Research target', '研究对象')}</dt><dd>{targetLabel}</dd></div>
      <div><dt>{t('Collection scope', '采集范围')}</dt><dd>{request.from.slice(0, 10)} – {request.to.slice(0, 10)} UTC · {estimates.length > 1 ? t(`up to ${request.limit} items each`, `每个最多 ${request.limit} 条`) : t(`up to ${request.limit} items`, `最多 ${request.limit} 条`)} · {request.includeComments ? t('with comments', '包含评论') : t('without comments', '不含评论')}</dd></div>
      <div><dt>{t('Estimated usage', '预计消耗')}</dt><dd>{t(`${totalRequests} external request(s) · ${totalUnits} collection units`, `${totalRequests} 次外部请求 · ${totalUnits} 采集额度`)}</dd></div>
    </dl>
    {anyUnknownCoverage && <p>{t(`${totalExisting} samples are already stored. Complete coverage across these dates is unknown.`, `这个时间范围已有 ${totalExisting} 条样本，暂时无法确认完整覆盖。`)} {onReuse && <button type="button" className="intake-link" disabled={pending} onClick={onReuse}>{t('Use existing data', '使用已有数据')}</button>}</p>}
    <p>{t('Actual usage can differ. Follow progress in Tasks. Saved results will appear in this project.', '实际额度可能不同。确认后可在采集任务查看进度，已入库数据会加入本项目。')}</p>
    <label className="intake-check"><Checkbox checked={confirmed} onCheckedChange={setConfirmed} disabled={pending} />
      {t('I understand the estimated usage.', '我已核对预计用量并确认本次采集。')}</label>
    <div className="intake-actions">
      <Button type="button" className="intake-primary" disabled={!confirmed || pending} onClick={onConfirm}>{pending ? t('Starting collection…', '正在提交…') : t('Confirm and start collecting', '确认开始采集')}<ArrowRight size={16} /></Button>
      <Button type="button" variant="ghost" disabled={pending} onClick={onBack}>{t('Change the scope', '修改采集范围')}</Button>
    </div>
  </>;
}

const restrictionText: Record<ResearchCollectionRestriction, [string, string]> = {
  target_unavailable: ['This target is not available for collection yet.', '暂时无法采集这个目标。'],
  manual_disabled: ['Your plan does not support on-demand collection.', '当前套餐不支持手动采集。'],
  provider_choice: ['The backup collection service is unavailable for this target.', '该目标目前不能使用备用采集服务。'],
  scope_limit: ['Reduce the date range or number of requested items.', '请缩小时间范围或减少采集条数。'],
  provider_unavailable: ['The collection service is not ready. Choose another target or contact an administrator.', '采集服务尚未就绪。请换个对象，或联系管理员。'],
  network_disabled: ['External network collection is currently disabled on this server (SOURCE_NETWORK_ENABLED is off).', '当前服务端未开启外部网络采集开关（SOURCE_NETWORK_ENABLED=false）。'],
  credential_missing: ['The provider API key is not configured yet. Ask an administrator to add it.', '对应采集渠道的 API 密钥尚未配置，请联系管理员在后台添加后重试。'],
  credential_invalid: ['The provider API key was rejected upstream and needs rotation by an administrator.', '采集渠道 API 密钥被上游拒绝或失效，请联系管理员测试并轮换密钥。'],
  charge_unresolved: ['A previous request may have used quota. Ask an administrator to review it.', '上次采集可能已消耗额度，请联系管理员核对。'],
  source_inactive: ['Collection is paused for this target.', '该对象已暂停采集。'],
  source_access: ['Collection is unavailable for this target under your current permissions.', '当前账号无法采集该对象。'],
  budget_unavailable: ['This collection service has no available budget.', '该采集服务暂无可用预算。'],
  quota_exhausted: ['There is not enough quota for this collection. Try a smaller request or return after it resets.', '当前可用额度不足。可减少采集量，或等额度恢复后再试。'],
  unsupported_scope: ['The collection service does not support this scope.', '当前采集服务不支持此范围。'],
};

export function IntakeRestriction({ result, registrationPath, isAdmin, onBack }: {
  result: ResearchPlanPreviewResponse;
  registrationPath?: string;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const codes = result.restrictions ?? (result.resolutionStatus === 'needs_admin_source' ? ['target_unavailable'] : []);
  const channel = result.matchedSource?.provider;
  const providerCredBlocked =
    isAdmin && (codes.includes('provider_unavailable') || codes.includes('credential_missing') || codes.includes('credential_invalid'));
  const budgetBlocked = isAdmin && codes.includes('budget_unavailable');
  return <Alert role="status" className="intake-restriction">
    <h3>{t('Collection cannot start yet', '暂时无法开始采集')}</h3>
    {codes.length ? <ul>{codes.map(code => <li key={code}>{restrictionText[code] ? t(...restrictionText[code]) : t('Collection is currently restricted.', '当前采集受限。')}</li>)}</ul>
      : <p>{t('Try another target or contact an administrator.', '请更换研究对象，或联系管理员检查采集设置。')}</p>}
    {providerCredBlocked && channel && <p>{t(`Check the saved credential and network status for ${channel}.`, `请检查 ${channel} 的渠道凭证和联网状态。`)}</p>}
    <div className="intake-actions">
      {isAdmin && registrationPath && <a href={registrationPath}>{t('Add this research source', '添加此研究来源')}</a>}
      {providerCredBlocked && <a href="/sources?tab=providers">{t('Check provider credentials', '检查渠道凭证')}</a>}
      {budgetBlocked && <a href="/sources?tab=budgets">{t('Check provider budgets', '检查渠道预算')}</a>}
      <Button type="button" variant="outline" onClick={onBack}>{t('Try another target', '更换研究对象')}</Button>
    </div>
  </Alert>;
}

export function ExistingIntakeData({ batches, pending, onAttach }: {
  batches: CollectionBatchDto[];
  pending: boolean;
  onAttach: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  return <>
    <h2>{t('Use existing research data', '使用已有研究数据')}</h2>
    <p>{t('Add previously collected data to this project without spending collection quota.', '将此前收集的数据加入项目，无需再消耗采集额度。')}</p>
    <div className="intake-target-list">{batches.map(batch => <div key={batch.id} className="intake-target-row">
      <span><strong>{batch.sourceLabel}</strong><small>{new Date(batch.createdAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en')} · {t(`${batch.itemCount} items`, `${batch.itemCount} 条内容`)}</small></span>
      <Button type="button" variant="outline" disabled={pending} onClick={() => onAttach(batch.id)}><Check size={15} />{t('Add to project', '添加到项目')}</Button>
    </div>)}</div>
  </>;
}
