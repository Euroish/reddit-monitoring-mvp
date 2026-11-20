import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Bookmark,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  Command,
  Database,
  ExternalLink,
  Flame,
  FolderKanban,
  Globe,
  Grid,
  Heart,
  HelpCircle,
  Key,
  Layers,
  Link2,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sliders,
  Sparkles,
  TrendingUp,
  User,
  X,
} from 'lucide-react';
import {
  useAnnotationsListQuery,
  useBudgetsQuery,
  useLogoutMutation,
  useProjectsQuery,
  useQuotasSummaryQuery,
  useSavedQueriesQuery,
  useSourcesQuery,
} from '../api/hooks';
import { SiftlineLogo } from '../components/BrandMark';
import { useLogo } from '../components/brandContext';
import { useTheme } from '../components/themeContext';
import { type Actor, type CapabilitiesResponse, validateSearchTerm } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export type WorkbenchRoute = '/' | '/projects' | '/content' | '/sources' | '/workspace' | '/settings';

interface WorkbenchShellProps {
  actor: Actor | null;
  publicRegistration?: boolean;
  capabilities?: CapabilitiesResponse;
  route: WorkbenchRoute;
  currentSearch: string;
  selectedProjectId: string;
  onSelectProjectId: (id: string) => void;
  onNavigate: (path: string) => void;
  onOpenAuth: (tab?: 'login' | 'register', reason?: string, pendingTarget?: string) => void;
  children: React.ReactNode;
}

