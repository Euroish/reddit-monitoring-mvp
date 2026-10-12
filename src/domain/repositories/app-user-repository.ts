import type { AppUser, AppUserPassword } from "../entities/app-user";

export interface AppUserWithPassword {
  user: AppUser;
  password: AppUserPassword;
}

export type CreateWithConsumedInviteResult =
  | "created"
  | "invite_unavailable"
  | "email_already_registered";

export interface AccountSecurityActor { userId?: string; role: AppUser["role"] | "machine" }
export type AccountAccessResult = { outcome: "updated"; user: AppUser } | { outcome: "not_found" | "forbidden" | "last_owner" | "self_change" };

export interface AppUserRepository {
  create(user: AppUser, password: AppUserPassword): Promise<void>;
  createWithConsumedInvite?(
    user: AppUser,
    password: AppUserPassword,
    inviteId: string,
    nowIso: string,
  ): Promise<CreateWithConsumedInviteResult>;
  findByEmailWithPassword(email: string): Promise<AppUserWithPassword | null>;
  findById(id: string): Promise<AppUser | null>;
  list(): Promise<AppUser[]>;
  updateStatus(id: string, status: AppUser["status"], updatedAt: string): Promise<AppUser | null>;
  updateAccess(id: string, changes: { role?: AppUser["role"]; status?: AppUser["status"] }, updatedAt: string, actor: AccountSecurityActor): Promise<AccountAccessResult>;
  replacePasswordAndRevokeSessions(userId: string, expectedVersion: number, expectedPasswordHash: string, password: AppUserPassword): Promise<boolean>;
  invalidateSessions(userId: string, nowIso: string): Promise<boolean>;
}
