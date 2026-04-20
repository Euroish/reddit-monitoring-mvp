import { randomUUID } from "node:crypto";
import type { AppUser } from "../../domain/entities/app-user";
import type { AppInviteRepository } from "../../domain/repositories/app-invite-repository";
import type { AppUserRepository } from "../../domain/repositories/app-user-repository";
import { PasswordHashingService } from "../services/password-hashing.service";
import { SessionTokenService } from "../services/session-token.service";

export class RegisterAppUserError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_invite"
      | "invite_unavailable"
      | "email_already_registered"
      | "invalid_register_request",
  ) {
    super(message);
  }
}

export interface RegisterAppUserOptions {
  appUserRepository: AppUserRepository;
  appInviteRepository: AppInviteRepository;
  passwordHashingService?: PasswordHashingService;
  sessionTokenService?: SessionTokenService;
  now?: () => string;
}

export async function registerAppUser(
  options: RegisterAppUserOptions,
  input: {
    email: string;
    password: string;
    inviteCode: string;
    displayName?: string;
  },
): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || !input.inviteCode.trim()) {
    throw new RegisterAppUserError("email, password, and inviteCode are required", "invalid_register_request");
  }

  const sessionTokenService = options.sessionTokenService ?? new SessionTokenService();
  const passwordHashingService = options.passwordHashingService ?? new PasswordHashingService();
  const nowIso = options.now?.() ?? new Date().toISOString();
  const invite = await options.appInviteRepository.findByCodeHash(
    sessionTokenService.hashToken(input.inviteCode.trim()),
  );
  if (!invite || invite.status !== "active" || (invite.expiresAt && invite.expiresAt <= nowIso)) {
    throw new RegisterAppUserError("invite is unavailable", "invalid_invite");
  }
  if (invite.usedCount >= invite.maxUses) {
    throw new RegisterAppUserError("invite is unavailable", "invite_unavailable");
  }

  const existing = await options.appUserRepository.findByEmailWithPassword(email);
  if (existing) {
    throw new RegisterAppUserError("email is already registered", "email_already_registered");
  }

  const user: AppUser = {
    id: randomUUID(),
    email,
    displayName: input.displayName?.trim() || undefined,
    role: invite.roleOnAccept,
    status: "pending",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const password = {
    userId: user.id,
    passwordHash: await passwordHashingService.hashPassword(input.password),
    passwordAlgo: passwordHashingService.passwordAlgo,
    updatedAt: nowIso,
  };

  if (options.appUserRepository.createWithConsumedInvite) {
    const result = await options.appUserRepository.createWithConsumedInvite(
      user,
      password,
      invite.id,
      nowIso,
    );
    if (result === "email_already_registered") {
      throw new RegisterAppUserError("email is already registered", "email_already_registered");
    }
    if (result === "invite_unavailable") {
      throw new RegisterAppUserError("invite is unavailable", "invite_unavailable");
    }
    return user;
  }

  const consumed = await options.appInviteRepository.incrementUsedCountIfAvailable(invite.id, nowIso);
  if (!consumed) {
    throw new RegisterAppUserError("invite is unavailable", "invite_unavailable");
  }
  await options.appUserRepository.create(user, password);
  return user;
}
