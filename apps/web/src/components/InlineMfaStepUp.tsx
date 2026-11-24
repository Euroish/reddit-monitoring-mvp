import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { apiClient } from '../api/client';
import { formatApiError } from '../api/hooks';
import { useI18n } from '../i18n/translations';

export function InlineMfaStepUp({
  onVerified,
  onCancel,
}: {
  onVerified: () => Promise<void> | void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await apiClient.stepUpMfa(code.trim());
      setCode('');
      await onVerified();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="wb-alert wb-alert--info"
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 8 }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>
        {t(
          'Recent authenticator verification is required. Your form draft is preserved — enter your 6-digit code to retry immediately.',
          '此敏感操作需要近期二次认证（当前表单草稿已保留）。请输入 6 位动态验证码完成验证并自动重试：',
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="wb-input"
          style={{ width: 160 }}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button type="submit" className="ds-btn" disabled={pending || code.trim().length < 6}>
          {pending ? t('Verifying…', '验证中…') : t('Verify & Retry', '验证并继续提交')}
        </button>
        {onCancel && (
          <button type="button" className="ds-btn ds-btn--ghost" disabled={pending} onClick={onCancel}>
            {t('Cancel', '取消')}
          </button>
        )}
      </div>
      {error && <div style={{ color: '#a8462f', fontSize: 11.5 }}>{error}</div>}
    </form>
  );
}

export function ViewerForbiddenCard({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="ds-page">
      <div className="ds-card" style={{ maxWidth: 520, margin: '48px auto', padding: 28, textAlign: 'center' }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            background: '#fdf1ee',
            color: '#a8462f',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 12px',
          }}
        >
          <Lock size={18} />
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          {t('Administrator access required (403)', '需要管理员权限（403）')}
        </h2>
        <div role="alert" style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16 }}>
          {t(
            'Only owners and administrators can manage sources and provider keys. Return to your research workspace or view your personal quota & jobs.',
            '仅所有者和管理员可以管理来源及服务商密钥，此处仅向管理员开放。请返回您的研究工作区，或查看个人配额与个人采集任务。',
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="ds-btn" onClick={() => onNavigate('/projects')}>
            {t('My Research Projects', '我的研究项目')}
          </button>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate('/settings?tab=quota')}>
            {t('My Quotas', '我的配额策略')}
          </button>
        </div>
      </div>
    </div>
  );
}
