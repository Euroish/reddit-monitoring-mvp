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
    [revision, setRevision] = useState(0);
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
        <a
          className="button primary"
          href={`/api/v1/content/export?${new URLSearchParams([...params].filter(([key]) => key !== "cursor"))}&format=json`}
        >
          下载当前结果
        </a>
      </Heading>
      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget),
            next = new URLSearchParams();
          if (form.get("query")) next.set("query", String(form.get("query")));
          if (form.get("sourceId"))
            next.set("sourceId", String(form.get("sourceId")));
          setParams(next);
        }}
      >
        <input
          key={params.get("query")}
          name="query"
          aria-label="搜索词"
          defaultValue={params.get("query") ?? ""}
          placeholder="搜索标题与正文…"
        />
        <select
          name="sourceId"
          aria-label="限定来源"
          defaultValue={params.get("sourceId") ?? ""}
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
        <button
          onClick={() => {
            const name = window.prompt("保存为哪个研究查询？");
            if (name) {
              const filter = Object.fromEntries(
                [...params].filter(
                  ([key]) => !["cursor", "limit"].includes(key),
                ),
              );
              void run(() =>
                api("/workspace/queries", {
                  method: "POST",
                  body: JSON.stringify({ name, filter }),
                }),
              );
            }
          }}
        >
          保存查询
        </button>
      </div>
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
              setRevision(0);
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
            <form
              key={`${selected.id}-${annotation.data?.annotation?.revision ?? 0}`}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void run(async () => {
                  const saved = await api<{ revision: number }>(
                    `/workspace/annotations/${selected.id}`,
                    {
                      method: "PUT",
                      body: JSON.stringify({
                        favorite: form.get("favorite") === "on",
                        note: form.get("note"),
                        revision:
                          annotation.data?.annotation?.revision ?? revision,
                      }),
                    },
                  );
                  setRevision(saved.revision);
                });
              }}
            >
              <label className="check">
                <input
                  type="checkbox"
                  name="favorite"
                  defaultChecked={
                    annotation.data?.annotation?.favorite ?? false
                  }
                />
                收藏这条证据
              </label>
              <Field label="研究批注">
                <textarea
                  name="note"
                  maxLength={2000}
                  rows={5}
                  defaultValue={annotation.data?.annotation?.note ?? ""}
                />
              </Field>
              <button>保存到我的研究</button>
            </form>
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
