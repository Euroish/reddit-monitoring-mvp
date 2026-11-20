import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Scopes,
  type Actor,
  type CollectionSource,
} from "../../../../packages/contracts/src/source-content";
import { Field, Heading } from "../ui";
import { api, type Run } from "../api";
const scopeLabels: Record<(typeof Scopes)[number], string> = {
  "sources:write": "管理来源",
  read: "检索内容与查看来源",
  export: "下载结果",
  ingest: "推送样本",
  collect: "启动采集",
  "projects:write": "管理项目",
};
export default function Account({ run, user }: { run: Run; user: Actor }) {
  const [token, setToken] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
  });
  return (
    <>
      <Heading title="设置" note="管理账户与研究工具的访问权限。" />
      <section className="panel">
        <h2>当前账户</h2>
        <p>{user.email}</p>
        <button
          onClick={() =>
            void run(() => api("/auth/logout", { method: "POST" }))
          }
        >
          退出登录
        </button>
      </section>
      {user.role !== "viewer" && (
        <section className="panel">
          <h2>连接外部研究工具</h2>
          <p className="muted">
            访问密钥仅显示一次，只授予本次任务所需的来源与操作。
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                const result = await api<{ token: string }>("/access/keys", {
                  method: "POST",
                  body: JSON.stringify({
                    label: form.get("label"),
                    scopes: form.getAll("scopes"),
                    allowedSourceIds: form.getAll("sources"),
                    expiresInDays: 30,
                  }),
                });
                setToken(result.token);
                setCopyStatus("");
              });
            }}
          >
            <Field label="工具名称">
              <input name="label" required maxLength={100} />
            </Field>
            <fieldset>
              <legend>允许操作</legend>
              {Scopes.map((value) => (
                <label className="check" key={value}>
                  <input type="checkbox" name="scopes" value={value} />
                  {scopeLabels[value]}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>允许访问的来源</legend>
              {sources.data?.sources.map((source) => (
                <label className="check" key={source.id}>
                  <input type="checkbox" name="sources" value={source.id} />
                  {source.label}
                </label>
              ))}
            </fieldset>
            <button className="primary">创建访问密钥</button>
          </form>
          {token && (
            <div role="status" className="token">
              <p>请保存此密钥（30 天后过期）</p>
              <code>{token}</code>
              <button onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token);
                  setCopyStatus("已复制密钥。");
                } catch {
                  setCopyStatus("无法访问剪贴板，请手动复制。");
                }
              }}>复制密钥</button>
              {copyStatus && <p>{copyStatus}</p>}
              <button onClick={() => setToken("")}>已保存，隐藏</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
