import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RoleGuard } from './auth/RequireAuth';
import { Layout } from './app/Layout';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';

const Login = lazy(() => import('./pages/Login').then((module) => ({ default: module.Login })));
const Register = lazy(() => import('./pages/Register').then((module) => ({ default: module.Register })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const MarketBoard = lazy(() => import('./pages/MarketBoard').then((module) => ({ default: module.MarketBoard })));
const Compare = lazy(() => import('./pages/Compare').then((module) => ({ default: module.Compare })));
const TargetDetail = lazy(() => import('./pages/TargetDetail').then((module) => ({ default: module.TargetDetail })));
const Queries = lazy(() => import('./pages/Queries').then((module) => ({ default: module.Queries })));
const Saved = lazy(() => import('./pages/Saved').then((module) => ({ default: module.Saved })));
const RunPhase1 = lazy(() => import('./pages/RunPhase1').then((module) => ({ default: module.RunPhase1 })));
const Ops = lazy(() => import('./pages/Ops').then((module) => ({ default: module.Ops })));
const OpsStorage = lazy(() => import('./pages/OpsStorage').then((module) => ({ default: module.OpsStorage })));
const OpsUsers = lazy(() => import('./pages/OpsUsers').then((module) => ({ default: module.OpsUsers })));
const OpsInvites = lazy(() => import('./pages/OpsInvites').then((module) => ({ default: module.OpsInvites })));
const OpsTargets = lazy(() => import('./pages/OpsTargets').then((module) => ({ default: module.OpsTargets })));
const OpsCollection = lazy(() => import('./pages/OpsCollection').then((module) => ({ default: module.OpsCollection })));
const OpsMaintenance = lazy(() => import('./pages/OpsMaintenance').then((module) => ({ default: module.OpsMaintenance })));

function RouteLoadingFallback() {
  const { t } = useLanguage();
  return (
    <div style={{ padding: '2rem', color: 'var(--text-tertiary)' }}>
      {t('Loading page...')}
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<RouteLoadingFallback />}>
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
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}
