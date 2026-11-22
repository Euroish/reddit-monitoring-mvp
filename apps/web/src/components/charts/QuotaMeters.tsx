import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { ProviderBudget } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { EChartBox } from './EChartBox';
import { useChartColors } from './chartUtils';

export function QuotaMeters({
  budgets,
  onSelectEdit,
}: {
  budgets: ProviderBudget[];
  onSelectEdit?: (b: ProviderBudget) => void;
}) {
  const { t } = useI18n();
  const colors = useChartColors();

  const option: EChartsOption = useMemo(() => {
    const names = budgets.map((b) => b.provider);
    const dailyPcts = budgets.map((b) => {
      const used = b.requests_today ?? 0;
      return b.daily_requests <= 0 ? 0 : Math.min(100, Math.round((used / b.daily_requests) * 100));
    });
    const monthlyPcts = budgets.map((b) => {
      const used = b.requests_month ?? 0;
      return b.monthly_requests <= 0 ? 0 : Math.min(100, Math.round((used / b.monthly_requests) * 100));
    });

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#1b221a',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 11 },
      },
      legend: {
        top: 0,
        right: 8,
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: '#5b655a', fontSize: 10.5 },
      },
      grid: { left: 104, right: 24, top: 28, bottom: 20 },
      xAxis: {
        type: 'value',
        max: 100,
        splitLine: { lineStyle: { color: colors.gridLine } },
        axisLabel: { color: '#8b9388', fontSize: 10, formatter: '{value}%' },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: colors.ink, fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace' },
      },
      series: [
        {
          name: t('Daily Request Quota %', '日请求额度占用 %'),
          type: 'bar',
          barMaxWidth: 10,
          itemStyle: { color: colors.teal, borderRadius: [0, 3, 3, 0] },
          data: dailyPcts,
        },
        {
          name: t('Monthly Request Quota %', '月请求额度占用 %'),
          type: 'bar',
          barMaxWidth: 10,
          itemStyle: { color: colors.purple, borderRadius: [0, 3, 3, 0] },
          data: monthlyPcts,
        },
      ],
    };
  }, [budgets, colors, t]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="wb-alert wb-alert--info">
        <span>
          {t(
            'Conservative reserved quotas (daily_requests / daily_resources) gate automatic & manual dispatches before upstream vendor billing is incurred.',
            '配额表展示服务端保守预留额度（请求与资源上限），不等同于第三方渠道实际账单；预算关闭或固定上限不足时停止执行；窗口额度消耗完后，符合条件的任务等待 UTC 日或月重置。',
          )}
        </span>
      </div>

      {/* ECharts Dual-Quota Utilization Overview */}
      <div className="ds-card">
        <div className="ds-card-hd">
          <div>
            <div className="ds-card-title">{t('Provider Quota Utilization Overview', '各采集渠道日 / 月额度占用总览')}</div>
            <div className="ds-card-sub">{t('Dual-dimension quota comparison across all registered pull providers', '按 UTC 日重置的保守预留比例对照')}</div>
          </div>
          <span className="tag tag--line">ECharts Dual Bar</span>
        </div>
        <div className="ds-card-bd">
          <EChartBox option={option} height={Math.max(190, budgets.length * 36)} />
        </div>
      </div>

      {/* DeepSeek Budget Cards Strip */}
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
                      background: b.enabled ? '#1c7a6a' : '#c0c6ba',
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
                  <b>{b.daily_requests <= 0 ? t('0 cap', '零上限') : `${dailyPct}%`}</b>
                </div>
                <div className="meter">
                  <i className={meterClass} style={{ width: `${dailyPct}%` }} />
                </div>
              </div>

              <div className="bc-meter">
                <div className="bm-top">
                  <span>{t('Monthly Req', '月请求')} ({usedMonthly}/{b.monthly_requests})</span>
                  <b>{b.monthly_requests <= 0 ? t('0 cap', '零上限') : `${monthlyPct}%`}</b>
                </div>
                <div className="meter">
                  <i style={{ width: `${monthlyPct}%` }} />
                </div>
              </div>

              <div className="source-health">
                <span>{t('Daily resources reserved', '日资源预留')} {b.resources_today ?? 0}/{b.daily_resources}</span>
                <span>{t('Monthly resources reserved', '月资源预留')} {b.resources_month ?? 0}/{b.monthly_resources}</span>
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
