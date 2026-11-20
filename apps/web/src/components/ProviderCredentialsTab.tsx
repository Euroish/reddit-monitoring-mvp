import { useState } from 'react';
import { AlertTriangle, Check, KeyRound, Play, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { apiClient } from '../api/client';
import {
  formatApiError,
  useProviderCredentialsQuery,
  useRevokeProviderCredentialMutation,
  useSaveProviderCredentialMutation,
} from '../api/hooks';
import type { CredentialProviderName, ProviderCredentialStatus } from '../contracts/api';
import { useI18n } from '../i18n/translations';

const PROVIDER_META: Record<CredentialProviderName, { title: string; platform: string; noteEn: string; noteZh: string }> = {
  kaix: {
    title: 'Apify · kaix',
    platform: 'Reddit (primary)',
    noteEn: 'Shared Apify token for Reddit search, community & comment hydration.',
    noteZh: 'Reddit 主采集渠道与帖子评论水合（共用 APIFY_API_TOKEN）。',
  },
  red_crawler: {
    title: 'Apify · red_crawler',
    platform: 'Reddit (fallback)',
    noteEn: 'Fallback Apify actor token for Reddit scheduled tasks.',
    noteZh: 'Reddit 定时采集备源渠道（Apify Token）。',
  },
  twitterapis: {
    title: 'TwitterAPIs',
    platform: 'X (primary)',
    noteEn: 'Bearer token for X advanced search & account timeline (<=20/page).',
    noteZh: 'X 主采集渠道 Bearer Token（单页 <= 20 条）。',
  },
  scrapebadger: {
    title: 'ScrapeBadger',
    platform: 'X (fallback / refresh)',
    noteEn: 'x-api-key for X fallback search & batch tweet refresh.',
    noteZh: 'X 备源与批量推文刷新密钥（x-api-key）。',
  },
};

export function ProviderCredentialsTab({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const credsQuery = useProviderCredentialsQuery(canManage);
  const saveMut = useSaveProviderCredentialMutation();
  const revokeMut = useRevokeProviderCredentialMutation();

  const [inputs, setInputs] = useState<Partial<Record<CredentialProviderName, string>>>({});
  const [confirmLive, setConfirmLive] = useState<Partial<Record<CredentialProviderName, boolean>>>({});
  const [probeMsg, setProbeMsg] = useState<Partial<Record<CredentialProviderName, { ok: boolean; text: string }>>>({});
  const [errMsg, setErrMsg] = useState<string | null>(null);

  if (!canManage) {
    return (
      <div className="wb-alert wb-alert--info">
        {t(
          'Only owner and admin browser sessions can inspect or modify third-party provider credentials.',
          '仅 owner 与 admin 浏览器会话可查看或管理第三方采集服务商密钥。',
        )}
      </div>
    );
  }

  const credentials = credsQuery.data?.credentials || [];
  const networkEnabled = credsQuery.data?.networkEnabled ?? false;

  const handleSave = async (item: ProviderCredentialStatus) => {
    setErrMsg(null);
    const val = (inputs[item.provider] || '').trim();
    if (!val) return;
    try {
      await saveMut.mutateAsync({
        provider: item.provider,
        apiKey: val,
        revision: item.revision > 0 ? item.revision : undefined,
      });
      setInputs((prev) => ({ ...prev, [item.provider]: '' }));
      setProbeMsg((prev) => ({
        ...prev,
        [item.provider]: { ok: true, text: t('Encrypted in DB & reloaded in memory.', '已加密落库并热生效（无需重启）。') },
      }));
    } catch (err) {
      setErrMsg(formatApiError(err));
    }
  };

  const handleRevoke = async (provider: CredentialProviderName) => {
    setErrMsg(null);
    try {
      await revokeMut.mutateAsync(provider);
      setProbeMsg((prev) => ({
        ...prev,
        [provider]: { ok: true, text: t('DB override revoked; reverted to env fallback if any.', '已撤销后台密钥；如有环境变量则自动回退。') },
      }));
    } catch (err) {
      setErrMsg(formatApiError(err));
    }
  };

  const handleTest = async (provider: CredentialProviderName) => {
    setErrMsg(null);
    const paidConfirmed = Boolean(confirmLive[provider]);
    try {
      const res = await apiClient.testProviderCredential(provider, paidConfirmed);
      setProbeMsg((prev) => ({
        ...prev,
        [provider]: { ok: res.ok, text: `[${res.mode}${res.status ? ` ${res.status}` : ''}] ${res.reason}` },
      }));
    } catch (err) {
      setErrMsg(formatApiError(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="wb-alert wb-alert--info" style={{ alignItems: 'flex-start' }}>
        <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <b>{t('Third-Party Provider Credentials (AES-256-GCM)', '第三方采集服务商密钥（AES-256-GCM 静态加密）')}</b>
          <div style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>
            {t(
              'Completely isolated from SIFTLINE Machine API Keys. Priority: DB encrypted config > container env var. Saved secrets are never returned in plaintext and reload live into API & Worker.',
              '与平台 Machine API Key 严格隔离。生效优先级：后台加密配置 > 容器环境变量。已保存密钥永不回传明文，保存/撤销后实时热生效。',
            )}
          </div>
          <div style={{ fontSize: 11, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
            SOURCE_NETWORK_ENABLED = {String(networkEnabled)}
          </div>
        </div>
      </div>

      {errMsg && <div className="wb-alert wb-alert--error">{errMsg}</div>}

      <div className="ds-grid">
        {credentials.map((item) => {
          const meta = PROVIDER_META[item.provider];
          const val = inputs[item.provider] || '';
          const probe = probeMsg[item.provider];
          return (
            <div key={item.provider} className="c6">
              <div className="ds-card">
                <div className="ds-card-hd">
                  <div>
                    <div className="ds-card-title">
                      <KeyRound size={14} />
                      <span>{meta.title}</span>
                    </div>
                    <div className="ds-card-sub">
                      {meta.platform} · env: <code>{item.envVar}</code>
                    </div>
                  </div>
                  <span className={`tag ${item.source === 'db' ? 'tag--mint' : item.source === 'env' ? 'tag--lilac' : 'tag--line'}`}>
                    {item.source === 'db' ? t('DB Encrypted', '后台加密') : item.source === 'env' ? t('Env Fallback', '环境变量') : t('Unconfigured', '未配置')}
                  </span>
                </div>
                <div className="ds-card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>{t(meta.noteEn, meta.noteZh)}</p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '6px 10px', background: '#fbfcf7', border: '1px solid var(--line)', borderRadius: 6 }}>
                    <span>{t('Active Hint', '当前掩码')}</span>
                    <code style={{ fontFamily: 'var(--font-mono)' }}>{item.keyHint ?? '—'}</code>
                  </div>

                  {item.updatedAt && (
                    <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                      {t('Updated', '更新于')} {item.updatedAt.slice(0, 19).replace('T', ' ')} UTC
                      {item.updatedByEmail ? ` · ${item.updatedByEmail}` : ''} (rev {item.revision})
                    </div>
                  )}

                  <div className="wb-field">
                    <label>{t('Set / Rotate API Key', '设置 / 轮换密钥（只写）')}</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      className="wb-input"
                      placeholder={t('Paste new API key (>= 8 chars)...', '粘贴新 API Key（至少 8 位）...')}
                      value={val}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [item.provider]: e.target.value }))}
                    />
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(confirmLive[item.provider])}
                      onChange={(e) => setConfirmLive((prev) => ({ ...prev, [item.provider]: e.target.checked }))}
                    />
                    <AlertTriangle size={12} color="var(--warn, #c47e18)" />
                    <span>{t('Confirm live upstream probe (may incur provider request)', '确认发起真实上游连通性探测（可能计入服务商请求）')}</span>
                  </label>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="ds-btn"
                      disabled={val.trim().length < 8 || saveMut.isPending}
                      onClick={() => handleSave(item)}
                    >
                      <Check size={12} /> {item.source === 'db' ? t('Rotate Key', '更新密钥') : t('Save Key', '保存密钥')}
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn--ghost"
                      disabled={!item.configured}
                      onClick={() => handleTest(item.provider)}
                    >
                      <Play size={12} /> {confirmLive[item.provider] ? t('Live Probe', '真实探测') : t('Dry Check', '本地校验')}
                    </button>
                    {item.source === 'db' && (
                      <button
                        type="button"
                        className="ds-btn ds-btn--danger"
                        disabled={revokeMut.isPending}
                        onClick={() => handleRevoke(item.provider)}
                      >
                        <Trash2 size={12} /> {t('Revoke DB Key', '撤销后台密钥')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="ds-btn ds-btn--ghost"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => credsQuery.refetch()}
                      title={t('Refresh status', '刷新状态')}
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>

                  {probe && (
                    <div className={`wb-alert ${probe.ok ? 'wb-alert--success' : 'wb-alert--error'}`} style={{ fontSize: 11 }}>
                      {probe.text}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
