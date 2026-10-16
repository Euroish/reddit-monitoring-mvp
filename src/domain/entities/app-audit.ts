export type AppAuditOutcome = "attempted" | "succeeded" | "failed";
export interface AppAuditRecord {
  id: string;
  actorUserId: string | null;
  actorType: "session" | "machine";
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  requestId: string | null;
  outcome: AppAuditOutcome;
  changes: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}
