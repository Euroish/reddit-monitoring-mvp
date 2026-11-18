import { useState, useRef, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import type { CollectionSource } from "../../../../packages/contracts/src/source-content";
import { Field, Heading, Empty } from "../ui";
import { api, type Run } from "../api";
export default function Sources({
  run,
  canEdit,
}: {
  run: Run;
  canEdit: boolean;
}) {
  const collectionRequest = useRef<{ body: string; key: string } | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
  });
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<CollectionSource | null>(null),
    [provider, setProvider] = useState("kaix");
  const jobs = useQuery({
    queryKey: ["jobs", selected?.id],
    enabled: !!selected,
    refetchInterval: selected ? 5000 : false,
    queryFn: () =>
      api<{
        jobs: {
          id: string;
          status: string;
          records_processed: number;
          error: string | null;
          provider_state: { phase?: string };
        }[];
      }>(`/sources/${selected!.id}/jobs`),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      await api("/sources", {
        method: "POST",
        body: JSON.stringify({
          label: form.get("label"),
          platform: provider === "bluesky_appview" ? "bluesky" : provider === "twitterapis" ? "x" :
            ["feed", "newsnow"].includes(provider) ? "web" : "reddit",
          primaryProvider: provider,
          fallbackProvider: form.get("fallbackProvider") || undefined,
          deliveryMode: provider === "external_ingest" ? "push" : "pull",
          contentKind: ["feed", "newsnow"].includes(provider) ? "article" : "post",
          target:
            provider === "bluesky_appview"
              ? { type: "account", account: form.get("target") }
              : provider === "feed"
                ? { type: "feed", url: form.get("target") }
                : { type: "search", query: provider === "newsnow" ? "hackernews" : form.get("target") },
        }),
      });
      setCreating(false);
    });
  };
  return (
    <>
      <Heading title="来源" note="定义收集范围，并在需要时采集或导入。">
        {canEdit && (
          <button className="primary" onClick={() => setCreating(!creating)}>
            添加来源
          </button>
        )}
      </Heading>
      {creating && (
        <form className="panel form-grid" onSubmit={submit}>
          <Field label="来源名称">
            <input name="label" required maxLength={100} />
          </Field>
          <Field label="采集方式">
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="kaix">Reddit · kaix</option>
              <option value="twitterapis">X · TwitterAPIs</option>
              <option value="bluesky_appview">Bluesky · 公开账号</option>
              <option value="newsnow">NewsNow · Hacker News</option>
              <option value="feed">RSS / Atom</option>
              <option value="external_ingest">导入已筛选内容</option>
            </select>
          </Field>
          {provider !== "newsnow" && <Field
            label={
              provider === "bluesky_appview"
                ? "账号"
                : provider === "external_ingest"
                  ? "样本主题"
                  : provider === "feed" ? "已批准的订阅 URL" : "搜索表达式"
            }
          >
            <input name="target" required maxLength={provider === "feed" ? 2000 : 200} />
          </Field>}
          {["twitterapis", "kaix"].includes(provider) && (
            <label className="check">
              <input type="checkbox" name="fallbackProvider" value={provider === "twitterapis" ? "scrapebadger" : "red_crawler"} />
              允许手动使用 {provider === "twitterapis" ? "ScrapeBadger" : "red_crawler"} 备源
            </label>
          )}
          <button>保存来源</button>
        </form>
      )}
      <div className="source-layout">
        <div className="source-list">
          {sources.data?.sources.map((source) => (
            <button
              className={`source-row ${selected?.id === source.id ? "selected" : ""}`}
              key={source.id}
              onClick={() => setSelected(source)}
            >
              <span className="source-icon">
                <Radio size={20} />
              </span>
              <div>
                <h2>{source.label}</h2>
                <p>
                  {source.platform} · {source.primaryProvider}
                </p>
              </div>
              <span className="badge">
                {source.state === "active"
                  ? "可用"
                  : source.state === "paused"
                    ? "已暂停"
                    : "已归档"}
              </span>
            </button>
          ))}
        </div>
        {selected && (
          <section className="panel source-detail">
            <h2>{selected.label}</h2>
            <p className="muted">
              {selected.deliveryMode === "push" ? "导入样本" : "按需采集"} ·{" "}
              {selected.contentKind}
            </p>
            <p className="target-text">
              {"query" in selected.target
                ? selected.target.query
                : "account" in selected.target
                  ? selected.target.account
                  : JSON.stringify(selected.target)}
            </p>
            {canEdit &&
              selected.state === "active" &&
              selected.deliveryMode === "pull" && (
                <form
                  key={selected.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const body = JSON.stringify({
                      from: new Date(String(form.get("from"))).toISOString(),
                      to: new Date(String(form.get("to"))).toISOString(),
                      limit: Number(form.get("limit")),
                      includeComments: form.get("comments") === "on",
                      useFallback: form.has("useFallback") || undefined,
                    });
                    const signature = `${selected.id}:${body}`;
                    if (collectionRequest.current?.body !== signature) {
                      collectionRequest.current = { body: signature, key: crypto.randomUUID() };
                    }
                    const key = collectionRequest.current.key;
                    setCollecting(true);
                    void run(async () => {
                      try {
                        await api(`/sources/${selected.id}/collect`, {
                          method: "POST", headers: { "Idempotency-Key": key }, body,
                        });
                        if (collectionRequest.current?.key === key) collectionRequest.current = null;
                      } finally { setCollecting(false); }
                    });
                  }}
                >
                  <Field label="开始日期">
                    <input
                      name="from"
                      type="date"
                      defaultValue={new Date(openedAt - 86400000)
                        .toISOString()
                        .slice(0, 10)}
                      required
                    />
                  </Field>
                  <Field label="结束日期（不含）">
                    <input
                      name="to"
                      type="date"
                      defaultValue={new Date(openedAt)
                        .toISOString()
                        .slice(0, 10)}
                      required
                    />
                  </Field>
                  <Field label="主帖上限">
                    <input
                      name="limit"
                      type="number"
                      min={1}
                      max={selected.primaryProvider === "twitterapis" ? 20 : selected.platform === "web" ? 30 : 100}
                      defaultValue={selected.primaryProvider === "twitterapis" ? 20 : 25}
                      required
                    />
                  </Field>
                  {selected.primaryProvider === "kaix" && <label className="check">
                    <input name="comments" type="checkbox" />
                    连带高赞评论（每帖最多 15 条）
                  </label>}
                  {selected.fallbackProvider && (
                    <label className="check">
                      <input type="checkbox" name="useFallback" />使用备源 {selected.fallbackProvider}
                    </label>
                  )}
                  <button disabled={collecting}>{collecting ? "正在提交…" : "开始采集"}</button>
                </form>
              )}
            {canEdit &&
              selected.state === "active" &&
              selected.deliveryMode === "push" && (
                <Field label="导入规范 JSON 文件">
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void run(async () => {
                          const payload = JSON.parse(await file.text());
                          return api(`/sources/${selected.id}/ingest`, {
                            method: "POST",
                            headers: { "Idempotency-Key": crypto.randomUUID() },
                            body: JSON.stringify(payload),
                          });
                        });
                    }}
                  />
                </Field>
              )}
            {canEdit && selected.state !== "archived" && (
              <button
                className="quiet"
                onClick={() =>
                  void run(async () => {
                    await api(`/sources/${selected.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        state:
                          selected.state === "paused" ? "active" : "paused",
                        revision: selected.revision,
                      }),
                    });
                    setSelected(null);
                  })
                }
              >
                {selected.state === "paused" ? "启用来源" : "暂停来源"}
              </button>
            )}
            <details open>
              <summary>最近任务</summary>
              {jobs.data?.jobs.map((job) => (
                <div className="job" key={job.id}>
                  <span>
                    {job.provider_state.phase === "unknown"
                      ? "收费结果待核查，已停发"
                      : ({
                          queued: "等待执行",
                          running: "采集中",
                          retrying: "稍后重试",
                          succeeded: "已完成",
                          failed: "采集失败",
                          cancelled: "已取消",
                        }[job.status] ?? "待核查")}
                  </span>
                  <span>{job.records_processed} 条</span>
                  {job.error && <p role="status">{job.error}</p>}
                </div>
              ))}
            </details>
          </section>
        )}
      </div>
      {sources.data?.sources.length === 0 && (
        <Empty>添加一个来源，开始积累研究证据。</Empty>
      )}
    </>
  );
}
