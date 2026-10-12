import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, Input } from '../components/ui';
import { useLanguage } from '../i18n/LanguageContext';
import type { AuthPasswordChangeResponse, AuthSessionsResponse } from '../../../../packages/contracts/src/http';

type RevokeResponse = { ok: true; requestId: string; currentSessionRevoked: boolean };

export function Account() {
  const { user, clearSession } = useAuth();
  const { language } = useLanguage();
  const copy = (en: string, zh: string) => language === 'zh-CN' ? zh : en;
  const client = useQueryClient();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const sessionKey = ['account.sessions', user?.id];
  const sessions = useQuery({ queryKey: sessionKey,
    queryFn: ({ signal }) => fetchApi<AuthSessionsResponse>('/auth/sessions', { signal }), enabled: Boolean(user), retry: false });
  const reauthenticate = () => {
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    clearSession();
    navigate('/login', { replace: true });
  };
  const password = useMutation({
    mutationFn: () => fetchApi<AuthPasswordChangeResponse>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
    onSuccess: reauthenticate,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => fetchApi<RevokeResponse>(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: response => {
      if (response.currentSessionRevoked) reauthenticate();
      else { setNotice(copy('Session revoked.', '会话已撤销。')); void client.invalidateQueries({ queryKey: sessionKey }); }
    },
  });
  const revokeAll = useMutation({
    mutationFn: () => fetchApi<RevokeResponse>('/auth/sessions/revoke-all', { method: 'POST', body: '{}' }),
    onSuccess: response => {
      if (response.currentSessionRevoked) reauthenticate();
      else { setNotice(copy('Sessions revoked.', '会话已撤销。')); void client.invalidateQueries({ queryKey: sessionKey }); }
    },
  });
  const submitPassword = (event: FormEvent) => {
    event.preventDefault(); setFormError(''); setNotice(''); password.reset();
    if (newPassword !== confirmPassword) { setFormError(copy('Passwords do not match.', '两次密码不一致。')); return; }
    if (newPassword === currentPassword) { setFormError(copy('Choose a different new password.', '新密码应与当前密码不同。')); return; }
    password.mutate();
  };
  const operationError = password.error ?? revoke.error ?? revokeAll.error;
  const busy = password.isPending || revoke.isPending || revokeAll.isPending;

  return <div>
    <div className="page-header"><div><h1>{copy('Account security', '账户安全')}</h1>
      <p className="page-subtitle">{user?.email} · {user?.role}</p></div></div>
    {(formError || operationError) && <p role="alert" style={{ color: '#ff4d4f' }}>{formError || operationError?.message || copy('Operation failed.', '操作失败。')}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
      <Card><h2>{copy('Change password', '修改密码')}</h2>
        <p className="page-subtitle">{copy('Changing your password revokes every session, including this one. Sign in again afterward.', '修改密码会撤销全部会话（含当前会话），之后需要重新登录。')}</p>
        <form onSubmit={submitPassword} className="list-stack" style={{ gap: 16, marginTop: 20 }}>
          <div><label htmlFor="account-current-password">{copy('Current password', '当前密码')}</label>
            <Input id="account-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={busy} /></div>
          <div><label htmlFor="account-new-password">{copy('New password', '新密码')}</label>
            <Input id="account-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} required disabled={busy} />
            <small>{copy('12–128 characters.', '12–128 个字符。')}</small></div>
          <div><label htmlFor="account-confirm-password">{copy('Confirm new password', '确认新密码')}</label>
            <Input id="account-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required disabled={busy} /></div>
          <Button type="submit" variant="primary" disabled={busy}>{password.isPending ? copy('Changing...', '正在修改...') : copy('Change password and sign out', '修改密码并退出')}</Button>
        </form>
      </Card>
      <Card><h2>{copy('Active sessions', '有效会话')}</h2>
        <p className="page-subtitle">{copy('Session IDs are references only; no session tokens are displayed.', '会话 ID 仅供识别，此页不显示会话 token。')}</p>
        {sessions.isLoading && <p role="status">{copy('Loading sessions...', '正在加载会话...')}</p>}
        {sessions.error && <p role="alert">{sessions.error.message}</p>}
        <div className="list-stack" style={{ marginTop: 18, gap: 16 }}>
          {sessions.data?.sessions.map(session => <div key={session.id} style={{ borderBottom: '1px solid var(--border-standard)', paddingBottom: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <code style={{ overflowWrap: 'anywhere' }}>{session.id}</code>
              {session.current && <Badge variant="success">{copy('This session', '当前会话')}</Badge>}
            </div>
            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: '8px 0' }}>
              {copy('Created', '创建')} {new Date(session.createdAt).toLocaleString()}<br />
              {copy('Last active', '最近活动')} {new Date(session.lastSeenAt).toLocaleString()}<br />
              {copy('Expires', '到期')} {new Date(session.expiresAt).toLocaleString()}
            </div>
            <Button type="button" onClick={() => { setNotice(''); revoke.mutate(session.id); }} disabled={busy} aria-label={copy(`Revoke session ${session.id}`, `撤销会话 ${session.id}`)}>
              {session.current ? copy('Revoke this session and sign out', '撤销当前会话并退出') : copy('Revoke session', '撤销会话')}
            </Button>
          </div>)}
          {sessions.data?.sessions.length === 0 && <p>{copy('No active sessions.', '暂无有效会话。')}</p>}
          <Button type="button" onClick={() => { setNotice(''); revokeAll.mutate(); }} disabled={busy || !sessions.data?.sessions.length}>{copy('Revoke all sessions and sign out', '撤销全部会话并退出')}</Button>
        </div>
      </Card>
    </div>
  </div>;
}
