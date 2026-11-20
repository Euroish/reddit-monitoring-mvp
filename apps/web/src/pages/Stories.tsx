import { sourceGroups, tierLabels, languages } from "../sourceLabels";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { StoryEvidence, StoryFeed } from "../../../../packages/contracts/src/content-stories";
import { api } from "../api";
import { Empty, Heading } from "../ui";

const views = { latest: "最新", hot: "48 小时热度", digest: "08:00 日报" } as const;
const badgeLabels = { surge: "飙升", rising: "升温", new: "新上榜" } as const;
const time = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" });

function StoryMicrocharts({ story }: { story: StoryFeed["items"][number] }) {
  const { tierBreakdown, sparkline48h } = story;
  if (!tierBreakdown || sparkline48h?.length !== 8) return null;
  const tiers = ["T1", "T1_5", "T2"] as const;
  const total = tiers.reduce((sum, tier) => sum + tierBreakdown[tier], 0);
  const peak = Math.max(...sparkline48h, 0.01);
  const points = sparkline48h.map((value, index) => `${2 + index * 12},${14 - 12 * value / peak}`).join(" ");
  return <div className="story-microcharts">
    {total > 0 && <span>
      <span aria-hidden="true">来源分布</span>
      <svg width="72" height="16" viewBox="0 0 72 16" role="img"
        aria-label={`来源分布：${tiers.map(tier => `${tier} ${tierBreakdown[tier]}`).join("，")}`}>
        <title>{tiers.map(tier => `${tier}：${tierBreakdown[tier]}`).join("，")}</title>
        {tiers.map((tier, index) => (
          <rect key={tier} className={`story-tier-${tier.toLowerCase()}`}
            x={72 * tiers.slice(0, index).reduce((sum, earlier) => sum + tierBreakdown[earlier], 0) / total}
            y="5" width={72 * tierBreakdown[tier] / total} height="6" />
        ))}
      </svg>
    </span>}
    <span>
      <span aria-hidden="true">48 小时热度</span>
      <svg width="88" height="16" viewBox="0 0 88 16" role="img"
        aria-label={`已采样热度，从早到晚每 6 小时：${sparkline48h.map(value => value.toFixed(2)).join("，")}`}>
        <title>已采样热度 · 每 6 小时</title>
        <path className="story-chart-guide" d="M2 14H86" />
        <polyline className="story-chart-line" points={points} fill="none" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </span>
  </div>;
}

function EvidenceLink({ item }: { item: StoryEvidence }) {
  return item.url && /^https?:\/\//i.test(item.url)
    ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
    : <>{item.title}</>;
}

