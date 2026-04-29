
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';
import { LanguageToggle } from '../i18n/LanguageToggle';
import { useLanguage } from '../i18n/LanguageContext';
import { RouteErrorBoundary } from './RouteErrorBoundary';

export function Layout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const canAccessOps = user?.role === 'admin' || user?.role === 'owner';

  const analysisLinks = [
    { to: '/markets', label: t('Markets') },
    { to: '/markets/board', label: t('Board') },
    { to: '/compare', label: t('Compare') },
    { to: '/queries', label: t('Queries') },
    { to: '/saved', label: t('Saved') },
    { to: '/run', label: t('Run Phase 1') },
  ];
  const opsLinks = [
    { to: '/ops', label: t('Overview') },
    { to: '/ops/storage', label: t('Storage') },
    { to: '/ops/users', label: t('Users') },
    { to: '/ops/invites', label: t('Invites') },
    { to: '/ops/targets', label: t('Targets') },
    { to: '/ops/collection', label: t('Collection') },
    { to: '/ops/maintenance', label: t('Maintenance') },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar">
        <div className="topbar-left">
          <div>
            <div style={{ fontWeight: 590, color: 'var(--text-primary)' }}>{t('Reddit Monitoring')}</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '4px' }}>
              {t('Analysis workbench and admin control plane')}
            </div>
          </div>
        </div>
        
        {user && (
          <div className="topbar-right">
            <LanguageToggle />
            <span className="topbar-email">{user.email}</span>
            <Button variant="ghost" onClick={handleLogout}>{t('Logout')}</Button>
          </div>
        )}
      </header>

      <div className="app-shell">
        {user && (
          <aside className="app-sidebar">
            <nav className="sidebar-section">
              <div className="sidebar-section-label">{t('Analysis')}</div>
              {analysisLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>

            {canAccessOps && (
              <nav className="sidebar-section">
                <div className="sidebar-section-label">{t('Admin')}</div>
                {opsLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </nav>
            )}
          </aside>
        )}

        <main className="app-main">
          <RouteErrorBoundary>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
