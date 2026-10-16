import type { AppInvite } from "../../../domain/entities/app-invite";
import type { AppSession } from "../../../domain/entities/app-session";
import type { AppUser, AppUserPassword } from "../../../domain/entities/app-user";
import type { AppInviteRepository } from "../../../domain/repositories/app-invite-repository";
import type { AppSessionRepository } from "../../../domain/repositories/app-session-repository";
import type {
  CreateWithConsumedInviteResult,
  AppUserRepository,
  AppUserWithPassword,
  AccountSecurityActor, AccountAccessResult,
} from "../../../domain/repositories/app-user-repository";
import { accountAccessPolicy } from "../../../domain/account-access-policy";

export class InMemoryAppUserRepository implements AppUserRepository {
  private readonly byId = new Map<string, AppUser>();
  private readonly passwordByUserId = new Map<string, AppUserPassword>();
  private inviteRepository?: InMemoryAppInviteRepository;
  private sessionRepository?: InMemoryAppSessionRepository;

  public attachSessionRepository(repository: InMemoryAppSessionRepository): void { this.sessionRepository = repository; }
  public currentUser(id: string): AppUser | undefined { return this.byId.get(id); }

  public attachInviteRepository(inviteRepository: InMemoryAppInviteRepository): void {
    this.inviteRepository = inviteRepository;
  }

  public async create(user: AppUser, password: AppUserPassword): Promise<void> {
    this.byId.set(user.id, { ...user, credentialVersion: user.credentialVersion ?? 0 });
    this.passwordByUserId.set(user.id, password);
  }

  public async createWithConsumedInvite(
    user: AppUser,
    password: AppUserPassword,
    inviteId: string,
    nowIso: string,
  ): Promise<CreateWithConsumedInviteResult> {
    if (
      Array.from(this.byId.values()).some(
        (candidate) => candidate.email.toLowerCase() === user.email.toLowerCase(),
      )
    ) {
      return "email_already_registered";
    }
    const consumed = await this.inviteRepository?.incrementUsedCountIfAvailable(inviteId, nowIso);
    if (!consumed) {
      return "invite_unavailable";
    }
    await this.create(user, password);
    return "created";
  }

