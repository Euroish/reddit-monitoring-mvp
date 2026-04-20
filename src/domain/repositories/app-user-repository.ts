import type { AppUser, AppUserPassword } from "../entities/app-user";

export interface AppUserWithPassword {
  user: AppUser;
  password: AppUserPassword;
}

export type CreateWithConsumedInviteResult =
  | "created"
  | "invite_unavailable"
  | "email_already_registered";

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
  updateStatus(id: string, status: AppUser["status"], updatedAt: string): Promise<AppUser | null>;
}
