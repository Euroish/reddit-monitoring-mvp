
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RoleGuard } from './auth/RequireAuth';
import { Layout } from './app/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Ops } from './pages/Ops';
import { TargetDetail } from './pages/TargetDetail';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/target/:targetId" element={<TargetDetail />} />
            <Route path="/ops" element={
              <RoleGuard allowedRoles={['admin', 'owner']}>
                <Ops />
              </RoleGuard>
            } />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
