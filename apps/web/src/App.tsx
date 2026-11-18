import React, { useEffect, useState } from 'react';
import { useCapabilitiesQuery, useSessionQuery } from './api/hooks';
import { AuthModal } from './components/AuthModal';
import { LogoProvider } from './components/BrandMark';
import { ThemeProvider } from './components/ThemeStudio';
import { type Lang, LangContext } from './i18n/translations';
import { ContentExplorerPage } from './pages/ContentExplorerPage';
import { Homepage } from './pages/Homepage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SourcesPage } from './pages/SourcesPage';
import { type WorkbenchRoute, WorkbenchShell } from './pages/WorkbenchShell';
import { WorkspacePage } from './pages/WorkspacePage';

const WORKBENCH_ROUTES: WorkbenchRoute[] = [
  '/projects',
  '/content',
  '/sources',
  '/workspace',
  '/settings',
];

function parseLocation(): { pathname: string; search: string } {
  return {
    pathname: window.location.pathname || '/',
    search: window.location.search.replace(/^\?/, ''),
  };
}

function isWorkbenchPath(p: string): p is WorkbenchRoute {
  return WORKBENCH_ROUTES.includes(p as WorkbenchRoute);
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
      // ignore
    }
  };

  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

  const [loc, setLoc] = useState(parseLocation);
  const [authModal, setAuthModal] = useState<{ open: boolean; tab: 'login' | 'register'; pendingTarget?: string }>({
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

  const navigate = (pathWithQuery: string) => {
    window.history.pushState(null, '', pathWithQuery);
    setLoc(parseLocation());
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const sessionQuery = useSessionQuery();
  const actor = sessionQuery.data?.user ?? null;
  const capabilitiesQuery = useCapabilitiesQuery(Boolean(actor));

  const handleEnterWorkbench = (targetPath = '/projects') => {
    if (!actor) {
      setAuthModal({ open: true, tab: 'login', pendingTarget: targetPath });
      return;
    }
    navigate(targetPath);
  };

  const onWorkbenchRoute = isWorkbenchPath(loc.pathname);
  const showWorkbench = Boolean(actor) && onWorkbenchRoute;

  const pendingQueryContext = React.useMemo(() => {
    const raw = authModal.pendingTarget || (onWorkbenchRoute ? `${loc.pathname}?${loc.search}` : '');
    const qPart = raw.split('?')[1];
    if (!qPart) return undefined;
    const sp = new URLSearchParams(qPart);
    const q = sp.get('query');
    const p = sp.get('platform');
    if (q && p) return `${q} (${p})`;
    return q || p || undefined;
  }, [authModal.pendingTarget, onWorkbenchRoute, loc.pathname, loc.search]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      <ThemeProvider>
        <LogoProvider>
          {showWorkbench && actor ? (
            <WorkbenchShell
              actor={actor}
              capabilities={capabilitiesQuery.data}
              route={loc.pathname as WorkbenchRoute}
              currentSearch={loc.search}
              selectedProjectId={selectedProjectId}
              onSelectProjectId={setSelectedProjectId}
              onNavigate={navigate}
              onGoHome={() => navigate('/')}
            >
              {loc.pathname === '/projects' && (
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
              {loc.pathname === '/content' && (
                <ContentExplorerPage
                  key={loc.search}
                  actor={actor}
                  initialQueryString={loc.search}
                  initialDetailId={contentDetailId}
                  onClearDetailId={() => setContentDetailId(null)}
                />
              )}
              {loc.pathname === '/sources' && (
                <SourcesPage actor={actor} initialQueryString={loc.search} />
              )}
              {loc.pathname === '/workspace' && (
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
              {loc.pathname === '/settings' && (
                <SettingsPage actor={actor} initialQueryString={loc.search} />
              )}
            </WorkbenchShell>
          ) : (
            <Homepage
              isAuthenticated={Boolean(actor)}
              onOpenAuth={(tab = 'login') =>
                setAuthModal({
                  open: true,
                  tab,
                  pendingTarget: onWorkbenchRoute
                    ? loc.pathname + (loc.search ? `?${loc.search}` : '')
                    : '/projects',
                })
              }
              onEnterWorkbench={handleEnterWorkbench}
            />
          )}

          {(authModal.open || (!actor && onWorkbenchRoute && !sessionQuery.isLoading)) && (
            <AuthModal
              initialTab={authModal.tab}
              initialQueryContext={pendingQueryContext}
              onClose={() => {
                setAuthModal((s) => ({ ...s, open: false }));
                if (!actor && onWorkbenchRoute) navigate('/');
              }}
              onSuccess={() => {
                const target =
                  authModal.pendingTarget ||
                  (onWorkbenchRoute ? loc.pathname + (loc.search ? `?${loc.search}` : '') : '/projects');
                setAuthModal((s) => ({ ...s, open: false }));
                navigate(target);
              }}
            />
          )}
        </LogoProvider>
      </ThemeProvider>
    </LangContext.Provider>
  );
}

export default App;
