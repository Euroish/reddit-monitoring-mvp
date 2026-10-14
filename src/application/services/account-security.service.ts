import type { AppUser } from "../../domain/entities/app-user";
import type { AppUserRepository, AccountSecurityActor } from "../../domain/repositories/app-user-repository";
import type { AppSessionRepository } from "../../domain/repositories/app-session-repository";
import { PasswordHashingService } from "./password-hashing.service";
import { isValidNewPassword, NEW_PASSWORD_POLICY_MESSAGE } from "./password-policy";

export class AccountSecurityError extends Error {
  constructor(public readonly code: "invalid_request" | "invalid_credentials" | "account_changed" | "not_found" | "forbidden" | "last_owner" | "self_change", public readonly status: 400 | 401 | 403 | 404 | 409, message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function userId(value: string) { if (!uuid.test(value)) throw new AccountSecurityError("invalid_request", 400, "Invalid user or session ID"); }

export class AccountSecurityService {
  constructor(private readonly repositories: { appUserRepository: AppUserRepository; appSessionRepository: AppSessionRepository }, private readonly passwords = new PasswordHashingService(), private readonly now = () => new Date().toISOString()) {}

  async changePassword(id: string, input: { currentPassword: string; newPassword: string }): Promise<void> {
    userId(id);
    if (typeof input.currentPassword !== "string" || !input.currentPassword || !isValidNewPassword(input.newPassword)) throw new AccountSecurityError("invalid_request", 400, `${NEW_PASSWORD_POLICY_MESSAGE}; current password is required`);
    const user = await this.repositories.appUserRepository.findById(id);
    const record = user ? await this.repositories.appUserRepository.findByEmailWithPassword(user.email) : null;
    if (!record || record.user.id !== id || record.user.status !== "active" || !await this.passwords.verifyPassword(input.currentPassword, record.password.passwordHash)) throw new AccountSecurityError("invalid_credentials", 401, "Current password is incorrect or the account is inactive");
    const passwordHash = await this.passwords.hashPassword(input.newPassword);
    const changed = await this.repositories.appUserRepository.replacePasswordAndRevokeSessions(id, record.user.credentialVersion ?? 0, record.password.passwordHash, { userId: id, passwordHash, passwordAlgo: this.passwords.passwordAlgo, updatedAt: this.now() });
    if (!changed) throw new AccountSecurityError("account_changed", 409, "Account credentials changed; sign in and retry");
  }

  async listSessions(id: string, currentSessionId?: string) {
    userId(id);
    return (await this.repositories.appSessionRepository.listByUserId(id, this.now())).map(session => ({ id: session.id, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt, current: session.id === currentSessionId }));
  }
  async revokeSession(id: string, sessionId: string): Promise<boolean> { userId(id); userId(sessionId); return this.repositories.appSessionRepository.deleteOwnById(id, sessionId, this.now()); }
  async revokeAllSessions(id: string): Promise<void> { userId(id); if (!await this.repositories.appUserRepository.invalidateSessions(id, this.now())) throw new AccountSecurityError("not_found", 404, "Account not found"); }
  async changeStatus(actor: AccountSecurityActor, id: string, status: AppUser["status"]): Promise<AppUser> {
    if (!["pending", "active", "disabled"].includes(status)) throw new AccountSecurityError("invalid_request", 400, "Invalid account status");
    return this.changeAccess(actor, id, { status });
  }
  async changeRole(actor: AccountSecurityActor, id: string, role: AppUser["role"]): Promise<AppUser> {
    if (!["owner", "admin", "viewer"].includes(role)) throw new AccountSecurityError("invalid_request", 400, "Invalid account role");
    return this.changeAccess(actor, id, { role });
  }
  private async changeAccess(actor: AccountSecurityActor, id: string, changes: { role?: AppUser["role"]; status?: AppUser["status"] }): Promise<AppUser> {
    userId(id); if (actor.userId) userId(actor.userId);
    const result = await this.repositories.appUserRepository.updateAccess(id, changes, this.now(), actor);
    if (result.outcome === "updated") return result.user;
    if (result.outcome === "not_found") throw new AccountSecurityError("not_found", 404, "Account not found");
    if (result.outcome === "forbidden") throw new AccountSecurityError("forbidden", 403, "Account operation is outside your role permissions");
    if (result.outcome === "self_change") throw new AccountSecurityError("self_change", 409, "You cannot disable or demote your own account");
    throw new AccountSecurityError("last_owner", 409, "Cannot remove the last active owner");
  }
}
