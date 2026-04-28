import type { AppInvite } from "../../../domain/entities/app-invite";
import type { AppSession } from "../../../domain/entities/app-session";
import type { AppUser, AppUserPassword } from "../../../domain/entities/app-user";
import type { AppInviteRepository } from "../../../domain/repositories/app-invite-repository";
import type { AppSessionRepository } from "../../../domain/repositories/app-session-repository";
import type {
  CreateWithConsumedInviteResult,
  AppUserRepository,
  AppUserWithPassword,
} from "../../../domain/repositories/app-user-repository";

export class InMemoryAppUserRepository implements AppUserRepository {
  private readonly byId = new Map<string, AppUser>();
  private readonly passwordByUserId = new Map<string, AppUserPassword>();
  private inviteRepository?: InMemoryAppInviteRepository;

  public attachInviteRepository(inviteRepository: InMemoryAppInviteRepository): void {
    this.inviteRepository = inviteRepository;
  }

  public async create(user: AppUser, password: AppUserPassword): Promise<void> {
    this.byId.set(user.id, user);
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
    const current = this.byId.get(id);
    if (!current) {
      return null;
    }
    const next = { ...current, status, updatedAt };
    this.byId.set(id, next);
    return next;
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

  public async create(session: AppSession): Promise<void> {
    this.byTokenHash.set(session.tokenHash, session);
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

  public all(): AppSession[] {
    return Array.from(this.byTokenHash.values());
  }
}
