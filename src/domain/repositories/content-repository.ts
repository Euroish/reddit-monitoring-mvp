import type { Content } from "../entities/content";

export interface ContentRepository {
  upsertMany(contents: Content[]): Promise<void>;
  countExistingExternalIds(args: { targetId: string; externalIds: string[] }): Promise<number>;
  findExistingExternalIds(args: { targetId: string; externalIds: string[] }): Promise<string[]>;
  findRecentByTarget(targetId: string, limit: number): Promise<Content[]>;
  findByTargetCreatedAtRange(args: {
    targetId: string;
    from: string;
    to: string;
    limit?: number;
    totalEligibleOnly?: boolean;
  }): Promise<Content[]>;
  findByTargetFirstSeenAtRange(args: {
    targetId: string;
    from: string;
    to: string;
    limit?: number;
    totalEligibleOnly?: boolean;
  }): Promise<Content[]>;
}
