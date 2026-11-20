import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Lock, RefreshCw } from 'lucide-react';
import { formatApiError, useCapabilitiesQuery, useSessionQuery } from './api/hooks';
import { AuthModal } from './components/AuthModal';
import { type Lang, LangContext } from './i18n/translations';
import { ContentExplorerPage } from './pages/ContentExplorerPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SourcesPage } from './pages/SourcesPage';
import { StoriesPage } from './pages/StoriesPage';
import { type WorkbenchRoute, WorkbenchShell } from './pages/WorkbenchShell';
import { WorkspacePage } from './pages/WorkspacePage';

const KNOWN_ROUTES: WorkbenchRoute[] = [
  '/',
  '/projects',
  '/content',
  '/sources',
  '/workspace',
  '/settings',
];

const AUTH_REQUIRED_ROUTES: WorkbenchRoute[] = [
  '/projects',
  '/sources',
  '/workspace',
  '/settings',
];

function parseLocation(): { pathname: WorkbenchRoute; search: string } {
  const raw = window.location.pathname || '/';
  const pathname = KNOWN_ROUTES.includes(raw as WorkbenchRoute) ? (raw as WorkbenchRoute) : '/';
  return {
    pathname,
    search: window.location.search.replace(/^\?/, ''),
  };
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

  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

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
  const actor = sessionQuery.data?.user ?? null;
  const publicRead = sessionQuery.data?.publicRead ?? false;
  const publicRegistration = sessionQuery.data?.publicRegistration ?? false;
  const capabilitiesQuery = useCapabilitiesQuery(Boolean(actor));

  const needsAuthForRoute = AUTH_REQUIRED_ROUTES.includes(loc.pathname);

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

  // Private mode: show clean inline login screen with zero fake marketing
  if (!publicRead && !actor) {
    return (
      <LangContext.Provider value={{ lang, setLang, t }}>
        <AuthModal
          inline
          publicRegistration={publicRegistration}
          onSuccess={() => {
            const target = loc.search ? `${loc.pathname}?${loc.search}` : loc.pathname;
            navigate(target || '/');
          }}
        />
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      <WorkbenchShell
        actor={actor}
        publicRead={publicRead}
        publicRegistration={publicRegistration}
        capabilities={capabilitiesQuery.data}
        route={loc.pathname}
        currentSearch={loc.search}
        selectedProjectId={selectedProjectId}
        onSelectProjectId={setSelectedProjectId}
        onNavigate={navigate}
        onOpenAuth={openAuth}
      >
        {loc.pathname === '/' && (
          <StoriesPage
            actor={actor}
            initialSearchString={loc.search}
            onNavigate={navigate}
            onOpenAuth={(tab, reason) => openAuth(tab, reason)}
          />
        )}

        {loc.pathname === '/content' && (
          <ContentExplorerPage
            key={loc.search}
            actor={actor}
            initialQueryString={loc.search}
            initialDetailId={contentDetailId}
            onClearDetailId={() => setContentDetailId(null)}
            onOpenAuth={(tab, reason) => openAuth(tab, reason)}
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
                  onClick={() => openAuth('login', undefined, `${loc.pathname}${loc.search ? `?${loc.search}` : ''}`)}
                >
                  {t('Sign in', '立即登录')}
                </button>
                <button type="button" className="ds-btn ds-btn--ghost" onClick={() => navigate('/')}>
                  {t('Back to Stories', '返回精选信息流')}
                </button>
              </div>
            </div>
          </div>
        )}

        {loc.pathname === '/projects' && actor && (
          <ProjectsPage
            actor={actor}
            selectedProjectId={selectedProjectId}
            onSelectProjectId={setSelectedProjectId}
            initialSearchString={loc.search}
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

        {loc.pathname === '/sources' && actor && (
          <SourcesPage actor={actor} initialQueryString={loc.search} />
        )}

        {loc.pathname === '/workspace' && actor && (
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

        {loc.pathname === '/settings' && actor && (
          <SettingsPage actor={actor} initialQueryString={loc.search} />
        )}
      </WorkbenchShell>

      {authModal.open && (
        <AuthModal
          initialTab={authModal.tab}
          publicRegistration={publicRegistration}
          reason={authModal.reason}
          onClose={() => setAuthModal((s) => ({ ...s, open: false }))}
          onSuccess={() => {
            const target = authModal.pendingTarget;
            setAuthModal((s) => ({ ...s, open: false }));
            if (target) navigate(target);
          }}
        />
      )}
    </LangContext.Provider>
  );
}

export default App;
