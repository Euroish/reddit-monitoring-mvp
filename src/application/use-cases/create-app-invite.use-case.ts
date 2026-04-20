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

export async function createAppInvite(
  options: CreateAppInviteOptions,
  input: {
    roleOnAccept: AppUserRole;
    maxUses: number;
    expiresAt?: string;
  },
): Promise<CreateAppInviteResult> {
  const nowIso = options.now?.() ?? new Date().toISOString();
  const sessionTokenService = options.sessionTokenService ?? new SessionTokenService();
  const code = sessionTokenService.createToken();
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
