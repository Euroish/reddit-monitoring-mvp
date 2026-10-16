import type { AppAuditOutcome, AppAuditRecord } from "../entities/app-audit";
export interface BeginAppAudit {
  id?: string; actorUserId: string | null; actorType: "session" | "machine";
  action: string; resourceType: string | null; resourceId?: string | null;
  requestId?: string | null; changes?: Record<string, unknown>; createdAt: string;
}
export interface AppAuditQuery { limit?: number; cursor?: string | null; actorId?: string; action?: string; outcome?: AppAuditOutcome }
export interface AppAuditRepository {
  begin(entry: BeginAppAudit): Promise<AppAuditRecord>;
  complete(id: string, outcome: "succeeded" | "failed", resourceId?: string | null, changes?: Record<string, unknown>): Promise<AppAuditRecord | null>;
  list(query?: AppAuditQuery): Promise<{ items: AppAuditRecord[]; nextCursor: string | null }>;
}
