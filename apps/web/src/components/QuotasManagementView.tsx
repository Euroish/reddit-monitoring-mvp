import { useState } from 'react';
import { Check, Shield, Sliders, Users } from 'lucide-react';
import {
  formatApiError,
  useQuotasSummaryQuery,
  useUpdatePlanPolicyMutation,
  useUpdateUserQuotaOverrideMutation,
} from '../api/hooks';
import type { Actor, PlanPolicyDto, ProviderBudget, QuotaOverrideDto, SourceCapability } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { QuotaMeters } from './charts/QuotaMeters';

export function QuotasManagementView({
  actor,
  budgets,
  providers,
  onEditBudget,
}: {
  actor: Actor;
  budgets: ProviderBudget[];
  providers: SourceCapability[];
  onEditBudget: (b: ProviderBudget) => void;
}) {
  const { t } = useI18n();
  const isOwner = actor.role === 'owner';
  const isAdmin = actor.role === 'owner' || actor.role === 'admin';
  const quotasQuery = useQuotasSummaryQuery(true);
  const updatePlanMut = useUpdatePlanPolicyMutation();
  const updateOverrideMut = useUpdateUserQuotaOverrideMutation();

  const [editingPlan, setEditingPlan] = useState<PlanPolicyDto | null>(null);
  const [pEnabled, setPEnabled] = useState(false);
  const [pProviders, setPProviders] = useState<string[]>([]);
  const [pDailyReq, setPDailyReq] = useState<string>('0');
  const [pDailyRes, setPDailyRes] = useState<string>('0');
  const [pMaxBatch, setPMaxBatch] = useState<number>(20);
  const [pErr, setPErr] = useState<string | null>(null);

  const [editUser, setEditUser] = useState<{ id: string; email: string; current: QuotaOverrideDto | null } | null>(null);
  const [uEnabled, setUEnabled] = useState<'inherit' | 'true' | 'false'>('inherit');
  const [uDailyReq, setUDailyReq] = useState<string>('');
  const [uDailyRes, setUDailyRes] = useState<string>('');
  const [uErr, setUErr] = useState<string | null>(null);

  const summary = quotasQuery.data;

  const openPlanEditor = (p: PlanPolicyDto) => {
    setEditingPlan(p);
    setPEnabled(p.manualCollectEnabled);
    setPProviders(p.allowedProviders);
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
          allowedSourceIds: editingPlan.allowedSourceIds,
          dailyRequests: pDailyReq.trim() === '' ? null : Math.max(0, Number(pDailyReq) || 0),
          dailyResources: pDailyRes.trim() === '' ? null : Math.max(0, Number(pDailyRes) || 0),
          maxBatchLimit: Math.max(1, Math.min(2000, pMaxBatch || 20)),
          maxCommentsPerPost: editingPlan.maxCommentsPerPost,
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
    setUDailyReq(o?.dailyRequests !== undefined && o?.dailyRequests !== null ? String(o.dailyRequests) : '');
    setUDailyRes(o?.dailyResources !== undefined && o?.dailyResources !== null ? String(o.dailyResources) : '');
    setUErr(null);
  };

  const saveUserOverride = async (clear = false) => {
    if (!editUser) return;
    setUErr(null);
    try {
      if (clear) {
        await updateOverrideMut.mutateAsync({ userId: editUser.id, payload: null });
      } else {
        const base: QuotaOverrideDto = { ...(editUser.current ?? {}) };
        delete base.manualCollectEnabled;
        delete base.dailyRequests;
        delete base.dailyResources;
        const next: QuotaOverrideDto = {
          ...base,
          ...(uEnabled === 'inherit' ? {} : { manualCollectEnabled: uEnabled === 'true' }),
          ...(uDailyReq.trim() !== '' ? { dailyRequests: Math.max(0, Number(uDailyReq) || 0) } : {}),
          ...(uDailyRes.trim() !== '' ? { dailyResources: Math.max(0, Number(uDailyRes) || 0) } : {}),
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
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>{t('Allowed Providers for Your Account:', '当前账号可用采集渠道：')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(summary?.providerAvailability || []).map((p) => (
                  <span key={p.provider} className={`tag ${p.planAllowed && p.enabled ? 'tag--mint' : 'tag--line'}`}>
                    {p.provider} ({p.planAllowed ? (p.enabled ? t('ready', '就绪') : t('system disabled', '系统未启用')) : t('not in plan', '套餐未开放')})
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
      <QuotaMeters budgets={budgets} onSelectEdit={onEditBudget} />

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
                <div>{t('Max Batch Limit', '单次条数上限')}: <b>{p.maxBatchLimit}</b></div>
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
              <div>
                <div style={{ fontSize: 11.5, marginBottom: 4 }}>{t('Allowed Providers', '允许使用的渠道')}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {providers.map((cap) => {
                    const checked = pProviders.includes(cap.provider);
                    return (
                      <label key={cap.provider} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 4, background: '#fff' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setPProviders((prev) => (checked ? prev.filter((x) => x !== cap.provider) : [...prev, cap.provider]))}
                        />
                        <span>{cap.provider}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
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
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="ds-btn" onClick={savePlanPolicy} disabled={updatePlanMut.isPending}>
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
                  <td style={{ fontSize: 11 }}>{u.quotaOverride ? JSON.stringify(u.quotaOverride) : t('Inherits plan', '继承套餐')}</td>
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
              <div className="wb-field">
                <label>{t('Daily Requests Override', '日请求覆盖（空=继承）')}</label>
                <input className="wb-input" type="number" min={0} value={uDailyReq} onChange={(e) => setUDailyReq(e.target.value)} />
              </div>
              <div className="wb-field">
                <label>{t('Daily Resources Override', '日资源覆盖（空=继承）')}</label>
                <input className="wb-input" type="number" min={0} value={uDailyRes} onChange={(e) => setUDailyRes(e.target.value)} />
              </div>
            </div>
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
