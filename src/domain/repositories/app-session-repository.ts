import type { AppSession } from "../entities/app-session";

export interface AppSessionRepository {
  create(session: AppSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AppSession | null>;
  touch(tokenHash: string, lastSeenAt: string): Promise<void>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
}
