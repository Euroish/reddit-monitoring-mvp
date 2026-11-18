import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { StoryEvidence, StoryFeed } from "../../../../packages/contracts/src/content-stories";
import { api } from "../api";
import { Empty, Heading } from "../ui";

const views = { latest: "最新", hot: "48 小时热度", digest: "08:00 日报" } as const;
const badgeLabels = { surge: "飙升", rising: "升温", new: "新上榜" } as const;
const time = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });

function EvidenceLink({ item }: { item: StoryEvidence }) {
  return item.url && /^https?:\/\//i.test(item.url)
    ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
    : <>{item.title}</>;
}

export default function Stories() {
  const [params] = useSearchParams();
  const tab = params.get("view");
  const view = tab === "hot" || tab === "digest" ? tab : "latest";
  const date = view === "digest" ? params.get("date") : null;
  const [copyStatus, setCopyStatus] = useState("");
  const feed = useQuery({
    queryKey: ["stories", view, date],
    queryFn: () => api<StoryFeed>(`/content/stories?${new URLSearchParams({ view, ...(date ? { date } : {}) })}`),
    staleTime: 30_000,
  });
  const copy = async () => {
    const data = feed.data;
    if (!data) return;
    const link = (item: StoryEvidence) => {
      const title = item.title.replace(/[\r\n]+/gu, " ").replace(/[\\[\]]/gu, "\\$&");
      return item.url && /^https?:\/\//i.test(item.url) ? `[${title}](<${item.url.replace(/[<>]/gu, encodeURIComponent)}>)` : title;
    };
    const markdown = [`# ${data.to.slice(0, 10)} 日报`, ...data.items.map(story => [
      `## ${link(story.representative)}`,
      `${story.representative.tier} · ${story.representative.sourceLabel}`,
      ...story.related.map(item => `- ${link(item)}`),
    ].join("\n"))].join("\n\n");
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus("已复制日报");
    } catch {
      setCopyStatus("复制失败，请重试");
    }
  };
  return <>
    <Heading title={views[view]}>
      {view === "digest" && !!feed.data?.items.length &&
        <button key={date ?? "today"} onClick={() => void copy()}>复制 Markdown</button>}
    </Heading>
    <nav className="story-tabs" aria-label="信息流视图">
      {Object.entries(views).map(([key, label]) => <Link key={key}
        to={key === "latest" ? "/" : `/?view=${key}`} aria-current={view === key ? "page" : undefined}>{label}</Link>)}
      <Link to="/content">内容库</Link>
    </nav>
    {feed.error && <p role="alert">{feed.error.message} <button onClick={() => void feed.refetch()}>重试</button></p>}
    {feed.isPending && <p role="status">正在读取事件…</p>}
    {feed.data && <>
      <div className="result-heading">
        <span>{time.format(new Date(feed.data.from))} 至 {time.format(new Date(feed.data.to))}（北京时间）</span>
        {view === "digest" && <Link to={`/?view=digest&date=${feed.data.from.slice(0, 10)}`} onClick={() => setCopyStatus("")}>前一日</Link>}
      </div>
      {view === "digest" && copyStatus && <p role="status">{copyStatus}</p>}
      {!feed.data.items.length && <Empty>这个时段暂无事件。</Empty>}
      <div className="content-list">
        {feed.data.items.map(story => {
          const item = story.representative;
          return <article className="content-row story-card" key={story.storyKey}>
            <div className="content-meta">
              <span>{item.tier}</span><span>{item.sourceLabel}</span>
              {item.author && item.author !== item.sourceLabel && <span>{item.author}</span>}
              <time dateTime={item.publishedAt ?? item.discoveredAt}>
                {item.publishedAt ? "" : "发现于 "}{time.format(new Date(item.publishedAt ?? item.discoveredAt))}
              </time>
            </div>
            <h2><EvidenceLink item={item} /></h2>
            {story.excerpt && story.excerpt !== item.title && <p>{story.excerpt}</p>}
            <div className="story-heat">
              <span>{story.sourceCount} 个独立来源</span>
              {view !== "latest" && <>
                <span>热度 {story.heat48h.toFixed(2)}</span>
                {story.change6h !== null && <span>近 6 小时 {new Intl.NumberFormat("zh-CN", { style: "percent", signDisplay: "exceptZero" }).format(story.change6h)}</span>}
                {story.badges.map(badge => <span className="badge" key={badge}>{badgeLabels[badge]}</span>)}
              </>}
            </div>
            {story.relatedCount > 0 && <details>
              <summary>{view === "digest" ? "当日进展" : "相关报道"}（{story.relatedCount}）</summary>
              <ul>{story.related.map(related => <li key={related.id}>
                <EvidenceLink item={related} /> <small>{related.sourceLabel} · {related.tier}</small>
              </li>)}</ul>
              {story.relatedCount > story.related.length && <p className="muted">已显示 {story.related.length} 条</p>}
            </details>}
          </article>;
        })}
      </div>
    </>}
  </>;
}
