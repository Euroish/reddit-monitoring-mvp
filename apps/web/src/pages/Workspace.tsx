import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Heading } from "../ui";
import { api, type Run } from "../api";
export default function Workspace({ run }: { run: Run }) {
  const navigate = useNavigate();
  const queries = useQuery({
    queryKey: ["queries"],
    queryFn: () =>
      api<{
        queries: {
          id: string;
          name: string;
          query: Record<string, string | string[]>;
        }[];
      }>("/workspace/queries"),
  });
  const annotations = useQuery({
    queryKey: ["annotations"],
    queryFn: () =>
      api<{
        annotations: {
          content_id: string;
          title: string | null;
          note: string;
          favorite: boolean;
        }[];
      }>("/workspace/annotations"),
  });
  return (
    <>
      <Heading
        title="我的研究"
        note="保存问题与判断，让每次研究可以接着进行。"
      />
      <section className="panel">
        <h2>保存的查询</h2>
        {queries.data?.queries.map((query) => (
          <div className="saved-row" key={query.id}>
            <button
              onClick={() =>
                navigate(
                  `/content?${(() => {
                    const params = new URLSearchParams();
                    for (const [key, value] of Object.entries(query.query)) {
                      for (const entry of Array.isArray(value)
                        ? value
                        : [value])
                        params.append(key, entry);
                    }
                    return params;
                  })()}`,
                )
              }
            >
              {query.name} →
            </button>
            <button
              className="quiet"
              onClick={() =>
                void run(() =>
                  api(`/workspace/queries/${query.id}`, { method: "DELETE" }),
                )
              }
            >
              删除
            </button>
          </div>
        ))}
        {queries.data?.queries.length === 0 && (
          <p className="muted">在内容库搜索后，保存常用的查询。</p>
        )}
      </section>
      <section className="panel">
        <h2>收藏与批注</h2>
        {annotations.data?.annotations.map((item) => (
          <article className="annotation" key={item.content_id}>
            <h3>
              {item.favorite ? "★ " : ""}
              {item.title ?? "讨论证据"}
            </h3>
            <p>{item.note || "已收藏，暂无批注。"}</p>
          </article>
        ))}
        {annotations.data?.annotations.length === 0 && (
          <p className="muted">打开一条内容，将证据与批注留在这里。</p>
        )}
      </section>
    </>
  );
}
