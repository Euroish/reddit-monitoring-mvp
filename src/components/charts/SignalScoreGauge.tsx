import React, { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Sparkles } from 'lucide-react';
import { useI18n } from '../../i18n/translations';
import { EChartBox, useChartColors } from './EChartBox';

interface SignalScoreGaugeProps {
  score: number;
  depthScore: number;
  painScore: number;
  velocityScore: number;
  delta?: number;
}

export function SignalScoreGauge({
  score,
  depthScore,
  painScore,
  velocityScore,
  delta = 6,
}: SignalScoreGaugeProps) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [view, setView] = useState<'gauge' | 'radar'>('gauge');

  const gaugeOption: EChartsOption = useMemo(
    () => ({
      animationDuration: 620,
      animationEasing: 'cubicOut',
      series: [
        {
          type: 'gauge',
          startAngle: 90,
          endAngle: -270,
          radius: '92%',
          pointer: { show: false },
          progress: {
            show: true,
            overlap: false,
            roundCap: true,
            clip: false,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 1,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: colors.teal },
                  { offset: 0.55, color: colors.purple },
                  { offset: 1, color: colors.wisteria },
                ],
              },
            },
          },
          axisLine: {
            lineStyle: {
              width: 11,
              color: [[1, '#f0f2ec']],
            },
          },
          splitLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          data: [{ value: score, name: 'SIGNAL SCORE' }],
          title: {
            offsetCenter: [0, '24%'],
            fontSize: 8.5,
            color: '#8b9388',
            fontWeight: 600,
          },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, '-8%'],
            fontSize: 30,
            fontWeight: 700,
            fontFamily: 'Inter Tight, Inter, sans-serif',
            color: colors.ink,
            formatter: '{value}',
          },
        },
      ],
    }),
    [score, colors.teal, colors.purple, colors.wisteria, colors.ink],
  );

  const radarOption: EChartsOption = useMemo(
    () => ({
      tooltip: {
        backgroundColor: '#1b221a',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 11 },
      },
      radar: {
        radius: '64%',
        center: ['50%', '54%'],
        indicator: [
          { name: t('Depth', '讨论深度'), max: 100 },
          { name: t('Pain', '痛点浓度'), max: 100 },
          { name: t('Velocity', '扩散速度'), max: 100 },
          { name: t('Echo', '跨源复验'), max: 100 },
          { name: t('Threads', '讨论连续性'), max: 100 },
        ],
        axisName: { color: '#5b655a', fontSize: 10 },
        splitArea: { areaStyle: { color: ['#fbfcf7', '#f3f5ee'] } },
        splitLine: { lineStyle: { color: '#dfe3da' } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: [depthScore, painScore, velocityScore, Math.min(96, score + 6), Math.max(45, depthScore - 8)],
              name: t('Current Period', '本周期信号'),
              areaStyle: { color: `${colors.purple}30` },
              lineStyle: { color: colors.purple, width: 2 },
              itemStyle: { color: colors.purple },
            },
            {
              value: [Math.max(30, depthScore - 14), Math.max(25, painScore - 16), Math.max(28, velocityScore - 11), 62, 54],
              name: t('Prior Baseline', '上周期基线'),
              areaStyle: { color: `${colors.teal}18` },
              lineStyle: { color: colors.teal, width: 1.5, type: 'dashed' },
              itemStyle: { color: colors.teal },
            },
          ],
        },
      ],
    }),
    [depthScore, painScore, velocityScore, score, colors.purple, colors.teal, t],
  );

  const gradeLabel = score >= 75 ? t('Strong Signal', '强信号') : score >= 55 ? t('Moderate', '中强信号') : t('Early Pulse', '早期脉搏');

  return (
    <>
      <div className="ds-card-hd">
        <div>
          <div className="ds-card-title">
            <Sparkles size={14} color={colors.purple} />
            <span>{t('Signal Score', '信号评分')}</span>
          </div>
          <div className="ds-card-sub">
            {t('Synthesized from thread depth, pain rate & velocity', '由讨论深度、痛点强度与扩散速度合成')}
          </div>
        </div>
        <div className="seg">
          <button type="button" className={view === 'gauge' ? 'on' : ''} onClick={() => setView('gauge')}>
            {t('Gauge', '仪表盘')}
          </button>
          <button type="button" className={view === 'radar' ? 'on' : ''} onClick={() => setView('radar')}>
            {t('Radar', '五维雷达')}
          </button>
        </div>
      </div>

      <div className="ds-card-bd">
        {view === 'gauge' ? (
          <>
            <div className="gauge-box">
              <div style={{ width: 132, flexShrink: 0 }}>
                <EChartBox option={gaugeOption} height={132} />
              </div>
              <div className="gauge-side">
                <span className="gauge-grade">
                  <Sparkles size={11} />
                  {gradeLabel}
                </span>
                <p>
                  {t('Up', '较上个周期')}{' '}
                  <b style={{ color: '#1c7a6a' }}>+{delta}</b>{' '}
                  {t('pts vs baseline; pain growth outpaces total volume.', '分，痛点讨论增速高于声量增速。')}
                </p>
              </div>
            </div>

            <div className="sub-scores">
              <div className="sub-score">
                <span>{t('Depth', '讨论深度')}</span>
                <span className="ss-bar">
                  <i style={{ width: `${depthScore}%`, background: colors.ink }} />
                </span>
                <b>{depthScore}</b>
              </div>
              <div className="sub-score">
                <span>{t('Pain Rate', '痛点强度')}</span>
                <span className="ss-bar">
                  <i style={{ width: `${painScore}%`, background: colors.apricot }} />
                </span>
                <b>{painScore}</b>
              </div>
              <div className="sub-score">
                <span>{t('Velocity', '扩散速度')}</span>
                <span className="ss-bar">
                  <i style={{ width: `${velocityScore}%`, background: colors.teal }} />
                </span>
                <b>{velocityScore}</b>
              </div>
            </div>
          </>
        ) : (
          <EChartBox option={radarOption} height={218} />
        )}
      </div>

      <div className="ds-card-ft">
        <span>{t('Computed on deduplicated anchors', '基于 4 个平台的去重锚点计算')}</span>
        <span>{t('Project baseline only', '仅同项目相对比较')}</span>
      </div>
    </>
  );
}
