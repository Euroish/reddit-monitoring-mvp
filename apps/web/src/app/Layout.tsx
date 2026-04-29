
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const canAccessOps = user?.role === 'admin' || user?.role === 'owner';

  const analysisLinks = [
    { to: '/markets', label: 'Markets' },
    { to: '/markets/board', label: 'Board' },
    { to: '/compare', label: 'Compare' },
    { to: '/queries', label: 'Queries' },
    { to: '/saved', label: 'Saved' },
  ];
  const opsLinks = [
    { to: '/ops', label: 'Overview' },
    { to: '/ops/storage', label: 'Storage' },
    { to: '/ops/users', label: 'Users' },
    { to: '/ops/invites', label: 'Invites' },
    { to: '/ops/targets', label: 'Targets' },
    { to: '/ops/collection', label: 'Collection' },
    { to: '/ops/maintenance', label: 'Maintenance' },
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
            <div style={{ fontWeight: 590, color: 'var(--text-primary)' }}>Reddit Monitoring</div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '4px' }}>
              Analysis workbench and admin control plane
            </div>
          </div>
        </div>
        
        {user && (
          <div className="topbar-right">
            <span className="topbar-email">{user.email}</span>
            <Button variant="ghost" onClick={handleLogout}>Logout</Button>
          </div>
        )}
      </header>

      <div className="app-shell">
        {user && (
          <aside className="app-sidebar">
            <nav className="sidebar-section">
              <div className="sidebar-section-label">Analysis</div>
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
                <div className="sidebar-section-label">Admin</div>
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
