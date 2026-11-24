import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Check,
  Copy,
  Key,
  Layers,
  LogOut,
  Mail,
  Palette,
  RotateCcw,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { apiClient } from '../api/client';
import {
  formatApiError,
  isMfaRequiredError,
  useAccessAuditQuery,
  useCreateMachineKeyMutation,
  useLogoutMutation,
  useMachineKeysQuery,
  useRevokeMachineKeyMutation,
  useSourcesQuery,
  useSessionQuery,
  useUpdateUserAccessMutation,
  useUsersQuery,
} from '../api/hooks';
import { BrowserSessionsCard } from '../components/BrowserSessionsCard';
import { AccountEmailStart, AccountPasswordForm } from '../components/AccountEmail';
import { MfaSecurityCard } from '../components/AdministratorMfa';
import { SiftlineLogo } from '../components/BrandMark';
import { InlineMfaStepUp, ViewerForbiddenCard } from '../components/InlineMfaStepUp';
import { QuotasManagementView } from '../components/QuotasManagementView';
import { useLogo } from '../components/brandContext';
import { useTheme } from '../components/themeContext';
import { type Actor, type MachineScope } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { isRedditArchiveSource } from '../lib/collectionLimits';

const ALL_SCOPES: MachineScope[] = ['read', 'export', 'ingest', 'collect', 'sources:write', 'projects:write'];

type SettingsTab = 'account' | 'quota' | 'members' | 'keys' | 'brand';

function getSettingsTabLabel(tab: SettingsTab, t: (en: string, zh: string) => string): string {
  const labels: Record<SettingsTab, string> = {
    quota: t('My Quotas & Capabilities', '我的配额与可用能力'),
    members: t('Members & Invites', '成员与权限'),
    keys: t('Machine API Keys', '机器 API 密钥'),
    brand: t('Brand Mark & Skin', '品牌标识与皮肤'),
    account: t('Account & RBAC', '当前账户与角色'),
  };
  return labels[tab];
}

