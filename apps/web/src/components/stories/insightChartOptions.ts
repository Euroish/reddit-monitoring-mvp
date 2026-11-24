import type { EChartOption } from '../charts/EChartBox';
import type { StoryInsights } from '../../contracts/api';

export interface ChartColorsPalette {
  ink: string;
  purple: string;
  wisteria: string;
  teal: string;
  apricot: string;
  citron: string;
  opal: string;
  muted: string;
  gridLine: string;
  reddit: string;
  x: string;
  bluesky: string;
  web: string;
}

export type CompositionDimension = 'channel' | 'source' | 'tier' | 'language';

export function buildActivityTrendOption(
  activityTrend: StoryInsights['activityTrend'],
  colors: ChartColorsPalette,
  activeFrom: string | undefined,
  lang: 'zh' | 'en',
): EChartOption {
  const categories = activityTrend.buckets.map((b) => b.bucket);
  return {
    grid: { top: 10, right: 8, bottom: 22, left: 30, containLabel: false },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (raw: unknown) => {
        const list = Array.isArray(raw) ? raw : [raw];
        const first = list[0] as { dataIndex?: number } | undefined;
        const idx = typeof first?.dataIndex === 'number' ? first.dataIndex : -1;
        const bucket = idx >= 0 ? activityTrend.buckets[idx] : undefined;
        if (!bucket) return '';
        const partialNote = bucket.isPartial
          ? lang === 'zh'
            ? '（进行中）'
            : ' (in progress)'
          : '';
        const unit = lang === 'zh' ? ' 条去重事件' : ' unique stories';
        return `<div style="font-size:12px;"><strong>${bucket.bucket}</strong>${partialNote}<br/>${bucket.count}${unit}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: colors.gridLine } },
      axisTick: { show: false },
      axisLabel: { color: colors.muted, fontSize: 10, interval: categories.length > 10 ? 'auto' : 0 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitNumber: 3,
      axisLabel: { color: colors.muted, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.gridLine, type: 'dashed' } },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 22,
        cursor: 'pointer',
        data: activityTrend.buckets.map((b) => {
          const isSelected = Boolean(activeFrom && b.from === activeFrom);
          return {
            value: b.count,
            itemStyle: {
              color: isSelected ? colors.purple : colors.teal,
              opacity: activeFrom && !isSelected ? 0.35 : b.isPartial ? 0.55 : 0.9,
              borderRadius: [3, 3, 0, 0],
              borderColor: b.isPartial ? colors.teal : undefined,
              borderWidth: b.isPartial ? 1 : 0,
              borderType: b.isPartial ? 'dashed' : 'solid',
            },
          };
        }),
      },
    ],
  };
}

export function buildHotKeywordsOption(
  items: StoryInsights['hotKeywords']['items'],
  colors: ChartColorsPalette,
  activeTerm: string | undefined,
  lang: 'zh' | 'en',
): EChartOption {
  const top = [...items].slice(0, 6).reverse();
  return {
    grid: { top: 4, right: 34, bottom: 8, left: 4, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (raw: unknown) => {
        const p = raw as { dataIndex?: number };
        const entry = typeof p.dataIndex === 'number' ? top[p.dataIndex] : undefined;
        if (!entry) return '';
        const unit = lang === 'zh' ? '条事件提及' : 'stories mention';
        return `<div style="font-size:12px;"><strong>${entry.displayTerm}</strong><br/>${entry.eventCount} ${unit} (${entry.sharePct}%)</div>`;
      },
    },
    xAxis: {
      type: 'value',
      show: false,
    },
    yAxis: {
      type: 'category',
      data: top.map((i) => i.displayTerm),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: colors.ink,
        fontSize: 11,
        width: 96,
        overflow: 'truncate',
      },
    },
    series: [
      {
        type: 'bar',
        barWidth: 11,
        cursor: 'pointer',
        data: top.map((item) => {
          const selected = Boolean(activeTerm && activeTerm.toLowerCase() === item.term.toLowerCase());
          return {
            value: item.eventCount,
            itemStyle: {
              color: selected ? colors.teal : colors.purple,
              opacity: activeTerm && !selected ? 0.38 : 0.88,
              borderRadius: [0, 3, 3, 0],
            },
          };
        }),
        label: {
          show: true,
          position: 'right',
          color: colors.muted,
          fontSize: 10,
          formatter: (p: { dataIndex: number }) => {
            const entry = top[p.dataIndex];
            return entry ? `${entry.eventCount}` : '';
          },
        },
      },
    ],
  };
}

export function buildCompositionOption(
  items: Array<{ key: string; label: string; count: number; sharePct: number; isOther?: boolean }>,
  colors: ChartColorsPalette,
  activeKey: string | undefined,
  lang: 'zh' | 'en',
): EChartOption {
  const palette = [colors.teal, colors.purple, colors.apricot, colors.wisteria, colors.web, colors.muted];
  const top = [...items].slice(0, 5).reverse();
  return {
    grid: { top: 4, right: 38, bottom: 8, left: 4, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (raw: unknown) => {
        const p = raw as { dataIndex?: number };
        const entry = typeof p.dataIndex === 'number' ? top[p.dataIndex] : undefined;
        if (!entry) return '';
        const unit = lang === 'zh' ? '条' : 'items';
        return `<div style="font-size:12px;"><strong>${entry.label}</strong><br/>${entry.count} ${unit} (${entry.sharePct}%)</div>`;
      },
    },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category',
      data: top.map((i) => i.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: colors.ink, fontSize: 11, width: 92, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        barWidth: 11,
        data: top.map((item, idx) => {
          const selected = Boolean(activeKey && activeKey === item.key);
          return {
            value: item.count,
            cursor: item.isOther ? 'default' : 'pointer',
            itemStyle: {
              color: item.isOther ? colors.muted : palette[(top.length - 1 - idx) % palette.length],
              opacity: activeKey && !selected ? 0.36 : item.isOther ? 0.55 : 0.9,
              borderRadius: [0, 3, 3, 0],
            },
          };
        }),
        label: {
          show: true,
          position: 'right',
          color: colors.muted,
          fontSize: 10,
          formatter: (p: { dataIndex: number }) => {
            const entry = top[p.dataIndex];
            return entry ? `${entry.sharePct.toFixed(0)}%` : '';
          },
        },
      },
    ],
  };
}

export function buildTopicsTreemapOption(
  items: StoryInsights['topics']['items'],
  colors: ChartColorsPalette,
  activeTopicId: string | undefined,
  lang: 'zh' | 'en',
): EChartOption {
  const palette = [colors.teal, colors.purple, colors.apricot, colors.wisteria, colors.web, colors.bluesky];
  return {
    tooltip: {
      trigger: 'item',
      formatter: (raw: unknown) => {
        const p = raw as { dataIndex?: number; data?: { topicId?: string } };
        const entry = items.find((i) => i.topicId === p.data?.topicId);
        if (!entry) return '';
        const kws = entry.keywords.slice(0, 4).join(' · ');
        const titles = entry.sampleTitles
          .slice(0, 2)
          .map((s) => `<div style="margin-top:2px;color:#cbd5e1;font-size:11px;max-width:240px;white-space:normal;">• ${s}</div>`)
          .join('');
        const unit = lang === 'zh' ? '条事件' : 'stories';
        return `<div style="font-size:12px;"><strong>${entry.label}</strong> (${entry.docCount} ${unit} · ${entry.sharePct}%)${
          kws ? `<div style="font-size:11px;opacity:0.9;">${kws}</div>` : ''
        }${titles}</div>`;
      },
    },
    series: [
      {
        type: 'treemap',
        width: '100%',
        height: '100%',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true,
          color: '#ffffff',
          fontSize: 11,
          lineHeight: 14,
          overflow: 'truncate',
          formatter: (p: { name: string; value: number }) => `${p.name}\n${p.value}`,
        },
        itemStyle: {
          borderColor: '#ffffff',
          borderWidth: 1.5,
          gapWidth: 1.5,
          borderRadius: 4,
        },
        data: items.map((item, idx) => {
          const selected = Boolean(activeTopicId && activeTopicId === item.topicId);
          return {
            name: item.label,
            value: item.docCount,
            topicId: item.topicId,
            isOther: item.isOther,
            itemStyle: {
              color: item.isOther ? colors.muted : palette[idx % palette.length],
              opacity: activeTopicId && !selected ? 0.38 : item.isOther ? 0.65 : 0.92,
              borderColor: selected ? colors.ink : '#ffffff',
              borderWidth: selected ? 2 : 1.5,
            },
          };
        }),
      },
    ],
  };
}
