import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Eye, EyeOff, Globe, ShieldCheck, X } from 'lucide-react';
import { formatApiError, useLoginMutation, useRegisterMutation } from '../api/hooks';
import { useI18n } from '../i18n/translations';
import { SiftlineLogo } from './BrandMark';

interface AuthModalProps {
  initialTab?: 'login' | 'register';
  publicRegistration: boolean;
  reason?: string;
  inline?: boolean;
  onClose?: () => void;
  onSuccess: () => void;
}

export function AuthModal({
  initialTab = 'login',
  publicRegistration,
  reason,
  inline = false,
  onClose,
  onSuccess,
}: AuthModalProps) {
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState<'login' | 'register'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [invite, setInvite] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loginMutation = useLoginMutation();
  const registerMutation = useRegisterMutation();

  useEffect(() => {
    if (inline || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inline, onClose]);

  const isValidLoginEmail = (val: string) =>
    /^[^\s@]+@[^\s@]+$/.test(val) && val.length >= 3 && val.length <= 254;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const cleaned = email.trim();
    if (!isValidLoginEmail(cleaned)) {
      setError(t('Please enter a valid email address.', '请输入有效的邮箱地址。'));
      return;
    }
    if (password.length < 1 || password.length > 128) {
      setError(t('Please enter your password.', '请输入密码。'));
      return;
    }
    try {
      await loginMutation.mutateAsync({ email: cleaned, password });
      onSuccess();
    } catch (err) {
      setError(formatApiError(err));
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const cleaned = email.trim();
    if (!isValidLoginEmail(cleaned)) {
      setError(t('Please enter a valid email address.', '请输入有效的邮箱地址。'));
      return;
    }
    const trimmedInvite = invite.trim();
    if (!publicRegistration && trimmedInvite.length < 12) {
      setError(t('A valid one-time invite code is required.', '请输入管理员分发的有效一次性邀请码。'));
      return;
    }
    if (password.length < 12) {
      setError(t('Password must be at least 12 characters.', '注册密码长度必须至少 12 位字符。'));
      return;
    }
    if (confirmPw && password !== confirmPw) {
      setError(t('Passwords do not match.', '两次输入的密码不一致。'));
      return;
    }
    try {
      const res = await registerMutation.mutateAsync({
        email: cleaned,
        password,
        invite: trimmedInvite || undefined,
      });
      if (res.user) {
        onSuccess();
        return;
      }
      setNotice(t('Account created. Please sign in with your new credentials.', '账号已创建，请使用新密码登录。'));
      setTab('login');
      setPassword('');
      setConfirmPw('');
    } catch (err) {
      setError(formatApiError(err));
    }
  };

  const submitting = loginMutation.isPending || registerMutation.isPending;

  const card = (
    <div
      className="auth-dialog"
      role={inline ? undefined : 'dialog'}
      aria-modal={inline ? undefined : true}
      aria-label={tab === 'login' ? t('Sign in', '登录账户') : t('Create account', '注册账户')}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="auth-top">
        <SiftlineLogo size={24} fontSize={18} />
        <div className="auth-top-actions">
          <button
            type="button"
            className="auth-util-pill"
            onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          >
            <Globe size={12} />
            <span>{lang === 'en' ? '中文' : 'EN'}</span>
          </button>
          {!inline && onClose && (
            <button
              type="button"
              className="icon-square"
              style={{ width: 28, height: 28 }}
              onClick={onClose}
              aria-label={t('Close', '关闭')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'login'}
          onClick={() => {
            setTab('login');
            setError(null);
            setNotice(null);
          }}
        >
          {t('Sign in', '登录')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'register'}
          onClick={() => {
            setTab('register');
            setError(null);
            setNotice(null);
          }}
        >
          {publicRegistration ? t('Register', '注册') : t('Redeem Invite', '邀请注册')}
        </button>
      </div>

      <h1>
        {tab === 'login'
          ? t('Sign in to SIFTLINE', '登录 SIFTLINE 工作台')
          : publicRegistration
            ? t('Create a research account', '创建研究账户')
            : t('Join via invite code', '使用邀请码加入')}
      </h1>
      <p className="auth-sub">
        {tab === 'login'
          ? t(
              'Access projects, saved queries, annotations, sources, and collection quotas.',
              '登录后可保存查询、记录研究批注并管理监测项目与采集来源。',
            )
          : publicRegistration
            ? t(
                'Open registration is enabled. Leave invite blank for a viewer account, or enter a team invite code.',
                '当前已开放自助注册。留空邀请码将直接创建个人研究账户并自动登录；如有团队邀请码也可一并填入。',
              )
            : t(
                'This instance requires a one-time invite token issued by an owner or admin.',
                '当前实例采用邀请制，请输入管理员分发的一次性邀请码。',
              )}
      </p>

      {reason && <div className="auth-reason">{reason}</div>}

      <form className="auth-form" onSubmit={tab === 'login' ? handleLogin : handleRegister} noValidate>
        {error && (
          <div className="auth-alert" role="alert">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="auth-alert is-ok" role="status">
            <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{notice}</span>
          </div>
        )}

        <div className="auth-field">
          <label htmlFor="auth-email">{t('Email', '邮箱')}</label>
          <input
            id="auth-email"
            className="auth-input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="auth-pw">{t('Password', '密码')}</label>
          <div className="auth-pw-wrap">
            <input
              id="auth-pw"
              className="auth-input"
              type={showPw ? 'text' : 'password'}
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              placeholder={tab === 'register' ? t('At least 12 characters', '至少 12 位字符') : t('Enter password', '输入密码')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="auth-pw-toggle"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? t('Hide password', '隐藏密码') : t('Show password', '显示密码')}
            >
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {tab === 'register' && (
          <>
            <div className="auth-field">
              <label htmlFor="auth-confirm">{t('Confirm Password', '确认密码')}</label>
              <input
                id="auth-confirm"
                className="auth-input"
                type="password"
                autoComplete="new-password"
                placeholder={t('Re-enter password', '再次输入密码')}
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
            </div>

            <div className="auth-field">
              <label htmlFor="auth-invite">
                {publicRegistration
                  ? t('Invite Code (Optional)', '邀请码（可选）')
                  : t('One-Time Invite Code', '一次性邀请码')}
              </label>
              <input
                id="auth-invite"
                className="auth-input"
                type="text"
                autoComplete="off"
                placeholder={publicRegistration ? t('Optional team invite token', '留空则注册普通账户') : t('72-character invite token', '72 位一次性邀请码')}
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                required={!publicRegistration}
              />
            </div>
          </>
        )}

        <button className="auth-submit-btn" type="submit" disabled={submitting}>
          <span>
            {submitting
              ? t('Submitting...', '提交中...')
              : tab === 'login'
                ? t('Sign in', '登录')
                : t('Create account', '创建账户')}
          </span>
          <ArrowRight size={14} />
        </button>
      </form>
    </div>
  );

  if (inline) {
    return <div className="auth-screen">{card}</div>;
  }

  return (
    <div className="auth-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      {card}
    </div>
  );
}
