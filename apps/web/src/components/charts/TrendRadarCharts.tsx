import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Activity, Layers, Network, ScatterChart } from 'lucide-react';
import type { PublicContent } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { EChartBox } from './EChartBox';
import { useChartColors } from './chartUtils';

interface TrendRadarChartsProps {
  items: PublicContent[];
  matchedCount: number;
  contentCount: number;
  onSelectContent?: (id: string) => void;
}

export function TrendRadarCharts({
  items,
  matchedCount,
  contentCount,
  onSelectContent,
}: TrendRadarChartsProps) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [rightChart, setRightChart] = useState<'treemap' | 'sankey' | 'funnel'>('treemap');

  // 1. ECharts Engagement × Comments × Provider Echo Scatter Bubble
  const { scatterPoints, treemapData, sankeyNodes, sankeyLinks, funnelData } = useMemo(() => {
    const bubblePain: Array<[number, number, number, string, string, string]> = [];
    const bubbleDisc: Array<[number, number, number, string, string, string]> = [];
    const subCountMap = new Map<string, { value: number; pain: number; platform: string }>();
    const flowCounts = new Map<string, number>();

    const painRe =
      /\b(broken|bug|slow|expensive|pricing|sucks|frustrated|unusable|churn|blocked|timeout|hate|pain|issue|fail(?:ed|ing)?|refund|friction|overage)\b|崩溃|卡顿|太贵|难用|踩坑|报错|封号|吐槽|痛/i;

    for (const item of items) {
      const latest = item.observations[item.observations.length - 1];
      const m = latest?.metrics || {};
      const score = Number(m['reddit.score'] ?? m['x.likes'] ?? m['bluesky.likes'] ?? 0);
      const comments = Number(m['reddit.num_comments'] ?? m['x.replies'] ?? m['bluesky.replies'] ?? 0);
      const providers = [...new Set(item.observations.map((o) => o.provider))];
      const isPain = painRe.test(`${item.title || ''} ${item.text || ''}`);
      const title = (item.title || item.text || item.externalId).slice(0, 48);
      const tuple: [number, number, number, string, string, string] = [
        Math.max(0, score),
        Math.max(0, comments),
        providers.length,
        title,
        item.id,
        item.platform,
      ];
      if (isPain) bubblePain.push(tuple);
      else bubbleDisc.push(tuple);

      const commKey =
        (item.platformDetails?.subreddit as string) ||
        (item.platformDetails?.community as string) ||
        (item.platform === 'x' ? '@X-Stream' : item.platform === 'bluesky' ? 'Bluesky' : 'Web-Index');
      const prev = subCountMap.get(commKey) || { value: 0, pain: 0, platform: item.platform };
      prev.value += Math.max(10, Math.round(score / 4) + comments);
      prev.pain += isPain ? 1 : 0;
      subCountMap.set(commKey, prev);

      for (const p of providers) {
        const edge1 = `${p}__${item.platform}`;
        flowCounts.set(edge1, (flowCounts.get(edge1) || 0) + 1);
      }
      const edge2 = `${item.platform}__${item.kind}`;
      flowCounts.set(edge2, (flowCounts.get(edge2) || 0) + 1);
    }

    const tree = [...subCountMap.entries()].map(([name, info]) => ({
      name,
      value: info.value,
      itemStyle: {
        color:
          info.platform === 'reddit'
            ? colors.reddit
            : info.platform === 'x'
              ? colors.ink
              : info.platform === 'bluesky'
                ? colors.teal
                : colors.apricot,
      },
    }));

    const nodeNames = new Set<string>();
    const links: Array<{ source: string; target: string; value: number }> = [];
    for (const [k, value] of flowCounts.entries()) {
      const [source, target] = k.split('__');
      nodeNames.add(source);
      nodeNames.add(target);
      links.push({ source, target, value });
    }

    const funnel = [
      { value: Math.max(contentCount, items.length), name: t('Dedup Threads', '去重讨论根') },
      { value: matchedCount, name: t('Matched Nodes', '命中节点总数') },
      { value: items.length, name: t('Loaded Sample', '当前加载样本') },
      { value: bubblePain.length, name: t('Pain Signal Hits', '痛点特征命中') },
    ];

    return {
      scatterPoints: { bubblePain, bubbleDisc },
      treemapData: tree,
      sankeyNodes: [...nodeNames].map((name) => ({ name })),
      sankeyLinks: links,
      funnelData: funnel,
    };
  }, [items, matchedCount, contentCount, colors, t]);

  const scatterOption: EChartsOption = useMemo(
    () => ({
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1b221a',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 11 },
        formatter: (params: unknown) => {
          const d = (params as { value: [number, number, number, string, string, string] }).value;
          return `<div style="max-width:240px;white-space:normal"><b>${d[3]}</b><br/>${t('Score', '热度')}: ${d[0]} · ${t('Replies', '评论')}: ${d[1]} · ${t('Providers', '发现渠道')}: ${d[2]}<br/><span style="color:#dbf477">${t('Click bubble to inspect thread', '点击气泡打开讨论抽屉 →')}</span></div>`;
        },
      },
      legend: {
        top: 0,
        right: 8,
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: colors.muted, fontSize: 10.5 },
      },
      grid: { left: 44, right: 20, top: 32, bottom: 32 },
      xAxis: {
        name: t('Score / Likes', '互动热度'),
        nameLocation: 'middle',
        nameGap: 20,
        nameTextStyle: { color: colors.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: colors.gridLine, type: 'dashed' } },
        axisLabel: { color: '#8b9388', fontSize: 10 },
      },
      yAxis: {
        name: t('Comments', '评论数'),
        nameTextStyle: { color: colors.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: colors.gridLine, type: 'dashed' } },
        axisLabel: { color: '#8b9388', fontSize: 10 },
      },
      series: [
        {
          name: t('Pain Signals', '痛点强信号'),
          type: 'scatter',
          symbolSize: (val: number[]) => Math.min(34, 12 + (val[2] || 1) * 7),
          itemStyle: { color: colors.apricot, opacity: 0.88, borderColor: '#fff', borderWidth: 1.5 },
          data: scatterPoints.bubblePain,
        },
        {
          name: t('Discussion Threads', '常规高热讨论'),
          type: 'scatter',
          symbolSize: (val: number[]) => Math.min(32, 11 + (val[2] || 1) * 6),
          itemStyle: { color: colors.purple, opacity: 0.82, borderColor: '#fff', borderWidth: 1.5 },
          data: scatterPoints.bubbleDisc,
        },
      ],
    }),
    [scatterPoints, colors, t],
  );

  const rightOption: EChartsOption = useMemo(() => {
    if (rightChart === 'treemap') {
      return {
        tooltip: {
          backgroundColor: '#1b221a',
          borderWidth: 0,
          textStyle: { color: '#fff', fontSize: 11 },
        },
        series: [
          {
            type: 'treemap',
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            itemStyle: { borderColor: '#ffffff', borderWidth: 2, gapWidth: 2, borderRadius: 4 },
            label: { show: true, formatter: '{b}\n{c}', fontSize: 10.5, color: '#ffffff' },
            data: treemapData,
          },
        ],
      };
    }
    if (rightChart === 'sankey') {
      return {
        tooltip: {
          trigger: 'item',
          backgroundColor: '#1b221a',
          borderWidth: 0,
          textStyle: { color: '#fff', fontSize: 11 },
        },
        series: [
          {
            type: 'sankey',
            layoutIterations: 16,
            emphasis: { focus: 'adjacency' },
            nodeGap: 10,
            nodeWidth: 12,
            label: { fontSize: 10, color: colors.ink },
            lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.35 },
            itemStyle: { color: colors.teal, borderWidth: 0 },
            data: sankeyNodes,
            links: sankeyLinks,
          },
        ],
      };
    }
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1b221a',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 11 },
      },
      series: [
        {
          type: 'funnel',
          left: '10%',
          top: 12,
          bottom: 12,
          width: '80%',
          sort: 'descending',
          gap: 3,
          label: { show: true, position: 'inside', fontSize: 10.5, color: '#ffffff' },
          itemStyle: { borderColor: '#fff', borderWidth: 1 },
          color: [colors.ink, colors.purple, colors.teal, colors.apricot, colors.wisteria],
          data: funnelData,
        },
      ],
    };
  }, [rightChart, treemapData, sankeyNodes, sankeyLinks, funnelData, colors]);

  return (
    <>
      <div className="c7" id="card-scatter-radar">
        <div className="ds-card" style={{ height: '100%' }}>
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title">
                <ScatterChart size={14} color={colors.purple} />
                <span>{t('Engagement × Depth Bubble Matrix', '互动 × 深度气泡矩阵')}</span>
              </div>
              <div className="ds-card-sub">
                {t('Bubble size = multi-provider echoes; click any bubble to open drawer', '气泡大小代表多渠道交叉验证次数，点击气泡直达原帖抽屉')}
              </div>
            </div>
            <span className="tag tag--lilac" style={{ height: 20, fontSize: 9.5 }}>ECharts Scatter</span>
          </div>
          <div className="ds-card-bd">
            <EChartBox
              option={scatterOption}
              height={240}
              onEvents={
                onSelectContent
                  ? {
                      click: (params: unknown) => {
                        const val = (params as { value?: unknown[] }).value;
                        const id = typeof val?.[4] === 'string' ? val[4] : undefined;
                        if (id) onSelectContent(id);
                      },
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      <div className="c5" id="card-topology-lab">
        <div className="ds-card" style={{ height: '100%' }}>
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title">
                {rightChart === 'treemap' ? <Layers size={14} color={colors.teal} /> : rightChart === 'sankey' ? <Network size={14} color={colors.teal} /> : <Activity size={14} color={colors.teal} />}
                <span>
                  {rightChart === 'treemap'
                    ? t('Community Signal Treemap', '社区热点矩形树图')
                    : rightChart === 'sankey'
                      ? t('Provider → Platform → Kind Flow', '采集渠道 → 平台 → 形态桑基流向')
                      : t('Signal Qualification Funnel', '信号漏斗转化')}
                </span>
              </div>
              <div className="ds-card-sub">
                {t('Switch chart topology to explore clusters and attribution paths', '切换多元图谱：矩树热点 · 桑基流向 · 信号筛选漏斗')}
              </div>
            </div>
            <div className="seg">
              <button type="button" className={rightChart === 'treemap' ? 'on' : ''} onClick={() => setRightChart('treemap')}>
                {t('Treemap', '矩树')}
              </button>
              <button type="button" className={rightChart === 'sankey' ? 'on' : ''} onClick={() => setRightChart('sankey')}>
                {t('Sankey', '桑基')}
              </button>
              <button type="button" className={rightChart === 'funnel' ? 'on' : ''} onClick={() => setRightChart('funnel')}>
                {t('Funnel', '漏斗')}
              </button>
            </div>
          </div>
          <div className="ds-card-bd">
            <EChartBox option={rightOption} height={240} />
          </div>
        </div>
      </div>
    </>
  );
}
