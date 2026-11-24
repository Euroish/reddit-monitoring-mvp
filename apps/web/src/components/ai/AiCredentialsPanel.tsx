import { useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import {
  type AiCredentialStatusItem,
  useAiAdminMutations,
  useAiCredentialsQuery,
} from '../../api/ai-client';
import { formatApiError, isMfaRequiredError } from '../../api/hooks';
import { useI18n } from '../../i18n/translations';
import { InlineMfaStepUp } from '../InlineMfaStepUp';

const PROVIDER_LABELS: Record<AiCredentialStatusItem['provider'], { title: string; descEn: string; descZh: string }> = {
  artificial_analysis: {
    title: 'Artificial Analysis',
    descEn: 'Benchmark rankings API key and optional public redistribution flag.',
    descZh: '用于拉取 AI 评测榜单快照；免费层默认仅限内部管理员查看，可按需配置商业公开分发许可。',
  },
  ai_llm: {
    title: 'AI Extraction LLM',
    descEn: 'HTTPS OpenAI-compatible endpoint, model ID, and API key for official article metadata extraction.',
    descZh: '用于辅助从官方公告长文中提取模型、日期与摘要结构化字段（须为公网 HTTPS 接口）。',
  },
  openrouter: {
    title: 'OpenRouter Catalog',
    descEn: 'Optional bearer key for authenticated OpenRouter model catalog synchronization.',
    descZh: '可选 Bearer 密钥，用于提高 OpenRouter 目录同步稳定性与限额。',
  },
};

export function AiCredentialsPanel() {
  const { t } = useI18n();
  const credsQ = useAiCredentialsQuery(true);
  const mutations = useAiAdminMutations();

  const [editingProvider, setEditingProvider] = useState<AiCredentialStatusItem['provider'] | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [model, setModel] = useState('');
  const [publicRedistribution, setPublicRedistribution] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [pendingMfaAction, setPendingMfaAction] = useState<(() => Promise<void>) | null>(null);

  const openEditor = (item: AiCredentialStatusItem) => {
    setEditingProvider(item.provider);
    setApiKey('');
    setApiUrl(item.config.apiUrl ?? '');
    setModel(item.config.model ?? '');
    setPublicRedistribution(Boolean(item.config.publicRedistribution));
    setMsg(null);
    setPendingMfaAction(null);
  };

  const runWithMfa = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
      setPendingMfaAction(null);
    } catch (err) {
      if (isMfaRequiredError(err)) {
        setPendingMfaAction(() => fn);
      } else {
        setMsg({ text: formatApiError(err), err: true });
      }
    }
  };

  return (
    <section className="ds-card">
      <header className="ds-card-hd">
        <div>
          <h2 className="ds-card-title">
            <KeyRound size={15} /> {t('AI Service Credentials (Encrypted)', 'AI 外部服务密钥与端点配置（加密存储）')}
          </h2>
          <div className="ds-card-sub">
            {t(
              'Encrypted with AES-256-GCM at rest. Database credentials override container environment variables immediately.',
              '密钥采用 AES-256-GCM 加密入库，保存后即时生效，无需修改环境变量或重启容器。',
            )}
          </div>
        </div>
      </header>
      <div className="ds-card-bd source-editor-fields">
        {credsQ.isError && <div role="alert" className="wb-alert wb-alert--error">{formatApiError(credsQ.error)}</div>}
        {msg && (
          <div role={msg.err ? 'alert' : 'status'} className={'wb-alert ' + (msg.err ? 'wb-alert--error' : 'wb-alert--success')}>
            {msg.text}
          </div>
        )}
        {pendingMfaAction && (
          <InlineMfaStepUp
            onVerified={async () => {
              await pendingMfaAction();
              setPendingMfaAction(null);
            }}
            onCancel={() => setPendingMfaAction(null)}
          />
        )}
        <div style={{ display: 'grid', gap: 10 }}>
          {(credsQ.data?.items ?? []).map((item) => {
            const meta = PROVIDER_LABELS[item.provider];
            const isEditing = editingProvider === item.provider;
            return (
              <div key={item.provider} style={{ padding: 12, borderRadius: 8, border: '1px solid var(--line)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{meta.title}</strong>
                      <span className={`chip-state ${item.configured ? 'active' : 'paused'}`}>
                        {item.configured ? `${t('Configured', '已配置')} (${item.source})` : t('Unconfigured', '未配置')}
                      </span>
                      {item.keyHint && <code>{item.keyHint}</code>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{t(meta.descEn, meta.descZh)}</div>
                    {item.provider === 'ai_llm' && item.config.apiUrl && (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {item.config.apiUrl} {item.config.model ? `· model: ${item.config.model}` : ''}
                      </div>
                    )}
                    {item.provider === 'artificial_analysis' && (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {item.config.publicRedistribution
                          ? t('Public redistribution enabled', '已开启公开榜单分发')
                          : t('Internal preview only', '仅限内部管理预览')}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="ds-btn ds-btn--ghost"
                      disabled={mutations.testCredential.isPending}
                      onClick={() => void runWithMfa(async () => {
                        const res = await mutations.testCredential.mutateAsync({ provider: item.provider });
                        setMsg({
                          text: `${meta.title}: ${res.ok ? t('Connection succeeded', '连通测试通过') : t('Connection failed', '连通测试失败')} (${res.message})`,
                          err: !res.ok,
                        });
                      })}
                    >
                      <ShieldCheck size={13} /> {t('Test', '测试连通')}
                    </button>
                    <button type="button" className="ds-btn ds-btn--ghost" onClick={() => openEditor(item)}>
                      {t('Configure', '配置')}
                    </button>
                    {item.source === 'database' && (
                      <button
                        type="button"
                        className="ds-btn ds-btn--danger"
                        disabled={mutations.deleteCredential.isPending}
                        onClick={() => void runWithMfa(async () => {
                          await mutations.deleteCredential.mutateAsync(item.provider);
                          if (isEditing) setEditingProvider(null);
                          setMsg({ text: `${meta.title}: ${t('Database credential cleared.', '已清除数据库密钥覆盖。')}` });
                        })}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div style={{ display: 'grid', gap: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                    <label className="wb-field">
                      {t('API Key (leave blank to preserve existing key when updating settings)', 'API 密钥（仅改其他参数且已有密钥时可留空）')}
                      <input
                        type="password"
                        className="wb-input"
                        value={apiKey}
                        placeholder={item.keyHint ? `${t('Current', '当前')}: ${item.keyHint}` : 'sk-...'}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                    </label>
                    {item.provider === 'ai_llm' && (
                      <div className="wb-grid-2">
                        <label className="wb-field">
                          {t('HTTPS Chat Completions URL', 'HTTPS Chat Completions 接口地址')}
                          <input
                            type="url"
                            className="wb-input"
                            placeholder="https://api.openai.com/v1/chat/completions"
                            value={apiUrl}
                            onChange={(e) => setApiUrl(e.target.value)}
                          />
                        </label>
                        <label className="wb-field">
                          {t('Model Name', '模型名称')}
                          <input
                            className="wb-input"
                            placeholder="gpt-4o-mini"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                    {item.provider === 'artificial_analysis' && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <input
                          type="checkbox"
                          checked={publicRedistribution}
                          onChange={(e) => setPublicRedistribution(e.target.checked)}
                        />
                        <span>{t('Commercial license permits public /ai ranking redistribution', '已具备商业授权，允许在公开 /ai 榜单展示')}</span>
                      </label>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="ds-btn"
                        disabled={mutations.saveCredential.isPending}
                        onClick={() => void runWithMfa(async () => {
                          const config = item.provider === 'ai_llm'
                            ? { apiUrl: apiUrl.trim(), model: model.trim() || undefined }
                            : item.provider === 'artificial_analysis'
                              ? { publicRedistribution }
                              : {};
                          await mutations.saveCredential.mutateAsync({
                            provider: item.provider,
                            body: { ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), config },
                          });
                          setEditingProvider(null);
                          setApiKey('');
                          setMsg({ text: `${meta.title}: ${t('Saved encrypted credential.', '加密凭证已保存并生效。')}` });
                        })}
                      >
                        {t('Save', '保存')}
                      </button>
                      <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setEditingProvider(null)}>
                        {t('Cancel', '取消')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
