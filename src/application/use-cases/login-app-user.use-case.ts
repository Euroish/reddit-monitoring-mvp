import { randomUUID } from "node:crypto";
import type { AppUser } from "../../domain/entities/app-user";
import type { AppSession } from "../../domain/entities/app-session";
import type { AppSessionRepository } from "../../domain/repositories/app-session-repository";
import type { AppUserRepository } from "../../domain/repositories/app-user-repository";
import { PasswordHashingService } from "../services/password-hashing.service";
import { SessionTokenService } from "../services/session-token.service";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_credentials" | "unauthorized",
  ) {
    super(message);
  }
}

export interface LoginAppUserOptions {
  appUserRepository: AppUserRepository;
  appSessionRepository: AppSessionRepository;
  passwordHashingService?: PasswordHashingService;
  sessionTokenService?: SessionTokenService;
  sessionTtlSeconds?: number;
  now?: () => string;
}

export interface LoginAppUserResult {
  user: AppUser;
  session: AppSession;
  token: string;
}

export async function loginAppUser(
  options: LoginAppUserOptions,
  input: { email: string; password: string },
): Promise<LoginAppUserResult> {
  const email = input.email.trim().toLowerCase();
  const passwordHashingService = options.passwordHashingService ?? new PasswordHashingService();
  const sessionTokenService = options.sessionTokenService ?? new SessionTokenService();
  const nowIso = options.now?.() ?? new Date().toISOString();
  const sessionTtlSeconds = Math.max(60, options.sessionTtlSeconds ?? 7 * 24 * 60 * 60);

  const record = await options.appUserRepository.findByEmailWithPassword(email);
  if (!record) {
    throw new AuthError("invalid email or password", "invalid_credentials");
  }

  const passwordOk = await passwordHashingService.verifyPassword(
    input.password,
    record.password.passwordHash,
  );
  if (!passwordOk) {
    throw new AuthError("invalid email or password", "invalid_credentials");
  }

  if (record.user.status !== "active") {
    throw new AuthError("invalid email or password", "invalid_credentials");
  }

  const token = sessionTokenService.createToken();
  const session: AppSession = {
    id: randomUUID(),
    userId: record.user.id,
    tokenHash: sessionTokenService.hashToken(token),
    expiresAt: new Date(new Date(nowIso).getTime() + sessionTtlSeconds * 1000).toISOString(),
    lastSeenAt: nowIso,
    createdAt: nowIso,
  };
  await options.appSessionRepository.create(session);
  return {
    user: record.user,
    session,
    token,
  };
}