export default function Stories() {
  const [params, setParams] = useSearchParams();
  const list = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const client = useQueryClient();
  const [saveStatus, setSaveStatus] = useState("");
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing ||
        document.querySelector('[role="dialog"], dialog[open]') ||
        (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"))) return;
      const key = event.key.toLowerCase();
      if (!["j", "k", "o", "s", "m"].includes(key)) return;
      const cards = [...(list.current?.querySelectorAll<HTMLElement>("article[data-content-id]") ?? [])];
      if (!cards.length) return;
      const index = cards.findIndex(card => card.contains(document.activeElement));
      if (key === "j" || key === "k") {
        event.preventDefault();
        const next = index < 0 ? (key === "j" ? 0 : cards.length - 1) : index + (key === "j" ? 1 : -1);
        cards[Math.max(0, Math.min(cards.length - 1, next))].focus();
        return;
      }
      if (index < 0 || event.repeat) return;
      const card = cards[index];
      event.preventDefault();
      if (key === "o") card.querySelector<HTMLAnchorElement>("h2 a")?.click();
      if (key === "m") card.querySelector<HTMLElement>("summary")?.click();
      if (key === "s" && !saving.current) {
        saving.current = true;
        const id = card.dataset.contentId!;
        const path = `/workspace/annotations/${id}`;
        void (async () => {
          try {
            const { annotation } = await api<{ annotation: { note: string; revision: number; favorite: boolean } | null }>(path);
            if (!annotation?.favorite) await api(path, {
              method: "PUT",
              body: JSON.stringify({ note: annotation?.note ?? "", revision: annotation?.revision ?? 0, favorite: true }),
            });
            await client.invalidateQueries({ queryKey: ["annotations"] });
            await client.invalidateQueries({ queryKey: ["annotation", id] });
            setSaveStatus("已收藏到我的研究。");
          } catch (error) {
            setSaveStatus(error instanceof Error ? error.message : "收藏失败，请重试。");
          } finally { saving.current = false; }
        })();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [client]);
  const tab = params.get("view");
  const view = tab === "hot" || tab === "digest" ? tab : "latest";
  const date = view === "digest" ? params.get("date") : null;
  const sourceGroup = params.get("sourceGroup") ?? "";
  const tier = params.get("tier") ?? "";
  const language = params.get("language") ?? "";
  const [copyStatus, setCopyStatus] = useState("");
  const feed = useQuery({
    queryKey: ["stories", view, date, sourceGroup, tier, language],
    queryFn: () => api<StoryFeed>(`/content/stories?${new URLSearchParams({
      view,
      ...(date ? { date } : {}),
      ...(sourceGroup ? { sourceGroup } : {}),
      ...(tier ? { tier } : {}),
      ...(language ? { language } : {}),
    })}`),
    staleTime: 30_000,
  });
  const updateFilter = (key: "sourceGroup" | "tier" | "language", value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const buildStoryUrl = (nextView: keyof typeof views, nextDate?: string) => {
    const next = new URLSearchParams();
    if (nextView !== "latest") next.set("view", nextView);
    if (nextDate) next.set("date", nextDate);
    if (sourceGroup) next.set("sourceGroup", sourceGroup);
    if (tier) next.set("tier", tier);
    if (language) next.set("language", language);
    const qs = next.toString();
    return qs ? `/?${qs}` : "/";
  };
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
        to={buildStoryUrl(key as keyof typeof views)} aria-current={view === key ? "page" : undefined}>{label}</Link>)}
      <Link to="/content">内容库</Link>
    </nav>
    <div className="filter-strip" role="group" aria-label="信息流筛选">
      <select aria-label="频道" value={sourceGroup} onChange={(event) => updateFilter("sourceGroup", event.target.value)}>
        <option value="">全部频道</option>
        {Object.entries(sourceGroups).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <select aria-label="等级" value={tier} onChange={(event) => updateFilter("tier", event.target.value)}>
        <option value="">全部等级</option>
        {Object.entries(tierLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <select aria-label="语言" value={language} onChange={(event) => updateFilter("language", event.target.value)}>
        <option value="">全部语言</option>
        {Object.entries(languages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      {(sourceGroup || tier || language) && (
        <button type="button" className="quiet" onClick={() => {
          const next = new URLSearchParams(params);
          for (const key of ["sourceGroup", "tier", "language"]) next.delete(key);
          setParams(next);
        }}>清除筛选</button>
      )}
    </div>
    {feed.error && <p role="alert">{feed.error.message} <button onClick={() => void feed.refetch()}>重试</button></p>}
    {feed.isPending && <p role="status">正在读取事件…</p>}
    {feed.data && <>
      <div className="result-heading">
        <span>{time.format(new Date(feed.data.from))} 至 {time.format(new Date(feed.data.to))}（北京时间）</span>
        {view === "digest" && <Link to={buildStoryUrl("digest", feed.data.from.slice(0, 10))} onClick={() => setCopyStatus("")}>前一日</Link>}
      </div>
      {view === "digest" && copyStatus && <p role="status">{copyStatus}</p>}
      {!feed.data.items.length && <Empty>这个时段暂无事件。</Empty>}
      {saveStatus && <p role="status">{saveStatus}</p>}
      <div className="content-list" ref={list}>
        {feed.data.items.map(story => {
          const item = story.representative;
          return <article className="content-row story-card" key={story.storyKey} tabIndex={-1} data-content-id={item.id}>
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
            <StoryMicrocharts story={story} />
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
