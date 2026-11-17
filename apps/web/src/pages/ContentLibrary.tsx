import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, X } from "lucide-react";
import type {
  CollectionSource,
  PublicContent,
} from "../../../../packages/contracts/src/source-content";
import { Field, Heading, Empty } from "../ui";
import { api, type Run } from "../api";
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN") : "发布时间未知";
export default function ContentLibrary({ run }: { run: Run }) {
  const [params, setParams] = useSearchParams(),
    [selected, setSelected] = useState<PublicContent | null>(null),
    [savingQuery, setSavingQuery] = useState(false),
    [draft, setDraft] = useState({
      scope: params.toString(),
      query: params.get("query") ?? "",
      sourceId: params.get("sourceId") ?? "",
    }),
    [exporting, setExporting] = useState(false);
  const searchDraft =
    draft.scope === params.toString()
      ? draft
      : {
          scope: params.toString(),
          query: params.get("query") ?? "",
          sourceId: params.get("sourceId") ?? "",
        };
  const annotation = useQuery({
    queryKey: ["annotation", selected?.id],
    enabled: !!selected,
    queryFn: () =>
      api<{
        annotation: {
          favorite: boolean;
          note: string;
          revision: number;
        } | null;
      }>(`/workspace/annotations/${selected!.id}`),
  });
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
  const query = params.toString();
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
      <Heading title="内容库" note="检索已经收集的内容，保留可追溯的原始证据。">
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
          const form = new FormData(event.currentTarget),
            next = new URLSearchParams(params);
          for (const key of ["cursor", "query", "sourceId"]) next.delete(key);
          if (form.get("query")) next.set("query", String(form.get("query")));
          if (form.get("sourceId"))
            next.set("sourceId", String(form.get("sourceId")));
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
          placeholder="搜索标题与正文…"
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
          {sources.data?.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </select>
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
            const filter: Record<string, string | string[]> = {};
            for (const key of new Set(params.keys())) {
              if (["cursor", "limit"].includes(key)) continue;
              const values = params.getAll(key);
              filter[key] = ["anyTerms", "allTerms", "exclusions"].includes(key)
                ? values
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
      {content.data?.items.length === 0 && (
        <Empty>当前范围没有匹配内容。尝试调整关键词或来源。</Empty>
      )}
      <div className="content-list">
        {content.data?.items.map((item) => (
          <button
            className="content-row"
            key={item.id}
            onClick={() => {
              setSelected(item);
            }}
          >
            <div className="content-meta">
              <span>{item.platform}</span>
              <span>{item.kind === "comment" ? "评论" : "主帖 / 文章"}</span>
              <time>{date(item.publishedAt)}</time>
            </div>
            <h2>{item.title || item.text?.slice(0, 100) || "正文不可用"}</h2>
            <p>{item.text?.slice(0, 220)}</p>
            <div className="content-footer">
              {item.observations
                .map((observation) => observation.provider)
                .join(" · ")}
              <span>
                查看证据 <ArrowUpRight size={14} />
              </span>
            </div>
          </button>
        ))}
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
            <hr />
            {annotation.isPending ? (
              <p role="status">正在读取批注…</p>
            ) : annotation.error ? (
              <p role="alert">{annotation.error.message}</p>
            ) : (
              <AnnotationForm
                key={selected.id}
                contentId={selected.id}
                initial={annotation.data?.annotation ?? null}
                run={run}
              />
            )}
            <details>
              <summary>采集记录</summary>
              <pre>{JSON.stringify(selected.observations, null, 2)}</pre>
            </details>
          </section>
        </div>
      )}
    </>
  );
}

function AnnotationForm({
  contentId,
  initial,
  run,
}: {
  contentId: string;
  initial: { favorite: boolean; note: string; revision: number } | null;
  run: Run;
}) {
  const [note, setNote] = useState(initial?.note ?? "");
  const [favorite, setFavorite] = useState(initial?.favorite ?? false);
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [saving, setSaving] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void run(async () => {
          try {
            const result = await api<{ revision: number }>(
              `/workspace/annotations/${contentId}`,
              {
                method: "PUT",
                body: JSON.stringify({ note, favorite, revision }),
              },
            );
            setRevision(result.revision);
          } finally {
            setSaving(false);
          }
        });
      }}
    >
      <label className="check">
        <input
          type="checkbox"
          checked={favorite}
          onChange={(event) => setFavorite(event.target.checked)}
        />
        收藏这条证据
      </label>
      <Field label="研究批注">
        <textarea
          rows={5}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <button disabled={saving}>保存到我的研究</button>
    </form>
  );
}
