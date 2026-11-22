import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { formatApiError } from '../api/hooks';
import { useI18n } from '../i18n/translations';

type Purpose = 'register' | 'verify' | 'reset';
type Turnstile = {
  render: (element: HTMLElement, config: {
    sitekey: string; action: string; callback: (token: string) => void;
    'expired-callback': () => void; 'error-callback': () => void;
  }) => string;
  remove: (id: string) => void;
};
let script: Promise<Turnstile> | undefined;

function loadTurnstile() {
  script ??= new Promise<Turnstile>((resolve, reject) => {
    const element = document.createElement('script');
    element.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    element.async = true;
    const onFailure = () => {
      element.remove();
      reject(new Error('Verification unavailable'));
    };
    element.onerror = onFailure;
    element.onload = () => {
      const verifier = (window as Window & { turnstile?: Turnstile }).turnstile;
      if (verifier) resolve(verifier);
      else onFailure();
    };
    document.head.append(element);
  }).catch((error: unknown) => {
    script = undefined;
    throw error;
  });
  return script;
}

export function AccountEmailStart({ siteKey, purpose, requireInvite = false }: {
  siteKey: string; purpose: Purpose; requireInvite?: boolean;
}) {
  const { t } = useI18n();
  const widget = useRef<HTMLDivElement>(null);
  const [proof, setProof] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [widgetError, setWidgetError] = useState(false);
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ error?: string; accepted?: boolean }>({});
  useEffect(() => {
    let unmounted = false;
    let remove: (() => void) | undefined;
    void loadTurnstile().then((turnstile) => {
      if (unmounted || !widget.current) return;
      const id = turnstile.render(widget.current, {
        sitekey: siteKey, action: purpose, callback: setProof,
        'expired-callback': () => setProof(''),
        'error-callback': () => { setProof(''); setWidgetError(true); },
      });
      remove = () => turnstile.remove(id);
    }).catch(() => { if (!unmounted) setWidgetError(true); });
    return () => { unmounted = true; remove?.(); };
  }, [siteKey, purpose, attempt]);

  function retry() {
    setProof('');
    setWidgetError(false);
    setAttempt((value) => value + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof || pending) return;
    setPending(true);
    setResult({});
    try {
      await apiClient.startAccountEmail(purpose, email.trim(), proof, invite.trim() || undefined);
      setResult({ accepted: true });
    } catch (error) {
      setResult({ error: formatApiError(error) });
    } finally {
      setPending(false);
      retry();
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      {purpose !== 'verify' && <label>{t('Email address', '邮箱地址')}
        <input className="auth-input" type="email" required maxLength={254}
          autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>}
      {purpose === 'register' && <label>{t('Invitation code', '邀请码')}
        <input className="auth-input" required={requireInvite} maxLength={256}
          value={invite} onChange={(event) => setInvite(event.target.value)} />
      </label>}
      <div ref={widget} />
      {widgetError && <button type="button" className="auth-link" onClick={retry}>
        {t('Verification unavailable. Try again', '暂时无法验证，重试')}
      </button>}
      {result.error && <p role="alert">{result.error}</p>}
      {result.accepted && <p role="status">
        {t('If eligible, you will receive a link by email. The link expires in 15 minutes.', '如果符合条件，你将收到邮件。链接有效期为 15 分钟。')}
      </p>}
      <button type="submit" className="auth-submit-btn" disabled={!proof || pending}>
        {pending ? t('Requesting link…', '正在请求链接…') : t('Send email link', '发送邮件链接')}
      </button>
    </form>
  );
}

const emailLink = ((): { purpose: Purpose; token: string } | null => {
  if (location.pathname !== '/account/confirm') return null;
  const query = new URLSearchParams(location.hash.slice(1));
  if (location.hash) history.replaceState(null, '', '/account/confirm');
  const purpose = query.get('purpose');
  const token = query.get('token');
  if ((purpose !== 'register' && purpose !== 'verify' && purpose !== 'reset') || !token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return null;
  return { purpose, token };
})();

export function AccountEmailConfirm() {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ error?: string; done?: boolean }>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailLink || pending || result.done) return;
    setPending(true);
    setResult({});
    try {
      await apiClient.finishAccountEmail(emailLink.purpose, emailLink.token, password);
      setPassword('');
      setResult({ done: true });
    } catch (error) {
      setResult({ error: formatApiError(error) });
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="ds-card" style={{ maxWidth: 480, margin: '48px auto', padding: 24 }}>
      <h1>{t('Confirm account request', '确认账户请求')}</h1>
      {!emailLink && <p role="alert">{t('Open the original link from your email to continue.', '请打开邮件中的原始链接继续。')}</p>}
      {result.done && <p role="status">{t('Request completed. You can now sign in.', '操作已完成，现在可以登录。')}</p>}
      {emailLink && !result.done && <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {emailLink.purpose !== 'verify' && <label>{t('New password (at least 15 characters)', '新密码（至少 15 个字符）')}
          <input className="auth-input" type="password" required minLength={15} maxLength={128}
            autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>}
        {result.error && <p role="alert">{result.error}</p>}
        <button type="submit" className="auth-submit-btn" disabled={pending}>
          {pending ? t('Confirming…', '正在确认…') : t('Confirm', '确认')}
        </button>
      </form>}
      <a href="/">{t('Back to SIFTLINE', '返回 SIFTLINE')}</a>
    </main>
  );
}

export function AccountPasswordForm() {
  const { t } = useI18n();
  const cache = useQueryClient();
  const [currentPassword, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await apiClient.changeAccountPassword(currentPassword, password);
      setCurrent('');
      setPassword('');
      cache.clear();
      await cache.invalidateQueries({ queryKey: ['session'] });
    } catch (failure) {
      setError(formatApiError(failure));
    } finally {
      setPending(false);
    }
  }
  return <form className="auth-form" onSubmit={(event) => void submit(event)}>
    <label>{t('Current password', '当前密码')}
      <input className="auth-input" type="password" required autoComplete="current-password"
        value={currentPassword} onChange={(event) => setCurrent(event.target.value)} />
    </label>
    <label>{t('New password', '新密码')}
      <input className="auth-input" type="password" required minLength={15} maxLength={128} autoComplete="new-password"
        value={password} onChange={(event) => setPassword(event.target.value)} />
    </label>
    <p>{t('Changing the password signs out all devices and revokes machine keys.', '修改密码会退出所有设备并撤销机器密钥。')}</p>
    {error && <p role="alert">{error}</p>}
    <button className="ds-btn" type="submit" disabled={pending}>{t('Change password', '修改密码')}</button>
  </form>;
}
