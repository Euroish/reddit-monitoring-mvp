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
import { QuotaMeters } from './charts/QuotaMeters';

export function QuotasManagementView({
  actor,
  budgets,
  budgetError,
  providers,
  sources,
  onEditBudget,
}: {
  actor: Actor;
  budgets: ProviderBudget[];
  budgetError: Error | null;
  sources: CollectionSource[];
  providers: SourceCapability[];
  onEditBudget: (b: ProviderBudget) => void;
}) {
  const { t } = useI18n();
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
  const [pErr, setPErr] = useState<string | null>(null);

  const [editUser, setEditUser] = useState<{ id: string; email: string; current: QuotaOverrideDto | null } | null>(null);
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
          dailyRequests: pDailyReq.trim() === '' ? null : Math.max(0, Number(pDailyReq) || 0),
          dailyResources: pDailyRes.trim() === '' ? null : Math.max(0, Number(pDailyRes) || 0),
          maxBatchLimit: Math.max(1, Math.min(2000, pMaxBatch || 20)),
          maxCommentsPerPost: pMaxComments,
          revision: editingPlan.revision,
        },
      });
      setEditingPlan(null);
    } catch (err) {
      setPErr(formatApiError(err));
    }
  };

  const openUserEditor = (u: { id: string; email: string; quotaOverride: QuotaOverrideDto | null }) => {
    setEditUser({ id: u.id, email: u.email, current: u.quotaOverride });
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
    } catch (err) {
      setUErr(formatApiError(err));
    }
  };

  const sourceOptions = sources.filter(source => source.deliveryMode === 'pull')
    .map(source => ({ id: source.id, label: source.label }));
  const providerOptions = providers.map(provider => ({ id: provider.provider, label: provider.provider }));
  const scopeCount = (ids: string[] | null) => ids === null ? t('All sources', '全部来源') : String(ids.length);
  const queryError = quotasQuery.error;
  if (queryError || !summary) {
    return <div role={queryError ? 'alert' : 'status'} className="wb-alert">{queryError ? formatApiError(queryError) : t('Loading collection policy…', '正在加载采集策略…')}</div>;
  }

  if (!isAdmin) {
    const ep = summary?.effectivePolicy;
    const my = summary?.myUsage;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="ds-card">
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title"><Sliders size={14} /><span>{t('My Collection Policy & Daily Quota', '我的采集权限与日额度')}</span></div>
              <div className="ds-card-sub">
                {t('Plan Tier:', '当前套餐：')} <b>{ep?.planTier ?? actor.planTier ?? 'free'}</b> · {t('Resets at UTC:', 'UTC 重置时间：')} {summary?.resetsAtUtc.slice(0, 19).replace('T', ' ') ?? '—'}
              </div>
            </div>
            <span className={`tag ${ep?.manualCollectEnabled ? 'tag--mint' : 'tag--line'}`}>
              {ep?.manualCollectEnabled ? t('Manual Collect Enabled', '已开放手动采集') : t('Manual Collect Disabled', '未开放手动采集')}
            </span>
          </div>
          <div className="ds-card-bd" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
              <div>
                <span style={{ color: 'var(--faint)' }}>{t('Today Requests Reserved / Executed', '今日预留 / 实际执行请求')}：</span>
                <b style={{ fontFamily: 'var(--font-mono)' }}>{my?.requestsReserved ?? 0} / {my?.requestsExecuted ?? 0}</b>
                <span style={{ color: 'var(--faint)', marginLeft: 4 }}>
                  ({t('Cap', '上限')}: {ep?.dailyRequests === null ? t('Unlimited (subject to system budget)', '不限个人上限（仍受系统预算约束）') : ep?.dailyRequests ?? 0})
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--faint)' }}>{t('Today Resources Reserved', '今日预留资源数')}：</span>
                <b style={{ fontFamily: 'var(--font-mono)' }}>{my?.resourcesReserved ?? 0}</b>
                <span style={{ color: 'var(--faint)', marginLeft: 4 }}>
                  ({t('Cap', '上限')}: {ep?.dailyResources === null ? t('Unlimited', '不限') : ep?.dailyResources ?? 0})
                </span>
              </div>
            </div>
            {ep && <p>{t('Source scope', '来源范围')} · {scopeCount(ep.allowedSourceIds)} · {t('Batch / comments per post', '批量 / 每帖评论上限')} {ep.maxBatchLimit} / {ep.maxCommentsPerPost} ·
              {' '}{ep.hasOverride ? t('Personal override applied', '已应用个人覆盖') : t('Inherited plan policy', '继承套餐策略')}</p>}
            {my?.byProvider.map(provider => <span key={provider.provider}>
              {provider.provider} · {t('Reserved / executed requests', '预留 / 实际请求')} {provider.requests_reserved} / {provider.requests_executed} · {t('Reserved resources', '预留资源')} {provider.resources_reserved}
            </span>)}
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>{t('Allowed Providers for Your Account:', '当前账号可用采集渠道：')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(summary?.providerAvailability || []).map((p) => (
                  <span key={p.provider} className={`tag ${p.planAllowed && p.enabled && p.budgetEnabled ? 'tag--mint' : 'tag--line'}`}>
                    {p.provider} ({p.planAllowed ? (p.enabled ? (p.budgetEnabled ? t('ready', '就绪') : t('budget disabled', '预算已停用')) : t('provider unavailable', '渠道未就绪')) : t('not in plan', '套餐未开放')})
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 1. System Provider Budgets */}
      {budgetError ? <div role="alert" className="wb-alert wb-alert--error">{formatApiError(budgetError)}</div> : <QuotaMeters budgets={budgets} onSelectEdit={onEditBudget} />}
      <p className="muted">{t('Owner and Admin collection uses provider budgets. Free/Pro policies and personal limits govern Viewer collection.', 'Owner 和 Admin 的采集受渠道预算约束。Free/Pro 策略与个人额度适用于 Viewer 采集。')}</p>

      {/* 2. Free / Pro Plan Policies */}
      <div className="ds-card">
        <div className="ds-card-hd">
          <div>
            <div className="ds-card-title"><Shield size={14} /><span>{t('Account Group Collection Policies (Free / Pro)', '账户组采集权限与默认额度 (Free / Pro)')}</span></div>
            <div className="ds-card-sub">
              {isOwner
                ? t('Owner can configure manual collection switch, allowed providers, and daily caps per plan tier.', 'Owner 可在线配置各套餐的手动采集开关、可用渠道及日额度；所有个人采集仍受系统全局预算上限约束。')
                : t('Read-only for Admin. Only Owner can modify plan-level policies.', 'Admin 可查看套餐策略；仅 Owner 可修改套餐默认规则。')}
            </div>
          </div>
        </div>
        <div className="ds-card-bd" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
          {(summary?.planPolicies || []).map((p) => (
            <div key={p.planTier} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, background: '#fbfcf7' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b style={{ fontSize: 13.5, textTransform: 'uppercase' }}>{p.planTier}</b>
                <span className={`tag ${p.manualCollectEnabled ? 'tag--mint' : 'tag--line'}`}>
                  {p.manualCollectEnabled ? t('Enabled', '已开放') : t('Disabled', '已关闭')}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', display: 'grid', gap: 4 }}>
                <div>{t('Allowed Providers', '允许渠道')}: <code>{p.allowedProviders.length ? p.allowedProviders.join(', ') : '—'}</code></div>
                <div>{t('Daily Requests Cap', '日请求上限')}: <b>{p.dailyRequests === null ? t('Unlimited', '不限') : p.dailyRequests}</b></div>
                <div>{t('Daily Resources Cap', '日资源上限')}: <b>{p.dailyResources === null ? t('Unlimited', '不限') : p.dailyResources}</b></div>
                <div>{t('Source scope', '来源范围')} · <b>{scopeCount(p.allowedSourceIds)}</b></div>
                <div>{t('Batch / comments per post', '批量 / 每帖评论上限')} · <b>{p.maxBatchLimit} / {p.maxCommentsPerPost}</b></div>
              </div>
              {isOwner && (
                <button type="button" className="ds-btn ds-btn--ghost" style={{ marginTop: 10, height: 26, fontSize: 11 }} onClick={() => openPlanEditor(p)}>
                  {t('Edit Policy', '配置套餐策略')}
                </button>
              )}
            </div>
          ))}
        </div>

        {editingPlan && isOwner && (
          <div style={{ borderTop: '1px solid var(--line)', padding: 14, background: '#f7f8f4' }}>
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
                  <label>{t('Daily Requests (empty = unlimited)', '日请求上限（留空=不限）')}</label>
                  <input className="wb-input" type="number" min={0} value={pDailyReq} onChange={(e) => setPDailyReq(e.target.value)} />
                </div>
                <div className="wb-field">
                  <label>{t('Daily Resources (empty = unlimited)', '日资源上限（留空=不限）')}</label>
                  <input className="wb-input" type="number" min={0} value={pDailyRes} onChange={(e) => setPDailyRes(e.target.value)} />
                </div>
                <div className="wb-field">
                  <label>{t('Max Batch Limit', '单次最大条数')}</label>
                  <input className="wb-input" type="number" min={1} max={2000} value={pMaxBatch} onChange={(e) => setPMaxBatch(Number(e.target.value))} />
                </div>
                <label className="wb-field">{t('Max comments per post', '每帖评论上限')}
                  <input className="wb-input" type="number" min={0} max={50} value={pMaxComments} onChange={event => setPMaxComments(Number(event.target.value))} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="ds-btn" onClick={savePlanPolicy} disabled={updatePlanMut.isPending || !providers.length}>
                  <Check size={12} /> {t('Save Plan Policy', '保存套餐策略')}
                </button>
                <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setEditingPlan(null)}>
                  {t('Cancel', '取消')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. User-level Quotas & Today's Usage */}
      <div className="ds-card">
        <div className="ds-card-hd">
          <div>
            <div className="ds-card-title"><Users size={14} /><span>{t('User Quota Overrides & Today’s Usage (UTC)', '用户额度覆盖与今日实际消耗 (UTC)')}</span></div>
            <div className="ds-card-sub">{t('System scheduled jobs do not consume any viewer’s personal quota.', '系统定时采集不计入普通用户个人额度；Admin 仅可调整 viewer 个人覆盖。')}</div>
          </div>
        </div>
        <div className="ds-card-bd" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="ds-table">
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
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{u.todayUsage.requestsReserved} / {u.todayUsage.requestsExecuted}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{u.todayUsage.resourcesReserved}</td>
                  <td style={{ fontSize: 11 }}>{u.role !== 'viewer' ? t('Provider budgets apply', '适用渠道预算') : u.quotaOverride ? JSON.stringify(u.quotaOverride) : t('Inherits plan', '继承套餐')}</td>
                  <td className="num">
                    {(isOwner || u.role === 'viewer') && (
                      <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 24, fontSize: 10.5 }} onClick={() => openUserEditor(u)}>
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
          <div style={{ borderTop: '1px solid var(--line)', padding: 14, background: '#f7f8f4' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t(`Quota Override for ${editUser.email}`, `调整 ${editUser.email} 的个人额度覆盖`)}</div>
            {uErr && <div className="wb-alert wb-alert--error" style={{ marginBottom: 8 }}>{uErr}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <div className="wb-field">
                <label>{t('Manual Collect', '手动采集开关')}</label>
                <select className="wb-select" value={uEnabled} onChange={(e) => setUEnabled(e.target.value as 'inherit' | 'true' | 'false')}>
                  <option value="inherit">{t('Inherit plan', '继承套餐')}</option>
                  <option value="true">{t('Force allow', '允许')}</option>
                  <option value="false">{t('Force deny', '禁止')}</option>
                </select>
              </div>
              <DailyOverride label={t('Daily requests', '日请求上限')} value={uDailyReq} onChange={setUDailyReq} max={100000} />
              <DailyOverride label={t('Daily resources', '日资源上限')} value={uDailyRes} onChange={setUDailyRes} max={10000000} />
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
              <button type="button" className="ds-btn" onClick={() => saveUserOverride(false)} disabled={updateOverrideMut.isPending}>{t('Save Override', '保存覆盖')}</button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => saveUserOverride(true)}>{t('Clear Override', '清除覆盖')}</button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setEditUser(null)}>{t('Cancel', '取消')}</button>
            </div>
          </div>
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
