
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
      <header style={{
        position: 'sticky',
        top: 0,
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ fontWeight: 590, color: 'var(--text-primary)' }}>Analytics MVP</div>
          {user && (
            <nav style={{ display: 'flex', gap: '16px' }}>
              <Link to="/dashboard" style={{ fontSize: '14px', fontWeight: 510 }}>Dashboard</Link>
              <Link to="/queries" style={{ fontSize: '14px', fontWeight: 510 }}>Queries</Link>
              {(user.role === 'admin' || user.role === 'owner') && (
                <Link to="/ops" style={{ fontSize: '14px', fontWeight: 510 }}>Ops</Link>
              )}
            </nav>
          )}
        </div>
        
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{user.email}</span>
            <Button variant="ghost" onClick={handleLogout}>Logout</Button>
          </div>
        )}
      </header>

      <main style={{ flex: 1, padding: '40px 24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
}
