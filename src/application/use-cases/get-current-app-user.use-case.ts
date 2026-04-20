import type { AppUser } from "../../domain/entities/app-user";
import type { AppSession } from "../../domain/entities/app-session";
import type { AppSessionRepository } from "../../domain/repositories/app-session-repository";
import type { AppUserRepository } from "../../domain/repositories/app-user-repository";

export interface CurrentAppUser {
  user: AppUser;
  session: AppSession;
}

export async function getCurrentAppUser(args: {
  appUserRepository: AppUserRepository;
  appSessionRepository: AppSessionRepository;
  tokenHash: string;
  nowIso: string;
}): Promise<CurrentAppUser | null> {
  const session = await args.appSessionRepository.findByTokenHash(args.tokenHash);
  if (!session || session.expiresAt <= args.nowIso) {
    return null;
  }

  const user = await args.appUserRepository.findById(session.userId);
  if (!user || user.status !== "active") {
    return null;
  }

  await args.appSessionRepository.touch(args.tokenHash, args.nowIso);
  return { user, session };
}
