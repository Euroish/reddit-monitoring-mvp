import { useEffect, useRef } from "react";
import { init, use as register, type ComposeOption } from "echarts/core";
import { BarChart, LineChart, ScatterChart, type BarSeriesOption, type LineSeriesOption, type ScatterSeriesOption } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, MarkLineComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ContentObservation } from "../../../../packages/contracts/src/source-content";
import type { StoryFeed } from "../../../../packages/contracts/src/content-stories";

register([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

export type PulseBucket = { from: string; byPlatform: { platform: string; count: number }[] };
type Choice = { from: string; platform?: string };
type Props =
  | { kind: "pulse"; buckets: PulseBucket[]; onPick: (choice: Choice) => void }
  | { kind: "observations"; observations: ContentObservation[]; sources: ReadonlyMap<string, string> }
  | { kind: "heat"; stories: StoryFeed["items"] };

type Option = ComposeOption<BarSeriesOption | LineSeriesOption | ScatterSeriesOption>;
const palette = ["#14635f", "#2f5ea8", "#b84327", "#7c5a99"];
const hatch = { symbol: "rect" as const, dashArrayX: [1, 0], dashArrayY: [3, 5], rotation: Math.PI / 4 };
const base = {
  animation: false, color: palette,
  grid: { top: 48, right: 18, bottom: 36, left: 58 },
  legend: { type: "scroll" as const },
  tooltip: { trigger: "item" as const, renderMode: "richText" as const, confine: true },
};

function chartOption(props: Props): Option {
  if (props.kind === "pulse") {
    const platforms = [...new Set(props.buckets.flatMap(bucket => bucket.byPlatform.map(item => item.platform)))];
    const max = Math.max(1, ...props.buckets.flatMap(bucket => bucket.byPlatform.map(item => item.count)));
    return {
      ...base,
      xAxis: { type: "category", data: props.buckets.map(bucket => bucket.from.slice(5, 10)) },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        ...platforms.map((platform): BarSeriesOption => ({
          name: platform, type: "bar",
          data: props.buckets.map(bucket => bucket.byPlatform.find(item => item.platform === platform)?.count ?? null),
          label: { show: true, position: "top", formatter: ({ value }) => value === 0 ? "0" : "" },
        })),
        { name: "覆盖未知", type: "bar", barGap: "-100%",
          data: props.buckets.map(bucket => bucket.byPlatform.length ? null : max),
          itemStyle: { color: "#e3e6dc", decal: hatch },
          tooltip: { formatter: "覆盖未知" },
        },
      ],
    };
  }
  if (props.kind === "heat") {
    const comparable = props.stories.filter(story => story.change6h !== null);
    const median = comparable.map(story => story.heat48h).sort((a, b) => a - b)[Math.floor(comparable.length / 2)] ?? 0;
    return {
      ...base, xAxis: { type: "value", name: "48 小时热度", nameLocation: "middle", nameGap: 24 },
      yAxis: { type: "value", name: "6 小时变化", axisLabel: { formatter: "{value}%" } },
      series: [{ type: "scatter", data: comparable.map(story => ({
        name: story.representative.title, value: [story.heat48h, Math.round(story.change6h! * 100)],
      })), markLine: { silent: true, symbol: "none", label: { show: false }, data: [{ xAxis: median }, { yAxis: 0 }] } }],
    };
  }
  const series = new Map<string, { name: string; points: [number, number | null][] }>();
  for (const observation of props.observations) {
    for (const [metric, value] of Object.entries(observation.metrics)) {
      const key = JSON.stringify([observation.sourceId, observation.provider, metric]);
      let line = series.get(key);
      if (!line) {
        const label = props.sources.get(observation.sourceId) ?? "来源";
        line = { name: `${label} · ${observation.provider} · ${metric} · ${observation.sourceId.slice(0, 8)}`, points: [] };
        series.set(key, line);
      }
      line.points.push([Date.parse(observation.sourceObservedAt ?? observation.fetchedAt), value]);
    }
  }
  return {
    ...base, xAxis: { type: "time" }, yAxis: { type: "value" },
    series: [...series.values()].map(({ name, points }) => ({
      name, type: "line", connectNulls: false, data: points.sort(([a], [b]) => a - b),
    })),
  };
}

export default function AnalysisChart(props: Props) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof init> | null>(null);
  useEffect(() => {
    const instance = init(element.current!, undefined, { renderer: "canvas" });
    chart.current = instance;
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(element.current!);
    return () => { resize.disconnect(); instance.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    const instance = chart.current!;
    instance.setOption(chartOption(props), { notMerge: true });
    const click = (event: { dataIndex: number; seriesName?: string; value?: unknown }) => {
      if (props.kind !== "pulse" || event.seriesName === "覆盖未知" || event.value == null) return;
      const bucket = props.buckets[event.dataIndex];
      if (bucket) props.onPick({ from: bucket.from, platform: event.seriesName });
    };
    instance.on("click", click);
    return () => { instance.off("click", click); };
  }, [props]);
  return <div ref={element} className="analysis-chart" aria-label={
    props.kind === "pulse" ? "按日与平台的内容量" : props.kind === "heat" ? "事件热度与增速四象限" : "采集指标时间序列"
  } role="img" />;
}
