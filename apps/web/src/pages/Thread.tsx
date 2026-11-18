import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicContent } from "../../../../packages/contracts/src/source-content";
import { api } from "../api";

export default function Thread({ id, scope }: { id: string; scope: string }) {
  const [view, setView] = useState("top");
  const [open, setOpen] = useState(false);
  const thread = useQuery({
    queryKey: ["thread", id, scope, view],
    enabled: open,
    queryFn: () => api<{
      root: PublicContent;
      nodes: { item: PublicContent; depth: number; contextMissing: boolean }[];
      capped: boolean;
      contextMissing: boolean;
    }>(`/content/${id}/thread?view=${view}&${scope}`),
  });
  return (
    <section>
      <button onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "收起评论树" : "展开评论树"}</button>
      {open && (
        <>
          <h3>评论树</h3>
          <div className="facets" aria-label="评论视图">
            {[["top", "高赞"], ["matches", "命中"], ["op", "楼主"]].map(([value, label]) => (
              <button key={value} onClick={() => setView(value)} aria-pressed={view === value}>{label}</button>
            ))}
          </div>
          {thread.isPending && <p role="status">正在读取讨论…</p>}
          {thread.error && <p role="alert">{thread.error.message}</p>}
          {thread.data?.contextMissing && <p>根帖上下文缺失</p>}
          {thread.data && thread.data.root.id !== id && (
            <p>根帖 · {thread.data.root.title ?? thread.data.root.text}</p>
          )}
          {thread.data?.capped && <p>当前显示最多 200 个讨论节点。</p>}
          {thread.data?.nodes.length === 0 && <p>当前视图没有评论。</p>}
          {thread.data?.nodes.map(({ item, depth, contextMissing }) => (
            <article className="annotation" key={item.id} style={{ marginInlineStart: `${Math.min(depth, 4) * 0.6}rem` }}>
              <strong>{item.author?.handle ?? "未知作者"}</strong>
              {contextMissing && <small> · 父链不完整</small>}
              <p>{item.text ?? "正文不可用"}</p>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
