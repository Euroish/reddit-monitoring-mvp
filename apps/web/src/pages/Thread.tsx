import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicContent } from "../../../../packages/contracts/src/source-content";
import { api, type Run } from "../api";
import { AnnotationEditor } from "../components/AnnotationEditor";

export default function Thread({ id, scope, run, onHydrate, hydrating }: {
  id: string;
  scope: string;
  run: Run;
  onHydrate?: (id: string) => void;
  hydrating: boolean;
}) {
  const [view, setView] = useState("top");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const thread = useQuery({
    queryKey: ["thread", id, scope, view],
    enabled: open,
    queryFn: () => api<{
      root: PublicContent;
      nodes: { item: PublicContent; depth: number; contextMissing: boolean; isOp?: boolean }[];
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
          {(thread.data?.contextMissing || thread.data?.nodes.some(node => node.contextMissing)) &&
            <p role="status">部分上下文缺失，可能缺少父节点或已达 32 层追溯上限。</p>}
          {thread.data?.root.platform === "reddit" &&
            thread.data.root.observations.some(observation => observation.provider === "kaix") && onHydrate &&
            <button disabled={hydrating} onClick={() => onHydrate(thread.data!.root.id)}>补采根帖评论（最多 15 条）</button>}
          {thread.data && thread.data.root.id !== id && (
            <p>根帖 · {thread.data.root.title ?? thread.data.root.text}</p>
          )}
          {thread.data?.capped && <p>当前显示最多 200 个讨论节点。</p>}
          {thread.data?.nodes.length === 0 && <p>当前视图没有评论。</p>}
          {thread.data?.nodes.map(({ item, depth, contextMissing, isOp }) => (
            <article className="annotation" key={item.id} style={{ marginInlineStart: `${Math.min(depth, 4) * 0.6}rem` }}>
              <strong>{item.author?.handle ?? "未知作者"}</strong>
              {isOp && <small> · 楼主</small>}
              {contextMissing && <small> · 父链不完整</small>}
              <p>{item.text ?? "正文不可用"}</p>
              <button aria-expanded={editing === item.id} onClick={() => setEditing(editing === item.id ? null : item.id)}>评论笔记</button>
              {editing === item.id && <AnnotationEditor contentId={item.id} run={run} />}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
