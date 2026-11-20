import { sourceGroups, tierLabels, languages } from "../sourceLabels";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, X } from "lucide-react";
import type {
  CollectionSource,
  PublicContent,
} from "../../../../packages/contracts/src/source-content";
import { Field, Heading, Empty } from "../ui";
import Thread from "./Thread";
import { AnnotationEditor } from "../components/AnnotationEditor";
import ContentAnalysis from "../components/ContentAnalysis";
import LazyChart from "../components/LazyChart";
import { api, type Run } from "../api";

const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "发布时间未知";
const readDraft = (search: URLSearchParams) => ({
  scope: search.toString(),
  query: search.get("query") ?? "",
  sourceId: search.get("sourceId") ?? "",
  signal: search.get("signal") ?? "",
  sourceGroup: search.get("sourceGroup") ?? "",
  tier: search.get("tier") ?? "",
  language: search.get("language") ?? "",
  hasMedia: search.get("hasMedia") === "true",
});

export default function ContentLibrary({ run, canCollect }: { run: Run; canCollect: boolean }) {
  const [params, setParams] = useSearchParams(),
    [selected, setSelected] = useState<PublicContent | null>(null),
    [savingQuery, setSavingQuery] = useState(false),
    [draft, setDraft] = useState(() => readDraft(params)),
    [exporting, setExporting] = useState(false);
  const searchDraft = draft.scope === params.toString() ? draft : readDraft(params);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog?.querySelectorAll<HTMLElement>("button,a,input,textarea") ?? [],
      );
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [selected]);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const scope = new URLSearchParams(params);
  scope.delete("cursor");
  scope.delete("limit");
  const query = params.toString();
  const projectId = params.get("projectId");
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: "", ids: [] });
  const picked = selection.scope === query ? selection.ids : [];
  const [hydrated, setHydrated] = useState(0);
  const [hydrating, setHydrating] = useState(false);
  const hydrationKey = useRef<{ body: string; key: string } | null>(null);
  const hydrate = (contentIds: string[], maxCommentsPerPost: number) => {
    if (!projectId || hydrating) return;
    const body = JSON.stringify({ contentIds, maxCommentsPerPost });
    const signature = `${projectId}:${body}`;
    if (hydrationKey.current?.body !== signature)
      hydrationKey.current = { body: signature, key: crypto.randomUUID() };
    const key = hydrationKey.current.key;
    setHydrating(true);
    void run(async () => {
      try {
        const result = await api<{ jobIds: string[] }>(`/projects/${projectId}/hydrate`, {
          method: "POST", headers: { "Idempotency-Key": key }, body,
        });
        setHydrated(result.jobIds.length);
        setSelection({ scope: query, ids: [] });
        hydrationKey.current = null;
      } finally {
        setHydrating(false);
      }
    });
  };
  const project = useQuery({
    queryKey: ["projects", projectId],
    enabled: !!projectId,
    queryFn: () => api<{ name: string; source_ids: string[] }>(`/projects/${projectId}`),
  });
  const content = useQuery({
    queryKey: ["content", query],
    queryFn: () =>
      api<{ items: PublicContent[]; nextCursor: string | null }>(
        `/content?${query}`,
      ),
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
  });
  return (
    <>
      <Heading title="内容库" note={project.data?.name ?? "检索已经收集的内容，保留可追溯的原始证据。"}>
        <button
          className="primary"
          disabled={exporting}
          onClick={() => {
            setExporting(true);
            void run(async () => {
              try {
                const filter = new URLSearchParams(
                  [...params].filter(
                    ([key]) => !["cursor", "limit"].includes(key),
                  ),
                );
                const response = await fetch(
                  `/api/v1/content/export?${filter}&format=json`,
                );
                if (!response.ok)
                  throw Error(
                    (await response.json()).error?.message ?? "下载失败",
                  );
                const body = await response.text();
                const payload = JSON.parse(body);
                if (!payload.result?.complete) throw Error("下载中断，请重试");
                const url = URL.createObjectURL(
                  new Blob([body], { type: "application/json" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = "content.json";
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } finally {
                setExporting(false);
              }
            });
          }}
        >
          {exporting ? "正在下载…" : "下载当前结果"}
        </button>
      </Heading>
      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          const next = new URLSearchParams(params);
          for (const key of ["cursor", "query", "sourceId", "signal", "sourceGroup", "tier", "language", "hasMedia"])
            next.delete(key);
          if (searchDraft.query.trim()) next.set("query", searchDraft.query.trim());
          if (searchDraft.sourceId) next.set("sourceId", searchDraft.sourceId);
          if (searchDraft.signal) next.set("signal", searchDraft.signal);
          if (searchDraft.sourceGroup) next.set("sourceGroup", searchDraft.sourceGroup);
          if (searchDraft.tier) next.set("tier", searchDraft.tier);
          if (searchDraft.language) next.set("language", searchDraft.language);
          if (searchDraft.hasMedia) next.set("hasMedia", "true");
          setParams(next);
        }}
      >
        <input
          name="query"
          aria-label="搜索词"
          value={searchDraft.query}
          onChange={(event) =>
            setDraft({ ...searchDraft, query: event.target.value })
          }
          placeholder="搜索标题与正文，至少连续 2 个字母或数字"
        />
        <select
          name="sourceId"
          aria-label="限定来源"
          value={searchDraft.sourceId}
          onChange={(event) =>
            setDraft({ ...searchDraft, sourceId: event.target.value })
          }
        >
          <option value="">全部可见来源</option>
          {sources.data?.sources.filter((source) => !project.data || project.data.source_ids.includes(source.id)).map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </select>
        <select
          name="sourceGroup"
          aria-label="频道"
          value={searchDraft.sourceGroup}
          onChange={(event) => setDraft({ ...searchDraft, sourceGroup: event.target.value })}
        >
          <option value="">全部频道</option>
          {Object.entries(sourceGroups).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select
          name="tier"
          aria-label="等级"
          value={searchDraft.tier}
          onChange={(event) => setDraft({ ...searchDraft, tier: event.target.value })}
        >
          <option value="">全部等级</option>
          {Object.entries(tierLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select
          name="language"
          aria-label="语言"
          value={searchDraft.language}
          onChange={(event) => setDraft({ ...searchDraft, language: event.target.value })}
        >
          <option value="">全部语言</option>
          {Object.entries(languages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select
          name="signal"
          aria-label="研究信号"
          value={searchDraft.signal}
          onChange={(event) => setDraft({ ...searchDraft, signal: event.target.value })}
        >
          <option value="">全部信号</option>
          <option value="discussion">讨论活跃</option>
          <option value="pain">痛点</option>
        </select>
        <label className="check">
          <input
            type="checkbox"
            name="hasMedia"
            checked={searchDraft.hasMedia}
            onChange={(event) => setDraft({ ...searchDraft, hasMedia: event.target.checked })}
          />
          仅含媒体
        </label>
        <button>搜索</button>
      </form>
      {content.error && <p role="alert">{content.error.message}</p>}
      <div className="result-heading">
        <span>已存样本</span>
        <button onClick={() => setSavingQuery(!savingQuery)}>保存查询</button>
      </div>
      {savingQuery && (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get("name"));
            const filter: Record<string, string | string[] | boolean> = {};
            for (const key of new Set(params.keys())) {
              if (["cursor", "limit"].includes(key)) continue;
              const values = params.getAll(key);
              filter[key] = ["anyTerms", "allTerms", "exclusions"].includes(key)
                ? values
                : key === "threadAware" || key === "hasMedia"
                  ? values[0] === "true"
                  : values[0];
            }
            void run(async () => {
              await api("/workspace/queries", {
                method: "POST",
                body: JSON.stringify({ name, filter }),
              });
              setSavingQuery(false);
            });
          }}
        >
          <Field label="查询名称">
            <input name="name" required maxLength={100} />
          </Field>
          <button>确认保存查询</button>
        </form>
      )}
      <button type="button" aria-expanded={showAnalysis} onClick={() => setShowAnalysis(!showAnalysis)}>分析内容</button>
      {showAnalysis && <ContentAnalysis scope={scope.toString()} onPick={({ from, platform }) => {
        const start = Math.max(Date.parse(from), Date.parse(scope.get("from") ?? "") || -Infinity);
        const end = Math.min(Date.parse(from) + 86_400_000, Date.parse(scope.get("to") ?? "") || Infinity);
        scope.set("from", new Date(start).toISOString());
        scope.set("to", new Date(end).toISOString());
        if (platform) scope.set("platform", platform);
        if (!projectId && !scope.has("deliveryMode")) scope.set("deliveryMode", "pull");
        setParams(scope);
      }} />}
      {content.data?.items.length === 0 && (
        <Empty>当前范围没有匹配内容。尝试调整关键词或来源。</Empty>
      )}
      {projectId && canCollect && picked.length > 0 && (
        <form className="panel search-bar" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          hydrate(picked, Number(form.get("comments")));
        }}>
          <Field label="每帖评论上限"><input type="number" name="comments" min={1} max={50} defaultValue={15} required /></Field>
          <button disabled={hydrating}>水合已选根帖（{picked.length}）</button>
        </form>
      )}
      {hydrated > 0 && <p role="status">已提交 {hydrated} 个水合任务。任务进度见来源页。</p>}
      <div className="content-list">
        {content.data?.items.map((item) => {
          const channel = (item.platformDetails as { channel?: string | null })?.channel;
          return (
          <div key={item.id}>
          {projectId && canCollect && item.platform === "reddit" && item.kind === "post" &&
            item.observations.some(({ provider }) => provider === "kaix") && (
            <label className="check">
              <input type="checkbox" checked={picked.includes(item.id)} disabled={picked.length >= 30 && !picked.includes(item.id)}
                onChange={(event) => setSelection({ scope: query,
                  ids: event.target.checked ? [...picked, item.id] : picked.filter((id) => id !== item.id),
                })} />
              选取根帖
            </label>
          )}
          <button
            className="content-row"
            onClick={() => {
              setSelected(item);
            }}
          >
            <div className="content-meta">
              <span>{item.platform}</span>
              {channel && <span>{channel}</span>}
              {(item.author?.displayName ?? item.author?.handle) && <span>{item.author?.displayName ?? item.author?.handle}</span>}
              {item.language && <span>{languages[item.language as keyof typeof languages] ?? item.language}</span>}
              {item.contextMissing && <span>根帖上下文缺失</span>}
              <span>{item.kind === "comment" ? "评论" : "主帖 / 文章"}</span>
              <time>{date(item.publishedAt)}</time>
            </div>
            <h2>{item.title || item.text?.slice(0, 100) || "正文不可用"}</h2>
            <p>{item.text?.slice(0, 220)}</p>
            <div className="content-footer">
              {item.observations
                .map(({ provider, metrics }) => {
                  const values = [
                    [metrics["reddit.num_comments"] ?? metrics["x.replies"], "回复"],
                    [metrics["x.likes"] ?? metrics["web.likes"], "点赞"],
                    [metrics["web.views"], "浏览"],
                    [metrics["web.rank"], "榜单名次"],
                  ] as const;
                  return [provider, ...values.flatMap(([value, label]) => value == null ? [] : [`${label} ${value}`])].join(" · ");
                })
                .join("　")}
              <span>
                查看证据 <ArrowUpRight size={14} />
              </span>
            </div>
          </button>
          </div>
          );
        })}
      </div>
      {content.data?.nextCursor && (
        <button
          className="next-page"
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set("cursor", content.data!.nextCursor!);
            setParams(next);
          }}
        >
          下一页 →
        </button>
      )}
      {selected && (
        <div className="drawer-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="内容详情"
            className="drawer"
          >
            <button
              className="close"
              aria-label="关闭详情"
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <p className="eyebrow">{selected.platform} / 证据详情</p>
            <h2>{selected.title ?? "讨论内容"}</h2>
            <p className="muted">{date(selected.publishedAt)}</p>
            <p className="full-text">
              {selected.text ?? "该内容没有可用正文。"}
            </p>
            {selected.url && /^https?:\/\//.test(selected.url) && (
              <a href={selected.url} target="_blank" rel="noreferrer">
                查看原文 ↗
              </a>
            )}
            <Thread key={selected.id} id={selected.id} scope={scope.toString()} run={run}
              onHydrate={projectId && canCollect ? id => hydrate([id], 15) : undefined} hydrating={hydrating} />
            <hr />
            <AnnotationEditor key={selected.id} contentId={selected.id} run={run} />
            {selected.observations.length > 0 &&
              <Observations key={selected.id} observations={selected.observations} sources={sources.data?.sources ?? []} />}

          </section>
        </div>
      )}
    </>
  );
}

function Observations({ observations, sources }: { observations: PublicContent["observations"]; sources: CollectionSource[] }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>采集记录</summary>
    {open && <>
      <LazyChart kind="observations" observations={observations} sources={new Map(sources.map(source => [source.id, source.label]))} />
      <pre>{JSON.stringify(observations, null, 2)}</pre>
    </>}
  </details>;
}
