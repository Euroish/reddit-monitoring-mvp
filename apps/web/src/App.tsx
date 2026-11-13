import { Suspense, lazy } from 'react';
import { createBrowserRouter, RouterProvider, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RoleGuard } from './auth/RequireAuth';
import { Layout } from './app/Layout';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { Login } from './pages/Login';
import { Button, Card } from './components/ui';

const Register = lazy(() => import('./pages/Register').then((module) => ({ default: module.Register })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const MarketBoard = lazy(() => import('./pages/MarketBoard').then((module) => ({ default: module.MarketBoard })));
const Compare = lazy(() => import('./pages/Compare').then((module) => ({ default: module.Compare })));
const TargetDetail = lazy(() => import('./pages/TargetDetail').then((module) => ({ default: module.TargetDetail })));
const Queries = lazy(() => import('./pages/Queries').then((module) => ({ default: module.Queries })));
const Content = lazy(() => import('./pages/Content').then((module) => ({ default: module.Content })));
const ContentDetail = lazy(() => import('./pages/ContentDetail').then((module) => ({ default: module.ContentDetail })));
const Saved = lazy(() => import('./pages/Saved').then((module) => ({ default: module.Saved })));
const Account = lazy(() => import('./pages/Account').then((module) => ({ default: module.Account })));
const RunPhase1 = lazy(() => import('./pages/RunPhase1').then((module) => ({ default: module.RunPhase1 })));
const Ops = lazy(() => import('./pages/Ops').then((module) => ({ default: module.Ops })));
const OpsStorage = lazy(() => import('./pages/OpsStorage').then((module) => ({ default: module.OpsStorage })));
const OpsUsers = lazy(() => import('./pages/OpsUsers').then((module) => ({ default: module.OpsUsers })));
const OpsAudit = lazy(() => import('./pages/OpsAudit').then((module) => ({ default: module.OpsAudit })));
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

function AppRoutes() {
  return (
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
                <Route path="/content" element={<Content />} />
                <Route path="/content/:contentId" element={<ContentDetail />} />
                <Route path="/saved" element={<Saved />} />
                <Route path="/account" element={<Account />} />
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
                <Route path="/ops/audit" element={
                  <RoleGuard allowedRoles={['admin', 'owner']}><OpsAudit /></RoleGuard>
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
                <Route path="/" element={<Navigate to="/content" replace />} />
              </Route>
            </Routes>
          </Suspense>
  );
}

function RouteLoadError() {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  return <main style={{ padding: '2rem' }}>
    <Card style={{ maxWidth: '720px', margin: '0 auto' }}>
      <h1>{zh ? '页面暂时无法加载' : 'This page could not load'}</h1>
      <p>{zh ? '请检查网络连接，然后重新加载页面。' : 'Check your connection, then reload the page.'}</p>
      <Button type="button" variant="primary" onClick={() => window.location.reload()}>{zh ? '重新加载页面' : 'Reload page'}</Button>
    </Card>
  </main>;
}

const router = createBrowserRouter([{ path: '*', element: <AppRoutes />, errorElement: <RouteLoadError /> }]);

export default function App() {
  return <LanguageProvider><AuthProvider><RouterProvider router={router} /></AuthProvider></LanguageProvider>;
}
