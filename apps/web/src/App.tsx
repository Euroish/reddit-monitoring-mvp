import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Lock, RefreshCw } from 'lucide-react';
import { formatApiError, useCapabilitiesQuery, useLogoutMutation, useSessionQuery } from './api/hooks';
import { AuthModal } from './components/AuthModal';
import { AccountEmailConfirm } from './components/AccountEmail';
import { LogoProvider } from './components/BrandMark';
import { type PublicRoute, PublicSiteShell } from './components/PublicSiteShell';
import { ThemeProvider } from './components/ThemeStudio';
import { type Lang, LangContext } from './i18n/translations';
import { PublicInfoHomePage } from './pages/PublicInfoHomePage';
import type { WorkbenchRoute } from './pages/WorkbenchShell';

const AiNewsPage = lazy(() => import('./pages/AiNewsPage').then((m) => ({ default: m.AiNewsPage })));
const GuidePage = lazy(() => import('./pages/GuidePage').then((m) => ({ default: m.GuidePage })));
const DocsPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })));
const Homepage = lazy(() => import('./pages/Homepage').then((m) => ({ default: m.Homepage })));
const StoriesPage = lazy(() =>
  import('./pages/StoriesPage').then((m) => ({ default: m.StoriesPage })),
);
const WorkbenchShell = lazy(() =>
  import('./pages/WorkbenchShell').then((m) => ({ default: m.WorkbenchShell })),
);
const ContentExplorerPage = lazy(() =>
  import('./pages/ContentExplorerPage').then((m) => ({ default: m.ContentExplorerPage })),
);
const ProjectsPage = lazy(() =>
  import('./pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
);
const SourcesPage = lazy(() =>
  import('./pages/SourcesPage').then((m) => ({ default: m.SourcesPage })),
);
const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const AiReviewQueuePage = lazy(() =>
  import('./pages/AiReviewQueuePage').then((m) => ({ default: m.AiReviewQueuePage })),
);

type AppRoute = PublicRoute | '/guide' | WorkbenchRoute;

const PUBLIC_ROUTES: PublicRoute[] = ['/', '/product', '/ai', '/docs'];

const WORKBENCH_ROUTES: WorkbenchRoute[] = [
  '/app/feed',
  '/projects',
  '/content',
  '/sources',
  '/workspace',
  '/settings',
  '/admin/queue',
];

const AUTH_REQUIRED_ROUTES: WorkbenchRoute[] = [
  '/projects',
  '/sources',
  '/workspace',
  '/settings',
  '/admin/queue',
];

const LEGACY_FEED_PARAMS = ['view', 'date', 'sourceGroup', 'tier', 'language', 'sourceId'] as const;

function hasLegacyFeedQuery(search: string): boolean {
  if (!search) return false;
  const sp = new URLSearchParams(search);
  return LEGACY_FEED_PARAMS.some((k) => {
    const val = sp.get(k);
    return val !== null && val !== '';
  });
}

function parseLocation(): { pathname: AppRoute; rawPathname: string; search: string } {
  const rawPathname = window.location.pathname || '/';
  const search = window.location.search.replace(/^\?/, '');

  // Backward compatibility: /?view=latest|hot|digest or feed filters -> /app/feed?...
  if (rawPathname === '/' && hasLegacyFeedQuery(search)) {
    const nextPath = `/app/feed?${search}`;
    window.history.replaceState(null, '', nextPath);
    return { pathname: '/app/feed', rawPathname: '/app/feed', search };
  }

  let pathname: AppRoute = '__not_found__';
  if (rawPathname === '/guide') {
    pathname = '/guide';
  } else if (PUBLIC_ROUTES.includes(rawPathname as PublicRoute)) {
    pathname = rawPathname as PublicRoute;
  } else if (WORKBENCH_ROUTES.includes(rawPathname as WorkbenchRoute)) {
    pathname = rawPathname as WorkbenchRoute;
  }
  return { pathname, rawPathname, search };
}

function PageFallback({ label }: { label: string }) {
  return (
    <div
      style={{
        minHeight: '50vh',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--muted)',
        fontSize: 13,
      }}
    >
      {label}
    </div>
  );
}

