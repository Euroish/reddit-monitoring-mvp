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
  credential_version: number;
}

function mapAppSession(row: AppSessionRow): AppSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    credentialVersion: row.credential_version,
  };
}

export class PostgresAppSessionRepository implements AppSessionRepository {
  constructor(private readonly db: PostgresClient) {}

  public async create(session: AppSession): Promise<void> {
    if (!await this.createIfCurrent(session, session.credentialVersion ?? 0)) throw new Error("Account credentials changed or account is inactive");
  }

  public async createIfCurrent(session: AppSession, expectedVersion: number): Promise<boolean> {
    return this.db.withTransaction(async client => {
      const user = await client.query("SELECT id FROM app_user WHERE id=$1 AND status='active' AND credential_version=$2 FOR SHARE", [session.userId, expectedVersion]);
      if (!user.rowCount) return false;
      await client.query("INSERT INTO app_session(id,user_id,token_hash,expires_at,last_seen_at,created_at,credential_version) VALUES($1,$2,$3,$4,$5,$6,$7)", [session.id, session.userId, session.tokenHash, session.expiresAt, session.lastSeenAt, session.createdAt, expectedVersion]);
      return true;
    });
  }

  public async findByTokenHash(tokenHash: string): Promise<AppSession | null> {
    const result = await this.db.query<AppSessionRow>(
      `
      SELECT id, user_id, token_hash, expires_at, last_seen_at, created_at, credential_version
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

  public async listByUserId(userId: string, nowIso: string): Promise<AppSession[]> {
    const result = await this.db.query<AppSessionRow>("SELECT s.* FROM app_session s JOIN app_user u ON u.id=s.user_id WHERE s.user_id=$1 AND s.expires_at>$2 AND u.status='active' AND s.credential_version=u.credential_version ORDER BY s.last_seen_at DESC,s.id DESC LIMIT 100", [userId, nowIso]);
    return result.rows.map(mapAppSession);
  }

  public async deleteOwnById(userId: string, sessionId: string, nowIso: string): Promise<boolean> {
    const result = await this.db.query("DELETE FROM app_session s USING app_user u WHERE s.user_id=u.id AND s.user_id=$1 AND s.id=$2 AND s.expires_at>$3 AND u.status='active' AND s.credential_version=u.credential_version", [userId, sessionId, nowIso]);
    return Boolean(result.rowCount);
  }
}
