import { lazy, Suspense, useCallback, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Radar, Library, Radio, Bookmark, Settings, X } from "lucide-react";
import type { Actor } from "../../../packages/contracts/src/source-content";
import { api, type Run } from "./api";
import { Field, Empty } from "./ui";
import Stories from "./pages/Stories";
import WorkbenchControls from "./WorkbenchControls";

const Projects = lazy(() => import("./pages/Projects"));
const ContentLibrary = lazy(() => import("./pages/ContentLibrary"));
const Sources = lazy(() => import("./pages/Sources"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Account = lazy(() => import("./pages/Account"));
const navigation = [
  { path: "/", label: "最新", Icon: Library },
  { path: "/projects", label: "项目", Icon: Radar },
  { path: "/content", label: "内容库", Icon: Library },
  { path: "/sources", label: "来源", Icon: Radio },
  { path: "/workspace", label: "我的研究", Icon: Bookmark },
  { path: "/settings", label: "设置", Icon: Settings },
] as const;

export default function App() {
  const client = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const toggleSidebar = useCallback(() => setCollapsed(value => !value), []);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ user: Actor | null }>("/auth/session"),
  });
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const run: Run = async (action) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await client.invalidateQueries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  };
  if (session.isPending)
    return <main className="login-shell">正在连接工作台…</main>;
  if (session.error)
    return (
      <main className="login-shell">
        <p role="alert">{session.error.message}</p>
        <button onClick={() => void session.refetch()}>重新连接</button>
      </main>
    );
  if (!session.data?.user)
    return (
      <main className="login-shell">
        <section className="login-card">
          <Radar size={32} />
          <p className="eyebrow">SIGNAL / RESEARCH</p>
          <h1>回到你的研究</h1>
          <p>登录后，继续追踪讨论与证据。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(() =>
                api("/auth/login", {
                  method: "POST",
                  body: JSON.stringify({
                    email: form.get("email"),
                    password: form.get("password"),
                  }),
                }),
              );
            }}
          >
            <Field label="邮箱">
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </Field>
            <Field label="密码">
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <button className="primary" disabled={busy}>
              进入工作台
            </button>
          </form>
          {message && <p role="alert">{message}</p>}
        </section>
      </main>
    );
  const user = session.data.user;
  return (
    <div className={collapsed ? "shell shell-collapsed" : "shell"} aria-busy={busy}>
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <Radar />
          <span>
            信号研究<span className="brand-small">MONITORING STUDIO</span>
          </span>
        </NavLink>
        <nav aria-label="主导航">
          {navigation.map(({ path, label, Icon }) => (
            <NavLink key={path} to={path} end aria-label={label} title={label}>
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="identity">
          <span className="avatar">{user.email[0].toUpperCase()}</span>
          <div>
            {user.email}
            <small>{user.role === "viewer" ? "研究成员" : "管理员"}</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <span>
            <i /> 个人研究空间
          </span>
          <WorkbenchControls routes={navigation} collapsed={collapsed} onToggle={toggleSidebar} admin={user.role !== "viewer"} />
        </div>
        {message && (
          <div role="alert" className="alert">
            {message}
            <button aria-label="关闭提示" onClick={() => setMessage("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <Suspense fallback={<p role="status">正在加载页面…</p>}>
        <Routes>
          <Route path="/" element={<Stories />} />
          <Route
            path="/projects"
            element={<Projects run={run} canEdit={user.role !== "viewer"} />}
          />
          <Route path="/content" element={<ContentLibrary run={run} canCollect={user.role !== "viewer"} />} />
          <Route
            path="/sources"
            element={<Sources run={run} canEdit={user.role !== "viewer"} />}
          />
          <Route path="/workspace" element={<Workspace run={run} />} />
          <Route path="/settings" element={<Account run={run} user={user} />} />
          <Route
            path="*"
            element={<Empty>页面不存在。请从左侧导航继续。</Empty>}
          />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}
