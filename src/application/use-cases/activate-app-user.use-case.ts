import type { AppUser } from "../../domain/entities/app-user";
import type { AppUserRepository } from "../../domain/repositories/app-user-repository";

export async function activateAppUser(args: {
  appUserRepository: AppUserRepository;
  userId: string;
  nowIso: string;
}): Promise<AppUser | null> {
  return args.appUserRepository.updateStatus(args.userId, "active", args.nowIso);
}
