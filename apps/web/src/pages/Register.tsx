import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchApi, ApiError } from '../api/client';
import { Button, Card, Input } from '../components/ui';
import { LanguageToggle } from '../i18n/LanguageToggle';
import { useLanguage } from '../i18n/LanguageContext';
import type { RegisterAppUserRequest, RegisterAppUserResponse } from '../../../../packages/contracts/src/http';

function getRegisterErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'email_already_registered') {
      return 'This email is already registered.';
    }
    if (error.code === 'invalid_invite' || error.code === 'invite_unavailable') {
      return 'This invite code is unavailable.';
    }
  }

  return error instanceof Error ? error.message : 'Registration failed';
}

export function Register() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteCodeFromQuery = useMemo(
    () => searchParams.get('inviteCode') ?? searchParams.get('code') ?? '',
    [searchParams],
  );
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState(inviteCodeFromQuery);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('Passwords do not match.'));
      return;
    }

    const payload: RegisterAppUserRequest = {
      email,
      password,
      inviteCode,
      displayName: displayName.trim() || undefined,
    };

    try {
      setIsSubmitting(true);
      await fetchApi<RegisterAppUserResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      navigate(`/login?registered=1&email=${encodeURIComponent(email.trim())}`, { replace: true });
    } catch (submitError) {
      setError(t(getRegisterErrorMessage(submitError)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <LanguageToggle className="auth-language-toggle" />
      <Card className="auth-card">
        <div className="auth-header">
          <div className="auth-eyebrow">{t('Invite Registration')}</div>
          <h2 className="auth-title">{t('Create your Analytics account')}</h2>
          <p className="auth-subtitle">{t('Use a valid invite code to create an account. New accounts remain pending until an admin activates them.')}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div>
            <label htmlFor="register-email" className="auth-field-label">{t('Email')}</label>
            <Input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label htmlFor="register-display-name" className="auth-field-label">{t('Display name')}</label>
            <Input
              id="register-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t('Optional')}
              autoComplete="name"
            />
          </div>

          <div>
            <label htmlFor="register-invite-code" className="auth-field-label">{t('Invite code')}</label>
            <Input
              id="register-invite-code"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder={t('Provided by an admin')}
              autoComplete="one-time-code"
              required
            />
          </div>

          <div>
            <label htmlFor="register-password" className="auth-field-label">{t('Password')}</label>
            <Input
              id="register-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('Create a password')}
              autoComplete="new-password"
              required
            />
          </div>

          <div>
            <label htmlFor="register-confirm-password" className="auth-field-label">{t('Confirm password')}</label>
            <Input
              id="register-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t('Repeat your password')}
              autoComplete="new-password"
              required
            />
          </div>

          {error ? <div className="auth-message error">{error}</div> : null}

          <Button variant="primary" type="submit" disabled={isSubmitting} style={{ marginTop: '8px' }}>
            {isSubmitting ? t('Creating account...') : t('Create account')}
          </Button>
        </form>

        <div className="auth-footer">
          {t('Already have an account?')} <Link to="/login">{t('Sign in')}</Link>
        </div>
      </Card>
    </div>
  );
}
