import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Static } from "@sinclair/typebox";
import type { ContentFacets } from "../../../../packages/contracts/src/source-content";
import type { StoryFeed } from "../../../../packages/contracts/src/content-stories";
import { api } from "../api";
import LazyChart from "./LazyChart";
import PulseChart from "./PulseChart";
import { dailyBuckets } from "./buckets";

const day = 86_400_000;
export default function ContentAnalysis({ scope, onPick }: {
  scope: string;
  onPick: (choice: { from: string; platform?: string }) => void;
}) {
  const [view, setView] = useState<"pulse" | "heat">("pulse");
  const filters = new URLSearchParams(scope);
  const [today] = useState(() => Math.floor(Date.now() / day) * day);
  const requestedTo = Date.parse(filters.get("to") ?? "");
  const to = Number.isFinite(requestedTo) ? requestedTo : today + day;
  const requestedFrom = Date.parse(filters.get("from") ?? "");
  const from = Math.max(to - 90 * day, Number.isFinite(requestedFrom) ? requestedFrom : to - 14 * day);
  const valid = to > from;
  const facetQuery = new URLSearchParams(filters);
  facetQuery.set("from", new Date(from).toISOString());
  facetQuery.set("to", new Date(to).toISOString());
  const facets = useQuery({
    queryKey: ["content-facets", facetQuery.toString()],
    queryFn: () => api<Static<typeof ContentFacets>>(`/content/facets?${facetQuery}`),
    enabled: valid && view === "pulse",
  });
  const storiesQuery = new URLSearchParams({ view: "hot", limit: "50" });
  for (const field of ["sourceId", "sourceGroup", "platform", "tier", "language"]) {
    const value = filters.get(field);
    if (value) storiesQuery.set(field, value);
  }
  const stories = useQuery({
    queryKey: ["stories", storiesQuery.toString()],
    queryFn: () => api<StoryFeed>(`/content/stories?${storiesQuery}`),
    enabled: view === "heat",
  });
  const result = view === "pulse" ? facets : stories;
  return <section className="panel">
    <div className="facets" aria-label="分析视图">
      <button aria-pressed={view === "pulse"} onClick={() => setView("pulse")}>内容量</button>
      <button aria-pressed={view === "heat"} onClick={() => setView("heat")}>事件热度</button>
    </div>
    {view === "pulse" && !valid ? <p role="alert">请选择有效的日期范围。</p> : <>
      {result.isPending && <p role="status">正在读取分析数据…</p>}
      {result.error && <p role="alert">{result.error.message}</p>}
    </>}
    {view === "pulse" && facets.data && <>
      <p className="muted">UTC 日期 · 最多 90 天 · 斜线表示覆盖未知</p>
      <PulseChart buckets={dailyBuckets(Math.floor(from / day) * day, to, facets.data.timeline)} onPick={onPick} />
    </>}
    {view === "heat" && stories.data && <>
      <p className="muted">最近 48 小时 · 按来源、频道、平台、等级和语言筛选</p>
      {stories.data.items.some(story => story.change6h !== null)
        ? <LazyChart kind="heat" stories={stories.data.items} />
        : <p>当前没有可比较的事件增速。</p>}
    </>}
  </section>;
}
