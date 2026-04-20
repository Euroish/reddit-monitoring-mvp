import type { AppSession } from "../../../domain/entities/app-session";
import type { AppSessionRepository } from "../../../domain/repositories/app-session-repository";
import type { PostgresClient } from "../../postgres/postgres-client";

interface AppSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  last_seen_at: Date;
  created_at: Date;
}

function mapAppSession(row: AppSessionRow): AppSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresAppSessionRepository implements AppSessionRepository {
  constructor(private readonly db: PostgresClient) {}

  public async create(session: AppSession): Promise<void> {
    await this.db.query(
      `
      INSERT INTO app_session (
        id, user_id, token_hash, expires_at, last_seen_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.expiresAt,
        session.lastSeenAt,
        session.createdAt,
      ],
    );
  }

  public async findByTokenHash(tokenHash: string): Promise<AppSession | null> {
    const result = await this.db.query<AppSessionRow>(
      `
      SELECT id, user_id, token_hash, expires_at, last_seen_at, created_at
      FROM app_session
      WHERE token_hash = $1
      LIMIT 1
      `,
      [tokenHash],
    );
    return result.rows.length > 0 ? mapAppSession(result.rows[0]) : null;
  }

  public async touch(tokenHash: string, lastSeenAt: string): Promise<void> {
    await this.db.query(
      `
      UPDATE app_session
      SET last_seen_at = $2
      WHERE token_hash = $1
      `,
      [tokenHash, lastSeenAt],
    );
  }

  public async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.query("DELETE FROM app_session WHERE token_hash = $1", [tokenHash]);
  }

  public async deleteByUserId(userId: string): Promise<void> {
    await this.db.query("DELETE FROM app_session WHERE user_id = $1", [userId]);
  }
}
