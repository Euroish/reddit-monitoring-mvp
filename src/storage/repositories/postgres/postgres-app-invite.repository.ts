import type { AppInvite } from "../../../domain/entities/app-invite";
import type { AppInviteRepository } from "../../../domain/repositories/app-invite-repository";
import type { PostgresClient } from "../../postgres/postgres-client";

interface AppInviteRow {
  id: string;
  code_hash: string;
  status: AppInvite["status"];
  role_on_accept: AppInvite["roleOnAccept"];
  max_uses: number;
  used_count: number;
  expires_at: Date | null;
  created_at: Date;
}

function mapAppInvite(row: AppInviteRow): AppInvite {
  return {
    id: row.id,
    codeHash: row.code_hash,
    status: row.status,
    roleOnAccept: row.role_on_accept,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: row.expires_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresAppInviteRepository implements AppInviteRepository {
  constructor(private readonly db: PostgresClient) {}

  public async create(invite: AppInvite): Promise<void> {
    await this.db.query(
      `
      INSERT INTO app_invite (
        id, code_hash, status, role_on_accept, max_uses, used_count, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        invite.id,
        invite.codeHash,
        invite.status,
        invite.roleOnAccept,
        invite.maxUses,
        invite.usedCount,
        invite.expiresAt ?? null,
        invite.createdAt,
      ],
    );
  }

  public async findByCodeHash(codeHash: string): Promise<AppInvite | null> {
    const result = await this.db.query<AppInviteRow>(
      `
      SELECT id, code_hash, status, role_on_accept, max_uses, used_count, expires_at, created_at
      FROM app_invite
      WHERE code_hash = $1
      LIMIT 1
      `,
      [codeHash],
    );
    return result.rows.length > 0 ? mapAppInvite(result.rows[0]) : null;
  }

  public async incrementUsedCountIfAvailable(id: string, nowIso: string): Promise<boolean> {
    const result = await this.db.query<{ id: string }>(
      `
      UPDATE app_invite
      SET used_count = used_count + 1
      WHERE id = $1
        AND status = 'active'
        AND used_count < max_uses
        AND (expires_at IS NULL OR expires_at > $2)
      RETURNING id
      `,
      [id, nowIso],
    );
    return result.rows.length > 0;
  }
}
