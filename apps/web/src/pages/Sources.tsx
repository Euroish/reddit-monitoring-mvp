import { useState, useRef, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import type { CollectionSource } from "../../../../packages/contracts/src/source-content";
import { Field, Heading, Empty } from "../ui";
import { api, type Run } from "../api";

const budgetFields = {
  daily_requests: ["dailyRequests", "每日请求"],
  monthly_requests: ["monthlyRequests", "每月请求"],
  daily_resources: ["dailyResources", "每日记录额度"],
  monthly_resources: ["monthlyResources", "每月记录额度"],
  minimum_interval_ms: ["minimumIntervalMs", "最短请求间隔（毫秒）"],
} as const;
type Budget = { provider: string; enabled: boolean; revision: number } & Record<keyof typeof budgetFields, number>;

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
  const [creating, setCreating] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [provider, setProvider] = useState("kaix"),
    [targetType, setTargetType] = useState("search");
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
  });
  const selected = sources.data?.sources.find((source) => source.id === selectedId);
  const budgets = useQuery({
    queryKey: ["provider-budgets"],
    enabled: canEdit && selected?.deliveryMode === "pull",
    queryFn: () => api<{ budgets: Budget[] }>("/sources/budgets"),
  });
  const budget = budgets.data?.budgets.find(({ provider }) => provider === selected?.primaryProvider);
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
    const value = String(form.get("target") ?? "");
    const target = targetType === "account" ? { type: "account", account: value }
      : targetType === "community" ? { type: "community", community: value }
      : targetType === "feed" ? { type: "feed", url: value }
      : { type: "search", query: value };
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
          target,
          schedule: provider === "external_ingest" ? undefined : { enabled: form.has("schedule") },
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
              onChange={(event) => {
                const next = event.target.value;
                setProvider(next);
                setTargetType(next === "bluesky_appview" ? "account" : next === "feed" ? "feed" : "search");
              }}
            >
              <option value="kaix">Reddit · kaix</option>
              <option value="twitterapis">X · TwitterAPIs</option>
              <option value="bluesky_appview">Bluesky · 公开账号</option>
              <option value="newsnow">NewsNow · 热榜</option>
              <option value="feed">RSS / Atom</option>
              <option value="external_ingest">导入已筛选内容</option>
            </select>
          </Field>
          {["twitterapis", "kaix"].includes(provider) && <Field label="监测目标">
            <select value={targetType} onChange={(event) => setTargetType(event.target.value)}>
              <option value="search">搜索表达式</option>
              <option value="account">账号</option>
              {provider === "kaix" && <option value="community">社区</option>}
            </select>
          </Field>}
          {provider === "newsnow" ? <Field label="热榜">
            <select name="target">
              <option value="hackernews">Hacker News</option>
              <option value="bilibili-hot-video">B 站热门视频</option>
              <option value="v2ex-share">V2EX 分享</option>
            </select>
          </Field> : <Field label={provider === "external_ingest" ? "样本主题" : ({
            account: "账号", community: "社区", feed: "已批准的订阅 URL", search: "搜索表达式",
          })[targetType] ?? "搜索表达式"}>
            <input name="target" required maxLength={targetType === "feed" ? 2000 : targetType === "search" ? 512 : targetType === "account" ? 253 : 100} />
          </Field>}
          {provider !== "external_ingest" && <label className="check">
            <input type="checkbox" name="schedule" />启用自动采集
          </label>}
          {(provider === "twitterapis" || provider === "kaix" && targetType !== "account") && (
            <label className="check">
              <input type="checkbox" name="fallbackProvider" value={provider === "twitterapis" ? "scrapebadger" : "red_crawler"} />
              配置备源 {provider === "twitterapis" ? "ScrapeBadger" : "red_crawler"} 备源
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
              onClick={() => setSelectedId(source.id)}
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
              {selected.deliveryMode === "push" ? "导入样本" : selected.schedule?.enabled ? "自动采集" : "按需采集"} ·{" "}
              {selected.contentKind}
            </p>
            <p className="target-text">
              {"query" in selected.target
                ? selected.target.query
                : "account" in selected.target
                  ? selected.target.account
                  : JSON.stringify(selected.target)}
            </p>
            {selected.lastCheckedAt && <p className="muted">最近检查 {new Date(selected.lastCheckedAt).toLocaleString("zh-CN")}</p>}
            {selected.lastSuccessAt && <p className="muted">最近采集成功 {new Date(selected.lastSuccessAt).toLocaleString("zh-CN")}</p>}
            {canEdit && selected.deliveryMode === "pull" && selected.state !== "archived" && (
              <button onClick={() => void run(() => api(`/sources/${selected.id}`, {
                method: "PATCH",
                body: JSON.stringify({ revision: selected.revision, schedule: { ...selected.schedule, enabled: !selected.schedule?.enabled } }),
              }))}>{selected.schedule?.enabled ? "关闭自动采集" : "开启自动采集"}</button>
            )}
            {budget && <details>
              <summary>供应商预算 · {budget.provider}</summary>
              <form key={`${budget.provider}:${budget.revision}`} onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const amounts = Object.fromEntries(Object.values(budgetFields).map(([name]) => [name, Number(form.get(name))]));
                void run(() => api(`/sources/budgets/${budget.provider}`, {
                  method: "PUT",
                  body: JSON.stringify({ ...amounts, enabled: form.has("enabled"), revision: budget.revision }),
                }));
              }}>
                <label className="check"><input type="checkbox" name="enabled" defaultChecked={budget.enabled} />开启额度</label>
                {Object.entries(budgetFields).map(([key, [name, label]]) => <Field key={key} label={label}>
                  <input type="number" name={name} min={0} defaultValue={budget[key as keyof typeof budgetFields]} required />
                </Field>)}
                <button>保存预算</button>
              </form>
            </details>}
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
                    setSelectedId(null);
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
                  {canEdit && selected.state === "active" && ["failed", "cancelled"].includes(job.status) && (() => {
                    const phase = job.provider_state.phase;
                    const continuing = phase === "running" || phase === "reading";
                    const unresolved = phase === "unknown" || phase === "starting";
                    return <button onClick={() => {
                      if (unresolved && !window.confirm("请先核对供应商账单。再次请求可能重复扣费，确定重试？")) return;
                      void run(() => api(`/source-jobs/${job.id}/${continuing ? "continue" : "retry"}`, {
                        method: "POST", body: JSON.stringify({ acknowledgePotentialCharge: unresolved }),
                      }));
                    }}>{continuing ? "继续读取" : "重试任务"}</button>;
                  })()}
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