function ActiveAccountColumn({
  actor,
  canManage,
  sessionMfaActive,
  siteKey,
  onDiag,
  t,
}: {
  actor: Actor;
  canManage: boolean;
  sessionMfaActive: boolean;
  siteKey?: string;
  onDiag: (msg: string) => void;
  t: (en: string, zh: string) => string;
}) {
  return (
    <div className="c5">
      <div className="ds-card">
        <div className="ds-card-hd">
          <div>
            <div className="ds-card-title"><User size={14} /><span>{t('Active Session', '当前会话身份')}</span></div>
            <div className="ds-card-sub">{t('Same-origin Cookie · clientKind:', '同源会话 · 客户端类型：')} {actor.clientKind}</div>
          </div>
        </div>
        <div className="ds-card-bd">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span className="u-avatar" style={{ width: 44, height: 44, fontSize: 14 }}>
              {actor.email.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 650 }}>{actor.email}</div>
              <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{actor.userId}</div>
            </div>
            <span className="tag tag--lilac" style={{ marginLeft: 'auto' }}>{actor.role}</span>
          </div>

          <div style={{ display: 'grid', gap: 2 }}>
            {[
              [t('Client Kind', '客户端类型'), actor.clientKind],
              [t('Product Plan Tier', '产品权益层级'), actor.planTier ?? 'free'],
              [t('Session ID', '会话 ID'), actor.sessionId],
              [t('Allowed Sources', '受限来源'), actor.allowedSourceIds ? actor.allowedSourceIds.join(', ') : 'null (all)'],
            ].map(([k, v]) => (
              <div key={k} className="toggle-line" style={{ borderBottom: '1px solid #f4f6ef' }}>
                <span>{k}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        {canManage && (
          <div className="ds-card-ft">
            <button
              type="button"
              onClick={async () => {
                try {
                  const spec = await apiClient.getOpenApiSummary();
                  onDiag(`OpenAPI ${String(spec.openapi || '3.0')}: ${JSON.stringify(spec.info || {})}`);
                } catch (err) {
                  onDiag(formatApiError(err));
                }
              }}
            >
              {t('Inspect OpenAPI 3.0 Spec →', '核对 /v1/openapi.json →')}
            </button>
          </div>
        )}
      </div>
      <BrowserSessionsCard userId={actor.userId} />
      {sessionMfaActive && <MfaSecurityCard />}
      {siteKey && <section className="ds-card" style={{ marginTop: 12 }}>
        <div className="ds-card-bd">
          <h2>{t('Verify account email', '验证账户邮箱')}</h2>
          <AccountEmailStart siteKey={siteKey} purpose="verify" />
          {actor.role === 'viewer' && <AccountPasswordForm />}
        </div>
      </section>}
    </div>
  );
}

function MemberMfaControl({
  needed,
  pending,
  onVerified,
  onCancel,
}: {
  needed: boolean;
  pending: unknown;
  onVerified: () => Promise<void>;
  onCancel: () => void;
}) {
  if (!needed || !pending) return null;
  return <InlineMfaStepUp onVerified={onVerified} onCancel={onCancel} />;
}

function DiagBanner({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="wb-alert wb-alert--info" style={{ marginBottom: 14, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
      {msg}
    </div>
  );
}

function BearerSnippetCard({ t }: { t: (en: string, zh: string) => string }) {
  return (
    <div className="c4">
      <div className="ds-card">
        <div className="ds-card-hd">
          <div>
            <div className="ds-card-title"><Terminal size={14} /><span>{t('Bearer Auth Snippet', '服务端接入示例')}</span></div>
            <div className="ds-card-sub">Authorization: Bearer &lt;token&gt;</div>
          </div>
        </div>
        <div className="ds-card-bd">
          <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.75, background: '#fbfcf7', border: '1px solid var(--line)', borderRadius: 6, padding: 10, overflowX: 'auto' }}>
{`curl /v1/content \\
  -H "Authorization: Bearer $KEY" \\
  -G --data-urlencode "query=pricing"`}
          </pre>
          <p style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 10, lineHeight: 1.6 }}>
            {t('Never embed machine tokens in frontend code. Browser sessions use cookie auth cleanly.', '严禁将机器密钥放入前端或 localStorage；浏览器一律走同源会话 Cookie。')}
          </p>
        </div>
      </div>
    </div>
  );
}

function RevealedTokenBanner({ token, copied, onCopy, t }: { token: string; copied: boolean; onCopy: (v: string) => void; t: (en: string, zh: string) => string }) {
  return (
    <div className="wb-alert wb-alert--warn" style={{ marginBottom: 14, flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
      <b>{t('Copy Token Now (shown once):', '请立即复制 Token（关闭后永不再显）：')}</b>
      <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
        <code style={{ flex: 1, wordBreak: 'break-all', fontWeight: 700 }}>{token}</code>
        <button type="button" className="ds-btn" style={{ height: 28, fontSize: 11 }} onClick={() => onCopy(token)}>
          <Copy size={12} /> {copied ? t('Copied', '已复制') : t('Copy', '复制')}
        </button>
      </div>
    </div>
  );
}

function AccessAuditPanel({ events, t }: { events?: { id: string; createdAt: string; action: string; resourceId: string | null; actorEmail: string | null }[]; t: (en: string, zh: string) => string }) {
  if (!events?.length) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'var(--muted)' }}>
        {t('Recent Security & Credential Audit (no plaintext secrets)', '近期安全与密钥审计日志（零明文）')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
        {events.slice(0, 10).map((ev) => (
          <div key={ev.id} style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--muted)', padding: '4px 8px', background: '#fbfcf7', borderRadius: 4, border: '1px solid var(--line)' }}>
            {ev.createdAt.slice(0, 19).replace('T', ' ')} · {ev.action} · {ev.resourceId ?? '-'} · {ev.actorEmail ?? 'system'}
          </div>
        ))}
      </div>
    </div>
  );
}

