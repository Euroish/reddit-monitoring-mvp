import { randomUUID } from "node:crypto";
import type { AppUser, AppUserPassword } from "../../domain/entities/app-user";
import type { AppUserWithPassword } from "../../domain/repositories/app-user-repository";
import { PasswordHashingService } from "../services/password-hashing.service";

export class BootstrapFirstOwnerError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_bootstrap_request"
      | "owner_bootstrap_not_empty"
      | "owner_email_already_registered",
  ) {
    super(message);
  }
}

export interface BootstrapFirstOwnerStore {
  hasAnyUsers(): Promise<boolean>;
  findByEmailWithPassword(email: string): Promise<AppUserWithPassword | null>;
  create(user: AppUser, password: AppUserPassword): Promise<void>;
}

export interface BootstrapFirstOwnerOptions {
  store: BootstrapFirstOwnerStore;
  passwordHashingService?: PasswordHashingService;
  now?: () => string;
}

export async function bootstrapFirstOwner(
  options: BootstrapFirstOwnerOptions,
  input: {
    email: string;
    password: string;
    displayName?: string;
  },
): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  const password = input.password.trim();
  if (!email || !password) {
    throw new BootstrapFirstOwnerError(
      "email and password are required",
      "invalid_bootstrap_request",
    );
  }

  const existingUser = await options.store.findByEmailWithPassword(email);
  if (existingUser) {
    throw new BootstrapFirstOwnerError(
      "email is already registered",
      "owner_email_already_registered",
    );
  }

  const hasAnyUsers = await options.store.hasAnyUsers();
  if (hasAnyUsers) {
    throw new BootstrapFirstOwnerError(
      "bootstrap-first-owner is only allowed before any app user exists",
      "owner_bootstrap_not_empty",
    );
  }

  const nowIso = options.now?.() ?? new Date().toISOString();
  const passwordHashingService = options.passwordHashingService ?? new PasswordHashingService();
  const user: AppUser = {
    id: randomUUID(),
    email,
    displayName: input.displayName?.trim() || undefined,
    role: "owner",
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const userPassword: AppUserPassword = {
    userId: user.id,
    passwordHash: await passwordHashingService.hashPassword(password),
    passwordAlgo: passwordHashingService.passwordAlgo,
    updatedAt: nowIso,
  };

  await options.store.create(user, userPassword);
  return user;
}
