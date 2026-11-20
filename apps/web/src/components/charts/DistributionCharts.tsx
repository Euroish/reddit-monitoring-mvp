import { useCallback, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Globe, Info, Layers, Link2 } from 'lucide-react';
import type { OverviewFacet, Platform, PublicContent } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { EChartBox } from './EChartBox';
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

  const [platChartMode, setPlatChartMode] = useState<'bar' | 'rose'>('bar');
  const [kindChartMode, setKindChartMode] = useState<'stack' | 'sunburst'>('stack');

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

  const platformOption: EChartsOption = useMemo(() => {
    if (platChartMode === 'rose') {
      return {
        tooltip: {
          trigger: 'item',
          backgroundColor: '#1b221a',
          borderWidth: 0,
          textStyle: { color: '#fff', fontSize: 11 },
          formatter: '{b}: {c} ({d}%)',
        },
        series: [
          {
            type: 'pie',
            roseType: 'radius',
            radius: ['28%', '76%'],
            center: ['50%', '52%'],
            itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
            label: { fontSize: 10.5, color: colors.ink, formatter: '{b} {d}%' },
            data: platformRows.map((r) => ({
              name: r.label,
              value: r.count,
              itemStyle: { color: platformColor(r.key) },
            })),
          },
        ],
      };
    }

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
      xAxis: { type: 'value', show: false, max: (v) => Math.max(1, v.max) },
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
            fontFamily: 'JetBrains Mono, monospace',
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
  }, [platChartMode, platformRows, colors, platformColor]);

  const kindOption: EChartsOption = useMemo(() => {
    if (kindChartMode === 'sunburst') {
      const hierarchy = (['reddit', 'x', 'bluesky', 'web'] as Platform[])
        .map((p) => {
          const items = contentItems.filter((c) => c.platform === p);
          if (!items.length) return null;
          const byK = new Map<string, number>();
          items.forEach((c) => byK.set(c.kind, (byK.get(c.kind) || 0) + 1));
          return {
            name: p === 'x' ? 'X' : p.charAt(0).toUpperCase() + p.slice(1),
            itemStyle: { color: platformColor(p) },
            children: [...byK.entries()].map(([k, val], ki) => ({
              name: k,
              value: val,
              itemStyle: { opacity: Math.max(0.55, 1 - ki * 0.18), color: platformColor(p) },
            })),
          };
        })
        .filter(Boolean);

      return {
        tooltip: {
          backgroundColor: '#1b221a',
          borderWidth: 0,
          textStyle: { color: '#fff', fontSize: 11 },
        },
        series: [
          {
            type: 'sunburst',
            radius: ['18%', '84%'],
            itemStyle: { borderRadius: 3, borderColor: '#fff', borderWidth: 1.5 },
            label: { fontSize: 9.5, minAngle: 20, rotate: 'radial' },
            data: hierarchy as never,
          },
        ],
      };
    }

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
  }, [kindChartMode, kindRows, contentItems, platformColor]);

  const attributionOption: EChartsOption = useMemo(() => {
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
        axisLabel: { color: colors.ink, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
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
            fontFamily: 'JetBrains Mono, monospace',
            color: colors.muted,
          },
          itemStyle: {
            borderRadius: 99,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: colors.purple },
                { offset: 1, color: colors.wisteria },
              ],
            },
          },
          data: rev.map((r) => r.val),
        },
      ],
    };
  }, [providerCounts, colors]);

  const topPlatform = platformRows[0];

  return (
    <>
      {/* c5 Platform Breakdown */}
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
            <div className="seg">
              <button type="button" className={platChartMode === 'bar' ? 'on' : ''} onClick={() => setPlatChartMode('bar')}>
                {t('Bar', '条形')}
              </button>
              <button type="button" className={platChartMode === 'rose' ? 'on' : ''} onClick={() => setPlatChartMode('rose')}>
                {t('Rose', '南丁格尔')}
              </button>
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

      {/* c4 Content Morphology */}
      <div className="c4" id="card-kind">
        <div className="ds-card" style={{ height: '100%' }}>
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title">
                <Layers size={14} color="var(--faint)" />
                <span>{t('Content Morphology', '内容形态')}</span>
              </div>
              <div className="ds-card-sub">{t('Post / Comment / Article hierarchy', '帖文 / 评论 / 文章层级分布')}</div>
            </div>
            <div className="seg">
              <button type="button" className={kindChartMode === 'stack' ? 'on' : ''} onClick={() => setKindChartMode('stack')}>
                {t('Stack', '堆叠')}
              </button>
              <button type="button" className={kindChartMode === 'sunburst' ? 'on' : ''} onClick={() => setKindChartMode('sunburst')}>
                {t('Sunburst', '旭日图')}
              </button>
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

      {/* c3 Non-exclusive Channel Attribution (NEVER pie chart!) */}
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