export function WorkbenchShell({
  actor,
  publicRegistration = false,
  route,
  currentSearch,
  selectedProjectId,
  onSelectProjectId,
  onNavigate,
  onOpenAuth,
  children,
}: WorkbenchShellProps) {
  const { lang, setLang, t } = useI18n();
  const { activeLogo, setSwitcherOpen } = useLogo();
  const { palette, setStudioOpen } = useTheme();
  const logoutMut = useLogoutMutation();

  const isAuthed = Boolean(actor);
  const canWrite = actor?.role === 'owner' || actor?.role === 'admin';
  const projectsQuery = useProjectsQuery(isAuthed);
  const sourcesQuery = useSourcesQuery(isAuthed);
  const queriesQuery = useSavedQueriesQuery(isAuthed);
  const annotationsQuery = useAnnotationsListQuery(isAuthed);
  const budgetsQuery = useBudgetsQuery(canWrite);
  const quotasSummaryQuery = useQuotasSummaryQuery(isAuthed);

  const projects = projectsQuery.data?.projects || [];
  const sources = useMemo(() => sourcesQuery.data?.sources ?? [], [sourcesQuery.data?.sources]);
  const savedQueries = queriesQuery.data?.queries || [];
  const annotations = annotationsQuery.data?.annotations || [];
  const budgets = useMemo(() => budgetsQuery.data?.budgets ?? [], [budgetsQuery.data?.budgets]);

  const activeProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const [collapsed, setCollapsed] = useState(false);
  const [mobileSideOpen, setMobileSideOpen] = useState(false);
  const [quickTerm, setQuickTerm] = useState('');
  const [quickErr, setQuickErr] = useState<string | null>(null);

  const [openPop, setOpenPop] = useState<'proj' | 'create' | 'notif' | 'avatar' | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [alertsDismissed, setAlertsDismissed] = useState(false);

  const blockedSources = useMemo(
    () => sources.filter((s) => s.automatic_collection_blocked),
    [sources],
  );
  const zeroQuotaProviders = useMemo(
    () => budgets.filter((b) => b.enabled && b.daily_requests === 0),
    [budgets],
  );
  const unreadNotifs = alertsDismissed ? 0 : blockedSources.length + zeroQuotaProviders.length;

  const searchParams = new URLSearchParams(currentSearch);
  const currentSection = searchParams.get('section') || '';
  const currentTab = searchParams.get('tab') || '';
  const currentView = searchParams.get('view') || '';

  const shellRef = useRef<HTMLDivElement>(null);

  // Close popovers on outside click
  useEffect(() => {
    if (!openPop) return;
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-pop-root]')) {
        setOpenPop(null);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [openPop]);

  // Global keyboard shortcuts matching DeepSeek app.js (Ctrl+K, Esc, [ to toggle sidebar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /INPUT|TEXTAREA|SELECT/.test(target.tagName);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        setPaletteQuery('');
        return;
      }
      if (e.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        if (openPop) {
          setOpenPop(null);
          return;
        }
        setMobileSideOpen(false);
        return;
      }
      if (!typing && e.key === '[') {
        setCollapsed((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, shortcutsOpen, openPop]);

  // Dynamic quota summary from real backend budgets / personal policy
  const quotaStats = useMemo(() => {
    const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
    if (!canWrite) {
      const q = quotasSummaryQuery.data;
      if (!q) return { pct: 0, used: '0', cap: '—' };
      const used = q.myUsage.requestsReserved;
      const cap = q.effectivePolicy.dailyRequests;
      if (!q.effectivePolicy.manualCollectEnabled) return { pct: 0, used: fmt(used), cap: 'Off' };
      if (cap === null) return { pct: 0, used: fmt(used), cap: '∞' };
      if (cap <= 0) return { pct: 0, used: fmt(used), cap: '0 cap' };
      return { pct: Math.min(100, Math.round((used / cap) * 100)), used: fmt(used), cap: fmt(cap) };
    }
    if (!budgets.length) return { pct: 0, used: '0', cap: '0' };
    const totalUsed = budgets.reduce((s, b) => s + (b.requests_today ?? 0), 0);
    const totalCap = budgets.reduce((s, b) => s + (b.enabled ? Math.max(0, b.daily_requests) : 0), 0);
    if (totalCap <= 0) return { pct: 0, used: fmt(totalUsed), cap: '0 cap' };
    const pct = Math.min(100, Math.round((totalUsed / totalCap) * 100));
    return { pct, used: fmt(totalUsed), cap: fmt(totalCap) };
  }, [canWrite, budgets, quotasSummaryQuery.data]);

  const handleGlobalSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuickErr(null);
    const trimmed = quickTerm.trim();
    if (trimmed) {
      const err = validateSearchTerm(trimmed);
      if (err) {
        setQuickErr(err);
        return;
      }
    }
    const qs = new URLSearchParams();
    if (trimmed) qs.set('query', trimmed);
    onNavigate(`/content${qs.toString() ? `?${qs.toString()}` : ''}`);
    setQuickTerm('');
  };

  const navigateAndClose = useCallback(
    (path: string) => {
      setMobileSideOpen(false);
      setOpenPop(null);
      onNavigate(path);
    },
    [onNavigate],
  );

  const projInitials = (name?: string) => {
    if (!name) return 'SL';
    const words = name.trim().split(/\s+/);
    return words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  };

  const userInitial = actor ? actor.email.slice(0, 2).toUpperCase() : 'G';

  const paletteCommands = useMemo(
    () => [
      { group: t('Feed', '信息流'), label: t("Today's Stories", '今日精选信息流'), kbd: 'G H', run: () => navigateAndClose('/') },
      { group: t('Feed', '信息流'), label: t('48h Momentum', '48 小时热度'), kbd: 'G T', run: () => navigateAndClose('/?view=hot') },
      { group: t('Feed', '信息流'), label: t('08:00 Daily Digest', '08:00 日报'), kbd: 'G D', run: () => navigateAndClose('/?view=digest') },
      { group: t('Feed', '信息流'), label: t('Product Overview', '产品介绍'), kbd: 'G P', run: () => navigateAndClose('/product') },
      { group: t('Navigate', '页面跳转'), label: t('Project Overview', '项目总览'), kbd: 'G O', run: () => navigateAndClose('/projects') },
      { group: t('Navigate', '页面跳转'), label: t('Signal Radar Analytics', '趋势雷达多维图谱'), kbd: 'G R', run: () => navigateAndClose('/projects?section=radar') },
      { group: t('Navigate', '页面跳转'), label: t('Content Explorer', '内容检索与过滤'), kbd: 'G E', run: () => navigateAndClose('/content') },
      { group: t('Navigate', '页面跳转'), label: t('Sources & Collection Jobs', '来源与采集任务'), kbd: 'G S', run: () => navigateAndClose('/sources') },
      { group: t('Navigate', '页面跳转'), label: t('Saved Queries & Annotations', '个人工作区'), kbd: 'G W', run: () => navigateAndClose('/workspace') },
      { group: t('Navigate', '页面跳转'), label: t('Account, Invites & Keys', '账户与机器密钥'), kbd: 'G A', run: () => navigateAndClose('/settings') },
      { group: t('Actions', '快捷操作'), label: t('Filter Pain Signals Only', '一键筛选痛点讨论'), kbd: '⚡', run: () => navigateAndClose('/content?signal=pain') },
      { group: t('Actions', '快捷操作'), label: t('Open Color Skin Studio (17 Presets)', '切换界面皮肤色调 (17 套预设)'), kbd: '🎨', run: () => setStudioOpen(true) },
      { group: t('Actions', '快捷操作'), label: t('Switch Brand Logo Mark (30 Concepts)', '切换品牌标志图标 (30 选 1)'), kbd: '✦', run: () => setSwitcherOpen(true) },
      { group: t('Actions', '快捷操作'), label: t('Switch Language (EN / 中文)', '切换界面语言 (EN / 中文)'), kbd: '🌐', run: () => setLang(lang === 'en' ? 'zh' : 'en') },
      { group: t('Actions', '快捷操作'), label: t('Keyboard Shortcuts', '查看键盘快捷键'), kbd: '?', run: () => setShortcutsOpen(true) },
    ],
    [lang, t, navigateAndClose, setLang, setStudioOpen, setSwitcherOpen],
  );

  const filteredCommands = paletteCommands.filter(
    (c) => !paletteQuery.trim() || c.label.toLowerCase().includes(paletteQuery.toLowerCase()),
  );

  return (
    <div
      ref={shellRef}
      className={`app-shell ${collapsed ? 'side-collapsed' : ''} ${mobileSideOpen ? 'side-open' : ''}`}
    >
      {/* ================= 1. Left Icon Rail ================= */}
      <aside className="rail" aria-label={t('Module switcher', '模块切换')}>
        <button
          type="button"
          className="rail-logo"
          onClick={() => navigateAndClose('/')}
          data-tip={t("Today's Stories", '今日精选信息流')}
          aria-label={t("Today's Stories", '今日精选信息流')}
        >
          <SiftlineLogo size={24} showWordmark={false} />
        </button>

        <div className="rail-group">
          <button
            type="button"
            className={`rail-btn ${route === '/' ? 'is-active' : ''}`}
            onClick={() => navigateAndClose('/')}
            data-tip={t('Stories Feed', '精选信息流')}
            aria-label={t('Stories Feed', '精选信息流')}
          >
            <BookOpen size={18} />
          </button>
          <button
            type="button"
            className={`rail-btn ${route === '/projects' ? 'is-active' : ''}`}
            onClick={() => navigateAndClose('/projects')}
            data-tip={t('Monitoring Overview', '监测总览')}
            aria-label={t('Monitoring Overview', '监测总览')}
          >
            <Grid size={18} />
          </button>
          <button
            type="button"
            className={`rail-btn ${route === '/content' ? 'is-active' : ''}`}
            onClick={() => navigateAndClose('/content')}
            data-tip={t('Content Explorer', '内容检索')}
            aria-label={t('Content Explorer', '内容检索')}
          >
            <Layers size={18} />
          </button>
          <button
            type="button"
            className={`rail-btn ${route === '/sources' ? 'is-active' : ''}`}
            onClick={() => navigateAndClose('/sources')}
            data-tip={t('Sources & Quotas', '来源与采集')}
            aria-label={t('Sources & Quotas', '来源与采集')}
          >
            <Database size={18} />
          </button>
          <button
            type="button"
            className={`rail-btn ${route === '/workspace' ? 'is-active' : ''}`}
            onClick={() => navigateAndClose('/workspace')}
            data-tip={t('Personal Workspace', '个人工作区')}
            aria-label={t('Personal Workspace', '个人工作区')}
          >
            <Bookmark size={18} />
          </button>
        </div>

        <div className="rail-sep" />

        <div className="rail-group">
          <button
            type="button"
            className="rail-btn"
            onClick={() => navigateAndClose('/projects?section=radar')}
            data-tip={t('Signal Radar Lab', '趋势雷达图谱')}
            aria-label={t('Signal Radar Lab', '趋势雷达图谱')}
          >
            <TrendingUp size={18} />
            <i className="lock-dot" style={{ background: 'var(--wb-teal)' }} />
          </button>
          <button
            type="button"
            className={`rail-btn ${route === '/settings' ? 'is-active' : ''}`}
            onClick={() => navigateAndClose('/settings')}
            data-tip={t('Account & Keys', '账户与权限')}
            aria-label={t('Account & Keys', '账户与权限')}
          >
            <Settings size={18} />
          </button>
        </div>

        <div className="rail-foot">
          <button
            type="button"
            className="rail-btn"
            onClick={() => setStudioOpen(true)}
            data-tip={t('Skin & Color Studio', '界面皮肤与配色方案')}
            aria-label={t('Skin & Color Studio', '界面皮肤与配色方案')}
          >
            <Palette size={17} />
          </button>
          <button
            type="button"
            className="rail-btn"
            onClick={() => setSwitcherOpen(true)}
            data-tip={`${t('Brand Logo', '品牌图标')} (${activeLogo.num}/30)`}
            aria-label={t('Switch Brand Logo', '切换品牌图标')}
          >
            <Sparkles size={17} />
          </button>
          <button
            type="button"
            className="rail-btn"
            onClick={() => setCollapsed((v) => !v)}
            data-tip={collapsed ? t('Expand Sidebar ([)', '展开侧边栏 ([)') : t('Collapse Sidebar ([)', '折叠侧边栏 ([)')}
            aria-label={t('Toggle sidebar', '折叠侧边栏')}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button
            type="button"
            className="rail-btn"
            onClick={() => setShortcutsOpen(true)}
            data-tip={t('Help & Shortcuts', '帮助与快捷键')}
            aria-label={t('Help & Shortcuts', '帮助与快捷键')}
          >
            <HelpCircle size={17} />
          </button>
        </div>
      </aside>

      {/* ================= 2. Collapsible Context Sidebar ================= */}
      <aside className="side">
        {/* Project Switcher (Authenticated) or Public Brand Header (Guest) */}
        {actor ? (
          <div className="proj-switch-wrap" data-pop-root>
            <button
              type="button"
              className="proj-switch"
              onClick={() => setOpenPop(openPop === 'proj' ? null : 'proj')}
              aria-expanded={openPop === 'proj'}
            >
              <span className="ps-avatar">{projInitials(activeProject?.name)}</span>
              <span className="ps-txt">
                <b>{activeProject?.name || t('Select Project', '选择监测项目')}</b>
                <small>
                  {activeProject
                    ? `${activeProject.source_ids.length} ${t('sources', '个来源')} · rev ${activeProject.revision}`
                    : t('Team Workspace', '团队空间')}
                </small>
              </span>
              <ChevronDown size={14} color="var(--faint)" />
            </button>

            {openPop === 'proj' && (
              <div className="ds-pop" style={{ top: '100%', left: 12, width: 292 }}>
                <div className="pop-hd">
                  <span>{t('Switch Project', '切换监测项目')}</span>
                  <span>{projects.length}</span>
                </div>
                <div style={{ display: 'grid', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`pop-opt ${p.id === activeProject?.id ? 'on' : ''}`}
                      onClick={() => {
                        onSelectProjectId(p.id);
                        setOpenPop(null);
                        if (route !== '/projects') onNavigate('/projects');
                      }}
                    >
                      <span className="ps-avatar" style={{ width: 24, height: 24, fontSize: 9.5 }}>
                        {projInitials(p.name)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <b style={{ display: 'block', fontSize: 11.5 }}>{p.name}</b>
                        <small style={{ color: 'var(--faint)', fontSize: 10 }}>
                          {p.source_ids.length} {t('sources', '个来源')} · rev {p.revision}
                        </small>
                      </span>
                      {p.id === activeProject?.id && <Check size={13} color="var(--wb-purple)" />}
                    </button>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid var(--line)', marginTop: 6, paddingTop: 6 }}>
                  <button
                    type="button"
                    className="pop-opt"
                    onClick={() => navigateAndClose('/projects?new=1')}
                  >
                    <Plus size={13} />
                    <span>{t('Create Monitoring Project', '新建监测项目')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="proj-switch-wrap">
            <button
              type="button"
              className="proj-switch"
              onClick={() => navigateAndClose('/')}
            >
              <span className="ps-avatar">SL</span>
              <span className="ps-txt">
                <b>SIFTLINE</b>
                <small>{t('Public Signal Reader', '公开信息流阅读器')}</small>
              </span>
            </button>
          </div>
        )}

        {/* Cmd+K Search Trigger */}
        <button
          type="button"
          className="cmd-trigger"
          onClick={() => {
            setPaletteOpen(true);
            setPaletteQuery('');
          }}
        >
          <Search size={13} />
          <span>{t('Search or jump...', '搜索或跳转…')}</span>
          <span className="kbd">Ctrl</span>
          <span className="kbd">K</span>
        </button>

        {/* Grouped Navigation */}
        <nav className="side-nav" aria-label={t('Primary navigation', '工作台导航')}>
          <div className="nav-group">
            <p className="nav-label">{t('Feed', '信息流')}</p>
            <button
              type="button"
              className={`nav-item ${route === '/' && (!currentView || currentView === 'latest') ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/')}
            >
              <BookOpen size={14} className="nav-ic" />
              <span>{t("Today's Stories", '今日精选')}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/' && currentView === 'hot' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/?view=hot')}
            >
              <Flame size={14} className="nav-ic" />
              <span>{t('48h Momentum', '48 小时热度')}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/' && currentView === 'digest' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/?view=digest')}
            >
              <Calendar size={14} className="nav-ic" />
              <span>{t('08:00 Digest', '08:00 日报')}</span>
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={() => navigateAndClose('/product')}
            >
              <ExternalLink size={14} className="nav-ic" />
              <span>{t('Product Intro', '产品介绍')}</span>
            </button>
          </div>

          <div className="nav-group">
            <p className="nav-label">{t('Monitoring', '监测')}</p>
            <button
              type="button"
              className={`nav-item ${route === '/projects' && !currentSection ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/projects')}
            >
              <Grid size={14} className="nav-ic" />
              <span>{t('Project Overview', '项目总览')}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/projects' && currentSection === 'radar' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/projects?section=radar')}
            >
              <TrendingUp size={14} className="nav-ic" />
              <span>{t('Trend Radar', '趋势雷达')}</span>
              <em className="ni-badge">{t('New', '新')}</em>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/projects' && currentSection === 'platform' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/projects?section=platform')}
            >
              <Layers size={14} className="nav-ic" />
              <span>{t('Platform Share', '平台构成')}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/projects' && currentSection === 'attribution' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/projects?section=attribution')}
            >
              <Link2 size={14} className="nav-ic" />
              <span>{t('Attribution', '渠道归因')}</span>
            </button>
          </div>

          <div className="nav-group">
            <p className="nav-label">{t('Research', '研究')}</p>
            <button
              type="button"
              className={`nav-item ${route === '/content' && currentView !== 'threads' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/content')}
            >
              <Search size={14} className="nav-ic" />
              <span>{t('Content Explorer', '内容检索')}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/content' && currentView === 'threads' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/content?view=threads')}
            >
              <MessageSquare size={14} className="nav-ic" />
              <span>{t('Thread Tree', '讨论树')}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/workspace' && currentTab === 'annotations' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/workspace?tab=annotations')}
            >
              <Heart size={14} className="nav-ic" />
              <span>{t('Annotations', '批注与收藏')}</span>
              <em className="ni-count">{annotations.length}</em>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/workspace' && currentTab !== 'annotations' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/workspace?tab=queries')}
            >
              <Bookmark size={14} className="nav-ic" />
              <span>{t('Saved Queries', '保存的查询')}</span>
              <em className="ni-count">{savedQueries.length}</em>
            </button>
          </div>

          <div className="nav-group">
            <p className="nav-label">{t('Collection Ops', '数据接入')}</p>
            <button
              type="button"
              className={`nav-item ${route === '/sources' && currentTab !== 'budgets' && currentTab !== 'jobs' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/sources?tab=sources')}
            >
              <Database size={14} className="nav-ic" />
              <span>{t('Sources List', '来源列表')}</span>
              <em className="ni-count">{sources.length}</em>
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/sources' && currentTab === 'jobs' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/sources?tab=jobs')}
            >
              <RefreshCw size={14} className="nav-ic" />
              <span>{t('Collection Jobs', '采集任务')}</span>
              <i className="ni-pulse" />
            </button>
            <button
              type="button"
              className={`nav-item ${route === '/sources' && currentTab === 'budgets' ? 'is-active' : ''}`}
              onClick={() => navigateAndClose('/sources?tab=budgets')}
            >
              <Sliders size={14} className="nav-ic" />
              <span>{t('Channel Quotas', '渠道配额')}</span>
            </button>
          </div>
        </nav>

        {/* Bottom Usage Card & User Account */}
        <div className="side-foot">
          {actor ? (
            <>
              <div className="usage-card">
                <div className="uc-top">
                  <span>{t('Daily Resource Quota', '今日采集资源配额')}</span>
                  <b>{quotaStats.pct}%</b>
                </div>
                <div className="uc-bar">
                  <i style={{ width: `${quotaStats.pct}%` }} />
                </div>
                <div className="uc-meta">
                  <span>
                    {quotaStats.used} / {quotaStats.cap}
                  </span>
                  <button type="button" onClick={() => navigateAndClose('/sources?tab=budgets')}>
                    {t('Manage', '治理')}
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="user-row"
                onClick={() => setOpenPop(openPop === 'avatar' ? null : 'avatar')}
              >
                <span className="u-avatar">{userInitial}</span>
                <span className="u-txt">
                  <b>{actor.email.split('@')[0]}</b>
                  <small>
                    {actor.role} · {actor.email}
                  </small>
                </span>
                <MoreHorizontal size={14} color="#a3aa9f" />
              </button>
            </>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              <button
                type="button"
                className="ds-btn"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => onOpenAuth('login', undefined, '/projects')}
              >
                <LogIn size={14} />
                <span>{t('Sign in to Workbench', '登录进入工作台')}</span>
              </button>
              {publicRegistration && (
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => onOpenAuth('register', undefined, '/projects')}
                >
                  <span>{t('Create Account', '注册账号')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ================= 3. Main Content Column ================= */}
      <div className="ds-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn only-mobile"
            onClick={() => setMobileSideOpen((v) => !v)}
            aria-label={t('Open menu', '打开菜单')}
          >
            <Menu size={18} />
          </button>

          <form className="global-search" onSubmit={handleGlobalSearchSubmit}>
            <Search size={14} color="#8d968a" />
            <input
              value={quickTerm}
              onChange={(e) => {
                setQuickTerm(e.target.value);
                setQuickErr(null);
              }}
              placeholder={t('Search discussions, projects or press Ctrl+K...', '搜索讨论、项目或按 Ctrl+K 快速跳转…')}
              aria-label={t('Global search', '全局搜索')}
            />
            <span className="gs-hint">
              <span className="kbd">Ctrl</span>
              <span className="kbd">K</span>
            </span>
          </form>

          {quickErr && (
            <span style={{ fontSize: 11, color: '#a8462f', whiteSpace: 'nowrap' }}>{quickErr}</span>
          )}

          <div className="top-actions" data-pop-root>
            {/* Color Skin Switcher Button (Requested Feature!) */}
            <button
              type="button"
              className="top-pill-btn"
              onClick={() => setStudioOpen(true)}
              title={t('Change UI Skin & Color Palette', '切换工作台界面皮肤色调')}
            >
              <span
                className="skin-dot-swatch"
                style={{
                  background: palette.hasGradient
                    ? `linear-gradient(135deg, ${palette.accent}, ${palette.accentEnd || palette.accent2})`
                    : palette.accent,
                }}
              />
              <span>{lang === 'zh' ? palette.nameZh.split(' × ')[0] : palette.nameEn.split(' & ')[0]}</span>
              <Palette size={12} color="var(--faint)" />
            </button>

            {/* Language Switcher EN / 中文 (Requested Feature!) */}
            <button
              type="button"
              className="top-pill-btn"
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
              title={t('Switch Display Language', '切换中英文界面')}
            >
              <Globe size={13} />
              <span>{lang === 'en' ? '中文' : 'EN'}</span>
            </button>

            {/* Product Intro Link */}
            <button
              type="button"
              className="top-pill-btn"
              onClick={() => navigateAndClose('/product')}
              title={t('Product Overview', '查看产品介绍')}
            >
              <span>{t('Product', '产品介绍')}</span>
            </button>

            {actor ? (
              <>
                {/* Live Session Status Pill */}
                <button
                  type="button"
                  className="top-pill-btn"
                  onClick={() => navigateAndClose('/settings')}
                  title={t('Live /api/v1 Cookie Session & RBAC Role', '当前在线 /api/v1 同源会话与权限角色')}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--wb-teal)',
                    }}
                  />
                  <span>Live · {actor.role}</span>
                </button>

                {/* + New Quick Create */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="ds-btn ds-btn--brand"
                    style={{ height: 33, padding: '0 13px', fontSize: 12 }}
                    onClick={() => setOpenPop(openPop === 'create' ? null : 'create')}
                  >
                    <Plus size={14} />
                    <span>{t('New', '新建')}</span>
                  </button>

                  {openPop === 'create' && (
                    <div className="ds-pop" style={{ top: 'calc(100% + 6px)', right: 0, width: 220 }}>
                      <div className="pop-hd"><span>{t('Quick Create', '新建')}</span></div>
                      <button type="button" className="pop-opt" onClick={() => navigateAndClose('/projects?new=1')}>
                        <FolderKanban size={13} />
                        <span style={{ flex: 1 }}>{t('Monitoring Project', '监测项目')}</span>
                        <span className="kbd">P</span>
                      </button>
                      <button type="button" className="pop-opt" onClick={() => navigateAndClose('/sources?new=1')}>
                        <Database size={13} />
                        <span style={{ flex: 1 }}>{t('Collection Source', '采集来源')}</span>
                        <span className="kbd">S</span>
                      </button>
                      <button type="button" className="pop-opt" onClick={() => navigateAndClose('/content')}>
                        <Bookmark size={13} />
                        <span style={{ flex: 1 }}>{t('Run & Save Query', '检索并保存查询')}</span>
                        <span className="kbd">Q</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Notification Bell */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setOpenPop(openPop === 'notif' ? null : 'notif')}
                    aria-label={t('Notifications', '通知')}
                  >
                    <Bell size={17} />
                    {unreadNotifs > 0 && <i className="notif-dot" />}
                  </button>

                  {openPop === 'notif' && (
                    <div className="ds-pop" style={{ top: 'calc(100% + 6px)', right: 0, width: 310, padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <b>{t('System Alerts', '运行与采集告警')}</b>
                        <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                          {unreadNotifs} {t('active', '条提示')}
                        </span>
                      </div>
                      {blockedSources.map((src) => (
                        <div key={src.id} style={{ padding: '10px 14px', borderBottom: '1px solid #f3f5ee', display: 'flex', gap: 9 }}>
                          <AlertTriangle size={15} color="#d4821c" style={{ flexShrink: 0, marginTop: 2 }} />
                          <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                            <b>{src.label}</b> · {t('Automatic collection blocked pending review', '存在未决付费阶段任务，已暂停自动采集')}
                          </div>
                        </div>
                      ))}
                      {zeroQuotaProviders.map((b) => (
                        <div key={b.provider} style={{ padding: '10px 14px', borderBottom: '1px solid #f3f5ee', display: 'flex', gap: 9 }}>
                          <AlertTriangle size={15} color="#6b756a" style={{ flexShrink: 0, marginTop: 2 }} />
                          <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                            <b>{b.provider}</b> · {t('Daily request cap is 0', '已启用但日请求额度上限为 0')}
                          </div>
                        </div>
                      ))}
                      {blockedSources.length === 0 && zeroQuotaProviders.length === 0 && (
                        <div style={{ padding: '16px 14px', textAlign: 'center', fontSize: 11.5, color: 'var(--faint)' }}>
                          {t('No active collection or quota alerts.', '当前无阻断来源或配额告警。')}
                        </div>
                      )}
                      {(blockedSources.length > 0 || zeroQuotaProviders.length > 0) && (
                        <div style={{ padding: 6, textAlign: 'center' }}>
                          <button
                            type="button"
                            className="ds-btn ds-btn--quiet"
                            style={{ fontSize: 11, width: '100%' }}
                            onClick={() => {
                              setAlertsDismissed(true);
                              setOpenPop(null);
                            }}
                          >
                            {t('Dismiss notifications', '忽略当前红点')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Avatar Popover */}
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="avatar-btn"
                    onClick={() => setOpenPop(openPop === 'avatar' ? null : 'avatar')}
                    aria-label={t('Account Menu', '账户菜单')}
                  >
                    {userInitial}
                  </button>

                  {openPop === 'avatar' && (
                    <div className="ds-pop" style={{ top: 'calc(100% + 6px)', right: 0, width: 236 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px 10px', borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
                        <span className="u-avatar">{userInitial}</span>
                        <div style={{ minWidth: 0 }}>
                          <b style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{actor.email}</b>
                          <span style={{ fontSize: 10, color: 'var(--faint)' }}>{actor.role} · {actor.clientKind}</span>
                        </div>
                      </div>
                      <button type="button" className="pop-opt" onClick={() => navigateAndClose('/settings')}>
                        <User size={13} />
                        <span>{t('Account & Access', '账户与权限')}</span>
                      </button>
                      <button type="button" className="pop-opt" onClick={() => navigateAndClose('/settings?tab=keys')}>
                        <Key size={13} />
                        <span>{t('Machine API Keys', '机器 API 密钥')}</span>
                      </button>
                      <button type="button" className="pop-opt" onClick={() => { setOpenPop(null); setStudioOpen(true); }}>
                        <Palette size={13} />
                        <span>{t('Skin & Color Studio', '切换皮肤配色 (17套)')}</span>
                      </button>
                      <button type="button" className="pop-opt" onClick={() => { setOpenPop(null); setSwitcherOpen(true); }}>
                        <Sparkles size={13} />
                        <span>{t('Logo Mark Explorer (30)', '切换品牌标志 (30套)')}</span>
                      </button>
                      <div style={{ borderTop: '1px solid var(--line)', margin: '5px 0' }} />
                      <button type="button" className="pop-opt" onClick={() => navigateAndClose('/product')}>
                        <ExternalLink size={13} />
                        <span>{t('Product Intro', '产品介绍页')}</span>
                      </button>
                      <button
                        type="button"
                        className="pop-opt"
                        style={{ color: '#a8462f' }}
                        onClick={() => {
                          setOpenPop(null);
                          logoutMut.mutate();
                        }}
                      >
                        <LogOut size={13} />
                        <span>{t('Log Out', '退出登录')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <button
                type="button"
                className="ds-btn ds-btn--brand"
                style={{ height: 33, padding: '0 14px', fontSize: 12 }}
                onClick={() => onOpenAuth('login', undefined, '/projects')}
              >
                <LogIn size={14} />
                <span>{t('Sign in', '登录')}</span>
              </button>
            )}
          </div>
        </header>

        {/* Scrollable View */}
        <main className="ds-view">{children}</main>
      </div>

      {/* ================= 4. Ctrl+K Command Palette ================= */}
      {paletteOpen && (
        <div className="palette-backdrop" onClick={() => setPaletteOpen(false)}>
          <div className="palette-box" onClick={(e) => e.stopPropagation()}>
            <div className="pl-input">
              <Search size={15} color="var(--faint)" />
              <input
                autoFocus
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                placeholder={t('Jump to view, toggle skin or search actions...', '搜索页面、切换皮肤、或运行快捷命令…')}
              />
              <span className="kbd">Esc</span>
            </div>
            <div className="pl-list">
              {filteredCommands.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>
                  {t('No matching commands', '未找到匹配命令')}
                </div>
              ) : (
                filteredCommands.map((cmd, idx) => (
                  <React.Fragment key={cmd.label}>
                    {(idx === 0 || filteredCommands[idx - 1].group !== cmd.group) && (
                      <div className="pl-group">{cmd.group}</div>
                    )}
                    <button
                      type="button"
                      className="pl-item"
                      onClick={() => {
                        setPaletteOpen(false);
                        cmd.run();
                      }}
                    >
                      <Command size={13} color="var(--faint)" />
                      <span style={{ flex: 1 }}>{cmd.label}</span>
                      <span className="kbd">{cmd.kbd}</span>
                    </button>
                  </React.Fragment>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= 5. Keyboard Shortcuts Modal ================= */}
      {shortcutsOpen && (
        <div className="sr-modal-backdrop" onClick={() => setShortcutsOpen(false)}>
          <div className="sr-modal" style={{ width: 'min(480px, 100%)', padding: '22px 24px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 650 }}>
                  {t('Keyboard Shortcuts', '工作台快捷键')}
                </h3>
                <p style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>
                  {t('Fast workbench navigation & controls', '快速切换面板、检索与皮肤调色')}
                </p>
              </div>
              <button type="button" className="sr-btn sr-btn--subtle sr-btn--xs" onClick={() => setShortcutsOpen(false)}>
                <X size={15} />
              </button>
            </div>
            <div style={{ display: 'grid', gap: 2 }}>
              {[
                [t('Open Command Palette', '打开命令面板'), 'Ctrl / ⌘ + K'],
                [t('Toggle Context Sidebar', '展开/收起次级边栏'), '['],
                [t('Close Active Modal / Popover', '关闭当前浮层'), 'Esc'],
                [t('Switch Color Skin', '切换皮肤色调'), t('Topbar Skin Button', '顶栏皮肤按钮')],
                [t('Switch Language', '切换中英文'), t('Topbar EN/中文', '顶栏语言切换')],
              ].map(([label, key]) => (
                <div key={label} className="toggle-line" style={{ borderBottom: '1px solid #f3f5ee' }}>
                  <span>{label}</span>
                  <span className="kbd">{key}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, textAlign: 'right' }}>
              <button type="button" className="ds-btn" onClick={() => setShortcutsOpen(false)}>
                {t('Got it', '知道了')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
