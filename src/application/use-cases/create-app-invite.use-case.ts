import { randomUUID } from "node:crypto";
import type { AppInvite } from "../../domain/entities/app-invite";
import type { AppUserRole } from "../../domain/entities/app-user";
import type { AppInviteRepository } from "../../domain/repositories/app-invite-repository";
import { SessionTokenService } from "../services/session-token.service";

export interface CreateAppInviteOptions {
  appInviteRepository: AppInviteRepository;
  sessionTokenService?: SessionTokenService;
  now?: () => string;
}

export interface CreateAppInviteResult {
  invite: AppInvite;
  code: string;
}

export class CreateAppInviteError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_invite_code" | "invite_code_conflict" | "invite_code_generation_failed",
  ) {
    super(message);
  }
}

function isSixDigitInviteCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

async function resolveInviteCode(args: {
  requestedCode?: string;
  appInviteRepository: AppInviteRepository;
  sessionTokenService: SessionTokenService;
}): Promise<string> {
  const requestedCode = args.requestedCode?.trim();
  if (requestedCode) {
    if (!isSixDigitInviteCode(requestedCode)) {
      throw new CreateAppInviteError("invite code must be a 6-digit number", "invalid_invite_code");
    }
    const existing = await args.appInviteRepository.findByCodeHash(
      args.sessionTokenService.hashToken(requestedCode),
    );
    if (existing) {
      throw new CreateAppInviteError("invite code already exists", "invite_code_conflict");
    }
    return requestedCode;
  }

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0");
    const existing = await args.appInviteRepository.findByCodeHash(
      args.sessionTokenService.hashToken(candidate),
    );
    if (!existing) {
      return candidate;
    }
  }

  throw new CreateAppInviteError(
    "unable to generate a unique invite code",
    "invite_code_generation_failed",
  );
}

export async function createAppInvite(
  options: CreateAppInviteOptions,
  input: {
    roleOnAccept: AppUserRole;
    maxUses: number;
    expiresAt?: string;
    code?: string;
  },
): Promise<CreateAppInviteResult> {
  const nowIso = options.now?.() ?? new Date().toISOString();
  const sessionTokenService = options.sessionTokenService ?? new SessionTokenService();
  const code = await resolveInviteCode({
    requestedCode: input.code,
    appInviteRepository: options.appInviteRepository,
    sessionTokenService,
  });
  const invite: AppInvite = {
    id: randomUUID(),
    codeHash: sessionTokenService.hashToken(code),
    status: "active",
    roleOnAccept: input.roleOnAccept,
    maxUses: input.maxUses,
    usedCount: 0,
    expiresAt: input.expiresAt,
    createdAt: nowIso,
  };
  await options.appInviteRepository.create(invite);
  return { invite, code };
}
