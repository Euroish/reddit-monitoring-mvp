import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input, Select } from '../components/ui';
import type { AppUserRole, CreateInviteRequest, CreateInviteResponse } from '../../../../packages/contracts/src/http';

export function OpsInvites() {
  const [roleOnAccept, setRoleOnAccept] = useState<AppUserRole>('viewer');
  const [maxUses, setMaxUses] = useState('1');
  const [code, setCode] = useState('');

  const createInvite = useMutation({
    mutationFn: (payload: CreateInviteRequest) =>
      fetchApi<CreateInviteResponse>('/auth/invites', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createInvite.mutate({
      roleOnAccept,
      maxUses: Number(maxUses),
      code: code.trim() || undefined,
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Invites</h1>
          <p className="page-subtitle">Current backend supports invite creation, but not a persisted invite list endpoint yet.</p>
        </div>
      </div>

      <div className="responsive-grid" style={{ gridTemplateColumns: 'minmax(320px, 520px) minmax(280px, 1fr)' }}>
        <Card>
          <form onSubmit={handleSubmit} className="list-stack" style={{ gap: '16px' }}>
            <div>
              <label htmlFor="invite-role" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Role on accept
              </label>
              <Select id="invite-role" value={roleOnAccept} onChange={(event) => setRoleOnAccept(event.target.value as AppUserRole)}>
                <option value="viewer">viewer</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
              </Select>
            </div>

            <div>
              <label htmlFor="invite-max-uses" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Max uses
              </label>
              <Input id="invite-max-uses" type="number" min={1} max={100} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
            </div>

            <div>
              <label htmlFor="invite-code" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Custom code
              </label>
              <Input id="invite-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Optional" />
            </div>

            <Button type="submit" variant="primary" disabled={createInvite.isPending}>
              {createInvite.isPending ? 'Creating...' : 'Create invite'}
            </Button>
          </form>
        </Card>

        <Card>
          <h3 style={{ marginBottom: '16px' }}>Latest Created Invite</h3>
          {!createInvite.data && <div className="card-empty" style={{ padding: '20px' }}>Create an invite to inspect the current response payload.</div>}
          {createInvite.data && (
            <div className="list-stack">
              <div className="list-row"><span>Code</span><Badge variant="success">{createInvite.data.code}</Badge></div>
              <div className="list-row"><span>Role</span><span>{createInvite.data.invite.roleOnAccept}</span></div>
              <div className="list-row"><span>Max uses</span><span>{createInvite.data.invite.maxUses}</span></div>
              <div className="list-row"><span>Created</span><span>{new Date(createInvite.data.invite.createdAt).toLocaleString()}</span></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
