import { useState } from 'react';
import { AlertTriangle, PauseCircle, ShieldCheck } from 'lucide-react';
import {
  formatApiError,
  isMfaRequiredError,
  useLegacySourcesQuery,
  useReconcileLegacySourceMutation,
} from '../api/hooks';
import { useI18n } from '../i18n/translations';
import { InlineMfaStepUp } from './InlineMfaStepUp';

export function LegacySourcesPanel({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const query = useLegacySourcesQuery(canManage);
  const reconcileMut = useReconcileLegacySourceMutation();
  const [pendingAction, setPendingAction] = useState<{
    sourceId: string;
    action: 'pause_schedule' | 'claim_monitor_managed';
    revision: number;
  } | null>(null);
  const [mfaNeeded, setMfaNeeded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!canManage) return null;
  const items = query.data?.items ?? [];
  if (!query.isPending && items.length === 0 && !notice) return null;

  const runAction = async (args: {
    sourceId: string;
    action: 'pause_schedule' | 'claim_monitor_managed';
    revision: number;
  }) => {
    setError('');
    setNotice('');
    try {
      await reconcileMut.mutateAsync(args);
      setMfaNeeded(false);
      setPendingAction(null);
      setNotice(
        args.action === 'pause_schedule'
          ? t('Legacy schedule paused cleanly.', '已停止该存量研究源的自动调度。')
          : t('Source claimed under monitor management.', '已接管该来源到监测调度体系。'),
      );
    } catch (err) {
      if (isMfaRequiredError(err)) {
        setPendingAction(args);
        setMfaNeeded(true);
      } else {
        setError(formatApiError(err));
      }
    }
  };

  return (
    <section className="ds-card collection-panel" style={{ marginTop: 14 }}>
      <header className="ds-card-hd collection-panel-header">
        <div>
          <h3 className="ds-card-title">
            <AlertTriangle size={15} color="#d4821c" />
            <span>{t('Legacy Unmanaged Scheduled Sources Audit', '存量未纳管定时研究源核查')}</span>
          </h3>
          <p className="ds-card-sub">
            {t(
              'Research pull sources running automatic schedules outside monitor governance. Pause or claim them explicitly.',
              '以下研究来源已开启自动定时调度但未标记为监测托管；可直接停用自动调度或纳管到监测器，避免静默消耗。',
            )}
          </p>
        </div>
      </header>
      <div className="ds-card-bd">
        {query.isPending && <p className="collection-hint">{t('Auditing legacy scheduled sources…', '正在核查存量定时来源…')}</p>}
        {error && <div className="wb-alert wb-alert--error">{error}</div>}
        {notice && <div className="wb-alert wb-alert--success" role="status">{notice}</div>}
        {mfaNeeded && pendingAction && (
          <InlineMfaStepUp onVerified={() => runAction(pendingAction)} onCancel={() => { setMfaNeeded(false); setPendingAction(null); }} />
        )}
        {items.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {items.map((item) => (
              <div key={item.id} className="job-row" style={{ alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 12 }}>[{item.platform.toUpperCase()}] {item.label}</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {item.classification} · {item.primaryProvider} · {t('Refs', '引用监测器')}: {item.totalMonitorRefs} · {t('Today resources', '今日消耗')}: {item.resourcesToday}
                    {item.unresolvedCharges > 0 && ` · ${t('Unresolved charges', '未决扣费')}: ${item.unresolvedCharges}`}
                  </div>
                </div>
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost"
                  disabled={reconcileMut.isPending}
                  onClick={() => void runAction({ sourceId: item.id, action: 'pause_schedule', revision: item.revision })}
                >
                  <PauseCircle size={12} />
                  <span>{t('Pause Schedule', '停用自动调度')}</span>
                </button>
                {item.totalMonitorRefs > 0 && (
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    disabled={reconcileMut.isPending}
                    onClick={() => void runAction({ sourceId: item.id, action: 'claim_monitor_managed', revision: item.revision })}
                  >
                    <ShieldCheck size={12} />
                    <span>{t('Claim Managed', '标记监测托管')}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