function KeysTableRows({ keys, onRevoke, t }: { keys: { id: string; label: string | null; scopes: string[]; allowed_source_ids: string[] | null; expires_at: string }[]; onRevoke: (id: string) => void; t: (en: string, zh: string) => string }) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>{t('Label / Scopes', '名称 / 作用域')}</th>
          <th>{t('Sources', '来源数')}</th>
          <th>{t('Expires', '过期时间')}</th>
          <th className="num">{t('Revoke', '操作')}</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k.id}>
            <td>
              <b style={{ display: 'block', fontSize: 12 }}>{k.label || 'Key'}</b>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                {k.scopes.map((sc) => (
                  <span key={sc} className="tag" style={{ height: 18, fontSize: 9 }}>{sc}</span>
                ))}
              </div>
            </td>
            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {k.allowed_source_ids ? k.allowed_source_ids.length : 'all'}
            </td>
            <td style={{ fontSize: 11, color: 'var(--faint)' }}>{k.expires_at.slice(0, 10)}</td>
            <td className="num">
              <button
                type="button"
                className="ds-btn ds-btn--danger"
                style={{ height: 26, padding: '0 10px', fontSize: 10.5 }}
                onClick={() => onRevoke(k.id)}
              >
                <Trash2 size={11} /> {t('Revoke', '吊销')}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RbacMatrixCard({ actorRole, t }: { actorRole: Actor['role']; t: (en: string, zh: string) => string }) {
  return (
    <div className="ds-card">
      <div className="ds-card-hd">
        <div>
          <div className="ds-card-title"><Shield size={14} /><span>{t('RBAC Role Matrix', '角色权限矩阵')}</span></div>
          <div className="ds-card-sub">{t('owner issues admin/viewer invites; admin issues viewer only', 'owner 可邀请 admin 与 viewer；admin 仅能邀请 viewer')}</div>
        </div>
      </div>
      <div className="ds-card-bd">
        {([
          ['owner', t('Full operational + governance access, can invite admin and viewer', '全部读写与治理权限，可邀请 admin / viewer')],
          ['admin', t('Full operational writes & budgets, cannot issue admin invite', '除邀请 admin 外与 owner 等价，可建源、配额与项目管理')],
          ['viewer', t('Read-only across projects/sources/content; full personal workspace', '来源 / 项目 / 内容只读；个人工作区（查询/批注）完全可读写')],
        ] as const).map(([r, desc]) => (
          <div key={r} className="toggle-line" style={{ borderBottom: '1px solid #f4f6ef', alignItems: 'flex-start' }}>
            <span>
              <b style={{ color: 'var(--ink)' }}>{r}</b>
              <small>{desc}</small>
            </span>
            {actorRole === r ? (
              <span className="chip-state active">{t('Current', '当前角色')}</span>
            ) : (
              <span className="tag tag--line" style={{ height: 19, fontSize: 9.5 }}>{t('Role', '内置角色')}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandSettingsTab({ lang, t }: { lang: string; t: (en: string, zh: string) => string }) {
  const { activeLogo, setActiveIdx, setSwitcherOpen } = useLogo();
  const { palette, setStudioOpen } = useTheme();
  return (
    <div className="ds-grid">
      <div className="c6">
        <div className="ds-card">
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title"><Sparkles size={14} /><span>{t('SIFTLINE Logo System (30 Concepts)', 'SIFTLINE 品牌标识（30 套 SVG 候选）')}</span></div>
              <div className="ds-card-sub">{t('From brand specification document, live-synced across all surfaces', '来自《新原型设计语言定义稿》，实时同步全站顶栏、登录页与工作台')}</div>
            </div>
          </div>
          <div className="ds-card-bd">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 14, borderRadius: 7, border: '1px solid var(--line)', background: 'linear-gradient(150deg, var(--wb-tint, #f1edfb), var(--wb-teal-tint, #eef6f3))' }}>
              <SiftlineLogo size={50} fontSize={26} />
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--faint)' }}>ACTIVE MARK</div>
                <b style={{ fontSize: 12.5 }}>{activeLogo.num} / {activeLogo.name}</b>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="ds-btn" onClick={() => setSwitcherOpen(true)}>
                <Sparkles size={13} /> {t('Open 30-Logo Studio', '打开 30 套标识浏览器')}
              </button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setActiveIdx(0)}>
                <RotateCcw size={13} /> {t('Reset Default', '恢复默认')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="c6">
        <div className="ds-card">
          <div className="ds-card-hd">
            <div>
              <div className="ds-card-title"><Palette size={14} /><span>{t('Active Interface Color Skin', '工作台界面配色皮肤')}</span></div>
              <div className="ds-card-sub">{lang === 'zh' ? palette.nameZh : palette.nameEn} · {palette.hasGradient ? t('Gradient', '渐变版') : t('Flat Solid', '纯色版')}</div>
            </div>
          </div>
          <div className="ds-card-bd">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                [palette.ink, 'Ink'],
                [palette.accent, 'Accent'],
                [palette.accentDeep, 'Deep'],
                [palette.accent2, 'Secondary'],
                [palette.heroTop, 'Tint'],
              ].map(([hex, labelName]) => (
                <div key={labelName} style={{ width: 64 }}>
                  <div style={{ height: 36, borderRadius: 5, background: hex, border: '1px solid rgba(0,0,0,0.1)' }} />
                  <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>{labelName}</div>
                </div>
              ))}
            </div>
            <button type="button" className="ds-btn ds-btn--brand" onClick={() => setStudioOpen(true)}>
              <Layers size={13} /> {t('Switch Skin Preset (17 Themes + Custom)', '切换 17 套预置皮肤与自定义调色')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage({
  actor,
  initialQueryString = '',
  onNavigate,
}: {
  actor: Actor;
  initialQueryString?: string;
  onNavigate?: (path: string) => void;
}) {
  const { lang, t } = useI18n();
  const canManage = actor.clientKind === 'browser' && actor.role !== 'viewer';

  const sp = new URLSearchParams(initialQueryString);
  const rawTab = sp.get('tab');
  const tab: SettingsTab =
    rawTab === 'quota' || rawTab === 'keys' || rawTab === 'members' || rawTab === 'brand' || rawTab === 'account'
      ? rawTab
      : 'account';
  const tabLabel = getSettingsTabLabel(tab, t);

  const keysQuery = useMachineKeysQuery(canManage && tab === 'keys');
  const sourcesQuery = useSourcesQuery(canManage && tab === 'keys');
  const usersQuery = useUsersQuery(canManage && tab === 'members');
  const auditQuery = useAccessAuditQuery(canManage && tab === 'members');
  const updateUserMut = useUpdateUserAccessMutation();
  const [pendingUserMutation, setPendingUserMutation] = useState<{
    id: string;
    payload: { role?: 'admin' | 'viewer'; status?: 'active' | 'disabled'; planTier?: 'free' | 'pro' };
  } | null>(null);
  const [memberMfaNeeded, setMemberMfaNeeded] = useState(false);
  const createKeyMut = useCreateMachineKeyMutation();
  const revokeKeyMut = useRevokeMachineKeyMutation();
  const logoutMut = useLogoutMutation();
  const session = useSessionQuery().data;
  const siteKey = session?.turnstileSiteKey;
  const invitesQuery = useQuery({
    queryKey: ['accessInvites', actor.userId], queryFn: apiClient.listInvites, enabled: canManage && tab === 'members',
  });

  const sources = sourcesQuery.data?.sources || [];
  const keys = keysQuery.data?.keys || [];
  const requestedArchiveSource = sp.get('archiveSource');
  const archiveSource = sources.find(source => source.id === requestedArchiveSource && source.state === 'active' && isRedditArchiveSource(source));

  const [inviteRole, setInviteRole] = useState<'viewer' | 'admin'>('viewer');
  const [inviteEmail, setInviteEmail] = useState('');
  const [generatedInvite, setGeneratedInvite] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [scopes, setScopes] = useState<MachineScope[]>(['read']);
  const [allowedSourceIds, setAllowedSourceIds] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [diagOutput, setDiagOutput] = useState<string | null>(null);

  const handleGenerateInvite = async () => {
    setInviteErr(null);
    setGeneratedInvite(null);
    try {
      const res = await apiClient.createInvite(inviteRole, siteKey ? inviteEmail.trim() : undefined);
      setGeneratedInvite(res.code);
      void invitesQuery.refetch();
    } catch (err) {
      setInviteErr(formatApiError(err));
    }
  };

  const toggleScope = (sc: MachineScope) => {
    setScopes((prev) => (prev.includes(sc) ? prev.filter((s) => s !== sc) : [...prev, sc]));
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyErr(null);
    setRevealedToken(null);
    if (scopes.includes('ingest') && allowedSourceIds.length === 0) {
      setKeyErr(t('allowedSourceIds is required whenever "ingest" scope is included.', '当包含 "ingest" 作用域时，必须至少绑定 1 个来源。'));
      return;
    }
    try {
      const res = await createKeyMut.mutateAsync({
        label: label.trim() || 'CI Pipeline Key',
        scopes,
        allowedSourceIds,
        expiresInDays,
      });
      setRevealedToken({ token: res.token, expiresAt: res.expiresAt });
      setLabel('');
    } catch (err) {
      setKeyErr(formatApiError(err));
    }
  };

  const copyText = (txt: string) => {
    navigator.clipboard?.writeText(txt).catch(() => {});
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1600);
  };

  return (
    <div className="ds-page">
      <div className="crumb">
        <button type="button" onClick={() => onNavigate?.('/settings?tab=account')}>
          {t('Account & Settings', '账户与设置')}
        </button>
        <span>/</span>
        <b>{tabLabel}</b>
      </div>

      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{t('Account, RBAC & Appearance', '账户权限、密钥与品牌皮肤')}</h1>
            <span className="tag tag--lilac">{actor.role}</span>
          </div>
          <p className="page-desc">
            {t(
              'Same-origin session security, 72-char one-time team invites, SHA-256 machine keys, and SIFTLINE brand/skin preferences.',
              '浏览器同源会话安全、一次性团队邀请码签发、43 位机器 API 密钥及 SIFTLINE 标识/皮肤外观设置。',
            )}
          </p>
        </div>
        <div className="page-actions">
          {canManage && (
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              onClick={async () => {
                try {
                  const [h, r] = await Promise.all([apiClient.healthz(), apiClient.readyz()]);
                  setDiagOutput(`/healthz: ${JSON.stringify(h)} · /readyz: ${JSON.stringify(r)}`);
                } catch (err) {
                  setDiagOutput(formatApiError(err));
                }
              }}
            >
              <Activity size={13} />
              <span>{t('Probe Health', '健康探针')}</span>
            </button>
          )}
          <button type="button" className="ds-btn ds-btn--danger" onClick={() => logoutMut.mutate()}>
            <LogOut size={13} />
            <span>{t('Sign Out', '退出登录')}</span>
          </button>
        </div>
      </div>

      <DiagBanner msg={diagOutput} />

      {tab === 'account' && (
        <div className="ds-grid">
          <ActiveAccountColumn
            actor={actor}
            canManage={canManage}
            sessionMfaActive={Boolean(session?.mfaActive)}
            siteKey={siteKey}
            onDiag={setDiagOutput}
            t={t}
          />

          <div className="c7">
            <RbacMatrixCard actorRole={actor.role} t={t} />
          </div>
        </div>
      )}

      {tab === 'quota' && (
        <QuotasManagementView
          actor={actor}
          budgets={[]}
          budgetError={null}
          budgetsPending={false}
          providers={[]}
          sources={[]}
          onEditBudget={() => {}}
          forcePersonalView={!canManage}
        />
      )}

      {!canManage && (tab === 'members' || tab === 'keys') && (
        <ViewerForbiddenCard onNavigate={(path) => onNavigate?.(path)} />
      )}

      {canManage && tab === 'members' && (
        <div className="ds-grid">
          <div className="c7">
            <div className="ds-card">
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title"><Users size={14} /><span>{t('Members & Access Control', '成员列表与权限边界')}</span></div>
                  <div className="ds-card-sub">{t('System role (owner/admin/viewer) is distinct from product plan tier (free/pro)', '系统角色与产品权益层级 (free/pro) 分离管理')}</div>
                </div>
              </div>
              <div className="ds-card-bd" style={{ paddingTop: 4 }}>
                {canManage && usersQuery.data?.users ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {usersQuery.data.users.map((u) => (
                      <div key={u.id} className="note-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <span className="u-avatar">{u.email.slice(0, 2).toUpperCase()}</span>
                        <div style={{ flex: 1, minWidth: 160 }}>
                          <b style={{ fontSize: 12.5 }}>{u.email}</b>
                          <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                            {u.status} · plan: {u.planTier}
                          </div>
                        </div>
                        <span className={`tag ${u.role === 'owner' ? 'tag--lilac' : u.role === 'admin' ? 'tag--mint' : 'tag--line'}`}>{u.role}</span>
                        {u.role !== 'owner' && (actor.role === 'owner' || u.role === 'viewer') && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            {actor.role === 'owner' && (
                              <>
                                <select
                                  className="wb-select"
                                  style={{ height: 26, fontSize: 11 }}
                                  value={u.role}
                                  onChange={async (e) => {
                                    const payload = { role: e.target.value as 'admin' | 'viewer' };
                                    setPendingUserMutation({ id: u.id, payload });
                                    try {
                                      await updateUserMut.mutateAsync({ id: u.id, payload });
                                      setMemberMfaNeeded(false);
                                      setPendingUserMutation(null);
                                    } catch (err) {
                                      if (isMfaRequiredError(err)) setMemberMfaNeeded(true);
                                    }
                                  }}
                                >
                                  <option value="viewer">viewer</option>
                                  <option value="admin">admin</option>
                                </select>
                                <select
                                  className="wb-select"
                                  style={{ height: 26, fontSize: 11 }}
                                  value={u.planTier}
                                  onChange={async (e) => {
                                    const payload = { planTier: e.target.value as 'free' | 'pro' };
                                    setPendingUserMutation({ id: u.id, payload });
                                    try {
                                      await updateUserMut.mutateAsync({ id: u.id, payload });
                                      setMemberMfaNeeded(false);
                                      setPendingUserMutation(null);
                                    } catch (err) {
                                      if (isMfaRequiredError(err)) setMemberMfaNeeded(true);
                                    }
                                  }}
                                >
                                  <option value="free">free</option>
                                  <option value="pro">pro</option>
                                </select>
                              </>
                            )}
                            <button
                              type="button"
                              className="ds-btn ds-btn--ghost"
                              style={{ height: 26, padding: '0 8px', fontSize: 10.5 }}
                              onClick={() => onNavigate?.(`/sources?tab=budgets&userId=${encodeURIComponent(u.id)}`)}
                            >
                              {t('Quotas / Override', '配额覆盖')}
                            </button>
                            <button
                              type="button"
                              className={`ds-btn ${u.status === 'active' ? 'ds-btn--danger' : 'ds-btn--ghost'}`}
                              style={{ height: 26, padding: '0 8px', fontSize: 10.5 }}
                              onClick={() => updateUserMut.mutate({ id: u.id, payload: { status: u.status === 'active' ? 'disabled' : 'active' } })}
                            >
                              {u.status === 'active' ? t('Disable', '停用') : t('Enable', '启用')}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="note-row">
                    <span className="u-avatar">{actor.email.slice(0, 2).toUpperCase()}</span>
                    <div style={{ flex: 1 }}>
                      <b style={{ fontSize: 12.5 }}>{actor.email}</b>
                      <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                        {t('Current authenticated operator', '当前已认证登录账户')} · {actor.clientKind}
                      </div>
                    </div>
                    <span className={`tag ${actor.role === 'owner' ? 'tag--lilac' : actor.role === 'admin' ? 'tag--mint' : 'tag--line'}`}>{actor.role}</span>
                  </div>
                )}
                {canManage && <MemberMfaControl
                  needed={memberMfaNeeded}
                  pending={pendingUserMutation}
                  onVerified={async () => {
                    if (!pendingUserMutation) return;
                    await updateUserMut.mutateAsync(pendingUserMutation);
                    setMemberMfaNeeded(false);
                    setPendingUserMutation(null);
                  }}
                  onCancel={() => {
                    setMemberMfaNeeded(false);
                    setPendingUserMutation(null);
                  }}
                />}
                {canManage && <AccessAuditPanel events={auditQuery.data?.events} t={t} />}
              </div>
            </div>
          </div>

          <div className="c5">
            <div className="ds-card">
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title"><Mail size={14} /><span>{t('Generate Invite Code', '生成一次性邀请码')}</span></div>
                  <div className="ds-card-sub">POST /v1/access/invites · 72 chars · 7 days TTL</div>
                </div>
              </div>
              <div className="ds-card-bd">
                {!canManage ? (
                  <div className="wb-alert wb-alert--info">{t('Only owner and admin roles can generate team invites.', '仅 owner 与 admin 可签发团队邀请码。')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="wb-field">
                      <label>{t('Target Role', '受邀角色')}</label>
                      <select className="wb-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'viewer' | 'admin')}>
                        <option value="viewer">viewer</option>
                        <option value="admin" disabled={actor.role !== 'owner'}>
                          admin {actor.role !== 'owner' ? '(owner only)' : ''}
                        </option>
                      </select>
                    </div>
                    {siteKey && <label>{t('Recipient email', '受邀邮箱')}
                      <input className="auth-input" type="email" value={inviteEmail} maxLength={254}
                        onChange={(event) => setInviteEmail(event.target.value)} />
                    </label>}
                    <button type="button" className="ds-btn" disabled={Boolean(siteKey && !inviteEmail.trim())} onClick={handleGenerateInvite}>
                      {t(`Generate ${inviteRole} Invite`, `生成 ${inviteRole} 邀请码`)}
                    </button>
                    {inviteErr && <div className="wb-alert wb-alert--error">{inviteErr}</div>}
                    {invitesQuery.error && <p role="alert">{formatApiError(invitesQuery.error)}</p>}
                    {invitesQuery.data?.invites.map((entry) => (
                      <div className="toggle-line" key={entry.id} style={{ flexWrap: 'wrap', gap: 8 }}>
                        <span>{entry.role} · {({
                          active: t('Active', '有效'), disabled: t('Revoked', '已撤销'),
                          used: t('Used', '已使用'), expired: t('Expired', '已过期'),
                        })[entry.status]}{entry.expiresAt && ' · ' + new Date(entry.expiresAt).toLocaleDateString(lang)}</span>
                        {entry.status === 'active' && <button type="button" className="ds-btn ds-btn--ghost" onClick={async () => {
                          if (!window.confirm(t('Revoke this invitation?', '撤销此邀请码？'))) return;
                          setInviteErr(null);
                          try { await apiClient.revokeInvite(entry.id); await invitesQuery.refetch(); }
                          catch (error) { setInviteErr(formatApiError(error)); }
                        }}>{t('Revoke', '撤销')}</button>}
                      </div>
                    ))}
                    {generatedInvite && (
                      <div className="wb-alert wb-alert--success" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                        <b>{t('72-char one-time invite token:', '72 位一次性邀请码：')}</b>
                        <code style={{ wordBreak: 'break-all', fontSize: 11 }}>{generatedInvite}</code>
                        <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 26, fontSize: 10.5 }} onClick={() => copyText(generatedInvite)}>
                          {copiedKey ? <Check size={12} /> : <Copy size={12} />} {t('Copy', '复制')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {canManage && tab === 'keys' && (
        <div className="ds-grid">
          <div className="c8">
            <div className="ds-card">
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title"><Key size={14} /><span>{t('Machine API Keys', '机器 API 密钥')}</span></div>
                  <div className="ds-card-sub">{t('43-char plaintext shown once on creation · SHA-256 stored server-side', '43 位明文仅创建时展示一次 · 服务端仅保存 SHA-256 哈希')}</div>
                </div>
              </div>
              <div className="ds-card-bd">
                {canManage && (
                  <form onSubmit={handleCreateKey} style={{ background: '#fbfcf7', border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="wb-grid-2">
                      <div className="wb-field">
                        <label>{t('Key Label', '密钥名称')}</label>
                        <input className="wb-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="BI Export Sync" required />
                      </div>
                      <div className="wb-field">
                        <label>{t('Expires In Days (1..90)', '有效期（1..90 天）')}</label>
                        <input type="number" className="wb-input" min={1} max={90} value={expiresInDays} onChange={(e) => setExpiresInDays(Math.min(90, Math.max(1, Number(e.target.value) || 30)))} />
                      </div>
                    </div>
                    <div className="wb-field">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <label style={{ margin: 0 }}>{t('Scopes', '授权作用域')}</label>
                        {requestedArchiveSource && (
                          <button type="button" className="ds-btn ds-btn--quiet" disabled={!archiveSource}
                            onClick={() => {
                              if (!archiveSource) return;
                              setLabel('r4-open-corpus-pusher');
                              setScopes(['ingest']);
                              setAllowedSourceIds([archiveSource.id]);
                            }}>
                            {t('Use archive source preset', '应用归档来源预设')}
                          </button>
                        )}
                      </div>
                      <div className="pill-select">
                        {ALL_SCOPES.map((sc) => (
                          <button key={sc} type="button" className={scopes.includes(sc) ? 'on' : ''} onClick={() => toggleScope(sc)}>
                            {sc}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="wb-field">
                      <label>
                        {t('Allowed Sources', '绑定来源')} {scopes.includes('ingest') ? t('(required for ingest)', '(含 ingest 必填)') : t('(optional)', '(可选)')}
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {sources.map((s) => (
                          <label key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={allowedSourceIds.includes(s.id)}
                              onChange={() =>
                                setAllowedSourceIds((prev) =>
                                  prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                                )
                              }
                            />
                            <span>{s.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    {requestedArchiveSource && !archiveSource && !sourcesQuery.isPending &&
                      <p className="muted">{t('The requested archive source is unavailable or inactive.', '指定的归档来源不可用或未启用。')}</p>}
                    {keyErr && <div className="wb-alert wb-alert--error">{keyErr}</div>}
                    <div>
                      <button type="submit" className="ds-btn" disabled={createKeyMut.isPending}>
                        {t('Issue Machine Key', '生成机器密钥')}
                      </button>
                    </div>
                  </form>
                )}

                {revealedToken && <RevealedTokenBanner token={revealedToken.token} copied={copiedKey} onCopy={copyText} t={t} />}

                <KeysTableRows keys={keys} onRevoke={(id) => revokeKeyMut.mutate(id)} t={t} />
              </div>
            </div>
          </div>

          <BearerSnippetCard t={t} />
        </div>
      )}

      {tab === 'brand' && <BrandSettingsTab lang={lang} t={t} />}
    </div>
  );
}
