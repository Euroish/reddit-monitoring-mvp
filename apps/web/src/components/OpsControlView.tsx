import { useState } from 'react';
import { Activity, Database, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import {
  formatApiError,
  isMfaRequiredError,
  useFeedAdminSummaryQuery,
  useIntelligenceOpsSummaryQuery,
  usePruneFeedAdminMutation,
  useReconcileAdminMonitorMutation,
} from '../api/hooks';
import { useI18n } from '../i18n/translations';
import { formatExactTime } from '../lib/sourceLabels';
import { InlineMfaStepUp } from './InlineMfaStepUp';
import { KpiCard } from './workbench/KpiCard';

export function OpsControlView({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useI18n();
  const opsQ = useIntelligenceOpsSummaryQuery(true);
  const feedQ = useFeedAdminSummaryQuery(true);
  const reconcileMut = useReconcileAdminMonitorMutation();
  const pruneMut = usePruneFeedAdminMutation();

  const [msg, setMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [pendingMfaAction, setPendingMfaAction] = useState<(() => Promise<void>) | null>(null);

  const runWithMfa = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
      setPendingMfaAction(null);
    } catch (err) {
      if (isMfaRequiredError(err)) setPendingMfaAction(() => fn);
      else setMsg({ text: formatApiError(err), isError: true });
    }
  };

  const ops = opsQ.data;
  const feed = feedQ.data;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {msg && (
        <div role={msg.isError ? 'alert' : 'status'} className={`wb-alert ${msg.isError ? 'wb-alert--error' : 'wb-alert--info'}`}>
          <span>{msg.text}</span>
        </div>
      )}

      {pendingMfaAction && (
        <InlineMfaStepUp
          onVerified={() => {
            const fn = pendingMfaAction;
            setPendingMfaAction(null);
            void runWithMfa(fn);
          }}
          onCancel={() => setPendingMfaAction(null)}
        />
      )}

      {/* Telemetry KPIs */}
      {ops && (
        <div className="kpi-strip">
          <KpiCard
            label={t('Global Social Ceiling (UTC)', '全站社媒日上限池 (UTC)')}
            value={`${ops.automation.socialResourcesReservedToday.toLocaleString()} / ${ops.automation.dailySocialItemCeiling.toLocaleString()}`}
            detail={ops.automation.autoHydrationEnabled ? t('P80 Auto-hydration: ON', 'P80 自动补采：已启用') : t('P80 Auto-hydration: PAUSED', 'P80 自动补采：已暂停')}
          />
          <KpiCard
            label={t('P80 Hydration Queue (Today)', 'P80 自动水合队列（今日）')}
            value={`${ops.automation.hydrateQueuedOrRunning} queued`}
            detail={t(`${ops.automation.hydrateSucceededToday} ok · ${ops.automation.hydrateFailedToday} failed`, `今日成功 ${ops.automation.hydrateSucceededToday} · 失败 ${ops.automation.hydrateFailedToday}`)}
          />
          <KpiCard
            label={t('Rollup Cache Health', 'Rollup 分析聚合缓存')}
            value={`${ops.rollups.totalBuckets.toLocaleString()} buckets`}
            detail={t(`${ops.rollups.distinctMonitors} monitors (${ops.rollups.buckets6h}×6h / ${ops.rollups.buckets1d}×1d)`, `${ops.rollups.distinctMonitors} 个监测器（6h ${ops.rollups.buckets6h} / 1d ${ops.rollups.buckets1d}）`)}
          />
          <KpiCard
            label={t('Scheduled Jobs Today', '今日定时采集派发')}
            value={ops.automation.scheduledJobsToday.toLocaleString()}
            detail={ops.rollups.latestUpdatedAt ? t(`Rollup: ${formatExactTime(ops.rollups.latestUpdatedAt)}`, `最近聚合：${formatExactTime(ops.rollups.latestUpdatedAt)}`) : t('No rollups yet', '尚无聚合')}
          />
        </div>
      )}

      {/* Global Monitors Control */}
      <div className="wb-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong style={{ fontSize: 14 }}>
              <Activity size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
              {t('All Intelligence Monitors Registry', '全站智能监测器总控台')}
            </strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('Inspect cross-user monitor schedules, UTC daily usage budgets, pause runaway tasks, or rebuild rollups.', '全局监测全站各成员定时监测器、今日 UTC 日预算消耗、紧急停机及 Rollup 重算。')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate('/sources?tab=budgets')}>
              {t('Edit Global Budget / P80 Toggle', '配置全站总预算与 P80 开关')}
            </button>
            <button type="button" className="ds-btn ds-btn--ghost" onClick={() => void opsQ.refetch()}>
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {opsQ.isPending && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('Loading monitors registry…', '正在加载全站监测器…')}</div>}
        {opsQ.isError && <div className="wb-alert wb-alert--error">{formatApiError(opsQ.error)}</div>}
        {ops && ops.monitors.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('No intelligence monitors created yet.', '全站尚无任何智能监测器。')}</div>
        )}
        {ops && ops.monitors.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="wb-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>{t('Monitor', '监测器')}</th>
                  <th>{t('Owner', '所属账号')}</th>
                  <th>{t('Cadence', '周期')}</th>
                  <th>{t('Today UTC Usage', '今日 UTC 消耗 / 日预算')}</th>
                  <th>{t('Last / Next Run', '上次 / 下次调度')}</th>
                  <th>{t('Actions', '运维操作')}</th>
                </tr>
              </thead>
              <tbody>
                {ops.monitors.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        <span className="tag">{m.kind}</span> {m.sourceCount} src ·{' '}
                        {m.enabled
                          ? <span className="tag tag--ok">{t('Active', '运行中')}</span>
                          : <span className="tag tag--amber">{m.pausedReason || t('Paused', '已暂停')}</span>}
                      </div>
                    </td>
                    <td>{m.ownerEmail ?? m.ownerUserId} <span className="tag">{m.ownerRole}</span></td>
                    <td className="tabular-nums">{m.scheduleIntervalHours}h</td>
                    <td className="tabular-nums">{m.requestsToday} req · {m.resourcesToday} / {m.dailyItemBudget}</td>
                    <td className="tabular-nums" style={{ fontSize: 11.5 }}>
                      <div>{t('Last', '上次')}: {m.lastDispatchedAt ? formatExactTime(m.lastDispatchedAt) : '—'}</div>
                      <div>{t('Next', '下次')}: {m.nextDueAt ? formatExactTime(m.nextDueAt) : '—'}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="ds-btn ds-btn--ghost"
                          style={{ height: 26, padding: '0 8px', fontSize: 11 }}
                          disabled={reconcileMut.isPending}
                          onClick={() => void runWithMfa(async () => {
                            const action = m.enabled ? 'pause' : 'resume';
                            await reconcileMut.mutateAsync({ id: m.id, action, revision: m.revision });
                            setMsg({ text: t(`Monitor ${action}d.`, `监测器已${m.enabled ? '暂停' : '恢复'}。`) });
                          })}
                        >
                          {m.enabled ? <Pause size={11} /> : <Play size={11} />}
                          <span>{m.enabled ? t('Pause', '暂停') : t('Resume', '恢复')}</span>
                        </button>
                        <button
                          type="button"
                          className="ds-btn ds-btn--ghost"
                          style={{ height: 26, padding: '0 8px', fontSize: 11 }}
                          disabled={reconcileMut.isPending}
                          onClick={() => void runWithMfa(async () => {
                            const res = await reconcileMut.mutateAsync({ id: m.id, action: 'refresh_rollups', revision: m.revision });
                            setMsg({ text: t(`Rebuilt ${res.updatedBuckets} rollup buckets.`, `已重算 ${res.updatedBuckets} 个 Rollup 时间桶。`) });
                          })}
                        >
                          <RefreshCw size={11} />
                          <span>{t('Rebuild Rollup', '重算聚合')}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Feed Engine & Cleanup Observation */}
      <div className="wb-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong style={{ fontSize: 14 }}>
              <Database size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />
              {t('Feed Engine & Retention Health', 'V2 信息流引擎与阅读记录清理观测')}
            </strong>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('Track personalized preference users, seen-history footprint, 7-day interactions, and prune expired artifacts.', '监控个性化偏好用户数、已读去重表体量、近 7 日交互明细与过期记录安全清理。')}
            </div>
          </div>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            disabled={pruneMut.isPending}
            onClick={() => void runWithMfa(async () => {
              const res = await pruneMut.mutateAsync();
              setMsg({
                text: t(
                  `Pruned ${res.deletedSeen} stale seen records (>14d) and ${res.deletedEvents} non-saved events (>30d).`,
                  `已清理 ${res.deletedSeen} 条过期已读（>14 天）与 ${res.deletedEvents} 条非收藏交互（>30 天）。`,
                ),
              });
            })}
          >
            <Trash2 size={12} />
            <span>{t('Prune Stale Seen & Events', '清理过期已读与交互记录')}</span>
          </button>
        </div>

        {feedQ.isError && <div className="wb-alert wb-alert--error">{formatApiError(feedQ.error)}</div>}
        {feed && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }} className="tabular-nums">
              <span className="tag tag--line">{t(`Pref Users: ${feed.preferencesUsers}`, `偏好设置用户：${feed.preferencesUsers}`)}</span>
              <span className="tag tag--line">{t(`Seen Rows: ${feed.seenTotal} (${feed.seenStale14d} >14d)`, `已读记录：${feed.seenTotal}（待清理 ${feed.seenStale14d}）`)}</span>
              <span className="tag tag--line">{t(`Affinity Weights: ${feed.affinityRows}`, `兴趣权重条目：${feed.affinityRows}`)}</span>
              <span className="tag tag--line">{t(`7d Events: ${feed.eventsLast7d} (${feed.staleEvents30d} >30d)`, `7 日交互：${feed.eventsLast7d}（待清理 ${feed.staleEvents30d}）`)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
              <strong>{t('Active Feed Lanes:', '启用中信息流赛道：')}</strong>
              {Object.entries(feed.activeFeedLanes).map(([lane, cnt]) => (
                <span key={lane} className="tag tabular-nums">{lane}: {cnt}</span>
              ))}
              {feed.eventBreakdown.map((eb) => (
                <span key={eb.eventType} className="tag tag--lilac tabular-nums">{eb.eventType}: {eb.count7d}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
