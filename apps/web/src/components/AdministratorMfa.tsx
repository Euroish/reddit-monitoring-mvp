import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { formatApiError } from '../api/hooks';
import { useI18n } from '../i18n/translations';

export function MfaLoginForm({ challenge, onSuccess, onCancel }: {
  challenge: string; onSuccess: () => void; onCancel: () => void;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await apiClient.completeMfa(challenge, code.trim());
      cache.clear();
      void cache.invalidateQueries({ queryKey: ['session'] });
      onSuccess();
    } catch (failure) {
      setError(formatApiError(failure));
    } finally {
      setPending(false);
      setCode('');
    }
  }
  return <form className="auth-form" onSubmit={(event) => void submit(event)}>
    <label>{t('Authenticator code or recovery code', '验证器代码或恢复码')}
      <input className="auth-input" autoComplete="one-time-code" maxLength={24} required
        value={code} onChange={(event) => setCode(event.target.value)} />
    </label>
    {error && <p role="alert">{error}</p>}
    <button className="auth-submit-btn" type="submit" disabled={pending}>{t('Verify and sign in', '验证并登录')}</button>
    <button className="auth-link" type="button" disabled={pending} onClick={onCancel}>{t('Back to sign in', '返回登录')}</button>
  </form>;
}

export function MfaSecurityCard() {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function run(action: () => Promise<void>) {
    setPending(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(formatApiError(failure));
    } finally {
      setPending(false);
    }
  }
  return <section className="ds-card" style={{ marginTop: 12 }}>
    <div className="ds-card-bd">
      <h2>{t('Administrator verification', '管理员二次认证')}</h2>
      <form className="auth-form" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await apiClient.stepUpMfa(code.trim());
          setCode('');
          setVerified(true);
        });
      }}>
        <label>{t('Six-digit authenticator code', '六位验证器代码')}
          <input className="auth-input" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required
            maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
        </label>
        <button type="submit" className="ds-btn" disabled={pending}>{t('Verify for five minutes', '验证后五分钟内有效')}</button>
      </form>
      {verified && <p role="status">{t('Verification complete. Return to the privileged action within five minutes.', '验证完成，请在五分钟内返回原操作。')}</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="ds-btn" disabled={pending} onClick={() => {
        if (window.confirm(t('Replace all existing recovery codes?', '替换所有旧恢复码？'))) {
          void run(async () => { setCodes((await apiClient.rotateRecoveryCodes()).codes); });
        }
      }}>{t('Generate recovery codes', '生成恢复码')}</button>
      {codes.length > 0 && <div role="status">
        <p>{t('Store these one-time codes in a password manager. They are shown once.', '请将这些一次性代码保存到密码管理器。代码仅显示一次。')}</p>
        <ul>{codes.map((value) => <li key={value}><code>{value}</code></li>)}</ul>
        <button type="button" className="auth-link" onClick={() => setCodes([])}>{t('Hide recovery codes', '隐藏恢复码')}</button>
      </div>}
    </div>
  </section>;
}
