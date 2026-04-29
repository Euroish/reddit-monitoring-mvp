import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import type { AppUserRole } from '../../../../packages/contracts/src/http';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>{t('Loading...')}</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export function RoleGuard({ 
  children, 
  allowedRoles 
}: { 
  children: React.ReactNode;
  allowedRoles: AppUserRole[];
}) {
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  if (isLoading) return null;

  if (!user || !allowedRoles.includes(user.role)) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--text-secondary)' }}>{t('Access Denied')}</h2>
        <p style={{ color: 'var(--text-tertiary)' }}>{t('You do not have permission to view this page.')}</p>
      </div>
    );
  }

  return <>{children}</>;
}
