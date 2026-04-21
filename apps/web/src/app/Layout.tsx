
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/ui';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar">
        <div className="topbar-left">
          <div style={{ fontWeight: 590, color: 'var(--text-primary)' }}>Analytics MVP</div>
          {user && (
            <nav className="topbar-nav">
              <Link to="/dashboard" style={{ fontSize: '14px', fontWeight: 510 }}>Dashboard</Link>
              <Link to="/queries" style={{ fontSize: '14px', fontWeight: 510 }}>Queries</Link>
              {(user.role === 'admin' || user.role === 'owner') && (
                <Link to="/ops" style={{ fontSize: '14px', fontWeight: 510 }}>Ops</Link>
              )}
            </nav>
          )}
        </div>
        
        {user && (
          <div className="topbar-right">
            <span className="topbar-email">{user.email}</span>
            <Button variant="ghost" onClick={handleLogout}>Logout</Button>
          </div>
        )}
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
