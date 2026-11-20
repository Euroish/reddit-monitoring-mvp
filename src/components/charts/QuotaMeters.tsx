import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { ProviderBudget } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { EChartBox, useChartColors } from './EChartBox';

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
    const dailyPcts = budgets.map((b) =>
      b.daily_requests <= 0 ? 100 : Math.min(100, Math.round(((b.used_daily_requests ?? 0) / b.daily_requests) * 100)),
    );
    const monthlyPcts = budgets.map((b) =>
      b.monthly_requests <= 0 ? 100 : Math.min(100, Math.round(((b.used_monthly_requests ?? 0) / b.monthly_requests) * 100)),
    );

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
            '配额表展示服务端保守预留额度（请求与资源上限），不等同于第三方渠道实际账单；0 上限或接近上限时会自动标记并拦截自动采集。',
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
          const dailyPct = b.daily_requests <= 0 ? 100 : Math.min(100, Math.round(((b.used_daily_requests ?? 0) / b.daily_requests) * 100));
          const monthlyPct = b.monthly_requests <= 0 ? 100 : Math.min(100, Math.round(((b.used_monthly_requests ?? 0) / b.monthly_requests) * 100));
          const meterClass = dailyPct > 85 ? 'hot' : dailyPct > 65 ? 'warn' : '';
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
                <span className="bc-rev">rev {b.revision}</span>
              </div>

              <div className="bc-meter">
                <div className="bm-top">
                  <span>{t('Daily Req', '日请求')}</span>
                  <b>{b.daily_requests === 0 ? '0 cap' : `${dailyPct}%`}</b>
                </div>
                <div className="meter">
                  <i className={meterClass} style={{ width: `${dailyPct}%` }} />
                </div>
              </div>

              <div className="bc-meter">
                <div className="bm-top">
                  <span>{t('Monthly Req', '月请求')}</span>
                  <b>{b.monthly_requests === 0 ? '0 cap' : `${monthlyPct}%`}</b>
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
