import type { AppSession } from "../entities/app-session";

export interface AppSessionRepository {
  create(session: AppSession): Promise<void>;
  createIfCurrent(session: AppSession, expectedVersion: number): Promise<boolean>;
  findByTokenHash(tokenHash: string): Promise<AppSession | null>;
  touch(tokenHash: string, lastSeenAt: string): Promise<void>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
  listByUserId(userId: string, nowIso: string): Promise<AppSession[]>;
  deleteOwnById(userId: string, sessionId: string, nowIso: string): Promise<boolean>;
}
