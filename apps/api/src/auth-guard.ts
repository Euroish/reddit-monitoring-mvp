import type { IncomingMessage } from "node:http";
import type { AppUserRole } from "../../../src/domain/entities/app-user";
import type { AppSessionRepository } from "../../../src/domain/repositories/app-session-repository";
import type { AppUserRepository } from "../../../src/domain/repositories/app-user-repository";
import { getCurrentAppUser } from "../../../src/application/use-cases/get-current-app-user.use-case";
import { SessionTokenService } from "../../../src/application/services/session-token.service";
import { DEFAULT_SESSION_COOKIE_NAME, readCookieValue } from "./auth-cookie";

export type ApiActor =
  | { type: "machine" }
  | { type: "session"; userId: string; role: AppUserRole; email: string };

export interface ResolveSessionActorOptions {
  req: IncomingMessage;
  nowIso: string;
  appUserRepository?: AppUserRepository;
  appSessionRepository?: AppSessionRepository;
  cookieName?: string;
  sessionTokenService?: SessionTokenService;
}

export async function resolveSessionActor(
  options: ResolveSessionActorOptions,
): Promise<ApiActor | null> {
  if (!options.appUserRepository || !options.appSessionRepository) {
    return null;
  }

  const token = readCookieValue(
    options.req.headers.cookie,
    options.cookieName ?? DEFAULT_SESSION_COOKIE_NAME,
  );
  if (!token) {
    return null;
  }

  const sessionTokenService = options.sessionTokenService ?? new SessionTokenService();
  const current = await getCurrentAppUser({
    appUserRepository: options.appUserRepository,
    appSessionRepository: options.appSessionRepository,
    tokenHash: sessionTokenService.hashToken(token),
    nowIso: options.nowIso,
  });
  if (!current) {
    return null;
  }

  return {
    type: "session",
    userId: current.user.id,
    role: current.user.role,
    email: current.user.email,
  };
}

export function canUseOpsWrite(actor: ApiActor): boolean {
  return actor.type === "machine" || actor.role === "owner" || actor.role === "admin";
}
