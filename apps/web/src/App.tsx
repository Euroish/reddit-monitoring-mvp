import { lazy, Suspense, useCallback, useMemo, useState, type FormEvent } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Clock,
  Flame,
  Hash,
  Layers,
  Library,
  Lock,
  Menu,
  Newspaper,
  Radar,
  Radio,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { api, type Run } from "./api";
import { sourceGroups } from "./sourceLabels";
import { AuthPromptCard, Empty } from "./ui";
import { AuthModal, PrivateLoginScreen } from "./components/AuthModal";
import Stories from "./pages/Stories";
import WorkbenchControls, { type CommandRoute } from "./WorkbenchControls";
import type { AuthMode, OpenAuthFn, PublicSourcesPayload, SessionPayload } from "./types";

const Projects = lazy(() => import("./pages/Projects"));
const ContentLibrary = lazy(() => import("./pages/ContentLibrary"));
const Sources = lazy(() => import("./pages/Sources"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Account = lazy(() => import("./pages/Account"));

const feedViews = [
  { key: "latest", path: "/", label: "精选信息流", Icon: Sparkles },
  { key: "timeline", path: "/?view=timeline", label: "全量时间线", Icon: Clock },
  { key: "hot", path: "/?view=hot", label: "48h 热度榜", Icon: Flame },
  { key: "digest", path: "/?view=digest", label: "08:00 日报", Icon: Newspaper },
] as const;

export default function App() {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const routeKey = `${location.pathname}${location.search}`;
  const [mobileOpenKey, setMobileOpenKey] = useState<string | null>(null);
  const mobileMenuOpen = mobileOpenKey === routeKey;
  const setMobileMenuOpen = useCallback((open: boolean | ((v: boolean) => boolean)) => {
    setMobileOpenKey((prev) => {
      const next = typeof open === "function" ? open(prev === routeKey) : open;
      return next ? routeKey : null;
    });
  }, [routeKey]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [authDialog, setAuthDialog] = useState<{
    open: boolean;
    mode: AuthMode;
    reason?: string;
  }>({ open: false, mode: "login" });

  const toggleSidebar = useCallback(() => setCollapsed((value) => !value), []);

  const openAuth: OpenAuthFn = useCallback((mode = "login", reason) => {
    setAuthDialog({ open: true, mode, reason });
  }, []);

  const closeAuth = useCallback(() => {
    setAuthDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<SessionPayload>("/auth/session"),
  });

  const user = session.data?.user ?? null;
  const publicRead = session.data?.publicRead !== false;
  const publicRegistration = session.data?.publicRegistration !== false;
  const isAdmin = !!user && user.role !== "viewer";

  const publicSources = useQuery({
    queryKey: ["public-sources"],
    queryFn: () => api<PublicSourcesPayload>("/public/sources"),
    enabled: !!session.data && (publicRead || !!user),
    staleTime: 60_000,
  });

  const run: Run = useCallback(
    async (action) => {
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
    },
    [client],
  );

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const activeView = location.pathname === "/" ? (searchParams.get("view") ?? "latest") : "";
  const activeGroup = location.pathname === "/" ? (searchParams.get("sourceGroup") ?? "") : "";

  const commandRoutes = useMemo<CommandRoute[]>(() => {
    const items: CommandRoute[] = [
      ...feedViews.map((v) => ({ path: v.path, label: v.label, group: "信息流" })),
      ...Object.entries(sourceGroups).map(([key, label]) => ({
        path: `/?sourceGroup=${key}`,
        label,
        group: "频道",
      })),
      { path: "/content", label: "内容库与分析", group: "工具" },
    ];
    if (user) {
      items.push(
        { path: "/projects", label: "专题监测", group: "工作区" },
        { path: "/workspace", label: "我的研究", group: "工作区" },
      );
      if (isAdmin) {
        items.push({ path: "/sources", label: "来源运维", group: "运维" });
      }
      items.push({ path: "/settings", label: "账户设置", group: "设置" });
    }
    return items;
  }, [user, isAdmin]);

  if (session.isPending) {
    return (
      <main className="login-shell">
        <p role="status" className="muted">正在连接信号研究…</p>
      </main>
    );
  }

  if (session.error) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <h1>连接失败</h1>
          <p role="alert" className="auth-error">{session.error.message}</p>
          <button className="primary" onClick={() => void session.refetch()}>重新连接</button>
        </section>
      </main>
    );
  }

  if (!publicRead && !user) {
    return <PrivateLoginScreen publicRegistration={publicRegistration} />;
  }

  const handleGlobalSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = globalQuery.trim();
    if (q) {
      navigate(`/content?query=${encodeURIComponent(q)}`);
    } else {
      navigate("/content");
    }
  };

  const buildViewHref = (viewKey: string) => {
    if (viewKey === "latest") return "/";
    const next = new URLSearchParams();
    next.set("view", viewKey);
    if (activeGroup) next.set("sourceGroup", activeGroup);
    return `/?${next.toString()}`;
  };

  const buildChannelHref = (groupKey: string) => {
    const next = new URLSearchParams();
    if (location.pathname === "/" && activeView && activeView !== "latest") {
      next.set("view", activeView);
    }
    if (activeGroup !== groupKey) {
      next.set("sourceGroup", groupKey);
    }
    const qs = next.toString();
    return qs ? `/?${qs}` : "/";
  };

  const groupCounts = publicSources.data?.groupCounts ?? {};

  return (
    <div
      className={[
        "shell",
        collapsed ? "shell-collapsed" : "",
        mobileMenuOpen ? "shell-mobile-open" : "",
      ].filter(Boolean).join(" ")}
      aria-busy={busy}
    >
      {mobileMenuOpen && (
        <div
          className="rail-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className="sidebar" aria-label="侧边导航">
        <div className="brand-row">
          <Link to="/" className="brand" title="信号研究">
            <span className="brand-mark" aria-hidden="true">
              <Radar size={17} />
            </span>
            <span className="brand-name">信号研究</span>
          </Link>
          <button
            type="button"
            className="icon-btn mobile-close-rail"
            aria-label="关闭导航菜单"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <div className="rail-scroll">
          <div className="rail-section">
            <p className="rail-label">信息流</p>
            <nav aria-label="信息流视图" className="rail-nav">
              {feedViews.map(({ key, label, Icon }) => {
                const isActive =
                  location.pathname === "/" &&
                  activeView === key &&
                  (key !== "latest" || !activeGroup);
                return (
                  <Link
                    key={key}
                    to={buildViewHref(key)}
                    className={`rail-link${isActive ? " active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    title={label}
                  >
                    <Icon size={16} />
                    <span className="rail-text">{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="rail-section rail-channels">
            <p className="rail-label">主题频道</p>
            <nav aria-label="主题频道" className="rail-nav">
              {Object.entries(sourceGroups).map(([key, label]) => {
                const isActive = location.pathname === "/" && activeGroup === key;
                const count = groupCounts[key] ?? 0;
                return (
                  <Link
                    key={key}
                    to={buildChannelHref(key)}
                    className={`rail-link rail-channel-link${isActive ? " active" : ""}`}
                    aria-current={isActive ? "page" : undefined}
                    title={label}
                  >
                    <Hash size={14} className="channel-glyph" />
                    <span className="rail-text">{label}</span>
                    {count > 0 && <span className="rail-count">{count}</span>}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="rail-section">
            <p className="rail-label">研究工具</p>
            <nav aria-label="主导航" className="rail-nav">
              <NavLink to="/content" className="rail-link" title="内容库与分析">
                <Library size={16} />
                <span className="rail-text">内容库</span>
              </NavLink>

              {user ? (
                <>
                  <NavLink to="/projects" className="rail-link" title="专题监测">
                    <Layers size={16} />
                    <span className="rail-text">专题监测</span>
                  </NavLink>
                  <NavLink to="/workspace" className="rail-link" title="我的研究">
                    <Bookmark size={16} />
                    <span className="rail-text">我的研究</span>
                  </NavLink>
                  {isAdmin && (
                    <NavLink to="/sources" className="rail-link" title="来源运维">
                      <Radio size={16} />
                      <span className="rail-text">来源运维</span>
                    </NavLink>
                  )}
                  <NavLink to="/settings" className="rail-link" title="设置">
                    <Settings size={16} />
                    <span className="rail-text">设置</span>
                  </NavLink>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="rail-link rail-link-gated"
                    title="专题监测（需登录）"
                    onClick={() => openAuth("login", "登录后查看与管理专题监测。")}
                  >
                    <Layers size={16} />
                    <span className="rail-text">专题监测</span>
                    <Lock size={12} className="rail-lock" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="rail-link rail-link-gated"
                    title="我的研究（需登录）"
                    onClick={() => openAuth("login", "登录后访问收藏证据、批注与已存查询。")}
                  >
                    <Bookmark size={16} />
                    <span className="rail-text">我的研究</span>
                    <Lock size={12} className="rail-lock" aria-hidden="true" />
                  </button>
                </>
              )}
            </nav>
          </div>
        </div>

        <div className="rail-footer">
          {user ? (
            <Link to="/settings" className="identity" title={`${user.email} · 设置`}>
              <span className="avatar">{user.email[0]?.toUpperCase() ?? "U"}</span>
              <div className="identity-meta">
                <span className="identity-email">{user.email}</span>
                <small>{user.role === "viewer" ? "研究成员" : "管理员"}</small>
              </div>
            </Link>
          ) : (
            <button
              type="button"
              className="guest-rail-btn"
              onClick={() => openAuth("login")}
              title="登录 / 注册"
            >
              <span className="avatar avatar-guest">客</span>
              <div className="identity-meta">
                <span className="identity-email">登录 / 注册</span>
                <small>开启收藏与研究笔记</small>
              </div>
            </button>
          )}
        </div>
      </aside>

      <div className="workspace-col">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-btn mobile-menu-btn"
              aria-label="打开导航菜单"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              <Menu size={18} />
            </button>
            <form className="global-search" role="search" onSubmit={handleGlobalSearch}>
              <Search size={14} className="global-search-icon" aria-hidden="true" />
              <input
                type="search"
                aria-label="全局搜索"
                placeholder="搜索标题、正文或关键词…"
                value={globalQuery}
                onChange={(event) => setGlobalQuery(event.target.value)}
              />
            </form>
          </div>

          <div className="topbar-right">
            <WorkbenchControls
              routes={commandRoutes}
              collapsed={collapsed}
              onToggle={toggleSidebar}
              admin={isAdmin}
            />
            {!user && (
              <div className="topbar-auth">
                <button
                  type="button"
                  className="topbar-btn"
                  onClick={() => openAuth("login")}
                >
                  登录
                </button>
                {publicRegistration && (
                  <button
                    type="button"
                    className="primary topbar-register-btn"
                    onClick={() => openAuth("register")}
                  >
                    注册
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="main">
          {message && (
            <div role="alert" className="alert global-alert">
              <span>{message}</span>
              <button type="button" className="icon-btn" aria-label="关闭提示" onClick={() => setMessage("")}>
                <X size={15} />
              </button>
            </div>
          )}
          <Suspense fallback={<p role="status" className="muted loading-note">正在加载页面…</p>}>
            <Routes>
              <Route
                path="/"
                element={
                  <Stories
                    user={user}
                    run={run}
                    openAuth={openAuth}
                    publicSources={publicSources.data?.sources ?? []}
                  />
                }
              />
              <Route
                path="/content"
                element={
                  <ContentLibrary
                    run={run}
                    canCollect={isAdmin}
                    user={user}
                    openAuth={openAuth}
                    publicSources={publicSources.data?.sources ?? []}
                  />
                }
              />
              <Route
                path="/projects"
                element={
                  user ? (
                    <Projects run={run} canEdit={isAdmin} />
                  ) : (
                    <AuthPromptCard
                      title="专题监测"
                      description="登录后可创建并追踪自定义关键词专题、按日对比趋势与下钻内容。"
                      openAuth={openAuth}
                      publicRegistration={publicRegistration}
                    />
                  )
                }
              />
              <Route
                path="/workspace"
                element={
                  user ? (
                    <Workspace run={run} />
                  ) : (
                    <AuthPromptCard
                      title="我的研究"
                      description="登录后可集中管理已收藏的报道、个人批注与常用检索查询。"
                      openAuth={openAuth}
                      publicRegistration={publicRegistration}
                    />
                  )
                }
              />
              <Route
                path="/sources"
                element={
                  !user ? (
                    <AuthPromptCard
                      title="来源运维"
                      description="请使用管理员账户登录后管理采集来源与渠道配额。"
                      openAuth={openAuth}
                      publicRegistration={false}
                    />
                  ) : !isAdmin ? (
                    <Empty>来源运维仅对管理员开放。</Empty>
                  ) : (
                    <Sources run={run} canEdit={isAdmin} />
                  )
                }
              />
              <Route
                path="/settings"
                element={
                  user ? (
                    <Account run={run} user={user} />
                  ) : (
                    <AuthPromptCard
                      title="账户设置"
                      description="登录后可查看账户状态与管理访问密钥。"
                      openAuth={openAuth}
                      publicRegistration={publicRegistration}
                    />
                  )
                }
              />
              <Route path="*" element={<Empty>页面不存在。请从左侧导航继续。</Empty>} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <AuthModal
        open={authDialog.open}
        mode={authDialog.mode}
        reason={authDialog.reason}
        publicRegistration={publicRegistration}
        onModeChange={(mode) => setAuthDialog((prev) => ({ ...prev, mode }))}
        onClose={closeAuth}
      />
    </div>
  );
}
