import { useCallback, useMemo } from 'react';
import { Globe, Info, Layers, Link2 } from 'lucide-react';
import type { OverviewFacet, Platform, PublicContent } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { EChartBox, type EChartOption } from './EChartBox';
import { useChartColors } from './chartUtils';

interface DistributionCardsProps {
  facets: OverviewFacet[];
  providers: string[];
  contentItems: PublicContent[];
  onDrillPlatform?: (platform: Platform) => void;
}

export function DistributionCards({
  facets,
  providers,
  contentItems,
  onDrillPlatform,
}: DistributionCardsProps) {
  const { t } = useI18n();
  const colors = useChartColors();

  const platformColor = useCallback(
    (p: string) =>
      p === 'reddit' ? colors.reddit : p === 'x' ? colors.x : p === 'bluesky' ? colors.bluesky : colors.web,
    [colors.reddit, colors.x, colors.bluesky, colors.web],
  );

  const platformRows = useMemo(() => {
    const raw = facets.filter((f) => f.day_group === 1 && f.platform_group === 0 && f.platform !== null);
    const total = Math.max(1, raw.reduce((s, r) => s + r.count, 0));
    return raw
      .map((r) => ({
        key: r.platform as Platform,
        label: r.platform === 'x' ? 'X' : r.platform === 'reddit' ? 'Reddit' : r.platform === 'bluesky' ? 'Bluesky' : 'Web',
        count: r.count,
        matched: r.matchedContentCount,
        pct: Math.round((r.count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }, [facets]);

  const kindRows = useMemo(() => {
    const raw = facets.filter((f) => f.day_group === 1 && f.kind_group === 0 && f.kind !== null);
    const total = Math.max(1, raw.reduce((s, r) => s + r.count, 0));
    return raw
      .map((r) => ({
        key: r.kind!,
        label:
          r.kind === 'post'
            ? t('Posts', '帖文')
            : r.kind === 'comment'
              ? t('Comments', '评论')
              : t('Articles', '文章'),
        count: r.count,
        pct: Math.round((r.count / total) * 100),
        color:
          r.kind === 'post'
            ? colors.ink
            : r.kind === 'comment'
              ? colors.purple
              : colors.teal,
      }))
      .sort((a, b) => b.count - a.count);
  }, [facets, colors.ink, colors.purple, colors.teal, t]);

  const providerCounts = useMemo(() => {
    const map = new Map<string, number>();
    providers.forEach((p) => map.set(p, 0));
    contentItems.forEach((item) => {
      const seen = new Set(item.observations.map((o) => o.provider));
      seen.forEach((prov) => map.set(prov, (map.get(prov) || 0) + 1));
    });
    return [...map.entries()]
      .map(([name, val]) => ({ name, val }))
      .sort((a, b) => b.val - a.val);
  }, [providers, contentItems]);

  const platformOption: EChartOption = useMemo(() => {
    const rev = [...platformRows].reverse();
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        backgroundColor: '#1b221a',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 11 },
      },
      grid: { left: 62, right: 44, top: 6, bottom: 6 },
      xAxis: { type: 'value', show: false, max: (v: { max: number }) => Math.max(1, v.max) },
      yAxis: {
        type: 'category',
        data: rev.map((r) => r.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: colors.ink, fontSize: 11, fontWeight: 550 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 11,
          showBackground: true,
          backgroundStyle: { color: '#f3f5ee', borderRadius: 4 },
          label: {
            show: true,
            position: 'right',
            fontSize: 10.5,
            fontFamily: 'ui-monospace, monospace',
            color: colors.muted,
            formatter: (params: unknown) => {
              const idx = (params as { dataIndex: number }).dataIndex;
              return `${rev[idx]?.pct ?? 0}%`;
            },
          },
          data: rev.map((r) => ({
            value: r.count,
            itemStyle: { color: platformColor(r.key), borderRadius: 4 },
          })),
        },
      ],
    };
  }, [platformRows, colors, platformColor]);

  const kindOption: EChartOption = useMemo(() => {
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        backgroundColor: '#1b221a',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 11 },
      },
      legend: {
        bottom: 4,
        left: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: '#5b655a', fontSize: 10.5 },
      },
      grid: { left: 4, right: 4, top: 20, bottom: 38 },
      xAxis: { type: 'value', max: 100, show: false },
      yAxis: { type: 'category', data: ['Kind'], show: false },
      series: kindRows.map((k, idx) => ({
        name: `${k.label} (${k.pct}%)`,
        type: 'bar',
        stack: 'total',
        barWidth: 26,
        itemStyle: {
          color: k.color,
          borderRadius:
            kindRows.length === 1
              ? [4, 4, 4, 4]
              : idx === 0
                ? [4, 0, 0, 4]
                : idx === kindRows.length - 1
                  ? [0, 4, 4, 0]
                  : [0, 0, 0, 0],
        },
        data: [k.pct],
      })),
    };
  }, [kindRows]);

  const attributionOption: EChartOption = useMemo(() => {
    const rev = [...providerCounts].reverse();
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'none' },
        backgroundColor: '#1b221a',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 11 },
      },
      grid: { left: 96, right: 38, top: 6, bottom: 6 },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        data: rev.map((r) => r.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: colors.ink, fontSize: 10, fontFamily: 'ui-monospace, monospace' },
      },
      series: [
        {
          type: 'bar',
          barWidth: 8,
          showBackground: true,
          backgroundStyle: { color: '#f2f4ed', borderRadius: 99 },
          label: {
            show: true,
            position: 'right',
            fontSize: 10,
            fontFamily: 'ui-monospace, monospace',
            color: colors.muted,
          },
          itemStyle: {
            borderRadius: 99,
            color: colors.purple,
          },
          data: rev.map((r) => r.val),
        },
      ],
    };
  }, [providerCounts, colors]);

  const topPlatform = platformRows[0];

  return (
    <>
      <div className="c5" id="card-platform">
        <div className="ds-card" style={{ height: '100%' }}>
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title">
                <Globe size={14} color="var(--faint)" />
                <span>{t('Platform Composition', '平台构成')}</span>
              </div>
              <div className="ds-card-sub">
                {t('Counted on deduplicated anchors (never engagement sums)', '按去重锚点数统计 · 非互动指标相加')}
              </div>
            </div>
          </div>

          <div className="ds-card-bd">
            <EChartBox
              option={platformOption}
              height={156}
              onEvents={
                onDrillPlatform
                  ? {
                      click: (params: unknown) => {
                        const name = (params as { name?: string }).name?.toLowerCase();
                        if (name === 'reddit' || name === 'x' || name === 'bluesky' || name === 'web') {
                          onDrillPlatform(name as Platform);
                        }
                      },
                    }
                  : undefined
              }
            />
          </div>

          <div className="ds-card-ft">
            <span>
              {topPlatform
                ? `${topPlatform.label} ${t('accounts for', '占比')} ${topPlatform.pct}% (${topPlatform.count})`
                : t('No platform facets', '暂无平台统计')}
            </span>
            {onDrillPlatform && topPlatform && (
              <button type="button" onClick={() => onDrillPlatform(topPlatform.key)}>
                {t('Drilldown →', '钻取内容 →')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="c4" id="card-kind">
        <div className="ds-card" style={{ height: '100%' }}>
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title">
                <Layers size={14} color="var(--faint)" />
                <span>{t('Content Morphology', '内容形态')}</span>
              </div>
              <div className="ds-card-sub">{t('Post / Comment / Article split', '帖文 / 评论 / 文章构成')}</div>
            </div>
          </div>

          <div className="ds-card-bd">
            <EChartBox option={kindOption} height={156} />
          </div>

          <div className="ds-card-ft">
            <span>{t('Nodes with non-empty body/root', '仅统计有效正文或根锚点节点')}</span>
            <span className="tag tag--line" style={{ height: 18, fontSize: 9 }}>kind_group = 0</span>
          </div>
        </div>
      </div>

      <div className="c3" id="card-attribution">
        <div className="ds-card" style={{ height: '100%' }}>
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title">
                <Link2 size={14} color="var(--faint)" />
                <span>{t('Channel Attribution', '渠道归因')}</span>
              </div>
              <div className="ds-card-sub">{t('Same content may overlap providers', '同一内容可被多渠道发现')}</div>
            </div>
          </div>

          <div className="ds-card-bd">
            <EChartBox option={attributionOption} height={126} />
            <div style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.5, marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--line)', display: 'flex', gap: 5 }}>
              <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                {t(
                  'Non-exclusive counts; totals can exceed 100% — no pie chart rendered.',
                  '非互斥统计，各渠道发现数总和可超 100%，严格不绘制饼图。',
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
