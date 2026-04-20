
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RoleGuard } from './auth/RequireAuth';
import { Layout } from './app/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Ops } from './pages/Ops';

const TargetDetail = lazy(() => import('./pages/TargetDetail').then((module) => ({ default: module.TargetDetail })));
const Queries = lazy(() => import('./pages/Queries').then((module) => ({ default: module.Queries })));

function RouteLoading() {
  return <div style={{ color: 'var(--text-tertiary)' }}>Loading...</div>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/queries" element={<Queries />} />
              <Route path="/target/:targetId" element={<TargetDetail />} />
              <Route path="/ops" element={
                <RoleGuard allowedRoles={['admin', 'owner']}>
                  <Ops />
                </RoleGuard>
              } />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
