import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RoleGuard } from './auth/RequireAuth';
import { Layout } from './app/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { MarketBoard } from './pages/MarketBoard';
import { Compare } from './pages/Compare';
import { TargetDetail } from './pages/TargetDetail';
import { Queries } from './pages/Queries';
import { Saved } from './pages/Saved';
import { RunPhase1 } from './pages/RunPhase1';
import { Ops } from './pages/Ops';
import { OpsStorage } from './pages/OpsStorage';
import { OpsUsers } from './pages/OpsUsers';
import { OpsInvites } from './pages/OpsInvites';
import { OpsTargets } from './pages/OpsTargets';
import { OpsCollection } from './pages/OpsCollection';
import { OpsMaintenance } from './pages/OpsMaintenance';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route path="/markets" element={<Dashboard />} />
            <Route path="/markets/board" element={<MarketBoard />} />
            <Route path="/dashboard" element={<Navigate to="/markets" replace />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/queries" element={<Queries />} />
            <Route path="/saved" element={<Saved />} />
            <Route path="/run" element={<RunPhase1 />} />
            <Route path="/target/:targetId" element={<TargetDetail />} />
            <Route path="/ops" element={
              <RoleGuard allowedRoles={['admin', 'owner']}>
                <Ops />
              </RoleGuard>
            } />
            <Route path="/ops/storage" element={
              <RoleGuard allowedRoles={['admin', 'owner']}>
                <OpsStorage />
              </RoleGuard>
            } />
            <Route path="/ops/users" element={
              <RoleGuard allowedRoles={['admin', 'owner']}>
                <OpsUsers />
              </RoleGuard>
            } />
            <Route path="/ops/invites" element={
              <RoleGuard allowedRoles={['admin', 'owner']}>
                <OpsInvites />
              </RoleGuard>
            } />
            <Route path="/ops/targets" element={
              <RoleGuard allowedRoles={['admin', 'owner']}>
                <OpsTargets />
              </RoleGuard>
            } />
            <Route path="/ops/collection" element={
              <RoleGuard allowedRoles={['admin', 'owner']}>
                <OpsCollection />
              </RoleGuard>
            } />
            <Route path="/ops/maintenance" element={
              <RoleGuard allowedRoles={['admin', 'owner']}>
                <OpsMaintenance />
              </RoleGuard>
            } />
            <Route path="/" element={<Navigate to="/markets" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