export function App() {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return localStorage.getItem('siftline.lang') === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('siftline.lang', l);
    } catch {
      // ignore storage failure
    }
  };

  const t = useCallback((en: string, zh: string) => (lang === 'zh' ? zh : en), [lang]);

  const [loc, setLoc] = useState(parseLocation);
  const [authModal, setAuthModal] = useState<{
    open: boolean;
    tab: 'login' | 'register';
    reason?: string;
    pendingTarget?: string;
  }>({
    open: false,
    tab: 'login',
  });
  const [contentDetailId, setContentDetailId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  useEffect(() => {
    const onPop = () => setLoc(parseLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((pathWithQuery: string) => {
    window.history.pushState(null, '', pathWithQuery);
    setLoc(parseLocation());
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const openAuth = useCallback(
    (tab: 'login' | 'register' = 'login', reason?: string, pendingTarget?: string) => {
      setAuthModal({ open: true, tab, reason, pendingTarget });
    },
    [],
  );

  const sessionQuery = useSessionQuery();
  const logoutMut = useLogoutMutation();
  const actor = sessionQuery.data?.user ?? null;
  const publicRead = sessionQuery.data?.publicRead ?? false;
  const publicRegistration = sessionQuery.data?.publicRegistration ?? false;
  const turnstileSiteKey = sessionQuery.data?.turnstileSiteKey;
  const capabilitiesQuery = useCapabilitiesQuery(Boolean(actor));

  const currentFullPath = `${loc.rawPathname}${loc.search ? `?${loc.search}` : ''}`;

  const pendingQueryContext = useMemo(() => {
    const raw = authModal.pendingTarget || currentFullPath;
    const qPart = raw.split('?')[1];
    if (!qPart) return undefined;
    const sp = new URLSearchParams(qPart);
    const q = sp.get('query');
    const p = sp.get('platform');
    if (q && p) return `${q} (${p})`;
    return q || p || undefined;
  }, [authModal.pendingTarget, currentFullPath]);

  const handleEnterWorkbench = useCallback(
    (targetPath = '/projects') => {
      if (!actor) {
        openAuth(
          'login',
          t('Sign in to enter the monitoring workbench.', '请登录以进入监测工作台。'),
          targetPath,
        );
        return;
      }
      navigate(targetPath);
    },
    [actor, navigate, openAuth, t],
  );

  const handleSwitchAccount = useCallback(async () => {
    try {
      await logoutMut.mutateAsync();
    } catch {
      // Proceed to login modal even if session already expired
    }
    setSelectedProjectId('');
    setContentDetailId(null);
    openAuth(
      'login',
      t('Signed out of previous session. Sign in with another account.', '已退出当前会话，请使用其他账号重新登录。'),
      currentFullPath,
    );
  }, [currentFullPath, logoutMut, openAuth, t]);

  if (sessionQuery.isLoading) {
    return (
      <LangContext.Provider value={{ lang, setLang, t }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--wb-bg)',
            color: 'var(--muted)',
            fontSize: 13,
          }}
        >
          {t('Loading SIFTLINE...', '正在初始化工作台…')}
        </div>
      </LangContext.Provider>
    );
  }

  if (sessionQuery.isError) {
    return (
      <LangContext.Provider value={{ lang, setLang, t }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--wb-bg)',
            padding: 24,
          }}
        >
          <div className="ds-card" style={{ maxWidth: 440, width: '100%', padding: 28, textAlign: 'center' }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: '50%',
                background: '#fdf1ee',
                color: '#a8462f',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 12px',
              }}
            >
              <AlertCircle size={18} />
            </div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              {t('Unable to connect to SIFTLINE', '无法连接到服务端')}
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16 }}>
              {formatApiError(sessionQuery.error)}
            </p>
            <button
              type="button"
              className="ds-btn"
              disabled={sessionQuery.isFetching}
              onClick={() => void sessionQuery.refetch()}
            >
              <RefreshCw size={13} />
              <span>{sessionQuery.isFetching ? t('Retrying...', '重试中…') : t('Retry', '重试')}</span>
            </button>
          </div>
        </div>
      </LangContext.Provider>
    );
  }

  if (loc.rawPathname === '/account/confirm') {
    return (
      <LangContext.Provider value={{ lang, setLang, t }}>
        <AccountEmailConfirm />
      </LangContext.Provider>
    );
  }

  // Private deployment mode (publicRead=false) without an authenticated session
  if (!actor && !publicRead) {
    return (
      <LangContext.Provider value={{ lang, setLang, t }}>
        <ThemeProvider>
          <LogoProvider>
            <AuthModal
              inline
              publicRegistration={publicRegistration}
              turnstileSiteKey={turnstileSiteKey}
              initialQueryContext={pendingQueryContext}
              reason={t(
                'This deployment requires authentication before reading stories or workspace data.',
                '当前为私有部署模式，请先登录以浏览信息流与监测工作台。',
              )}
              onSuccess={() => {
                void sessionQuery.refetch();
                if (loc.pathname === '__not_found__') {
                  navigate('/');
                }
              }}
            />
          </LogoProvider>
        </ThemeProvider>
      </LangContext.Provider>
    );
  }

  const authOverlay = authModal.open ? (
    <AuthModal
      initialTab={authModal.tab}
      initialQueryContext={pendingQueryContext}
      publicRegistration={publicRegistration}
      turnstileSiteKey={turnstileSiteKey}
      reason={authModal.reason}
      onClose={() => setAuthModal((s) => ({ ...s, open: false }))}
      onSuccess={() => {
        const target = authModal.pendingTarget;
        setAuthModal((s) => ({ ...s, open: false }));
        void sessionQuery.refetch();
        if (target && target !== currentFullPath) navigate(target);
      }}
    />
  ) : null;

  // Consumer-facing product guide (/guide from PR #11), preserved intact
  if (loc.pathname === '/guide') {
    return (
      <LangContext.Provider value={{ lang, setLang, t }}>
        <ThemeProvider>
          <LogoProvider>
            <Suspense fallback={<PageFallback label={t('Opening the guide…', '正在打开使用手册…')} />}>
              <GuidePage
                isAuthenticated={Boolean(actor)}
                onNavigate={navigate}
                onOpenAuth={() => openAuth('login', undefined, '/projects')}
              />
            </Suspense>
            {authOverlay}
          </LogoProvider>
        </ThemeProvider>
      </LangContext.Provider>
    );
  }

  const isPublicSiteRoute =
    loc.pathname === '/' ||
    loc.pathname === '/product' ||
    loc.pathname === '/ai' ||
    loc.pathname === '/docs' ||
    loc.pathname === '__not_found__';

  if (isPublicSiteRoute) {
    return (
      <LangContext.Provider value={{ lang, setLang, t }}>
        <ThemeProvider>
          <LogoProvider>
            <PublicSiteShell
              actor={actor}
              route={loc.pathname as PublicRoute}
              onNavigate={navigate}
              onOpenAuth={openAuth}
              onSwitchAccount={() => void handleSwitchAccount()}
              onOpenWorkbench={handleEnterWorkbench}
              switchingAccount={logoutMut.isPending}
            >
              {loc.pathname === '/' && (
                <PublicInfoHomePage
                  actor={actor}
                  onNavigate={navigate}
                  onOpenAuth={(tab, reason) => openAuth(tab, reason, currentFullPath)}
                />
              )}

              {loc.pathname === '/product' && (
                <Suspense fallback={<PageFallback label={t('Loading product overview...', '正在加载产品介绍…')} />}>
                  <Homepage
                    embedded
                    isAuthenticated={Boolean(actor)}
                    onOpenAuth={(tab = 'login') => openAuth(tab, undefined, '/projects')}
                    onEnterWorkbench={handleEnterWorkbench}
                    onGoFeed={() => navigate('/app/feed')}
                  />
                </Suspense>
              )}

              {loc.pathname === '/ai' && (
                <Suspense fallback={<PageFallback label={t('Loading AI Release Intelligence...', '正在加载 AI 资讯中心…')} />}>
                  <AiNewsPage actor={actor} search={loc.search} onNavigate={navigate} onOpenAuth={openAuth} />
                </Suspense>
              )}

              {loc.pathname === '/docs' && (
                <Suspense fallback={<PageFallback label={t('Opening the documentation center…', '正在打开文档中心…')} />}>
                  <DocsPage
                    embedded
                    actor={actor}
                    search={loc.search}
                    onNavigate={navigate}
                    onOpenAuth={() => openAuth('login', undefined, '/docs')}
                  />
                </Suspense>
              )}

              {loc.pathname === '__not_found__' && (
                <div className="pdoc-wrap">
                  <div className="ds-card" style={{ maxWidth: 500, margin: '40px auto', padding: 28, textAlign: 'center' }}>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
                      404 · {t('Page not found', '未找到对应页面')}
                    </h1>
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
                      {t(
                        `No route matches "${loc.rawPathname}". Return to the public information home or full feed.`,
                        `路径 "${loc.rawPathname}" 不存在，可返回公开信息首页或完整信息流。`,
                      )}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                      <button type="button" className="ds-btn" onClick={() => navigate('/')}>
                        {t('Back to Home', '返回公开首页')}
                      </button>
                      <button type="button" className="ds-btn ds-btn--ghost" onClick={() => navigate('/app/feed')}>
                        {t('Full Feed', '完整信息流')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </PublicSiteShell>
            {authOverlay}
          </LogoProvider>
        </ThemeProvider>
      </LangContext.Provider>
    );
  }

  const workbenchRoute = loc.pathname as WorkbenchRoute;
  const needsAuthForRoute = AUTH_REQUIRED_ROUTES.includes(workbenchRoute);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      <ThemeProvider>
        <LogoProvider>
          <Suspense fallback={<PageFallback label={t('Loading workbench...', '正在加载工作台…')} />}>
            <WorkbenchShell
              actor={actor}
              publicRegistration={publicRegistration}
              capabilities={capabilitiesQuery.data}
              route={workbenchRoute}
              currentSearch={loc.search}
              selectedProjectId={selectedProjectId}
              onSelectProjectId={setSelectedProjectId}
              onNavigate={navigate}
              onOpenAuth={openAuth}
            >
              {workbenchRoute === '/app/feed' && (
                <StoriesPage
                  actor={actor}
                  basePath="/app/feed"
                  initialSearchString={loc.search}
                  onNavigate={navigate}
                  onOpenAuth={(tab, reason) => openAuth(tab, reason, currentFullPath)}
                />
              )}

              {workbenchRoute === '/content' && (
                <ContentExplorerPage
                  key={loc.search}
                  actor={actor}
                  initialQueryString={loc.search}
                  initialDetailId={contentDetailId}
                  onClearDetailId={() => setContentDetailId(null)}
                  onOpenAuth={(tab, reason) => openAuth(tab, reason, currentFullPath)}
                />
              )}

              {needsAuthForRoute && !actor && (
                <div className="ds-page">
                  <div className="ds-card" style={{ maxWidth: 480, margin: '48px auto', padding: 28, textAlign: 'center' }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: '50%',
                        background: 'var(--wb-tint)',
                        color: 'var(--wb-purple)',
                        display: 'grid',
                        placeItems: 'center',
                        margin: '0 auto 12px',
                      }}
                    >
                      <Lock size={18} />
                    </div>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
                      {t('Sign in required', '该模块需要登录后访问')}
                    </h2>
                    <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16 }}>
                      {t(
                        'Projects, sources, personal workspace, and settings require an authenticated account.',
                        '专题监测、来源运维、个人工作区与账户设置需要登录会话权限。',
                      )}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                      <button
                        type="button"
                        className="ds-btn"
                        onClick={() =>
                          openAuth(
                            'login',
                            t('Sign in to access this workspace module.', '请登录以访问该工作台模块。'),
                            currentFullPath,
                          )
                        }
                      >
                        {t('Sign in', '立即登录')}
                      </button>
                      <button type="button" className="ds-btn ds-btn--ghost" onClick={() => navigate('/')}>
                        {t('Back to Public Home', '返回公开首页')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {workbenchRoute === '/projects' && actor && (
                <ProjectsPage
                  actor={actor}
                  selectedProjectId={selectedProjectId}
                  onSelectProjectId={setSelectedProjectId}
                  initialSearchString={loc.search}
                  onNavigate={navigate}
                  onDrilldown={(projectId, extraQs) => {
                    const sp = new URLSearchParams(extraQs || '');
                    if (projectId) sp.set('projectId', projectId);
                    const suffix = sp.toString() ? `?${sp.toString()}` : '';
                    navigate(`/content${suffix}`);
                  }}
                  onOpenContentDetail={(cid) => {
                    setContentDetailId(cid);
                    navigate('/content');
                  }}
                />
              )}

              {workbenchRoute === '/sources' && actor && (
                <SourcesPage actor={actor} initialQueryString={loc.search} onNavigate={navigate} />
              )}

              {workbenchRoute === '/workspace' && actor && (
                <WorkspacePage
                  initialQueryString={loc.search}
                  onRunSavedQuery={(qs) => navigate(`/content${qs ? `?${qs}` : ''}`)}
                  onOpenContentDetail={(cid) => {
                    setContentDetailId(cid);
                    navigate('/content');
                  }}
                  onNavigate={navigate}
                />
              )}

              {workbenchRoute === '/settings' && actor && (
                <SettingsPage actor={actor} initialQueryString={loc.search} />
              )}

              {workbenchRoute === '/admin/queue' && actor && (
                <AiReviewQueuePage actor={actor} onNavigate={navigate} />
              )}
            </WorkbenchShell>
          </Suspense>
          {authOverlay}
        </LogoProvider>
      </ThemeProvider>
    </LangContext.Provider>
  );
}

export default App;
