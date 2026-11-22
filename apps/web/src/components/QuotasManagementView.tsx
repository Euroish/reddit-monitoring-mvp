import { useState } from 'react';
import { Check, Shield, Sliders, Users } from 'lucide-react';
import {
  formatApiError,
  useQuotasSummaryQuery,
  useUpdatePlanPolicyMutation,
  useUpdateUserQuotaOverrideMutation,
} from '../api/hooks';
import type { Actor, CollectionSource, PlanPolicyDto, ProviderBudget, QuotaOverrideDto, SourceCapability } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { ProviderBudgetTable } from './ProviderBudgetTable';

export function QuotasManagementView({
  actor,
  budgets,
  budgetError,
  budgetsPending,
  providers,
  sources,
  onEditBudget,
}: {
  actor: Actor;
  budgets: ProviderBudget[];
  budgetError: Error | null;
  budgetsPending: boolean;
  sources: CollectionSource[];
  providers: SourceCapability[];
  onEditBudget: (b: ProviderBudget) => void;
}) {
  const { lang, t } = useI18n();
  const number = new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en');
  const isAdmin = actor.clientKind === 'browser' && actor.role !== 'viewer';
  const isOwner = isAdmin && actor.role === 'owner';
  const quotasQuery = useQuotasSummaryQuery(true);
  const updatePlanMut = useUpdatePlanPolicyMutation();
  const updateOverrideMut = useUpdateUserQuotaOverrideMutation();

  const [editingPlan, setEditingPlan] = useState<PlanPolicyDto | null>(null);
  const [pEnabled, setPEnabled] = useState(false);
  const [pProviders, setPProviders] = useState<string[]>([]);
  const [pSources, setPSources] = useState<string[] | null>(null);
  const [pMaxComments, setPMaxComments] = useState(0);
  const [pDailyReq, setPDailyReq] = useState<string>('0');
  const [pDailyRes, setPDailyRes] = useState<string>('0');
  const [pMaxBatch, setPMaxBatch] = useState<number>(20);
  const [pMaxProjects, setPMaxProjects] = useState<number>(3);
  const [pExportEnabled, setPExportEnabled] = useState<boolean>(true);
  const [pErr, setPErr] = useState<string | null>(null);

  const [editUser, setEditUser] = useState<{ id: string; email: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [uEnabled, setUEnabled] = useState<'inherit' | 'true' | 'false'>('inherit');
  const [uDailyReq, setUDailyReq] = useState<string>('');
  const [uDailyRes, setUDailyRes] = useState<string>('');
  const [uErr, setUErr] = useState<string | null>(null);
  const [uProviders, setUProviders] = useState<string[] | undefined>();
  const [uSources, setUSources] = useState<string[] | null | undefined>();
  const [uBatch, setUBatch] = useState('');

  const summary = quotasQuery.data;

  const openPlanEditor = (p: PlanPolicyDto) => {
    setEditingPlan(p);
    setPEnabled(p.manualCollectEnabled);
    setPProviders(p.allowedProviders);
    setPSources(p.allowedSourceIds);
    setPMaxComments(p.maxCommentsPerPost);
    setPDailyReq(p.dailyRequests === null ? '' : String(p.dailyRequests));
    setPDailyRes(p.dailyResources === null ? '' : String(p.dailyResources));
    setPMaxBatch(p.maxBatchLimit);
    setPMaxProjects(p.maxProjects ?? 3);
    setPExportEnabled(p.exportEnabled ?? true);
    setPErr(null);
  };

  const savePlanPolicy = async () => {
    if (!editingPlan) return;
    setPErr(null);
    try {
      await updatePlanMut.mutateAsync({
        tier: editingPlan.planTier,
        payload: {
          manualCollectEnabled: pEnabled,
          allowedProviders: pProviders,
          allowedSourceIds: pSources,
          dailyRequests: pDailyReq.trim() === '' ? null : Number(pDailyReq),
          dailyResources: pDailyRes.trim() === '' ? null : Number(pDailyRes),
          maxBatchLimit: pMaxBatch,
          maxCommentsPerPost: pMaxComments,
          maxProjects: pMaxProjects,
          exportEnabled: pExportEnabled,
          revision: editingPlan.revision,
        },
      });
      setEditingPlan(null);
      setNotice(t('Plan policy saved.', '套餐策略已保存。'));
    } catch (err) {
      setPErr(formatApiError(err));
    }
  };

  const openUserEditor = (u: { id: string; email: string; quotaOverride: QuotaOverrideDto | null }) => {
    setEditUser({ id: u.id, email: u.email });
    const o = u.quotaOverride;
    setUEnabled(o?.manualCollectEnabled === true ? 'true' : o?.manualCollectEnabled === false ? 'false' : 'inherit');
    setUDailyReq(o?.dailyRequests === null ? 'unlimited' : String(o?.dailyRequests ?? ''));
    setUDailyRes(o?.dailyResources === null ? 'unlimited' : String(o?.dailyResources ?? ''));
    setUProviders(o?.allowedProviders ?? undefined);
    setUSources(o?.allowedSourceIds);
    setUBatch(String(o?.maxBatchLimit ?? ''));
    setUErr(null);
  };

  const saveUserOverride = async (clear = false) => {
    if (!editUser) return;
    setUErr(null);
    try {
      if (clear) {
        await updateOverrideMut.mutateAsync({ userId: editUser.id, payload: null });
      } else {
        const dailyValue = (value: string) => value === 'unlimited' ? null : value === '' ? undefined : Number(value);
        const next: QuotaOverrideDto = {
          ...(uEnabled === 'inherit' ? {} : { manualCollectEnabled: uEnabled === 'true' }),
          ...(uDailyReq !== '' ? { dailyRequests: dailyValue(uDailyReq) } : {}),
          ...(uDailyRes !== '' ? { dailyResources: dailyValue(uDailyRes) } : {}),
          ...(uProviders !== undefined ? { allowedProviders: uProviders } : {}),
          ...(uSources !== undefined ? { allowedSourceIds: uSources } : {}),
          ...(uBatch !== '' ? { maxBatchLimit: Number(uBatch) } : {}),
        };
        await updateOverrideMut.mutateAsync({
          userId: editUser.id,
          payload: Object.keys(next).length > 0 ? next : null,
        });
      }
      setEditUser(null);
      setNotice(clear ? t('Plan inheritance restored.', '已恢复继承套餐。') : t('Personal override saved.', '个人覆盖已保存。'));
    } catch (err) {
      setUErr(formatApiError(err));
    }
  };

  const sourceOptions = sources.filter(source => source.deliveryMode === 'pull')
    .map(source => ({ id: source.id, label: source.label }));
  const providerOptions = providers.map(provider => ({ id: provider.provider, label: provider.provider }));
  const scopeCount = (ids: string[] | null) => ids === null ? t('All sources', '全部来源')
    : ids.length ? number.format(ids.length) + ' ' + t('selected', '个指定来源') : t('No sources', '无可用来源');
  const limitText = (cap: number | null, en: string, zh: string) =>
    cap === null ? t('Unlimited', '不限') : number.format(cap) + ' ' + t(en, zh);
  function overrideText(override: QuotaOverrideDto | null) {
    if (!override) return [];
    const labels: string[] = [];
    if (typeof override.manualCollectEnabled === 'boolean') labels.push(override.manualCollectEnabled ? t('Allow manual collection', '允许手动采集') : t('Block manual collection', '禁止手动采集'));
    if (override.dailyRequests !== undefined) labels.push(t('Daily requests', '日请求') + ' · ' + limitText(override.dailyRequests, 'requests', '次'));
    if (override.dailyResources !== undefined) labels.push(t('Daily resources', '日资源') + ' · ' + limitText(override.dailyResources, 'units', '单位'));
    if (override.maxBatchLimit != null) labels.push(t('Batch limit', '单批上限') + ' · ' + limitText(override.maxBatchLimit, 'items', '条'));
    if (override.allowedProviders) labels.push(override.allowedProviders.join(', ') || t('No providers', '无可用渠道'));
    if (override.allowedSourceIds !== undefined) labels.push(scopeCount(override.allowedSourceIds));
    return labels;
  }
  const queryError = quotasQuery.error;
  if (queryError || !summary) {
    return <div role={queryError ? 'alert' : 'status'} className="wb-alert">{queryError ? formatApiError(queryError) : t('Loading collection policy…', '正在加载采集策略…')}</div>;
  }

  if (!isAdmin) {
    const ep = summary.effectivePolicy;
    const my = summary.myUsage;
    return (
      <section className="ds-card collection-panel">
        <header className="ds-card-hd collection-panel-header">
          <div>
            <h2 className="ds-card-title"><Sliders size={16} />{t('Effective policy', '当前生效策略')} · {ep.planTier.toUpperCase()}</h2>
            <p className="ds-card-sub">{t('Next reset (UTC)', '下次重置（UTC）')} · <time dateTime={summary.resetsAtUtc}>{summary.resetsAtUtc.slice(0, 16).replace('T', ' ')}</time>
              {' · '}{ep.hasOverride ? t('Personal override applied', '已应用个人覆盖') : t('Inherited plan policy', '继承套餐策略')}</p>
          </div>
          <span className={'collection-status ' + (ep.manualCollectEnabled ? 'collection-status--ok' : '')}>{ep.manualCollectEnabled ? t('Manual collection enabled', '可手动采集') : t('Manual collection disabled', '手动采集已关闭')}</span>
        </header>
        <dl className="collection-quota-guide">
          <div><dt>{t('Reserved requests', '已预留请求')}</dt><dd><strong>{number.format(my.requestsReserved)}</strong> / {limitText(ep.dailyRequests, 'requests', '次')}</dd></div>
          <div><dt>{t('Executed requests', '已执行请求')}</dt><dd><strong>{number.format(my.requestsExecuted)}</strong> {t('requests', '次')}</dd></div>
          <div><dt>{t('Reserved resources', '已预留资源')}</dt><dd><strong>{number.format(my.resourcesReserved)}</strong> / {limitText(ep.dailyResources, 'units', '单位')}</dd></div>
        </dl>
        <div className="ds-card-bd collection-form">
          <p className="collection-hint">{t('Personal usage uses the amount requested at submission. System provider budgets also apply at execution.', '个人额度按提交时的请求预留。任务执行时还要满足渠道预算。')}</p>
          <div className="collection-toolbar">
            <span>{t('Sources', '来源范围')} · {scopeCount(ep.allowedSourceIds)}</span>
            <span>{t('Batch limit', '单批上限')} · {limitText(ep.maxBatchLimit, 'items', '条')}</span>
            <span>{t('Comments per post', '每帖评论')} · {limitText(ep.maxCommentsPerPost, 'comments', '条')}</span>
          </div>
          {(summary.providerAvailability ?? []).map(provider => {
            const usage = my.byProvider.find(row => row.provider === provider.provider);
            const state = !provider.planAllowed ? t('Outside policy', '策略未开放') : !provider.enabled ? t('Provider unavailable', '渠道未就绪')
              : !provider.budgetEnabled ? t('Budget unavailable', '预算不可用') : t('Ready', '就绪');
            return <div className="collection-account-provider" key={provider.provider}>
              <strong>{provider.provider}</strong><span className="collection-status">{state}</span>
              {usage && <small>{t('Reserved / executed', '预留 / 执行')} {number.format(usage.requests_reserved)} / {number.format(usage.requests_executed)} {t('requests', '次')} · {t('Resources', '资源')} {number.format(usage.resources_reserved)} {t('units', '单位')}</small>}
            </div>;
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="collection-stack">
      {/* 1. System Provider Budgets */}
      {budgetError ? <div role="alert" className="wb-alert wb-alert--error">{formatApiError(budgetError)}</div> : <ProviderBudgetTable budgets={budgets} providers={providers} pending={budgetsPending} onEdit={onEditBudget} />}
      {notice && <p className="wb-alert wb-alert--success" role="status">{notice}</p>}
      <p className="collection-hint">{t('Owner and Admin collection uses provider budgets. Free/Pro policies and personal limits govern Viewer collection.', 'Owner 和 Admin 的采集受渠道预算约束。Free/Pro 策略与个人额度适用于 Viewer 采集。')}</p>

      {/* 2. Free / Pro Plan Policies */}
      <div className="ds-card collection-panel">
        <div className="ds-card-hd collection-panel-header">
          <div>
            <div className="ds-card-title"><Shield size={14} /><span>{t('Account Group Collection Policies (Free / Pro)', '账户组采集权限与默认额度 (Free / Pro)')}</span></div>
            <div className="ds-card-sub">
              {isOwner
                ? t('Owner can configure manual collection switch, allowed providers, and daily caps per plan tier.', 'Owner 可在线配置各套餐的手动采集开关、可用渠道及日额度；所有个人采集仍受系统全局预算上限约束。')
                : t('Read-only for Admin. Only Owner can modify plan-level policies.', 'Admin 可查看套餐策略；仅 Owner 可修改套餐默认规则。')}
            </div>
          </div>
        </div>
        <div className="ds-card-bd collection-policy-grid">
          {(summary?.planPolicies || []).map((p) => (
            <div key={p.planTier} className="collection-policy-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b style={{ fontSize: 13.5, textTransform: 'uppercase' }}>{p.planTier}</b>
                <span className={`tag ${p.manualCollectEnabled ? 'tag--mint' : 'tag--line'}`}>
                  {p.manualCollectEnabled ? t('Enabled', '已开放') : t('Disabled', '已关闭')}
                </span>
              </div>
              <div className="collection-policy-values">
                <div>{t('Allowed Providers', '允许渠道')}: <code>{p.allowedProviders.length ? p.allowedProviders.join(', ') : '—'}</code></div>
                <div>{t('Daily Requests Cap', '日请求上限')}: <b>{limitText(p.dailyRequests, 'requests', '次')}</b></div>
                <div>{t('Daily Resources Cap', '日资源上限')}: <b>{limitText(p.dailyResources, 'units', '单位')}</b></div>
                <div>{t('Source scope', '来源范围')} · <b>{scopeCount(p.allowedSourceIds)}</b></div>
                <div>{t('Batch / comments per post', '批量 / 每帖评论上限')} · <b>{limitText(p.maxBatchLimit, 'items', '条')} / {limitText(p.maxCommentsPerPost, 'comments', '条')}</b></div>
              </div>
              {isOwner && (
                <button type="button" className="ds-btn ds-btn--ghost" onClick={() => openPlanEditor(p)}>
                  {t('Edit Policy', '配置套餐策略')}
                </button>
              )}
            </div>
          ))}
        </div>

        {editingPlan && isOwner && (
          <form className="collection-editor-section" onSubmit={event => { event.preventDefault(); void savePlanPolicy(); }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>
              {t(`Editing ${editingPlan.planTier.toUpperCase()} Plan Policy (rev ${editingPlan.revision})`, `编辑 ${editingPlan.planTier.toUpperCase()} 套餐策略 (rev ${editingPlan.revision})`)}
            </div>
            {pErr && <div className="wb-alert wb-alert--error" style={{ marginBottom: 10 }}>{pErr}</div>}
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <input type="checkbox" checked={pEnabled} onChange={(e) => setPEnabled(e.target.checked)} />
                <span>{t('Allow manual collection for this plan tier', '允许该套餐用户发起手动采集')}</span>
              </label>
              <QuotaChoices label={t('Allowed providers', '允许渠道')} options={providerOptions} value={pProviders} onChange={setPProviders} />
              <label><input type="checkbox" checked={pSources === null} onChange={event => setPSources(event.target.checked ? null : [])} /> {t('Allow all sources', '允许全部来源')}</label>
              {pSources && <QuotaChoices label={t('Allowed sources', '允许来源')} options={sourceOptions} value={pSources} onChange={setPSources} />}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <div className="wb-field">
                  <label htmlFor="plan-requests">{t('Daily Requests (empty = unlimited)', '日请求上限（次，留空表示不限）')}</label>
                  <input id="plan-requests" className="wb-input" type="number" min={0} max={100_000} value={pDailyReq} onChange={(e) => setPDailyReq(e.target.value)} />
                </div>
                <div className="wb-field">
                  <label htmlFor="plan-resources">{t('Daily Resources (empty = unlimited)', '日资源上限（单位，留空表示不限）')}</label>
                  <input id="plan-resources" className="wb-input" type="number" min={0} max={10_000_000} value={pDailyRes} onChange={(e) => setPDailyRes(e.target.value)} />
                </div>
                <div className="wb-field">
                  <label htmlFor="plan-batch">{t('Max Batch Limit', '单次最大条数')}</label>
                  <input id="plan-batch" className="wb-input" type="number" required min={1} max={2000} value={pMaxBatch} onChange={(e) => setPMaxBatch(Number(e.target.value))} />
                </div>
                <label className="wb-field">{t('Max comments per post', '每帖评论上限')}
                  <input className="wb-input" type="number" min={0} max={50} value={pMaxComments} onChange={event => setPMaxComments(Number(event.target.value))} />
                </label>
                <label className="wb-field">{t('Max private projects', '私有项目数量上限')}
                  <input className="wb-input" type="number" min={0} max={500} value={pMaxProjects} onChange={event => setPMaxProjects(Number(event.target.value))} />
                </label>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <input type="checkbox" checked={pExportEnabled} onChange={(e) => setPExportEnabled(e.target.checked)} />
                <span>{t('Allow CSV/JSON data export (reserved policy toggle)', '允许 CSV / JSON 数据导出（权益预留开关）')}</span>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="ds-btn" disabled={updatePlanMut.isPending || !providers.length}>
                  <Check size={12} /> {t('Save Plan Policy', '保存套餐策略')}
                </button>
                <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setEditingPlan(null)}>
                  {t('Cancel', '取消')}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* 3. User-level Quotas & Today's Usage */}
      <div className="ds-card collection-panel">
        <div className="ds-card-hd collection-panel-header">
          <div>
            <div className="ds-card-title"><Users size={14} /><span>{t('Account usage and overrides (UTC)', '账户用量与个人覆盖（UTC）')}</span></div>
            <div className="ds-card-sub">{t('System scheduled jobs do not consume any viewer’s personal quota.', '系统定时采集不计入普通用户个人额度；Admin 仅可调整 viewer 个人覆盖。')}</div>
          </div>
        </div>
        <div className="collection-table-scroll" role="region" aria-label={t('Personal quotas table', '个人配额表')} tabIndex={0}>
          <table className="collection-table">
            <thead>
              <tr>
                <th>{t('User', '用户')}</th>
                <th>{t('Role / Plan', '角色 / 套餐')}</th>
                <th>{t('Today Reserved / Executed', '今日预留 / 实际请求')}</th>
                <th>{t('Today Resources', '今日预留资源')}</th>
                <th>{t('Override', '个人覆盖')}</th>
                <th className="num">{t('Action', '操作')}</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.users || []).map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.email}</td>
                  <td>
                    <span className="tag tag--line">{u.role}</span> <span className="tag tag--lilac">{u.planTier}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{number.format(u.todayUsage.requestsReserved)} / {number.format(u.todayUsage.requestsExecuted)} {t('requests', '次')}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{number.format(u.todayUsage.resourcesReserved)} {t('units', '单位')}</td>
                  <td>{u.role !== 'viewer' ? t('Provider budgets apply', '适用渠道预算')
                    : overrideText(u.quotaOverride).join(' · ') || t('Inherits plan', '继承套餐')}</td>
                  <td className="num">
                    {u.role === 'viewer' && (
                      <button type="button" className="ds-btn ds-btn--ghost" onClick={() => openUserEditor(u)}>
                        {t('Override', '调整')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editUser && (
          <form className="collection-editor-section" onSubmit={event => { event.preventDefault(); void saveUserOverride(); }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t(`Quota Override for ${editUser.email}`, `调整 ${editUser.email} 的个人额度覆盖`)}</div>
            {uErr && <div className="wb-alert wb-alert--error" style={{ marginBottom: 8 }}>{uErr}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <div className="wb-field">
                <label htmlFor="viewer-manual-collect">{t('Manual Collect', '手动采集开关')}</label>
                <select className="wb-select" id="viewer-manual-collect" value={uEnabled} onChange={(e) => setUEnabled(e.target.value as 'inherit' | 'true' | 'false')}>
                  <option value="inherit">{t('Inherit plan', '继承套餐')}</option>
                  <option value="true">{t('Force allow', '允许')}</option>
                  <option value="false">{t('Force deny', '禁止')}</option>
                </select>
              </div>
              <DailyOverride label={t('Daily requests (count)', '日请求上限（次）')} value={uDailyReq} onChange={setUDailyReq} max={100000} />
              <DailyOverride label={t('Daily resources (units)', '日资源上限（单位）')} value={uDailyRes} onChange={setUDailyRes} max={10000000} />
              <label className="wb-field">{t('Batch limit (blank inherits)', '批量上限（留空继承）')}
                <input className="wb-input" type="number" min={1} max={2000} value={uBatch} onChange={event => setUBatch(event.target.value)} />
              </label>
            </div>
            <label><input type="checkbox" checked={uProviders === undefined} onChange={event => setUProviders(event.target.checked ? undefined : [])} /> {t('Inherit plan providers', '继承套餐渠道')}</label>
            {uProviders && <QuotaChoices label={t('Allowed providers', '允许渠道')} options={providerOptions} value={uProviders} onChange={setUProviders} />}
            <label className="wb-field">{t('Source scope override', '个人来源范围')}
              <select className="wb-select" value={uSources === undefined ? 'inherit' : uSources === null ? 'all' : 'selected'}
                onChange={event => setUSources(event.target.value === 'all' ? null : event.target.value === 'selected' ? [] : undefined)}>
                <option value="inherit">{t('Inherit plan', '继承套餐')}</option>
                <option value="all">{t('All sources', '全部来源')}</option>
                <option value="selected">{t('Selected sources', '仅指定来源')}</option>
              </select>
            </label>
            {uSources && <QuotaChoices label={t('Allowed sources', '允许来源')} options={sourceOptions} value={uSources} onChange={setUSources} />}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="submit" className="ds-btn" disabled={updateOverrideMut.isPending}>{t('Save Override', '保存覆盖')}</button>
              <button type="button" className="ds-btn ds-btn--ghost" disabled={updateOverrideMut.isPending} onClick={() => saveUserOverride(true)}>{t('Clear Override', '清除覆盖')}</button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setEditUser(null)}>{t('Cancel', '取消')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function QuotaChoices({ label, options, value, onChange }: {
  label: string; options: { id: string; label: string }[]; value: string[]; onChange: (next: string[]) => void;
}) {
  const labels = new Map(options.map(option => [option.id, option.label]));
  return (
    <fieldset className="source-editor-fields">
      <legend>{label}</legend>
      <div className="pill-select">{[...new Set([...labels.keys(), ...value])].map(id => (
        <label key={id}>
          <input type="checkbox" checked={value.includes(id)} onChange={event =>
            onChange(event.target.checked ? [...value, id] : value.filter(selected => selected !== id))} />
          {' '}{labels.get(id) ?? id}
        </label>
      ))}</div>
    </fieldset>
  );
}

function DailyOverride({ label, value, onChange, max }: {
  label: string; value: string; onChange: (next: string) => void; max: number;
}) {
  const { t } = useI18n();
  return (
    <div className="wb-field">
      <label className="wb-field">{label}
        <input className="wb-input" type="number" min={0} max={max} placeholder={t('Inherit plan', '继承套餐')}
          disabled={value === 'unlimited'} value={value === 'unlimited' ? '' : value} onChange={event => onChange(event.target.value)} />
      </label>
      <label><input type="checkbox" checked={value === 'unlimited'} onChange={event => onChange(event.target.checked ? 'unlimited' : '')} /> {t('Unlimited', '不限')}</label>
    </div>
  );
}
