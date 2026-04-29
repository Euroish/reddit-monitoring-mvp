import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card } from '../components/ui';
import type {
  AuthMeResponse,
  ListAppUsersResponse,
  UpdateAppUserStatusRequest,
  UpdateAppUserStatusResponse,
} from '../../../../packages/contracts/src/http';

type UserStatus = 'pending' | 'active' | 'disabled';

function statusVariant(status: UserStatus) {
  return status === 'active' ? 'success' : 'neutral';
}

export function OpsUsers() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops.users'],
    queryFn: () => fetchApi<ListAppUsersResponse>('/auth/users'),
  });

  const activateUser = useMutation({
    mutationFn: (userId: string) => fetchApi<AuthMeResponse>(`/auth/users/${userId}/activate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ops.users'] }),
  });

  const updateStatus = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: UserStatus }) =>
      fetchApi<UpdateAppUserStatusResponse>(`/auth/users/${userId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status } satisfies UpdateAppUserStatusRequest),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ops.users'] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p className="page-subtitle">Account activation and status control using the current auth admin endpoints.</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading users...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading users.</div>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {data.users.map((user) => (
            <Card key={user.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ marginBottom: '8px' }}>{user.displayName ?? user.email}</h3>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{user.email}</div>
                </div>
                <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
              </div>

              <div className="list-stack" style={{ marginBottom: '18px' }}>
                <div className="list-row"><span>Role</span><span>{user.role}</span></div>
                <div className="list-row"><span>Status</span><span>{user.status}</span></div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {user.status === 'pending' && (
                  <Button type="button" variant="primary" onClick={() => activateUser.mutate(user.id)} disabled={activateUser.isPending}>
                    Activate
                  </Button>
                )}
                {user.status !== 'disabled' && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => updateStatus.mutate({ userId: user.id, status: 'disabled' })}
                    disabled={updateStatus.isPending}
                  >
                    Disable
                  </Button>
                )}
                {user.status === 'disabled' && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => updateStatus.mutate({ userId: user.id, status: 'active' })}
                    disabled={updateStatus.isPending}
                  >
                    Re-enable
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
