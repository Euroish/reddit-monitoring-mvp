import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import { Badge, Button, Card, Select } from '../components/ui';
import type {
  AppUserRole,
  AuthMeResponse,
  ListAppUsersResponse,
  UpdateAppUserStatusRequest,
  UpdateAppUserStatusResponse,
  UpdateAppUserRoleResponse,
} from '../../../../packages/contracts/src/http';

type UserStatus = 'pending' | 'active' | 'disabled';

function statusVariant(status: UserStatus) {
  return status === 'active' ? 'success' : 'neutral';
}

export function OpsUsers() {
  const { user: currentUser } = useAuth();
  const { language } = useLanguage();
  const copy = (en: string, zh: string) => language === 'zh-CN' ? zh : en;
  const [roleDrafts, setRoleDrafts] = useState<Record<string, AppUserRole>>({});
  const [notice, setNotice] = useState('');
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops.users', currentUser?.id],
    queryFn: ({ signal }) => fetchApi<ListAppUsersResponse>('/auth/users', { signal }),
    enabled: currentUser?.role === 'owner' || currentUser?.role === 'admin', retry: false,
  });
  const updated = () => { setNotice(copy('User updated.', '用户已更新。')); return queryClient.invalidateQueries({ queryKey: ['ops.users'] }); };

  const activateUser = useMutation({
    mutationFn: (userId: string) => fetchApi<AuthMeResponse>(`/auth/users/${userId}/activate`, { method: 'POST' }),
    onSuccess: updated,
  });

  const updateStatus = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: UserStatus }) =>
      fetchApi<UpdateAppUserStatusResponse>(`/auth/users/${userId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status } satisfies UpdateAppUserStatusRequest),
      }),
    onSuccess: updated,
  });
  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AppUserRole }) => fetchApi<UpdateAppUserRoleResponse>(`/auth/users/${userId}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
    onSuccess: () => { setRoleDrafts({}); return updated(); },
  });
  const operationError = activateUser.error ?? updateStatus.error ?? updateRole.error;
  const busy = activateUser.isPending || updateStatus.isPending || updateRole.isPending;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{copy('Users', '用户')}</h1>
          <p className="page-subtitle">{copy('Admins manage viewer status. Owners manage other users and roles; self-disable and self-demotion are blocked, and at least one active owner must remain.', '管理员管理 viewer 状态；owner 可管理其他用户和角色。禁止自己禁用或降权，且必须保留至少一名有效 owner。')}</p>
        </div>
      </div>

      {isLoading && <div role="status" style={{ color: 'var(--text-tertiary)' }}>{copy('Loading users...', '正在加载用户...')}</div>}
      {(error || operationError) && <div role="alert" style={{ color: '#ff4d4f' }}>{(error ?? operationError)?.message}</div>}
      {notice && <p role="status">{notice}</p>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
          {data.users.map((user) => {
            const self = user.id === currentUser?.id;
            const canManage = !self && (currentUser?.role === 'owner' || (currentUser?.role === 'admin' && user.role === 'viewer'));
            const canChangeRole = !self && currentUser?.role === 'owner';
            const selectedRole = roleDrafts[user.id] ?? user.role;
            return (
            <Card key={user.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ marginBottom: '8px' }}>{user.displayName ?? user.email}</h3>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{user.email}</div>
                </div>
                <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
              </div>

              <div className="list-stack" style={{ marginBottom: '18px' }}>
                <div className="list-row"><span>{copy('Role', '角色')}</span><span>{user.role}{self ? copy(' (you)', '（自己）') : ''}</span></div>
                <div className="list-row"><span>{copy('Status', '状态')}</span><span>{user.status}</span></div>
              </div>
              <div style={{ marginBottom: 14 }}><label htmlFor={`user-role-${user.id}`}>{copy('Change role', '调整角色')}</label>
                <Select id={`user-role-${user.id}`} value={selectedRole} disabled={!canChangeRole || busy} onChange={event => setRoleDrafts(value => ({ ...value, [user.id]: event.target.value as AppUserRole }))}>
                  <option value="viewer">viewer</option><option value="admin">admin</option><option value="owner">owner</option>
                </Select>
                <Button type="button" style={{ marginTop: 8 }} disabled={!canChangeRole || busy || selectedRole === user.role} onClick={() => { setNotice(''); updateRole.mutate({ userId: user.id, role: selectedRole }); }}>{copy('Save role', '保存角色')}</Button>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {user.status === 'pending' && (
                  <Button type="button" variant="primary" onClick={() => { setNotice(''); activateUser.mutate(user.id); }} disabled={!canManage || busy}>
                    {copy('Activate', '激活')}
                  </Button>
                )}
                {user.status !== 'disabled' && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => updateStatus.mutate({ userId: user.id, status: 'disabled' })}
                    disabled={!canManage || busy}
                  >
                    {copy('Disable', '禁用')}
                  </Button>
                )}
                {user.status === 'disabled' && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => updateStatus.mutate({ userId: user.id, status: 'active' })}
                    disabled={!canManage || busy}
                  >
                    {copy('Re-enable', '重新启用')}
                  </Button>
                )}
              </div>
            </Card>
          ); })}
        </div>
      )}
    </div>
  );
}