  public async findByEmailWithPassword(email: string): Promise<AppUserWithPassword | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = Array.from(this.byId.values()).find(
      (candidate) => candidate.email.toLowerCase() === normalizedEmail,
    );
    if (!user) {
      return null;
    }
    const password = this.passwordByUserId.get(user.id);
    return password ? { user, password } : null;
  }

  public async findById(id: string): Promise<AppUser | null> {
    return this.byId.get(id) ?? null;
  }

  public async list(): Promise<AppUser[]> {
    return Array.from(this.byId.values()).sort((left, right) => {
      if (left.createdAt === right.createdAt) {
        return left.email.localeCompare(right.email);
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  }

  public async updateStatus(
    id: string,
    status: AppUser["status"],
    updatedAt: string,
  ): Promise<AppUser | null> {
    const result = await this.updateAccess(id, { status }, updatedAt, { role: "machine" });
    if (result.outcome === "last_owner") throw new Error("Cannot remove the last active owner");
    return result.outcome === "updated" ? result.user : null;
  }

  public async updateAccess(id: string, changes: { role?: AppUser["role"]; status?: AppUser["status"] }, updatedAt: string, actor: AccountSecurityActor): Promise<AccountAccessResult> {
    let actualActor = actor;
    if (actor.role !== "machine") {
      const currentActor = actor.userId ? this.byId.get(actor.userId) : undefined;
      if (!currentActor || currentActor.status !== "active") return { outcome: "forbidden" };
      actualActor = { userId: currentActor.id, role: currentActor.role };
    }
    const current = this.byId.get(id);
    if (!current) return { outcome: "not_found" };
    const policy = accountAccessPolicy(actualActor, current, changes);
    if (policy !== "allowed") return { outcome: policy };
    const role = changes.role ?? current.role, status = changes.status ?? current.status;
    if (role === current.role && status === current.status) return { outcome: "updated", user: current };
    if (current.role === "owner" && current.status === "active" && (role !== "owner" || status !== "active") && !Array.from(this.byId.values()).some(user => user.id !== id && user.role === "owner" && user.status === "active")) return { outcome: "last_owner" };
    const user = { ...current, role, status, updatedAt, credentialVersion: (current.credentialVersion ?? 0) + 1 };
    this.byId.set(id, user);
    await this.sessionRepository?.deleteByUserId(id);
    return { outcome: "updated", user };
  }

  public async replacePasswordAndRevokeSessions(userId: string, expectedVersion: number, expectedPasswordHash: string, password: AppUserPassword): Promise<boolean> {
    const current = this.byId.get(userId), oldPassword = this.passwordByUserId.get(userId);
    if (!current || current.status !== "active" || (current.credentialVersion ?? 0) !== expectedVersion || oldPassword?.passwordHash !== expectedPasswordHash) return false;
    this.passwordByUserId.set(userId, password);
    this.byId.set(userId, { ...current, updatedAt: password.updatedAt, credentialVersion: expectedVersion + 1 });
    await this.sessionRepository?.deleteByUserId(userId);
    return true;
  }

  public async invalidateSessions(userId: string, nowIso: string): Promise<boolean> {
    const current = this.byId.get(userId); if (!current) return false;
    this.byId.set(userId, { ...current, updatedAt: nowIso, credentialVersion: (current.credentialVersion ?? 0) + 1 });
    await this.sessionRepository?.deleteByUserId(userId);
    return true;
  }

  public all(): AppUser[] {
    return Array.from(this.byId.values());
  }
}

export class InMemoryAppInviteRepository implements AppInviteRepository {
  private readonly byId = new Map<string, AppInvite>();

  public async create(invite: AppInvite): Promise<void> {
    this.byId.set(invite.id, invite);
  }

  public async findByCodeHash(codeHash: string): Promise<AppInvite | null> {
    return Array.from(this.byId.values()).find((invite) => invite.codeHash === codeHash) ?? null;
  }

  public async incrementUsedCountIfAvailable(id: string, nowIso: string): Promise<boolean> {
    const current = this.byId.get(id);
    if (
      !current ||
      current.status !== "active" ||
      current.usedCount >= current.maxUses ||
      (current.expiresAt && current.expiresAt <= nowIso)
    ) {
      return false;
    }
    this.byId.set(id, { ...current, usedCount: current.usedCount + 1 });
    return true;
  }

  public all(): AppInvite[] {
    return Array.from(this.byId.values());
  }
}

export class InMemoryAppSessionRepository implements AppSessionRepository {
  private readonly byTokenHash = new Map<string, AppSession>();
  constructor(private readonly users?: InMemoryAppUserRepository) { users?.attachSessionRepository(this); }

  public async create(session: AppSession): Promise<void> {
    if (!await this.createIfCurrent(session, session.credentialVersion ?? 0)) throw new Error("Account credentials changed or account is inactive");
  }

  public async createIfCurrent(session: AppSession, expectedVersion: number): Promise<boolean> {
    const user = this.users?.currentUser(session.userId);
    // No await between reading the version and inserting: the in-memory operation is atomic.
    if (!user || user.status !== "active" || (user.credentialVersion ?? 0) !== expectedVersion) return false;
    this.byTokenHash.set(session.tokenHash, { ...session, credentialVersion: expectedVersion });
    return true;
  }

  public async findByTokenHash(tokenHash: string): Promise<AppSession | null> {
    return this.byTokenHash.get(tokenHash) ?? null;
  }

  public async touch(tokenHash: string, lastSeenAt: string): Promise<void> {
    const current = this.byTokenHash.get(tokenHash);
    if (!current) {
      return;
    }
    this.byTokenHash.set(tokenHash, { ...current, lastSeenAt });
  }

  public async deleteByTokenHash(tokenHash: string): Promise<void> {
    this.byTokenHash.delete(tokenHash);
  }

  public async deleteByUserId(userId: string): Promise<void> {
    for (const [tokenHash, session] of this.byTokenHash.entries()) {
      if (session.userId === userId) {
        this.byTokenHash.delete(tokenHash);
      }
    }
  }

  public async listByUserId(userId: string, nowIso: string): Promise<AppSession[]> {
    const user = this.users?.currentUser(userId);
    if (!user || user.status !== "active") return [];
    return Array.from(this.byTokenHash.values()).filter(session => session.userId === userId && session.expiresAt > nowIso && (session.credentialVersion ?? 0) === (user.credentialVersion ?? 0)).sort((a,b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || b.id.localeCompare(a.id)).slice(0,100);
  }

  public async deleteOwnById(userId: string, sessionId: string, nowIso: string): Promise<boolean> {
    const user = this.users?.currentUser(userId);
    const session = Array.from(this.byTokenHash.values()).find(item => item.id === sessionId && item.userId === userId && item.expiresAt > nowIso && user?.status === "active" && (item.credentialVersion ?? 0) === (user.credentialVersion ?? 0));
    return session ? this.byTokenHash.delete(session.tokenHash) : false;
  }

  public all(): AppSession[] {
    return Array.from(this.byTokenHash.values());
  }
}
