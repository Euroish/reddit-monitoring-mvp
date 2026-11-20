import type { ProviderBudget } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';

export function QuotaMeters({
  budgets,
  onSelectEdit,
}: {
  budgets: ProviderBudget[];
  onSelectEdit?: (b: ProviderBudget) => void;
}) {
  const { t } = useI18n();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="wb-alert wb-alert--info">
        <span>
          {t(
            'Conservative reserved quotas (daily_requests / daily_resources) gate automatic & manual dispatches before upstream vendor billing is incurred.',
            '配额表展示服务端保守预留额度（请求与资源上限），不等同于第三方渠道实际账单；0 上限或接近上限时会自动标记并拦截自动采集。',
          )}
        </span>
      </div>

      <div className="budget-strip">
        {budgets.map((b) => {
          const usedDaily = b.requests_today ?? 0;
          const usedMonthly = b.requests_month ?? 0;
          const dailyPct = b.daily_requests <= 0 ? 0 : Math.min(100, Math.round((usedDaily / b.daily_requests) * 100));
          const monthlyPct = b.monthly_requests <= 0 ? 0 : Math.min(100, Math.round((usedMonthly / b.monthly_requests) * 100));
          const meterClass = b.daily_requests > 0 && dailyPct > 85 ? 'hot' : b.daily_requests > 0 && dailyPct > 65 ? 'warn' : '';

          return (
            <div key={b.provider} className="budget-card">
              <div className="bc-top">
                <span className="bc-name">
                  <i
                    className="dot"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: b.enabled ? '#147a57' : '#c0c6ba',
                      display: 'inline-block',
                    }}
                  />
                  <span>{b.provider}</span>
                </span>
                <span className="bc-rev">{b.enabled ? `rev ${b.revision}` : t('disabled', '已停用')}</span>
              </div>

              <div className="bc-meter">
                <div className="bm-top">
                  <span>{t('Daily Req', '日请求')} ({usedDaily}/{b.daily_requests})</span>
                  <b className="tabular-nums">{b.daily_requests <= 0 ? t('0 cap', '零上限') : `${dailyPct}%`}</b>
                </div>
                <div className="meter">
                  <i className={meterClass} style={{ width: `${dailyPct}%` }} />
                </div>
              </div>

              <div className="bc-meter">
                <div className="bm-top">
                  <span>{t('Monthly Req', '月请求')} ({usedMonthly}/{b.monthly_requests})</span>
                  <b className="tabular-nums">{b.monthly_requests <= 0 ? t('0 cap', '零上限') : `${monthlyPct}%`}</b>
                </div>
                <div className="meter">
                  <i style={{ width: `${monthlyPct}%` }} />
                </div>
              </div>

              {onSelectEdit && (
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--faint)' }}>
                    min {b.minimum_interval_ms}ms
                  </span>
                  <button
                    type="button"
                    className="ds-btn ds-btn--quiet"
                    style={{ height: 24, fontSize: 10.5, padding: '0 8px' }}
                    onClick={() => onSelectEdit(b)}
                  >
                    {t('Edit', '调整配额')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
